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
true }`. Logs contain only allowlisted correlation metadata; message text,
sender identifiers, profile names, media details, and raw payloads are not
logged. Webhook events are durably recorded with a processing state and
deduplicated by provider/event ID before the worker processes them.

## Outbound template configuration

Outbound template sends use Graph API `v25.0`. Each stage requires:

- `WHATSAPP_ACCESS_TOKEN`: secret source value that CDK stores as
  `whatsappAccessToken` in the stage JSON Secrets Manager bucket.
- `WHATSAPP_PHONE_NUMBER_ID`: non-secret, stage-specific runtime and GitHub
  environment variable.

Use different values in dev and production. Never place the access token in
documentation, test fixtures, command output, or browser configuration. If a
token has appeared outside a secure store, rotate it before use. Updating the
shared CDK-managed JSON secret can also regenerate `lookupProofSecret`, so plan
rotation around the 30-minute RSVP lookup-proof lifetime. Runtime secret caches
may retain the previous token for up to five minutes.

Templates are immutable, versioned records in the stage wedding table. A stable
purpose resolves through an active pointer, and every activation writes a
history record. No recipient or recipient-specific value belongs in these
records.

Create and activate the initial dev template explicitly:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm whatsapp:template -- create \
  --purpose wedding_invitation --version 1 --name wedding --language en --apply

BRIMAX_ENV_FILE=.env.dev pnpm whatsapp:template -- activate \
  --purpose wedding_invitation --version 1 --apply
```

Template writes default to dry-run. Production writes additionally require
`--confirm-prod`. Optional component definitions are supplied through
`--components-file` as validated JSON. Older immutable versions can be
reactivated for rollback.

## Guarded dev send

The operational send command is deliberately restricted to `STAGE=dev` and is
not used by CI, CDK, deployment, or Lambda handlers:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm whatsapp:send-template -- \
  --purpose wedding_invitation \
  --recipient '<country-code-and-number>' \
  --confirm-send
```

This performs one irreversible external send that can consume Meta rate limits
or incur charges. It does not retry. The command prints only the stage,
template purpose/version, outbound message ID, and provider trace ID; it does
not print the token, recipient, parameters, or raw Meta response. For templates
with runtime variables, pass a local JSON object through `--parameters-file`;
do not commit that file.

If a send fails with `ambiguous_delivery`, Meta returned successful response
headers but the response body and message ID could not be recovered. The
message may already have been accepted. Do not resend automatically; reconcile
the outcome manually using webhook status events or Meta tooling before
deciding whether another send is safe.

The same no-resend rule applies to `timeout` and `network` failures. Without an
HTTP response, the client cannot prove whether Meta received the request, so
both categories are non-retryable and their delivery outcome is unknown. The
operator client allows 15 seconds for the request and response body, but that
longer deadline only reduces ambiguity; it does not make a timed-out request
safe to replay. Future Lambda callers must choose a shorter timeout that leaves
enough execution time for safe shutdown and logging.

Outbound message IDs can later correlate status webhooks and inbound
`replyContextMessageId` values. This phase does not persist outbound sends,
match guests, update RSVP state, or generate automatic replies.

The previously referenced `docs/whatsapp_integration_context.md` is not present.
Do not recreate stale local-server/ngrok instructions or copy credentials from
historical material; this deployed Lambda runbook is authoritative.
