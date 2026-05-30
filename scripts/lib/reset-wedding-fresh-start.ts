import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { PAYMENT_GIFTS } from "../../packages/config/src/gifts.ts";
import { PRODUCTION_INVITATIONS } from "../seed-dev.ts";

type ResetMode = "dry-run" | "apply" | "verify";

type ItemRecord = {
  PK?: string;
  SK?: string;
  entityType?: string;
};

type Inventory = {
  pkPrefixCounts: Map<string, number>;
  entityTypeCounts: Map<string, number>;
  deletableItems: Required<Pick<ItemRecord, "PK" | "SK">>[];
  unexpectedItems: Required<Pick<ItemRecord, "PK" | "SK">>[];
};

const ALLOWED_DELETION_PREFIXES = [
  "INVITATION#",
  "HOUSEHOLD#",
  "GUEST_MESSAGES",
  "GUEST_MESSAGE#",
  "MESSAGE#",
  "GIFT#",
  "PAYMENT#",
  "IDEMPOTENCY#",
  "WEBHOOK#",
] as const;

const REQUIRED_EMPTY_PREFIXES_AFTER_RESET = [
  "PAYMENT#",
  "IDEMPOTENCY#",
  "WEBHOOK#",
  "GUEST_MESSAGES",
  "GUEST_MESSAGE#",
  "MESSAGE#",
  "HOUSEHOLD#",
] as const;

const EXPECTED_INVITATION_COUNT = PRODUCTION_INVITATIONS.length;
const EXPECTED_GUEST_COUNT = PRODUCTION_INVITATIONS.reduce(
  (total, invitation) => total + invitation.guests.length,
  0,
);
const EXPECTED_GIFT_COUNT = PAYMENT_GIFTS.length;

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function parseMode(argv: string[]): ResetMode {
  const requestedMode = argv[2] as ResetMode | undefined;
  if (!requestedMode || requestedMode === "dry-run") {
    return "dry-run";
  }
  if (requestedMode === "apply" || requestedMode === "verify") {
    return requestedMode;
  }
  throw new Error(`Unknown mode "${requestedMode}". Use dry-run, apply, or verify.`);
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function classifyPk(pk: string): string {
  for (const prefix of ALLOWED_DELETION_PREFIXES) {
    if (prefix === "GUEST_MESSAGES") {
      if (pk === prefix) {
        return prefix;
      }
      continue;
    }
    if (pk.startsWith(prefix)) {
      return prefix;
    }
  }
  return "UNEXPECTED";
}

async function scanAllItems(tableName: string) {
  const items: ItemRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const input: ScanCommandInput = {
      TableName: tableName,
      ProjectionExpression: "PK, SK, entityType",
      ExclusiveStartKey: exclusiveStartKey,
    };
    const response = await client.send(new ScanCommand(input));
    items.push(...((response.Items as ItemRecord[] | undefined) ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
}

async function buildInventory(tableName: string): Promise<Inventory> {
  const items = await scanAllItems(tableName);
  const pkPrefixCounts = new Map<string, number>();
  const entityTypeCounts = new Map<string, number>();
  const deletableItems: Required<Pick<ItemRecord, "PK" | "SK">>[] = [];
  const unexpectedItems: Required<Pick<ItemRecord, "PK" | "SK">>[] = [];

  for (const item of items) {
    if (!item.PK || !item.SK) {
      throw new Error("Encountered DynamoDB item without PK/SK.");
    }

    const prefix = classifyPk(item.PK);
    pkPrefixCounts.set(prefix, (pkPrefixCounts.get(prefix) ?? 0) + 1);

    const entityType = item.entityType ?? "<none>";
    entityTypeCounts.set(entityType, (entityTypeCounts.get(entityType) ?? 0) + 1);

    if (prefix === "UNEXPECTED") {
      unexpectedItems.push({ PK: item.PK, SK: item.SK });
      continue;
    }

    deletableItems.push({ PK: item.PK, SK: item.SK });
  }

  return {
    pkPrefixCounts,
    entityTypeCounts,
    deletableItems,
    unexpectedItems,
  };
}

function sortedEntries(map: Map<string, number>) {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function printInventory(inventory: Inventory) {
  console.log("Inventory by PK family:");
  for (const [key, count] of sortedEntries(inventory.pkPrefixCounts)) {
    console.log(`  ${key}: ${count}`);
  }

  console.log("Inventory by entityType:");
  for (const [key, count] of sortedEntries(inventory.entityTypeCounts)) {
    console.log(`  ${key}: ${count}`);
  }
}

function assertNoUnexpectedFamilies(inventory: Inventory) {
  if (inventory.unexpectedItems.length === 0) {
    return;
  }

  const preview = inventory.unexpectedItems
    .slice(0, 20)
    .map((item) => `  ${item.PK} / ${item.SK}`)
    .join("\n");
  throw new Error(
    `Found ${inventory.unexpectedItems.length} unexpected DynamoDB rows. Aborting.\n${preview}`,
  );
}

async function deleteItems(tableName: string, items: Required<Pick<ItemRecord, "PK" | "SK">>[]) {
  for (const item of items) {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: item,
      }),
    );
  }
}

async function verifyReset(tableName: string) {
  const inventory = await buildInventory(tableName);
  printInventory(inventory);
  assertNoUnexpectedFamilies(inventory);

  for (const prefix of REQUIRED_EMPTY_PREFIXES_AFTER_RESET) {
    const count = inventory.pkPrefixCounts.get(prefix) ?? 0;
    if (count !== 0) {
      throw new Error(`Expected ${prefix} rows to be empty after reset, found ${count}.`);
    }
  }

  const invitationCount = inventory.entityTypeCounts.get("Invitation") ?? 0;
  if (invitationCount !== EXPECTED_INVITATION_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_INVITATION_COUNT} Invitation rows, found ${invitationCount}.`,
    );
  }

  const guestCount = inventory.entityTypeCounts.get("InvitationGuest") ?? 0;
  if (guestCount !== EXPECTED_GUEST_COUNT) {
    throw new Error(`Expected ${EXPECTED_GUEST_COUNT} InvitationGuest rows, found ${guestCount}.`);
  }

  const rsvpCount = inventory.entityTypeCounts.get("RsvpResponse") ?? 0;
  if (rsvpCount !== 0) {
    throw new Error(`Expected 0 RsvpResponse rows after fresh seed, found ${rsvpCount}.`);
  }

  const giftMetadataCount = inventory.entityTypeCounts.get("GiftMetadata") ?? 0;
  if (giftMetadataCount !== EXPECTED_GIFT_COUNT) {
    throw new Error(`Expected ${EXPECTED_GIFT_COUNT} GiftMetadata rows, found ${giftMetadataCount}.`);
  }

  const giftStateCount = inventory.entityTypeCounts.get("GiftState") ?? 0;
  if (giftStateCount !== EXPECTED_GIFT_COUNT) {
    throw new Error(`Expected ${EXPECTED_GIFT_COUNT} GiftState rows, found ${giftStateCount}.`);
  }
}

async function main() {
  const mode = parseMode(process.argv);
  const tableName = requiredEnv("WEDDING_TABLE_NAME");
  const stage = process.env.STAGE ?? "<unset>";
  const region = process.env.AWS_REGION ?? "<unset>";

  console.log(`Mode: ${mode}`);
  console.log(`Target table: ${tableName}`);
  console.log(`Stage: ${stage}`);
  console.log(`AWS region: ${region}`);

  if (mode === "verify") {
    await verifyReset(tableName);
    console.log("Fresh-start verification passed.");
    return;
  }

  const inventory = await buildInventory(tableName);
  printInventory(inventory);
  assertNoUnexpectedFamilies(inventory);

  console.log(`Deletable rows: ${inventory.deletableItems.length}`);

  if (mode === "dry-run") {
    console.log("Dry run only. No rows deleted.");
    return;
  }

  await deleteItems(tableName, inventory.deletableItems);
  console.log(`Deleted ${inventory.deletableItems.length} rows from ${tableName}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
