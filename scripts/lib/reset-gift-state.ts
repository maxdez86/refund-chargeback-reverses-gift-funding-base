import { DynamoDBClient, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import { PAYMENT_GIFTS } from "../../packages/config/src/gifts.ts";
import { giftStateKeys } from "../../apps/api/src/services/dynamodb/key-builder.ts";

const tableName = process.env.PAYMENTS_TABLE_NAME;
const region = process.env.AWS_REGION ?? "us-east-1";

if (!tableName) {
  throw new Error("Missing PAYMENTS_TABLE_NAME.");
}

const client = new DynamoDBClient({ region });
const updatedAt = new Date().toISOString();
const requestItems = PAYMENT_GIFTS.map((gift) => ({
  PutRequest: {
    Item: {
      ...marshallStringMap(giftStateKeys(gift.id)),
      entityType: { S: "GiftState" },
      giftId: { S: gift.id },
      partsFunded: { N: "0" },
      fullyFunded: { BOOL: false },
      updatedAt: { S: updatedAt }
    }
  }
}));

for (let index = 0; index < requestItems.length; index += 25) {
  const chunk = requestItems.slice(index, index + 25);
  await client.send(
    new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: chunk
      }
    })
  );
}

console.log(`Recreated ${PAYMENT_GIFTS.length} gift state items in ${tableName}.`);

function marshallStringMap(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { S: value }])
  );
}
