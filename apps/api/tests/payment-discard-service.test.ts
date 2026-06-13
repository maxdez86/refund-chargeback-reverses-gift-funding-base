import { describe, expect, it, vi } from "vitest";
import { PaymentDiscardService } from "../src/domain/payment-discard-service";
import { AsaasApiError } from "../src/services/asaas/client";

function payment(status = "AWAITING_PAYMENT") {
  return {
    paymentId: "payment-1",
    paymentMethod: "HOSTED",
    status,
    amountCents: 10_000,
    currency: "BRL",
    gift: {
      id: "gift-1",
      name: "Gift",
      fractional: false,
      quantity: 1,
      unitAmountCents: null,
      amountCents: 10_000
    },
    checkout: {
      sessionId: "checkout-1",
      url: "https://sandbox.asaas.com/checkoutSession/show/checkout-1"
    },
    createdAt: "2026-06-13T10:00:00.000Z",
    updatedAt: "2026-06-13T10:00:00.000Z"
  };
}

function reservation(status = "ACTIVE") {
  return {
    paymentId: "payment-1",
    giftId: "gift-1",
    quantity: 1,
    quotaValuesCents: [10_000],
    amountCents: 10_000,
    status,
    expiresAt: "2026-06-13T11:00:00.000Z",
    createdAt: "2026-06-13T10:00:00.000Z",
    updatedAt: "2026-06-13T10:00:00.000Z"
  };
}

function shell(status = "CHECKOUT_READY") {
  return {
    paymentId: "payment-1",
    giftId: "gift-1",
    amountCents: 10_000,
    quotaValuesCents: [10_000],
    paymentMethod: "HOSTED",
    externalReference: "payment-1",
    shellStatus: status,
    asaasCheckoutId: "checkout-1",
    createdAt: "2026-06-13T10:00:00.000Z",
    updatedAt: "2026-06-13T10:00:00.000Z"
  };
}

function createRepository(
  initial = {
    payment: payment(),
    reservation: reservation(),
    shell: shell()
  },
  final = {
    payment: payment("CANCELED"),
    reservation: reservation("RELEASED"),
    shell: shell("CHECKOUT_RELEASED")
  }
) {
  return {
    getPayment: vi.fn().mockResolvedValueOnce(initial.payment).mockResolvedValueOnce(final.payment),
    getPaymentReservation: vi
      .fn()
      .mockResolvedValueOnce(initial.reservation)
      .mockResolvedValueOnce(final.reservation),
    getPaymentShell: vi.fn().mockResolvedValueOnce(initial.shell).mockResolvedValueOnce(final.shell),
    discardPendingPayment: vi.fn().mockResolvedValue(true)
  };
}

describe("PaymentDiscardService", () => {
  it("cancels Asaas before atomically releasing the local checkout", async () => {
    const repository = createRepository();
    const asaasClient = {
      cancelCheckout: vi.fn().mockResolvedValue({ id: "checkout-1", status: "CANCELED" }),
      getCheckoutById: vi.fn()
    };
    const service = new PaymentDiscardService(repository as never, asaasClient as never);

    const result = await service.discard("payment-1", " idem-1 ");

    expect(result.payment.status).toBe("CANCELED");
    expect(asaasClient.cancelCheckout).toHaveBeenCalledWith("checkout-1");
    expect(asaasClient.cancelCheckout.mock.invocationCallOrder[0]).toBeLessThan(
      repository.discardPendingPayment.mock.invocationCallOrder[0]
    );
    expect(repository.discardPendingPayment).toHaveBeenCalledWith({
      paymentId: "payment-1",
      expectedPaymentStatus: "AWAITING_PAYMENT",
      expectedReservationStatus: "ACTIVE",
      expectedShellStatus: "CHECKOUT_READY"
    });
  });

  it("returns an already completed discard without calling Asaas or decrementing again", async () => {
    const discarded = {
      payment: payment("CANCELED"),
      reservation: reservation("RELEASED"),
      shell: shell("CHECKOUT_RELEASED")
    };
    const repository = createRepository(discarded, discarded);
    const asaasClient = {
      cancelCheckout: vi.fn(),
      getCheckoutById: vi.fn()
    };
    const service = new PaymentDiscardService(repository as never, asaasClient as never);

    await expect(service.discard("payment-1")).resolves.toEqual(
      expect.objectContaining({ payment: expect.objectContaining({ status: "CANCELED" }) })
    );
    expect(asaasClient.cancelCheckout).not.toHaveBeenCalled();
    expect(repository.discardPendingPayment).not.toHaveBeenCalled();
  });

  it.each(["PROCESSING", "CONFIRMED", "RECEIVED", "REFUNDED", "CHARGEBACK"])(
    "does not release a %s payment",
    async (status) => {
      const initial = {
        payment: payment(status),
        reservation: reservation(),
        shell: shell()
      };
      const repository = createRepository(initial, initial);
      const asaasClient = {
        cancelCheckout: vi.fn(),
        getCheckoutById: vi.fn()
      };
      const service = new PaymentDiscardService(repository as never, asaasClient as never);

      await expect(service.discard("payment-1")).rejects.toMatchObject({ statusCode: 409 });
      expect(asaasClient.cancelCheckout).not.toHaveBeenCalled();
      expect(repository.discardPendingPayment).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["ACTIVE", new AsaasApiError("Bad request", 400), { id: "checkout-1", status: "ACTIVE" }],
    ["PAID", new AsaasApiError("Not cancellable", 400), { id: "checkout-1", status: "PAID" }],
    ["404", new AsaasApiError("Not found", 404), null]
  ])("keeps the reservation intact after an ambiguous %s cancellation", async (_case, failure, lookup) => {
    const repository = createRepository();
    const asaasClient = {
      cancelCheckout: vi.fn().mockRejectedValue(failure),
      getCheckoutById: vi.fn().mockResolvedValue(lookup)
    };
    const service = new PaymentDiscardService(repository as never, asaasClient as never);

    await expect(service.discard("payment-1")).rejects.toBe(failure);
    expect(repository.discardPendingPayment).not.toHaveBeenCalled();
  });

  it("does not reconcile or release after a timeout", async () => {
    const repository = createRepository();
    const timeout = new Error("timeout");
    const asaasClient = {
      cancelCheckout: vi.fn().mockRejectedValue(timeout),
      getCheckoutById: vi.fn()
    };
    const service = new PaymentDiscardService(repository as never, asaasClient as never);

    await expect(service.discard("payment-1")).rejects.toBe(timeout);
    expect(asaasClient.getCheckoutById).not.toHaveBeenCalled();
    expect(repository.discardPendingPayment).not.toHaveBeenCalled();
  });

  it.each(["CANCELED", "EXPIRED"])(
    "reconciles a failed cancel when checkout lookup proves %s",
    async (status) => {
      const repository = createRepository();
      const asaasClient = {
        cancelCheckout: vi.fn().mockRejectedValue(new AsaasApiError("Already closed", 400)),
        getCheckoutById: vi.fn().mockResolvedValue({ id: "checkout-1", status })
      };
      const service = new PaymentDiscardService(repository as never, asaasClient as never);

      await expect(service.discard("payment-1")).resolves.toEqual(
        expect.objectContaining({ payment: expect.objectContaining({ status: "CANCELED" }) })
      );
      expect(repository.discardPendingPayment).toHaveBeenCalledTimes(1);
    }
  );

  it("returns success when a concurrent discard completed the final state", async () => {
    const repository = createRepository();
    repository.discardPendingPayment.mockResolvedValue(false);
    const asaasClient = {
      cancelCheckout: vi.fn().mockResolvedValue({ id: "checkout-1", status: "CANCELED" }),
      getCheckoutById: vi.fn()
    };
    const service = new PaymentDiscardService(repository as never, asaasClient as never);

    await expect(service.discard("payment-1")).resolves.toEqual(
      expect.objectContaining({ payment: expect.objectContaining({ status: "CANCELED" }) })
    );
  });

  it("returns 409 when a confirmation webhook wins the local transaction", async () => {
    const repository = createRepository(
      {
        payment: payment(),
        reservation: reservation(),
        shell: shell()
      },
      {
        payment: payment("CONFIRMED"),
        reservation: reservation("CONSUMED"),
        shell: shell("CHECKOUT_CONSUMED")
      }
    );
    repository.discardPendingPayment.mockResolvedValue(false);
    const asaasClient = {
      cancelCheckout: vi.fn().mockResolvedValue({ id: "checkout-1", status: "CANCELED" }),
      getCheckoutById: vi.fn()
    };
    const service = new PaymentDiscardService(repository as never, asaasClient as never);

    await expect(service.discard("payment-1")).rejects.toMatchObject({ statusCode: 409 });
  });
});
