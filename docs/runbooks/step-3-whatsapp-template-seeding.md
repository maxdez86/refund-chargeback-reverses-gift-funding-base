# Step 3 Runbook: WhatsApp Template Seeding & Meta Activation

This runbook guides the verification of Meta-approved WhatsApp message templates and the seeding of template definitions and active pointers into the production DynamoDB table.

---

## 1. Overview

The WhatsApp RSVP engine in PR #165 relies on a dynamic template versioning repository in DynamoDB:
- Stored Versions: `PK: WHATSAPP_TEMPLATE#<purpose>`, `SK: VERSION#<versionNumber>`
- Active Version Pointer: `PK: WHATSAPP_TEMPLATE#<purpose>`, `SK: ACTIVE`

When an outbound template command is queued or an inbound branch selects a follow-up template, `WhatsappTemplateRepository.getActive(purpose)` resolves the active version from DynamoDB.

> [!IMPORTANT]
> If templates are not seeded and activated in DynamoDB immediately after the CDK backend deployment, any WhatsApp send or automated follow-up will fail with `TEMPLATE_NOT_FOUND` (HTTP 404).

---

## 2. Template Catalog & Manifest

The template manifest is defined in [`apps/api/src/services/whatsapp/template-manifest.ts`](file:///home/maxreis86/consulting/brimax-life/apps/api/src/services/whatsapp/template-manifest.ts).

| Purpose | Active Version | Meta Template Name | Category | Language |
|---|---|---|---|---|
| `wedding_invitation` | 1 | `wedding` | UTILITY | `en` |
| `wedding_rsvp_reconfirmation` | 2 | `wedding_rsvp_reconfirmation` | UTILITY | `pt_BR` |
| `wedding_rsvp_attending_followup` | 2 | `wedding_rsvp_attending_followup` | UTILITY | `pt_BR` |
| `wedding_rsvp_declined_followup` | 2 | `wedding_rsvp_declined_followup` | UTILITY | `pt_BR` |
| `wedding_rsvp_undecided_followup` | 2 | `wedding_rsvp_undecided_followup` | UTILITY | `pt_BR` |
| `wedding_rsvp_single_guest` | 1 | `wedding_rsvp_single_guest` | UTILITY | `pt_BR` |
| `wedding_rsvp_multi_guest` | 1 | `wedding_rsvp_multi_guest` | UTILITY | `pt_BR` |
| `wedding_rsvp_attend_all_followup` | 1 | `wedding_rsvp_attend_all_followup` | UTILITY | `pt_BR` |
| `wedding_rsvp_decline_all_followup` | 1 | `wedding_rsvp_decline_all_followup` | UTILITY | `pt_BR` |
| `wedding_rsvp_partial_followup` | 1 | `wedding_rsvp_partial_followup` | UTILITY | `pt_BR` |
| `wedding_rsvp_fallback` | 1 | `wedding_rsvp_fallback` | UTILITY | `pt_BR` |
| `wedding_rsvp_manual_followup` | 1 | `wedding_rsvp_manual_followup` | UTILITY | `pt_BR` |

---

## 3. Meta Cloud API Approval Verification

Before seeding in DynamoDB, verify with Meta Graph API that the production WhatsApp Business Account has approved templates:

```bash
set -a
source .env
set +a

# Query Meta Graph API for template status
curl -sS -G "https://graph.facebook.com/v25.0/${WHATSAPP_PHONE_NUMBER_ID}" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}"
```

---

## 4. Seeding and Activating Templates in DynamoDB

### Dry-Run Mode
Inspect what will be created in DynamoDB without writing:

```bash
pnpm exec tsx scripts/lib/manage-whatsapp-templates.ts seed
```
*Expected output: List of plan entries with status `"create"` or `"already-active"`.*

### Apply & Activate in Production
Apply the template versions and activate pointers in production DynamoDB:

```bash
pnpm exec tsx scripts/lib/manage-whatsapp-templates.ts seed --apply --activate --confirm-prod
```

Or using the shell wrapper:
```bash
bash scripts/whatsapp-template.sh seed --apply --activate --confirm-prod
```

---

## 5. Verification

Verify active template pointers in DynamoDB using AWS CLI:

```bash
# Check active pointer for reconfirmation template
AWS_PROFILE=personal-stg aws dynamodb get-item \
  --table-name brimax-wedding \
  --region us-east-1 \
  --key '{"PK":{"S":"WHATSAPP_TEMPLATE#wedding_rsvp_reconfirmation"},"SK":{"S":"ACTIVE"}}'

# Check active pointer for single guest template
AWS_PROFILE=personal-stg aws dynamodb get-item \
  --table-name brimax-wedding \
  --region us-east-1 \
  --key '{"PK":{"S":"WHATSAPP_TEMPLATE#wedding_rsvp_single_guest"},"SK":{"S":"ACTIVE"}}'
```

Expected result: Returns item with `activeVersion` (e.g. `2` or `1`) and `entityType: "WhatsappTemplateActive"`.
