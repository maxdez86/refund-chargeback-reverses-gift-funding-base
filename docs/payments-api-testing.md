# Payments API Testing

Production-first runbook for validating the backend payment flow before any frontend integration.

## Required local `.env` values

Set or confirm these values in `.env`:

```bash
STAGE=prod
AWS_PROFILE=<aws-cli-profile>
AWS_REGION=us-east-1
ROOT_DOMAIN=brimax.life
PAYMENTS_STACK_NAME=BrimaxAppStack
PAYMENTS_DATA_STACK_NAME=BrimaxDataStack
PAYMENTS_OBSERVABILITY_STACK_NAME=BrimaxObservabilityStack
ASAAS_ENV=production
ASAAS_API_BASE_URL=https://api.asaas.com/v3
PAYMENTS_TEST_GIFT_ID=g-armario
PAYMENTS_TEST_GIFT_QUANTITY=1
PAYMENTS_TEST_PAYER_NAME=<real tester name>
PAYMENTS_TEST_PAYER_EMAIL=<email you control>
PAYMENTS_TEST_PAYER_CPF=<valid cpf>
PAYMENTS_TEST_PAYER_PHONE=<optional phone>
```

Value sources:

- `AWS_PROFILE`, `AWS_REGION`: local AWS CLI configuration for the production account.
- `ROOT_DOMAIN`, `STAGE`: same deploy convention used by the existing repo scripts.
- `PAYMENTS_*_STACK_NAME`: production CDK stack names.
- `ASAAS_API_BASE_URL`: Asaas production API endpoint.
- `PAYMENTS_TEST_GIFT_*`: backend gift catalog. `g-armario` with quantity `1` keeps the PIX test at `R$50,00`.
- `PAYMENTS_TEST_PAYER_*`: controlled real identity used for live payment testing.

## Secrets Manager setup

Create or update these two secrets in AWS Secrets Manager:

- `/prod/brimax/asaas/api-key`
- `/prod/brimax/asaas/webhook-token`

The API key comes from the Asaas production dashboard credentials area.

The webhook token is a secret you generate yourself and also configure in Asaas for the production webhook endpoint.

Accepted secret shapes:

- Plain text
- `{"value":"..."}`
- `{"token":"..."}`
- `{"apiKey":"..."}`

Example commands:

```bash
aws secretsmanager create-secret \
  --name /prod/brimax/asaas/api-key \
  --secret-string '{"apiKey":"replace-me"}'

aws secretsmanager create-secret \
  --name /prod/brimax/asaas/webhook-token \
  --secret-string '{"token":"replace-me"}'
```

If the secret already exists, use `update-secret` instead of `create-secret`.

## Pre-flight

Confirm the following before running live tests:

```bash
pnpm install
aws sts get-caller-identity
jq --version
```

In Asaas production webhook settings:

- Set the webhook URL to `https://<api-id>.execute-api.us-east-1.amazonaws.com/webhooks/asaas`
- Set the webhook token to the same value stored in `/prod/brimax/asaas/webhook-token`

## Backend-only deploy

Deploy only the backend stacks:

```bash
bash scripts/deploy-backend.sh
```

This deploys:

- `BrimaxDataStack`
- `BrimaxAppStack`
- `BrimaxObservabilityStack`

It does not deploy:

- `BrimaxEdgeStack`
- `BrimaxCertificateStack`
- `BrimaxPlatformStack`

## Resolve deployed API values

Load the payment test environment:

```bash
source scripts/payments-env.sh
require_payments_test_env
printf '%s\n' "${PAYMENTS_API_URL}"
```

The script resolves these values from CloudFormation outputs:

- `PAYMENTS_API_URL`
- `PAYMENTS_TABLE_NAME`
- `PAYMENTS_WEBHOOK_QUEUE_URL`
- `PAYMENTS_ASAAS_API_SECRET_ARN`
- `PAYMENTS_ASAAS_WEBHOOK_SECRET_ARN`

## PIX-first API runbook

Create a PIX payment:

```bash
bash scripts/test-payments-pix.sh
```

This script:

- Calls `POST /payments`
- Saves request and response artifacts to `.tmp/payments-tests/...`
- Verifies `201`, `ok=true`, `AWAITING_PAYMENT`, `paymentId`, and PIX payload fields
- Calls `GET /payments/{paymentId}` immediately and verifies the returned state

Complete the payment manually using the printed `pix.copyPaste` value.

Then verify webhook-driven state changes:

```bash
PAYMENT_ID=<captured paymentId> bash scripts/test-payments-webhook.sh
```

Expected result:

- `GET /payments/{paymentId}` moves from `AWAITING_PAYMENT` to `CONFIRMED` or `RECEIVED`

If the webhook does not arrive:

1. Inspect webhook delivery in the Asaas production dashboard.
2. Confirm the webhook URL matches `${PAYMENTS_API_URL}/webhooks/asaas`.
3. Re-send the event from Asaas.
4. Check CloudWatch logs for `AsaasWebhookFunction` and `AsaasWebhookProcessorFunction`.

## Negative and resilience tests

Run:

```bash
bash scripts/test-payments-negative.sh
```

This covers:

- Invalid `giftId` returns `400`
- Same payload + same idempotency key returns the same `paymentId`
- Different payload + same idempotency key returns `409`
- Invalid webhook token returns `403`
- Same webhook body submitted twice returns `duplicate=true` on the second request

## Additional checks before frontend integration

Manual checks still recommended after the scripts pass:

- Card smoke test:
  create one `CREDIT_CARD` payment and verify `invoiceUrl` is returned and reachable.
- DynamoDB verification:
  inspect the payment item and webhook event item to confirm status progression, `asaasPaymentId` lookup fields, masked CPF persistence, and webhook retention fields.
- Queue verification:
  confirm the main webhook queue drains and the DLQ remains empty.
- Alarm verification:
  confirm the payment error alarms exist in CloudWatch.
- Log verification:
  confirm these metrics/log markers are present:
  `PAYMENT_CREATED`
  `PAYMENT_CREATE_FAILED`
  `WEBHOOK_AUTH_FAILED`
  `WEBHOOK_DUPLICATE`
  `PAYMENT_STATE_TRANSITION`
- Replay behavior:
  re-send the same Asaas webhook and confirm there is no state regression.
- Polling contract:
  confirm `GET /payments/{paymentId}` stays stable enough for the future frontend polling flow.
- Rollback prep:
  document how to rotate `/prod/brimax/asaas/webhook-token` or disable the Asaas webhook quickly if the live test misbehaves.
