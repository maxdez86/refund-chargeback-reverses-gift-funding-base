import { PAYMENT_GIFTS_BY_ID } from "@brimax/config";
import { describe, expect, it } from "vitest";
import {
  initialPaymentStatus,
  mapAsaasWebhookToPaymentStatus,
  resolveGiftSelection,
  shouldApplyStatusTransition
} from "../src/domain/payment-state";

describe("payment-state", () => {
  it("resolves a full gift selection without fractional quantity", () => {
    const gift = PAYMENT_GIFTS_BY_ID.get("g-toalhas-banho");

    expect(gift).toBeDefined();
    expect(resolveGiftSelection(gift!, undefined)).toEqual({
      amountCents: 17_600,
      quantity: 1,
      unitAmountCents: null
    });
  });

  it("resolves a fractional gift selection from the requested quantity", () => {
    const gift = PAYMENT_GIFTS_BY_ID.get("g-armario");

    expect(gift).toBeDefined();
    expect(resolveGiftSelection(gift!, 3)).toEqual({
      amountCents: 15_000,
      quantity: 3,
      unitAmountCents: 5_000
    });
  });

  it("maps Pix and hosted card creations to the expected initial states", () => {
    expect(initialPaymentStatus("PIX")).toBe("AWAITING_PAYMENT");
    expect(initialPaymentStatus("CREDIT_CARD")).toBe("CREATED");
  });

  it("maps authoritative Asaas events to internal terminal states", () => {
    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_RECEIVED",
        payment: { status: "RECEIVED" }
      })
    ).toBe("RECEIVED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_CHARGEBACK_REQUESTED",
        payment: { status: "CHARGEBACK" }
      })
    ).toBe("CHARGEBACK");
  });

  it("prevents stale updates from regressing a completed payment", () => {
    expect(shouldApplyStatusTransition("RECEIVED", "CONFIRMED")).toBe(false);
    expect(shouldApplyStatusTransition("CONFIRMED", "RECEIVED")).toBe(true);
  });
});
