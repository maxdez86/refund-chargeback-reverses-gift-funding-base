# WhatsApp RSVP operator runbook

This is the production operating contract for the WhatsApp RSVP flow. Do not
deploy, seed templates, backfill phones, or send real messages from an
unapproved shell session. Verify development first, then use a controlled
manual-per-household production rollout.

## Admin routes and Google Workspace authorization

Use the stage API base URL (`https://api.brimax.life` for production or
`https://api.dev.brimax.life` for development):

- `POST /admin/whatsapp/messages` queues a template and returns a `commandId`.
- `GET /admin/whatsapp/messages/{commandId}` reads command status.
- `GET /admin/whatsapp/invitations/{invitationCode}` reads flow state and
  cursor-paginated history.
- `PUT /admin/whatsapp/invitations/{invitationCode}/phone` updates a phone.

All routes use the shared Google Workspace administrator authorizer. Obtain a
Google ID token through the dashboard's stage-specific OAuth client and send it
as a bearer token. The token must have the exact active-stage audience and the
verified hosted-domain claim `hd=brimax.life`. See
`docs/runbooks/google-workspace-admin-sso.md`. Never paste a real token into
logs, documentation, or shell history:

```bash
read -r -s GOOGLE_ID_TOKEN
curl --fail-with-body \
  -X POST "https://api.dev.brimax.life/admin/whatsapp/messages" \
  -H "Authorization: Bearer ${GOOGLE_ID_TOKEN}" \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: campaign-wave-0001' \
  --data '{"invitationCode":"SW2748","templateId":"wedding_rsvp_reconfirmation"}'
unset GOOGLE_ID_TOKEN
```

The idempotency key is case-insensitive, must contain 8–64 safe characters,
and should be retained for retries. A replay returns the same command.

## Correlation, logs, and diagnosis

Use this chain when diagnosing a send:

`requestId → commandId → wamid → eventId`

The API emits `requestId` and `commandId`; the worker adds `commandId` and the
provider `wamid`; webhook processing adds `eventId`. Search the relevant Lambda
logs and never search or paste phone numbers, message bodies, sender IDs,
profile names, media details, raw payloads, or secrets.

After queueing, poll for `queued`, `sending`, `sent`, `failed`, or
`reconciliation_required`. Inspect the command record first, then worker logs,
queue metrics, and the DLQ. Provider acceptance is not proof of delivery; use
the stored `wamid` and Meta status events for reconciliation.

The `Brimax/Payments` RSVP metrics cover send outcomes, worker outcomes,
reconciliation, branch matching, inbound correlation, queue depth/age, worker
errors/throttles, and DLQ depth. Queue and DLQ alarms are automatic. During the
campaign, manually check stuck conversations:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm whatsapp:rsvp list --status send_queued --invitation-code SW2748
BRIMAX_ENV_FILE=.env.dev pnpm whatsapp:rsvp list --status reconciliation_required --invitation-code SW2748
```

For unknown provider outcomes, do not resend automatically.

## Phone readiness and import

New invitation imports may include an optional validated E.164-shaped
`phoneNumber` field. The importer reports missing phones in its summary. Never
put real phone data in Git, fixtures, command output, or chat.

Existing invitations are backfilled with `pnpm whatsapp:rsvp-phones`, which
loops the single-household `whatsapp:rsvp phone` operation over an
`invitationCode,phoneNumber` CSV. It writes DynamoDB only and never sends a
message. The gate itself still stands: before any production send, verify that
no target household is missing a phone.

```bash
BRIMAX_ENV_FILE=.env.dev pnpm whatsapp:rsvp-phones --csv .tmp/phones.csv
BRIMAX_ENV_FILE=.env.dev pnpm whatsapp:rsvp-phones --csv .tmp/phones.csv --apply
BRIMAX_ENV_FILE=.env pnpm whatsapp:rsvp-phones --csv .tmp/phones.csv --apply --confirm-prod
```

Runs are dry-run unless `--apply` is passed, and a production apply is refused
without `--confirm-prod`. The CSV takes two columns plus an optional header,
`#` comments, and blank lines. Phone numbers are normalized exactly as the
single-household operation normalizes them, so `+55 11 91436-2818` and
`5511914362818` are the same number.

Every row is classified against the stored value before anything is written:

| Outcome | Meaning |
|---|---|
| `new` | The invitation has no phone yet. |
| `unchanged` | The stored phone already matches, so no write is issued. |
| `changed` | A different phone is stored. See the warning below. |
| `missing` | No such invitation. The row fails. |

A bad row never stops the run. Every remaining row is processed and the command
exits non-zero if anything failed, so a dry-run that exits `0` is the evidence
that the gate is clear. `--limit <n>` processes only the first `n` rows, which
is how to stage the backfill in small waves.

Replacing an existing phone leaves the previous number still resolving to that
invitation: the update adds the new `WHATSAPP_PHONE#<phone>` lookup row but
never removes the old one. The command warns and counts these as `changed`.
Remove stale lookup rows deliberately, never as a side effect of a backfill.

Each run writes `results.jsonl`, `summary.txt`, and — when rows fail — a
re-runnable `failures.csv` under
`.tmp/whatsapp-rsvp-phones/<timestamp>-<stage>/`. Only the last four digits of
a phone reach stdout or `results.jsonl`. `failures.csv` holds raw numbers so it
can be fed straight back into `--csv`, which is why it and the input CSV both
belong under the gitignored `.tmp/`.

## Deployment and templates

Perform this sequence in development first, then repeat the approved sequence
for production:

1. Run `pnpm build`, `pnpm test`, `pnpm test:coverage`, and `pnpm synth`.
2. Deploy the backend using the stage-specific wrapper.
3. Verify Meta webhook subscription using `docs/runbooks/whatsapp-webhook.md`.
4. Seed all six approved templates, creating immutable versions before
   activation. Verify each active pointer's `name`, `language`, and
   `parameterFormat`.
5. Complete and review the existing-invitation phone readiness gate.
6. Run the offline branch simulator for every branch.
7. Send one controlled dev message using `wedding_rsvp_reconfirmation`.
   Confirm named parameter binding, the quick-reply payload, and the dynamic
   production RSVP link.
8. In production, send manually per household, beginning with known-friendly
   recipients and pausing to inspect delivery, failure, reconciliation, and
   quality signals after each small group.

Dev and prod use separate Meta credentials and stage-specific AWS resources;
the `dev-` prefix separates tables, queues, and log groups. Approved deep links
always point to `https://brimax.life/`, even from dev, so only controlled test
numbers may receive dev messages.

`wedding_rsvp_pending_reminder` is a MARKETING template subject to marketing
limits, opt-outs, and quality-based pausing. Its first production messages can
affect the quality trajectory of the sending number. The other RSVP templates
are Utility templates.

## Failure handling and rollback

- `400`: malformed or invalid input.
- `404`: invitation, template, or command not found.
- `409`: invalid flow transition or idempotency conflict.
- `422`: missing or incompatible invitation data.
- `503`: queue/provider availability failure.
- `500`: unexpected infrastructure or stored-record failure.

To stop new sends, stop invoking the admin route. If queued messages must be
halted, disable the WhatsApp RSVP SQS event-source mapping. For a template
defect, reactivate the previous immutable template version. A stack rollback
is the final option after checking whether Meta may already have accepted
messages. Sent WhatsApp messages cannot be recalled.

Conversation records are retained indefinitely as part of the wedding record.
Review privacy expectations after the wedding before changing retention.
