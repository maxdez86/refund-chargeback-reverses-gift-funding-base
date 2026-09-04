# Step 2 Runbook: DynamoDB On-Demand Backup & Disaster Recovery

This runbook documents the required pre-deployment table backup and recovery steps for the production DynamoDB table (`brimax-wedding`).

---

## 1. Overview

Before promoting PR #165 and executing the one-time bulk phone number update script, an on-demand point-in-time snapshot must be created. This ensures full zero-data-loss recovery capability if any unplanned issue occurs.

---

## 2. Pre-Deployment Backup Procedure

### Command
Run the following AWS CLI command using the authorized profile (`AWS_PROFILE=personal-stg`) against account `183286346090` in `us-east-1`:

```bash
AWS_PROFILE=personal-stg aws dynamodb create-backup \
  --table-name brimax-wedding \
  --backup-name "pre-v2-0-0-prod-backup-$(date +%Y%m%d%H%M%S)" \
  --region us-east-1
```

### Verification
Verify that the backup was created and reached `AVAILABLE` status:

```bash
AWS_PROFILE=personal-stg aws dynamodb list-backups \
  --table-name brimax-wedding \
  --region us-east-1 \
  --query "BackupSummaries[?BackupStatus=='AVAILABLE'] | sort_by(@, &BackupCreationDateTime)[-1]"
```

Example expected output:
```json
{
  "BackupArn": "arn:aws:dynamodb:us-east-1:183286346090:table/brimax-wedding/backup/01724874000000-abcdef12",
  "BackupName": "pre-v2-0-0-prod-backup-20260828174500",
  "BackupStatus": "AVAILABLE",
  "BackupType": "USER",
  "TableArn": "arn:aws:dynamodb:us-east-1:183286346090:table/brimax-wedding",
  "TableName": "brimax-wedding"
}
```

---

## 3. Table Inspection Queries (Read-Only)

To inspect table state and item counts before and after backfill:

```bash
# Describe table structure, GSIs, and active status
AWS_PROFILE=personal-stg aws dynamodb describe-table \
  --table-name brimax-wedding \
  --region us-east-1 \
  --query "Table.{ItemCount:ItemCount, TableSizeBytes:TableSizeBytes, TableStatus:TableStatus}"

# Query sample invitation partition
AWS_PROFILE=personal-stg aws dynamodb query \
  --table-name brimax-wedding \
  --region us-east-1 \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"INVITATION#SAMPLE1"}}'
```

---

## 4. Disaster Recovery & Rollback Procedure

If an unexpected data anomaly occurs:

### Step 1: Restore Table from Backup
```bash
AWS_PROFILE=personal-stg aws dynamodb restore-table-from-backup \
  --target-table-name "brimax-wedding-Restored-$(date +%Y%m%d%H%M%S)" \
  --backup-arn "<BackupArn_from_step_2>" \
  --region us-east-1
```

### Step 2: Verification of Restored Table
Wait for the restored table status to become `ACTIVE`:
```bash
AWS_PROFILE=personal-stg aws dynamodb describe-table \
  --table-name "brimax-wedding-Restored-..." \
  --region us-east-1 \
  --query "Table.TableStatus"
```

### Step 3: Re-pointing Lambda or Re-running Data Sync
- The primary table name is managed by CDK in `BrimaxDataStack`. Because PR #165's changes to DynamoDB are purely additive (`phoneNumber` attributes on existing invitations and new `WHATSAPP_PHONE#...` partition rows), existing RSVP and guest data are preserved in place.
- If individual records were updated with incorrect phone numbers, simply correct the CSV file and re-run [`whatsapp-rsvp-phones.ts`](file:///home/maxreis86/consulting/brimax-life/scripts/lib/whatsapp-rsvp-phones.ts) with `--apply --confirm-prod` to overwrite them.
