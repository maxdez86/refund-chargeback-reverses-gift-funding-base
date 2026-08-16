import { describe, expect, it } from "vitest";
import {
  asaasPaymentLookupIndex,
  giftStateKeys,
  idempotencyKeys,
  invitationKeys,
  paymentKeys,
  reservationOpenIndex,
  webhookKeys,
  whatsappTemplateActivationKeys,
  whatsappTemplateActiveKeys,
  whatsappTemplateVersionKeys
} from "../src/services/dynamodb/key-builder";

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
});
