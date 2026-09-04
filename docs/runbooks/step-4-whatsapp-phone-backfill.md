# Step 4 Runbook: Bulk WhatsApp RSVP Phone Backfill

This runbook provides complete operational instructions for executing the one-time bulk phone number backfill script ([`whatsapp-rsvp-phones.ts`](file:///home/maxreis86/consulting/brimax-life/scripts/lib/whatsapp-rsvp-phones.ts)) against the production DynamoDB table.

---

## 1. Overview & Safety Rules

- **Script Location:** [`scripts/lib/whatsapp-rsvp-phones.ts`](file:///home/maxreis86/consulting/brimax-life/scripts/lib/whatsapp-rsvp-phones.ts)
- **Shell Wrapper:** [`scripts/whatsapp-rsvp-phones.sh`](file:///home/maxreis86/consulting/brimax-life/scripts/whatsapp-rsvp-phones.sh)
- **Scope of Modification:**
  - Reads `INVITATION#<code>` to verify existence and check if phone number has changed.
  - Updates `phoneNumber`, `phoneNumberUpdatedAt`, and `phoneNumberSource` on `INVITATION#<code>`.
  - Puts lookup record on `WHATSAPP_PHONE#<digits>` with `SK: INVITATION#<code>`.
  - **Does NOT** modify guest lists, RSVP status, dietary notes, or gift contributions.
  - **Does NOT** send WhatsApp messages.
- **Privacy Rule:** The input CSV file contains real guest phone numbers. Store it strictly inside the gitignored `.tmp/` directory (e.g. `.tmp/phones.csv`).

---

## 2. Preparing the CSV Input File

### Format Requirements
The CSV file must contain two columns: `invitationCode,phoneNumber`.

1. **Header:** `invitationCode,phoneNumber` (case-insensitive).
2. **Codes:** Must match regex `/^[A-Z0-9]{4,16}$/` (e.g. `ABC123`).
3. **Phone Numbers:** Must include Brazilian country code (`55`) and DDD (2 digits), totaling 12–13 digits (e.g. `5511999999999`).

### Example File: `.tmp/production-phones.csv`
```csv
invitationCode,phoneNumber
BRIMAX01,5511999990001
BRIMAX02,5511999990002
BRIMAX03,5521988880003
```

---

## 3. Step-by-Step Execution Procedure

### Step 3.1: Execute Dry-Run Validation
Always run in `dry-run` mode first to validate all codes, formatting, and database existence:

```bash
# Load environment
set -a
source .env
set +a

# Run dry-run
pnpm exec tsx scripts/lib/whatsapp-rsvp-phones.ts --csv .tmp/production-phones.csv dry-run
```

Or using the shell wrapper:
```bash
bash scripts/whatsapp-rsvp-phones.sh --csv .tmp/production-phones.csv dry-run
```

### Step 3.2: Audit Dry-Run Output
Examine the dry-run summary rendered to the terminal and written to `.tmp/whatsapp-rsvp-phones/<timestamp>-prod/summary.txt`:
```
Phone batch summary: mode=dry-run updated=0 wouldUpdate=150 unchanged=0 failed=0 missing=0 changed=0 skipped=0
```
- **`wouldUpdate`**: Count of invitations that will receive phone numbers.
- **`missing` / `failed`**: Count of rejected rows. If `failed > 0`, inspect `.tmp/whatsapp-rsvp-phones/<timestamp>-prod/results.jsonl` and fix the CSV before proceeding.

### Step 3.3: Apply Changes to Production
Once dry-run reports 0 errors, execute with `--apply` and `--confirm-prod`:

```bash
pnpm exec tsx scripts/lib/whatsapp-rsvp-phones.ts \
  --csv .tmp/production-phones.csv \
  --apply \
  --confirm-prod
```

Or using the shell wrapper:
```bash
bash scripts/whatsapp-rsvp-phones.sh \
  --csv .tmp/production-phones.csv \
  --apply \
  --confirm-prod
```

### Step 3.4: Verify Application Summary
Expected final summary:
```
Phone batch summary: mode=apply updated=150 wouldUpdate=0 unchanged=0 failed=0 missing=0 changed=0 skipped=0
```

---

## 4. Handling Failures & Reruns

If network timeouts, throttling, or bad data cause partial failures:

1. The script writes `.tmp/whatsapp-rsvp-phones/<timestamp>-prod/failures.csv` containing only the failed rows.
2. If failures were transient network errors, simply rerun the exact same command. Rows already updated will be reported as `unchanged` with no duplicate writes.
3. If specific rows had invalid invitation codes or phone formatting, fix them in `failures.csv` and rerun against the failure file:
```bash
pnpm exec tsx scripts/lib/whatsapp-rsvp-phones.ts \
  --csv .tmp/whatsapp-rsvp-phones/<timestamp>-prod/failures.csv \
  --apply \
  --confirm-prod
```

---

## 5. Post-Backfill Data Verification

Query sample invitations using AWS CLI to confirm phone numbers and lookup items:

```bash
# 1. Verify invitation record has phoneNumber and phoneNumberSource
AWS_PROFILE=personal-stg aws dynamodb get-item \
  --table-name brimax-wedding \
  --region us-east-1 \
  --key '{"PK":{"S":"INVITATION#BRIMAX01"},"SK":{"S":"INVITATION"}}' \
  --projection-expression "invitationCode, householdName, phoneNumber, phoneNumberSource"

# 2. Verify reverse lookup index item
AWS_PROFILE=personal-stg aws dynamodb get-item \
  --table-name brimax-wedding \
  --region us-east-1 \
  --key '{"PK":{"S":"WHATSAPP_PHONE#5511999990001"},"SK":{"S":"INVITATION#BRIMAX01"}}'
```
