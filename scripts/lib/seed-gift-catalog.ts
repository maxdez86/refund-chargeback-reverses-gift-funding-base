import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { PAYMENT_GIFTS } from "../../packages/config/src/gifts.ts";
import {
  giftMetadataKeys,
  giftStateKeys
} from "../../apps/api/src/services/dynamodb/key-builder.ts";

const stage = process.env.STAGE === "dev" ? "dev" : "prod";
const tableName =
  process.env.PAYMENTS_TABLE_NAME ??
  process.env.WEDDING_TABLE_NAME ??
  `${stage === "prod" ? "" : "dev-"}brimax-wedding`;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function main() {
  const updatedAt = new Date().toISOString();

  for (const gift of PAYMENT_GIFTS) {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...giftMetadataKeys(gift.id),
          entityType: "GiftMetadata",
          ...gift
        }
      })
    );

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...giftStateKeys(gift.id),
          entityType: "GiftState",
          giftId: gift.id,
          partsFunded: 0,
          fullyFunded: false,
          updatedAt
        }
      })
    );
  }

  console.log(`Seeded ${PAYMENT_GIFTS.length} gifts into ${tableName}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
