import { describe, expect, it, vi } from "vitest";
import { expirePaymentIfStale, sweepStaleCheckouts } from "../src/domain/checkout-expiry";
import { CHECKOUT_EXPIRY_GRACE_MS } from "../src/domain/payment-state";

const NOW_MS = Date.parse("2026-06-12T12:00:00.000Z");

function reservationFor(paymentId: string) {
  return {
    paymentId,
    giftId: "g-travesseiros",
    quantity: 1,
    quotaValuesCents: [10_000],
    amountCents: 10_000,
    status: "ACTIVE" as const,
    expiresAt: "2026-06-12T11:00:00.000Z",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z"
  };
}

function createRepositoryMock(overrides: Record<string, unknown> = {}) {
  return {
    listStaleOpenReservations: vi.fn().mockResolvedValue([]),
    getPayment: vi.fn().mockResolvedValue(null),
    releaseReservationAfterCheckoutFailure: vi.fn().mockResolvedValue(undefined),
    tryExpireStalePayment: vi.fn().mockResolvedValue(true),
    ...overrides
  };
}

describe("sweepStaleCheckouts", () => {
  it("queries with the grace-adjusted cutoff and expires pending payments", async () => {
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi.fn().mockResolvedValue([reservationFor("payment-1")]),
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-1",
        status: "AWAITING_PAYMENT"
      })
    });

    await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(repository.listStaleOpenReservations).toHaveBeenCalledWith(
      new Date(NOW_MS - CHECKOUT_EXPIRY_GRACE_MS).toISOString()
    );
    expect(repository.tryExpireStalePayment).toHaveBeenCalledWith({
      paymentId: "payment-1",
      expectedCurrentStatus: "AWAITING_PAYMENT"
    });
    expect(repository.releaseReservationAfterCheckoutFailure).not.toHaveBeenCalled();
  });

  it("releases the reservation when the payment record is missing", async () => {
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi.fn().mockResolvedValue([reservationFor("payment-orphan")]),
      getPayment: vi.fn().mockResolvedValue(null)
    });

    await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(repository.releaseReservationAfterCheckoutFailure).toHaveBeenCalledWith("payment-orphan");
    expect(repository.tryExpireStalePayment).not.toHaveBeenCalled();
  });

  it("skips payments that are processing or already terminal", async () => {
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi
        .fn()
        .mockResolvedValue([reservationFor("payment-processing"), reservationFor("payment-confirmed")]),
      getPayment: vi
        .fn()
        .mockResolvedValueOnce({ paymentId: "payment-processing", status: "PROCESSING" })
        .mockResolvedValueOnce({ paymentId: "payment-confirmed", status: "CONFIRMED" })
    });

    await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(repository.tryExpireStalePayment).not.toHaveBeenCalled();
    expect(repository.releaseReservationAfterCheckoutFailure).not.toHaveBeenCalled();
  });

  it("continues sweeping the remaining reservations when one item fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi
        .fn()
        .mockResolvedValue([reservationFor("payment-broken"), reservationFor("payment-2")]),
      getPayment: vi
        .fn()
        .mockRejectedValueOnce(new Error("dynamo unavailable"))
        .mockResolvedValueOnce({ paymentId: "payment-2", status: "CREATED" })
    });

    await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(repository.tryExpireStalePayment).toHaveBeenCalledWith({
      paymentId: "payment-2",
      expectedCurrentStatus: "CREATED"
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"CHECKOUT_EXPIRY_SWEEP_ITEM_FAILED\"")
    );
    errorSpy.mockRestore();
  });
});

describe("expirePaymentIfStale", () => {
  const basePayment = {
    paymentId: "payment-1",
    status: "CREATED" as const,
    checkout: {
      sessionId: "checkout-1",
      url: "https://www.asaas.com/c/checkout-1",
      expiresAt: "2026-06-12T11:55:00.000Z"
    }
  };

  it("does nothing while the checkout is still inside the grace window", async () => {
    const repository = createRepositoryMock();
    const nowMs = Date.parse(basePayment.checkout.expiresAt) + CHECKOUT_EXPIRY_GRACE_MS;

    const expired = await expirePaymentIfStale(repository as never, basePayment as never, nowMs);

    expect(expired).toBe(false);
    expect(repository.tryExpireStalePayment).not.toHaveBeenCalled();
  });

  it("expires the payment once the grace window has elapsed", async () => {
    const repository = createRepositoryMock();
    const nowMs = Date.parse(basePayment.checkout.expiresAt) + CHECKOUT_EXPIRY_GRACE_MS + 1;

    const expired = await expirePaymentIfStale(repository as never, basePayment as never, nowMs);

    expect(expired).toBe(true);
    expect(repository.tryExpireStalePayment).toHaveBeenCalledWith({
      paymentId: "payment-1",
      expectedCurrentStatus: "CREATED"
    });
  });
});
