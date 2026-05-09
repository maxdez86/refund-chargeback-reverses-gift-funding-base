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
ASAAS_API_KEY=<raw asaas production api key>
ASAAS_WEBHOOK_TOKEN=<raw webhook token to be written by cdk>
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
- `ASAAS_API_KEY`: raw Asaas API key from the Asaas production dashboard.
- `ASAAS_WEBHOOK_TOKEN`: raw token you generate and configure in Asaas for the production webhook endpoint.
- `PAYMENTS_TEST_GIFT_*`: backend gift catalog. `g-armario` with quantity `1` keeps the PIX test at `R$50,00`.
- `PAYMENTS_TEST_PAYER_*`: controlled real identity used for live payment testing.

CDK will use the raw env vars to create or update these Secrets Manager entries during backend deployment:

- `/prod/brimax/asaas/api-key`
- `/prod/brimax/asaas/webhook-token`

The deployed payload shapes are:

- `{"apiKey":"<ASAAS_API_KEY>"}`
- `{"token":"<ASAAS_WEBHOOK_TOKEN>"}`

## Pre-flight

Confirm the following before running live tests:

```bash
pnpm install
aws sts get-caller-identity
jq --version
```

## API domain prerequisites

The payment API now uses `https://api.brimax.life` as its public base URL and webhook host.

Before production payment tests, make sure the API domain rollout has been completed:

1. Deploy the certificate stack.
2. Apply the certificate validation DNS records through OpenTofu.
3. Wait for ACM issuance.
4. Deploy the backend so API Gateway attaches the custom domain.
5. Apply the API DNS record in Cloudflare.

The exact commands are listed below.

## Backend and API domain deploy with IaC-managed secrets

Deploy the certificate stack first:

```bash
bash scripts/deploy-landing-certificate.sh
bash scripts/landing-opentofu.sh certificate-validation init
bash scripts/landing-opentofu.sh certificate-validation apply
pnpm wait:landing:cert
```

Then deploy the backend stacks:

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

The deploy script requires `ASAAS_API_KEY` and `ASAAS_WEBHOOK_TOKEN` and passes them into CDK so the payment secrets are fully managed as infrastructure.

Then apply the API DNS record:

```bash
bash scripts/landing-opentofu.sh api-dns init
bash scripts/landing-opentofu.sh api-dns apply
```

The `api-dns` module creates a DNS-only Cloudflare CNAME for `api.brimax.life` that points at the API Gateway regional custom-domain target.

## Resolve deployed API values, verify secrets, and confirm the branded webhook

Load the payment test environment:

```bash
source scripts/payments-env.sh
require_payments_test_env
verify_payments_secret_contract
printf '%s\n' "${PAYMENTS_API_URL}"
printf '%s\n' "${PAYMENTS_WEBHOOK_URL}"
```

The script resolves these values from CloudFormation outputs:

- `PAYMENTS_API_URL`
- `PAYMENTS_WEBHOOK_URL`
- `PAYMENTS_TABLE_NAME`
- `PAYMENTS_WEBHOOK_QUEUE_URL`
- `PAYMENTS_ASAAS_API_SECRET_ARN`
- `PAYMENTS_ASAAS_WEBHOOK_SECRET_ARN`

`PAYMENTS_API_URL` is the production base URL and should resolve to `https://api.brimax.life`.

`PAYMENTS_EXECUTE_API_URL` is also loaded for fallback diagnostics, but it is intentionally the raw API Gateway hostname and should not be used as the normal production endpoint or Asaas webhook target.

## Confirm Asaas webhook configuration

In Asaas production webhook settings:

- Set the webhook URL to `https://api.brimax.life/webhooks/asaas`
- Set the webhook token to the same raw value used in `ASAAS_WEBHOOK_TOKEN`

## PIX-first production API runbook

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
2. Confirm the webhook URL matches `${PAYMENTS_WEBHOOK_URL}`.
3. Confirm the webhook token configured in Asaas matches `ASAAS_WEBHOOK_TOKEN`.
4. Re-send the event from Asaas.
5. Check CloudWatch logs for `AsaasWebhookFunction` and `AsaasWebhookProcessorFunction`.

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
- Custom domain check:
  confirm `https://api.brimax.life/payments/<paymentId>` reaches the API and that the execute-api hostname is no longer the documented public endpoint.
- Rollback prep:
  document how to rotate `ASAAS_WEBHOOK_TOKEN`, redeploy the backend, or temporarily disable the Asaas webhook if the live test misbehaves.
