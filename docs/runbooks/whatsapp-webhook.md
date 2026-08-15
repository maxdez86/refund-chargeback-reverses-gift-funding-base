# WhatsApp Webhook Runbook

The deployed endpoints are:

- Production: `https://api.brimax.life/webhooks/whatsapp`
- Development: `https://api.dev.brimax.life/webhooks/whatsapp`

Configure each Meta application with its matching URL and stage-specific
`WHATSAPP_VERIFY_TOKEN`. Configure `WHATSAPP_APP_SECRET` from the Meta app
settings in the matching GitHub environment. Both values are loaded into the
stage's CDK-managed JSON Secrets Manager bucket.

After deployment, verify the endpoint manually with placeholders:

```bash
WEBHOOK_URL='https://api.dev.brimax.life/webhooks/whatsapp'
VERIFY_TOKEN='replace-with-the-dev-verification-token'
CHALLENGE='test-challenge'

curl --fail-with-body --get "${WEBHOOK_URL}" \
  --data-urlencode 'hub.mode=subscribe' \
  --data-urlencode "hub.verify_token=${VERIFY_TOKEN}" \
  --data-urlencode "hub.challenge=${CHALLENGE}"
```

An invalid verification token must return HTTP 403. Meta POST deliveries must
include a valid `X-Hub-Signature-256` header and a WhatsApp Business Account
payload; accepted deliveries return HTTP 200 with `{ "ok": true, "received":
true }`. Text message bodies are written to the Lambda log for the initial
receipt workflow, but webhook payloads are not persisted and no durable
duplicate protection exists yet.
