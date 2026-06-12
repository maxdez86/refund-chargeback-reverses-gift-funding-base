# Asaas Webhook Processor Diagnostics

## Deployment Verification

Resolve the deployed Lambda name from CloudFormation:

```bash
aws cloudformation describe-stack-resources \
  --stack-name <app-stack-name> \
  --logical-resource-id AsaasWebhookProcessorFunction \
  --query 'StackResources[0].PhysicalResourceId' \
  --output text
```

Confirm the deployed bundle logged the current resolver marker:

```bash
aws logs tail "/aws/lambda/<function-name>" \
  --since 1h \
  --filter-pattern '"WEBHOOK_PROCESSOR_BUILD_INFO"'
```

Expected marker:

```json
{"metric":"WEBHOOK_PROCESSOR_BUILD_INFO","paymentResolutionVersion":"resolvePaymentForWebhook-v1"}
```

## Incident Workflow

Inspect unmatched webhook diagnostics in CloudWatch Logs:

```bash
aws logs tail "/aws/lambda/<function-name>" \
  --since 1h \
  --filter-pattern '"WEBHOOK_PAYMENT_NOT_FOUND"'
```

Run the repo-local diagnosis tool with either the stored `eventId` or the Asaas payment id:

```bash
node scripts/diagnose-asaas-webhook.mjs --event-id <event-id> --stage prod
node scripts/diagnose-asaas-webhook.mjs --asaas-payment-id <asaas-payment-id> --stage prod
```

Environment expected by the diagnosis tool:

- `ASAAS_API_KEY`
- `ASAAS_API_BASE_URL` (optional; defaults by stage)
- `WEDDING_TABLE_NAME` or `PAYMENTS_TABLE_NAME` (optional; defaults by stage)

Classification guidance:

- `stale-deployment`: the current stored data resolves to a payment, so the reported 404 likely came from an older deployed bundle or a transient earlier state
- `missing-webhook-identifiers`: the stored webhook event does not contain enough identifiers to resolve a payment
- `asaas-missing-references`: Asaas returned no usable `externalReference` or `checkoutSession`
- `local-payment-missing`: identifiers exist, but no local payment record matches them
- `unclassified`: none of the deterministic buckets matched
