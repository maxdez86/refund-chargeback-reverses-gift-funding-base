import { describe, expect, it } from "vitest";
import {
  asaasPaymentLookupIndex,
  giftStateKeys,
  idempotencyKeys,
  invitationKeys,
  paymentKeys,
  reservationOpenIndex,
  webhookKeys,
  whatsappCommandKeys,
  whatsappConversationCommandIndex,
  whatsappConversationIndexPrefix,
  whatsappConversationMessageIndex,
  whatsappUnassignedMessageIndex,
  whatsappUnassignedMessageIndexPrefix,
  whatsappMessageKeys,
  whatsappTemplateActivationKeys,
  whatsappTemplateActiveKeys,
  whatsappTemplateVersionKeys
} from "../src/services/dynamodb/key-builder";

// A real Meta message ID, punctuation and all — these flow straight into the partition key.
const WAMID = "wamid.HBgNNTUxMTk2MzY1NjUxNxUCABIYFjNBMEE3RjhCQzc5RDk4RkY4QjNBMQA=";

describe("DynamoDB key builders", () => {
  it("creates invitation keys", () => {
    expect(invitationKeys("ABCD1234")).toEqual({
      PK: "INVITATION#ABCD1234",
      SK: "INVITATION"
    });
  });

  it("creates webhook idempotency keys", () => {
    expect(webhookKeys("asaas", "evt_123")).toEqual({
      PK: "WEBHOOK#asaas",
      SK: "EVENT#evt_123"
    });
  });

  it("creates payment and idempotency keys", () => {
    expect(paymentKeys("pay_123")).toEqual({
      PK: "PAYMENT#pay_123",
      SK: "PAYMENT"
    });

    expect(idempotencyKeys("idem_123")).toEqual({
      PK: "IDEMPOTENCY#idem_123",
      SK: "PAYMENT"
    });

    expect(giftStateKeys("g-test-pix")).toEqual({
      PK: "GIFT#g-test-pix",
      SK: "STATE"
    });
  });

  it("creates the Asaas payment lookup index values", () => {
    expect(asaasPaymentLookupIndex("pay_asaas_123")).toEqual({
      GSI1PK: "ASAAS#PAYMENT#pay_asaas_123",
      GSI1SK: "PAYMENT"
    });
  });

  it("creates the open reservation sparse index values", () => {
    expect(reservationOpenIndex("2026-06-12T20:00:00.000Z")).toEqual({
      GSI1PK: "RESERVATION#OPEN",
      GSI1SK: "2026-06-12T20:00:00.000Z"
    });
  });

  it("creates versioned WhatsApp template registry keys", () => {
    expect(whatsappTemplateVersionKeys("wedding_invitation", 12)).toEqual({
      PK: "WHATSAPP_TEMPLATE#wedding_invitation",
      SK: "VERSION#000012"
    });
    expect(whatsappTemplateActiveKeys("wedding_invitation")).toEqual({
      PK: "WHATSAPP_TEMPLATE#wedding_invitation",
      SK: "ACTIVE"
    });
    expect(
      whatsappTemplateActivationKeys(
        "wedding_invitation",
        "2026-08-15T12:00:00.000Z",
        "activation-1"
      )
    ).toEqual({
      PK: "WHATSAPP_TEMPLATE#wedding_invitation",
      SK: "ACTIVATION#2026-08-15T12:00:00.000Z#activation-1"
    });
  });

  it("creates WhatsApp message and command keys, preserving provider ID punctuation", () => {
    expect(whatsappMessageKeys(WAMID)).toEqual({
      PK: `WHATSAPP_MESSAGE#${WAMID}`,
      SK: "MESSAGE"
    });
    expect(whatsappCommandKeys("idempotency-batch-01")).toEqual({
      PK: "WHATSAPP_COMMAND#idempotency-batch-01",
      SK: "COMMAND"
    });
  });

  it("creates conversation index values that interleave commands and messages by time", () => {
    expect(whatsappConversationMessageIndex("SW2748", "2026-08-17T12:00:00.000Z", WAMID)).toEqual({
      GSI1PK: "INVITATION#SW2748",
      GSI1SK: `WHATSAPP#2026-08-17T12:00:00.000Z#MESSAGE#${WAMID}`
    });
    expect(whatsappConversationCommandIndex("SW2748", "2026-08-17T11:00:00.000Z", "cmd-1")).toEqual({
      GSI1PK: "INVITATION#SW2748",
      GSI1SK: "WHATSAPP#2026-08-17T11:00:00.000Z#COMMAND#cmd-1"
    });
    expect(whatsappConversationIndexPrefix("SW2748")).toEqual({
      GSI1PK: "INVITATION#SW2748",
      GSI1SK: "WHATSAPP#"
    });
    expect(whatsappUnassignedMessageIndex("2026-08-17T12:00:00.000Z", WAMID)).toEqual({
      GSI1PK: "WHATSAPP#UNASSIGNED",
      GSI1SK: `WHATSAPP#2026-08-17T12:00:00.000Z#MESSAGE#${WAMID}`
    });
    expect(whatsappUnassignedMessageIndexPrefix()).toEqual({
      GSI1PK: "WHATSAPP#UNASSIGNED",
      GSI1SK: "WHATSAPP#"
    });
  });

  it("sorts a conversation chronologically regardless of record kind", () => {
    // The timestamp sits ahead of the record kind, so a command at 11:00 sorts before a message
    // at 12:00. A kind-first prefix would have grouped all commands after all messages.
    const sortKeys = [
      whatsappConversationMessageIndex("SW2748", "2026-08-17T12:00:00.000Z", WAMID).GSI1SK,
      whatsappConversationCommandIndex("SW2748", "2026-08-17T11:00:00.000Z", "cmd-1").GSI1SK,
      whatsappConversationMessageIndex("SW2748", "2026-08-17T13:00:00.000Z", "wamid.ZZZ").GSI1SK
    ];

    expect([...sortKeys].sort()).toEqual([sortKeys[1], sortKeys[0], sortKeys[2]]);
    for (const sortKey of sortKeys) {
      expect(sortKey.startsWith(whatsappConversationIndexPrefix("SW2748").GSI1SK)).toBe(true);
    }
  });
});
