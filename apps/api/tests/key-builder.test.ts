import { describe, expect, it } from "vitest";
import {
  asaasPaymentLookupIndex,
  idempotencyKeys,
  invitationKeys,
  paymentKeys,
  webhookKeys
} from "../src/services/dynamodb/key-builder";

describe("DynamoDB key builders", () => {
  it("creates invitation keys", () => {
    expect(invitationKeys("ABCD1234")).toEqual({
      PK: "INVITATION#ABCD1234",
      SK: "INVITATION"
    });
  });

  it("creates webhook idempotency keys", () => {
    expect(webhookKeys("stripe", "evt_123")).toEqual({
      PK: "WEBHOOK#stripe",
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
  });

  it("creates the Asaas payment lookup index values", () => {
    expect(asaasPaymentLookupIndex("pay_asaas_123")).toEqual({
      GSI1PK: "ASAAS#PAYMENT#pay_asaas_123",
      GSI1SK: "PAYMENT"
    });
  });
});
