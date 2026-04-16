import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { invitationKeys, phoneLookupIndex } from "../apps/api/src/services/dynamodb/key-builder";
import { resourceName, resolveStage } from "../packages/config/src";

const stage = resolveStage(process.env.STAGE);
const tableName = process.env.WEDDING_TABLE_NAME ?? resourceName("brimax-wedding", stage);
const invitationCode = process.env.INVITATION_CODE ?? "ABCD1234";
const householdId = process.env.HOUSEHOLD_ID ?? "household-001";
const guestId = process.env.GUEST_ID ?? randomUUID();
const phoneNumber = process.env.PHONE_NUMBER ?? "+5511999999999";

async function main() {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        ...invitationKeys(invitationCode),
        ...phoneLookupIndex(phoneNumber),
        entityType: "Invitation",
        invitationCode,
        householdId,
        guestId,
        guestName: "Sample Guest",
        phoneNumber,
        allowedPlusOnes: 1,
        rsvpStatus: "pending"
      }
    })
  );

  console.log(`Seeded invitation ${invitationCode} into ${tableName}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
