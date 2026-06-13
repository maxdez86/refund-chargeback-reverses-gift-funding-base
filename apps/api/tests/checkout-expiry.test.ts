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
    releaseReservationAfterCheckoutFailure: vi.fn().mockResolvedValue("released"),
    tryExpireStalePayment: vi.fn().mockResolvedValue(true),
    ...overrides
  };
}

describe("sweepStaleCheckouts", () => {
  it("queries with the grace-adjusted cutoff (and default limit) and expires pending payments", async () => {
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi.fn().mockResolvedValue([reservationFor("payment-1")]),
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-1",
        status: "AWAITING_PAYMENT"
      })
    });

    const summary = await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(repository.listStaleOpenReservations).toHaveBeenCalledWith(
      new Date(NOW_MS - CHECKOUT_EXPIRY_GRACE_MS).toISOString(),
      25
    );
    expect(repository.tryExpireStalePayment).toHaveBeenCalledWith({
      paymentId: "payment-1",
      expectedCurrentStatus: "AWAITING_PAYMENT"
    });
    expect(repository.releaseReservationAfterCheckoutFailure).not.toHaveBeenCalled();
    expect(summary).toEqual(
      expect.objectContaining({ scanned: 1, released: 1, raceLost: 0, protected: 0, failedIds: [] })
    );
    expect(summary.oldestStaleAgeMs).toBeGreaterThan(0);
  });

  it("forwards a configurable limit to the GSI query", async () => {
    const repository = createRepositoryMock();

    await sweepStaleCheckouts(repository as never, NOW_MS, { limit: 100 });

    expect(repository.listStaleOpenReservations).toHaveBeenCalledWith(expect.any(String), 100);
  });

  it("releases the reservation when the payment record is missing", async () => {
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi.fn().mockResolvedValue([reservationFor("payment-orphan")]),
      getPayment: vi.fn().mockResolvedValue(null),
      releaseReservationAfterCheckoutFailure: vi.fn().mockResolvedValue("released")
    });

    const summary = await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(repository.releaseReservationAfterCheckoutFailure).toHaveBeenCalledWith("payment-orphan");
    expect(repository.tryExpireStalePayment).not.toHaveBeenCalled();
    expect(summary.released).toBe(1);
  });

  it("tallies release outcomes (race-lost / protected / missing-context)", async () => {
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi
        .fn()
        .mockResolvedValue([reservationFor("p-race"), reservationFor("p-protected"), reservationFor("p-missing")]),
      getPayment: vi.fn().mockResolvedValue(null),
      releaseReservationAfterCheckoutFailure: vi
        .fn()
        .mockResolvedValueOnce("race-lost")
        .mockResolvedValueOnce("protected")
        .mockResolvedValueOnce("missing-context")
    });

    const summary = await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(summary).toEqual(
      expect.objectContaining({
        scanned: 3,
        released: 0,
        raceLost: 1,
        protected: 1,
        missingContext: 1,
        failedIds: []
      })
    );
  });

  it("classifies a lost expiry race (tryExpire => false) as race-lost, not a failure", async () => {
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi.fn().mockResolvedValue([reservationFor("payment-late")]),
      getPayment: vi.fn().mockResolvedValue({ paymentId: "payment-late", status: "CREATED" }),
      tryExpireStalePayment: vi.fn().mockResolvedValue(false)
    });

    const summary = await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(summary.raceLost).toBe(1);
    expect(summary.released).toBe(0);
    expect(summary.failedIds).toEqual([]);
  });

  it("treats processing and terminal payments as protected and leaves them alone", async () => {
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi
        .fn()
        .mockResolvedValue([reservationFor("payment-processing"), reservationFor("payment-confirmed")]),
      getPayment: vi
        .fn()
        .mockResolvedValueOnce({ paymentId: "payment-processing", status: "PROCESSING" })
        .mockResolvedValueOnce({ paymentId: "payment-confirmed", status: "CONFIRMED" })
    });

    const summary = await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(repository.tryExpireStalePayment).not.toHaveBeenCalled();
    expect(repository.releaseReservationAfterCheckoutFailure).not.toHaveBeenCalled();
    expect(summary.protected).toBe(2);
  });

  it("records a retryable failure as a failedId while still sweeping the rest of the batch", async () => {
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

    const summary = await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(repository.tryExpireStalePayment).toHaveBeenCalledWith({
      paymentId: "payment-2",
      expectedCurrentStatus: "CREATED"
    });
    expect(summary.failedIds).toEqual(["payment-broken"]);
    expect(summary.released).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"CHECKOUT_EXPIRY_SWEEP_ITEM_FAILED\"")
    );
    errorSpy.mockRestore();
  });

  it("surfaces a retryable expiry transaction failure (e.g. TransactionConflict) as a failedId", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi.fn().mockResolvedValue([reservationFor("payment-conflict")]),
      getPayment: vi.fn().mockResolvedValue({ paymentId: "payment-conflict", status: "AWAITING_PAYMENT" }),
      tryExpireStalePayment: vi.fn().mockRejectedValue(new Error("TransactionConflict"))
    });

    const summary = await sweepStaleCheckouts(repository as never, NOW_MS);

    expect(summary.failedIds).toEqual(["payment-conflict"]);
    errorSpy.mockRestore();
  });

  it("processes more candidates than the concurrency bound without dropping any", async () => {
    const reservations = Array.from({ length: 9 }, (_, index) => reservationFor(`payment-${index}`));
    const repository = createRepositoryMock({
      listStaleOpenReservations: vi.fn().mockResolvedValue(reservations),
      getPayment: vi.fn().mockResolvedValue(null),
      releaseReservationAfterCheckoutFailure: vi.fn().mockResolvedValue("released")
    });

    const summary = await sweepStaleCheckouts(repository as never, NOW_MS, { concurrency: 4 });

    expect(summary.scanned).toBe(9);
    expect(summary.released).toBe(9);
    expect(repository.releaseReservationAfterCheckoutFailure).toHaveBeenCalledTimes(9);
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
