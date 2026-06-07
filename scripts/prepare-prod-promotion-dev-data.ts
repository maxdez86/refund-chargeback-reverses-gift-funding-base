import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  giftMetadataKeys,
  giftStateKeys
} from "../apps/api/src/services/dynamodb/key-builder.ts";
import { seedInvitations } from "./seed-dev.ts";
import {
  createDocumentClient,
  resolveIntegrationGift,
  resolveIntegrationInvitation,
  resolveStage,
  resolveWeddingTableName
} from "./lib/prod-promotion-support.ts";

async function main() {
  const stage = resolveStage();
  if (stage !== "dev") {
    throw new Error(`Prod-promotion dev data preparation only supports STAGE=dev, received ${stage}.`);
  }

  const tableName = await resolveWeddingTableName();
  const documentClient = createDocumentClient();
  const invitation = resolveIntegrationInvitation();
  const gift = resolveIntegrationGift();
  const updatedAt = new Date().toISOString();

  await seedInvitations(documentClient, [invitation], tableName);

  await documentClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        ...giftMetadataKeys(gift.id),
        entityType: "GiftMetadata",
        ...gift
      }
    })
  );

  await documentClient.send(
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

  console.log(
    JSON.stringify({
      ok: true,
      stage,
      tableName,
      invitationCode: invitation.invitationCode,
      giftId: gift.id,
      giftName: gift.name,
      reset: ["invitation partition", "gift metadata", "gift state"]
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
