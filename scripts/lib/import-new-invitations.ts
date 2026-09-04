import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput
} from "@aws-sdk/lib-dynamodb";
import { pathToFileURL } from "node:url";
import { NEW_INVITATIONS, type NewInvitation } from "../data/new-invitations.ts";
import { invitationKeys } from "../../apps/api/src/services/dynamodb/key-builder.ts";
import {
  buildGuestId,
  buildInvitationItems,
  type InvitationGuestRecord,
  type InvitationRecord
} from "../../apps/api/src/domain/invitation-provisioning.ts";
import { INVITATION_CODE_REGEX } from "../../packages/contracts/src/invitation-code.ts";

// Re-exported so the script keeps the public surface its tests import, while the item shapes stay
// owned by the domain module the admin handler also calls. Two builders would drift; one cannot.
export { buildGuestId, buildInvitationItems };
export type { InvitationGuestRecord, InvitationRecord };

type ImportMode = "dry-run" | "apply";

type ImportOptions = {
  mode: ImportMode;
  logger?: Pick<Console, "log">;
};

type ImportResult = {
  inserted: number;
  wouldInsert: number;
  skipped: number;
};

const CONDITIONAL_INSERT = "attribute_not_exists(PK) AND attribute_not_exists(SK)";

export function validateNewInvitations(invitations: readonly NewInvitation[]) {
  const seenCodes = new Set<string>();

  for (const invitation of invitations) {
    if (!invitation.invitationCode.trim()) {
      throw new Error("New invitation is missing an invitationCode.");
    }
    if (!INVITATION_CODE_REGEX.test(invitation.invitationCode)) {
      throw new Error(`Invalid invitation code: ${invitation.invitationCode}`);
    }
    if (seenCodes.has(invitation.invitationCode)) {
      throw new Error(`Duplicate invitation code: ${invitation.invitationCode}`);
    }
    seenCodes.add(invitation.invitationCode);

    if (!invitation.householdName.trim()) {
      throw new Error(`Invitation ${invitation.invitationCode} is missing householdName.`);
    }
    if (invitation.phoneNumber !== undefined && !/^[1-9]\d{7,14}$/.test(invitation.phoneNumber)) {
      throw new Error(`Invalid phone number for invitation ${invitation.invitationCode}.`);
    }
    if (invitation.guests.length === 0) {
      throw new Error(`Invitation ${invitation.invitationCode} has no guests.`);
    }

    const seenSlots = new Set<number>();
    for (const guest of invitation.guests) {
      if (!guest.guestName.trim()) {
        throw new Error(`Invitation ${invitation.invitationCode} has a blank guest name.`);
      }
      if (!Number.isInteger(guest.slot) || guest.slot <= 0) {
        throw new Error(`Invitation ${invitation.invitationCode} has an invalid guest slot.`);
      }
      if (seenSlots.has(guest.slot)) {
        throw new Error(
          `Invitation ${invitation.invitationCode} has a duplicate guest slot: ${guest.slot}.`
        );
      }
      seenSlots.add(guest.slot);
    }
  }
}

export function buildImportTransaction(
  tableName: string,
  invitation: NewInvitation
): TransactWriteCommandInput {
  return {
    TransactItems: buildInvitationItems(invitation).map((item) => ({
      Put: {
        TableName: tableName,
        Item: item,
        ConditionExpression: CONDITIONAL_INSERT
      }
    }))
  };
}

export async function importNewInvitations(
  client: DynamoDBDocumentClient,
  invitations: readonly NewInvitation[],
  tableName: string,
  options: ImportOptions
): Promise<ImportResult> {
  validateNewInvitations(invitations);

  const logger = options.logger ?? console;
  let inserted = 0;
  let wouldInsert = 0;
  let skipped = 0;
  let missingPhone = 0;

  for (const invitation of invitations) {
    const existing = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: invitationKeys(invitation.invitationCode)
      })
    );

    if (existing.Item) {
      skipped += 1;
      if (!existing.Item.phoneNumber) missingPhone += 1;
      logger.log(`skipped ${invitation.invitationCode}: invitation already exists`);
      continue;
    }

    const transaction = buildImportTransaction(tableName, invitation);
    if (options.mode === "dry-run") {
      wouldInsert += 1;
      if (!invitation.phoneNumber) missingPhone += 1;
      logger.log(
        `would insert ${invitation.invitationCode}: ${transaction.TransactItems?.length ?? 0} rows`
      );
      continue;
    }

    await client.send(new TransactWriteCommand(transaction));
    inserted += 1;
    if (!invitation.phoneNumber) missingPhone += 1;
    logger.log(`inserted ${invitation.invitationCode}: ${transaction.TransactItems?.length ?? 0} rows`);
  }

  logger.log(`Import summary: inserted=${inserted} wouldInsert=${wouldInsert} skipped=${skipped} missingPhone=${missingPhone}`);

  return { inserted, wouldInsert, skipped };
}

function parseMode(argv: readonly string[]): ImportMode {
  if (argv.includes("--apply")) {
    return "apply";
  }

  return "dry-run";
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const tableName = requiredEnv("WEDDING_TABLE_NAME");
  const region = requiredEnv("AWS_REGION");
  const stage = process.env.STAGE?.trim() || "<unset>";

  console.log(`Mode: ${mode}`);
  console.log(`Stage: ${stage}`);
  console.log(`AWS region: ${region}`);
  console.log(`Target table: ${tableName}`);

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  await importNewInvitations(client, NEW_INVITATIONS, tableName, { mode });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
