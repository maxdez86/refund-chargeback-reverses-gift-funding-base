import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  invitationKeys,
  giftMetadataKeys,
  giftStateKeys,
  whatsappConversationMessageIndex,
  whatsappMessageKeys
} from "../apps/api/src/services/dynamodb/key-builder.ts";
import { seedInvitations } from "./seed-dev.ts";
import {
  createDocumentClient,
  resolveIntegrationGift,
  resolveIntegrationInvitation,
  resolveWhatsappIntegrationInvitationCode,
  resolveStage,
  resolveWeddingTableName
} from "./lib/prod-promotion-support.ts";

const WHATSAPP_PHONE = "5511900000000";

async function seedWhatsappIntegrationData(documentClient: ReturnType<typeof createDocumentClient>, tableName: string) {
  const invitationCode = resolveWhatsappIntegrationInvitationCode();
  const outboundMessageId = `wamid.synthetic-outbound-${invitationCode}`;
  await seedInvitations(documentClient, [{
    invitationCode,
    householdName: "Prod promotion WhatsApp integration",
    guests: [{ guestName: "Synthetic WhatsApp guest", slot: 1 }]
  }], tableName);

  await documentClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      ...invitationKeys(invitationCode),
      entityType: "Invitation",
      invitationCode,
      householdName: "Prod promotion WhatsApp integration",
      phoneNumber: WHATSAPP_PHONE,
      phoneNumberSource: "import",
      whatsappFlowStatus: "message_sent",
      whatsappFlowStage: "reconfirmation",
      whatsappLastOutboundMessageId: outboundMessageId,
      whatsappFlowUpdatedAt: new Date().toISOString()
    }
  }));

  const createdAt = new Date().toISOString();
  await documentClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      ...whatsappMessageKeys(outboundMessageId),
      ...whatsappConversationMessageIndex(invitationCode, createdAt, outboundMessageId),
      entityType: "WhatsappMessage",
      messageId: outboundMessageId,
      invitationCode,
      direction: "outbound",
      messageType: "template",
      correlationStatus: "matched",
      status: "sent",
      createdAt,
      persistedAt: createdAt,
      timestampSource: "processing",
      templateId: "wedding_rsvp_reconfirmation",
      stage: "reconfirmation",
      recipientPhone: WHATSAPP_PHONE
    }
  }));

  return { invitationCode, outboundMessageId };
}

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

  const whatsapp = await seedWhatsappIntegrationData(documentClient, tableName);

  await documentClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        ...giftStateKeys(gift.id),
        entityType: "GiftState",
        giftId: gift.id,
        partsFunded: 0,
        partsReserved: 0,
        confirmedAmountCents: 0,
        reservedAmountCents: 0,
        version: 0,
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
      whatsappInvitationCode: whatsapp.invitationCode,
      whatsappOutboundMessageId: whatsapp.outboundMessageId,
      reset: ["invitation partition", "gift metadata", "gift state"]
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
