import { PAYMENT_GIFTS_BY_ID } from "@brimax/config";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_EXPIRY_GRACE_MS,
  initialPaymentStatus,
  isChargebackReversalSignal,
  isStalePendingCheckout,
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
    expect(initialPaymentStatus("PIX")).toBe("CREATED");
    expect(initialPaymentStatus("CREDIT_CARD")).toBe("CREATED");
  });

  it("maps authoritative Asaas events to internal terminal states", () => {
    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_CONFIRMED",
        payment: { status: "CONFIRMED" }
      })
    ).toBe("CONFIRMED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_RECEIVED",
        payment: { status: "RECEIVED" }
      })
    ).toBe("RECEIVED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_OVERDUE",
        payment: { status: "OVERDUE" }
      })
    ).toBe("EXPIRED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_REFUNDED",
        payment: { status: "REFUNDED" }
      })
    ).toBe("REFUNDED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
        payment: { status: "REFUSED" }
      })
    ).toBe("FAILED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_CHARGEBACK_REQUESTED",
        payment: { status: "CHARGEBACK" }
      })
    ).toBe("CHARGEBACK");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_CHARGEBACK_DISPUTE",
        payment: { status: "CHARGEBACK" }
      })
    ).toBe("CHARGEBACK");

    // Dispute won: Asaas reports it before the money is passed back, and the
    // generic CHARGEBACK match must not swallow it.
    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
        payment: { status: "AWAITING_CHARGEBACK_REVERSAL" }
      })
    ).toBe("CONFIRMED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
        payment: { status: "CHARGEBACK" }
      })
    ).toBe("CONFIRMED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_REFUND_DENIED",
        payment: { status: "CONFIRMED" }
      })
    ).toBe("CONFIRMED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_REFUND_DENIED"
      })
    ).toBe("FAILED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_REFUND_IN_PROGRESS",
        payment: { status: "CONFIRMED" }
      })
    ).toBe("CONFIRMED");
  });

  it("prevents stale updates from regressing a completed payment", () => {
    expect(shouldApplyStatusTransition("RECEIVED", "CONFIRMED")).toBe(false);
    expect(shouldApplyStatusTransition("CONFIRMED", "RECEIVED")).toBe(true);
    expect(shouldApplyStatusTransition("EXPIRED", "RECEIVED")).toBe(true);
    // A chargeback only leaves CHARGEBACK for a refund by way of the table. A
    // won dispute is an explicit exception the processor makes on the reversal
    // signal, never something a redelivered confirmation can trigger.
    expect(shouldApplyStatusTransition("CHARGEBACK", "RECEIVED")).toBe(false);
    expect(shouldApplyStatusTransition("CHARGEBACK", "CONFIRMED")).toBe(false);
    expect(shouldApplyStatusTransition("CHARGEBACK", "CHARGEBACK")).toBe(true);
    expect(shouldApplyStatusTransition("CHARGEBACK", "REFUNDED")).toBe(true);
    expect(shouldApplyStatusTransition("REFUNDED", "CONFIRMED")).toBe(false);
  });

  it("recognises only the explicit chargeback reversal signal", () => {
    expect(isChargebackReversalSignal({ event: "PAYMENT_AWAITING_CHARGEBACK_REVERSAL" })).toBe(true);
    expect(isChargebackReversalSignal({ payment: { status: "AWAITING_CHARGEBACK_REVERSAL" } })).toBe(true);
    expect(isChargebackReversalSignal({ status: "AWAITING_CHARGEBACK_REVERSAL" })).toBe(true);

    expect(isChargebackReversalSignal({ event: "PAYMENT_CONFIRMED" })).toBe(false);
    expect(isChargebackReversalSignal({ event: "PAYMENT_RECEIVED" })).toBe(false);
    expect(isChargebackReversalSignal({ event: "PAYMENT_CHARGEBACK_DISPUTE" })).toBe(false);
    expect(isChargebackReversalSignal({})).toBe(false);
  });

  it("flags a pending checkout as stale only past the expiry grace window", () => {
    const expiresAt = "2026-06-12T12:00:00.000Z";
    const expiresAtMs = Date.parse(expiresAt);

    expect(isStalePendingCheckout("CREATED", expiresAt, expiresAtMs)).toBe(false);
    expect(isStalePendingCheckout("CREATED", expiresAt, expiresAtMs + CHECKOUT_EXPIRY_GRACE_MS)).toBe(false);
    expect(isStalePendingCheckout("CREATED", expiresAt, expiresAtMs + CHECKOUT_EXPIRY_GRACE_MS + 1)).toBe(true);
    expect(
      isStalePendingCheckout("AWAITING_PAYMENT", expiresAt, expiresAtMs + CHECKOUT_EXPIRY_GRACE_MS + 1)
    ).toBe(true);
  });

  it("never flags non-pending statuses or unparsable expiries as stale", () => {
    const farPastGrace = Date.parse("2027-01-01T00:00:00.000Z");

    expect(isStalePendingCheckout("PROCESSING", "2026-06-12T12:00:00.000Z", farPastGrace)).toBe(false);
    expect(isStalePendingCheckout("CONFIRMED", "2026-06-12T12:00:00.000Z", farPastGrace)).toBe(false);
    expect(isStalePendingCheckout("CREATED", undefined, farPastGrace)).toBe(false);
    expect(isStalePendingCheckout("CREATED", "not-a-date", farPastGrace)).toBe(false);
  });

  it("maps a PAYMENT_REFUNDED whose payment is still RECEIVED to RECEIVED, not REFUNDED", () => {
    // Asaas keeps payment.status at RECEIVED for a partial refund. RECEIVED is
    // matched before the REFUNDED branch on purpose: the refunded amount, not
    // the event label, decides how many parts come back. Flipping this order
    // would make every partial refund reverse the whole gift.
    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_REFUNDED",
        payment: { status: "RECEIVED" }
      })
    ).toBe("RECEIVED");

    expect(
      mapAsaasWebhookToPaymentStatus({
        event: "PAYMENT_REFUNDED",
        payment: { status: "REFUNDED" }
      })
    ).toBe("REFUNDED");
  });
});
