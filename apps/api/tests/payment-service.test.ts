import { describe, expect, it, vi } from "vitest";
import { PAYMENT_GIFTS_BY_ID } from "@brimax/config";
import { PaymentService } from "../src/domain/payment-service";

const toalhasGift = PAYMENT_GIFTS_BY_ID.get("g-toalhas-banho");
const pratosGift = PAYMENT_GIFTS_BY_ID.get("g-pratos");

function createRepositoryMock(overrides: Record<string, unknown> = {}) {
  return {
    reserveCreatePayment: vi.fn().mockResolvedValue({
      accepted: true,
      reservation: {
        paymentId: "payment-test-1"
      }
    }),
    reserveGiftSelection: vi.fn().mockImplementation(async ({ gift, quantity }: { gift: typeof toalhasGift; quantity: number }) => {
      if (gift?.id === "g-pratos" && quantity === 7) {
        return {
          quantity: 7,
          quotaValuesCents: [5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 3_100],
          amountCents: 33_100,
          unitAmountCents: null
        };
      }

      return {
        quantity,
        quotaValuesCents: Array.from({ length: quantity }, () => gift?.fractional ? (gift.partValueCents ?? 0) : (gift?.totalValueCents ?? 0)),
        amountCents: gift?.fractional ? quantity * (gift.partValueCents ?? 0) : (gift?.totalValueCents ?? 0),
        unitAmountCents: gift?.fractional ? (gift.partValueCents ?? null) : null
      };
    }),
    putPaymentShell: vi.fn().mockResolvedValue(undefined),
    finalizeCreatePayment: vi.fn().mockResolvedValue(undefined),
    markCheckoutAmbiguous: vi.fn().mockResolvedValue(undefined),
    releaseReservationAfterCheckoutFailure: vi.fn().mockResolvedValue(undefined),
    getPaymentShell: vi.fn().mockResolvedValue(null),
    getPaymentReservation: vi.fn().mockResolvedValue(null),
    getGift: vi.fn().mockResolvedValue(toalhasGift),
    getPayment: vi.fn().mockResolvedValue(null),
    ...overrides
  };
}

describe("PaymentService", () => {
  it("creates a hosted PIX checkout without collecting payer data", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const repository = createRepositoryMock();
    const asaasClient = {
      createCheckout: vi.fn().mockResolvedValue({
        id: "checkout-1"
      }),
      buildCheckoutUrl: vi.fn().mockReturnValue("https://www.asaas.com/c/checkout-1")
    };

    const service = new PaymentService(repository as never, asaasClient as never);

    const result = await service.createPayment(
      {
        giftId: "g-toalhas-banho",
        paymentMethod: "PIX"
      },
      "idem-test-pix"
    );

    expect(asaasClient.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        billingTypes: ["PIX"],
        chargeTypes: ["DETACHED"],
        externalReference: result.payment.paymentId,
        items: [
          expect.objectContaining({
            name: "4 Toalhas de Banho",
            quantity: 1,
            value: 176
          })
        ]
      })
    );
    expect(asaasClient.createCheckout.mock.calls[0][0]).not.toHaveProperty("installment");
    expect(asaasClient.createCheckout.mock.calls[0][0]).not.toHaveProperty("customerData");
    expect(result.payment.status).toBe("CREATED");
    expect(result.payment.customerProfileStatus).toBe("PENDING");
    expect(repository.finalizeCreatePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        asaasCheckoutId: "checkout-1",
        idempotencyKey: "idem-test-pix",
        payment: expect.objectContaining({
          paymentId: result.payment.paymentId,
          customerProfileStatus: "PENDING"
        })
      })
    );
    expect(repository.putPaymentShell).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: result.payment.paymentId,
        externalReference: result.payment.paymentId,
        shellStatus: "CHECKOUT_CREATING"
      })
    );
    expect(repository.reserveGiftSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: result.payment.paymentId
      })
    );
    expect(repository.finalizeCreatePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        asaasCheckoutId: "checkout-1",
        payment: expect.objectContaining({
          customerProfileStatus: "PENDING"
        })
      })
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"PAYMENT_CREATE_SERVICE_TIMING\"")
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"outcome\":\"success\"")
    );
    infoSpy.mockRestore();
  });

  it("sends both billingTypes to Asaas when paymentMethod is HOSTED", async () => {
    const repository = createRepositoryMock({
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: true,
        reservation: {
          paymentId: "payment-test-hosted-1"
        }
      })
    });
    const asaasClient = {
      createCheckout: vi.fn().mockResolvedValue({
        id: "checkout-hosted-1"
      }),
      buildCheckoutUrl: vi.fn().mockReturnValue("https://www.asaas.com/c/checkout-hosted-1")
    };

    const service = new PaymentService(repository as never, asaasClient as never);

    const result = await service.createPayment(
      {
        giftId: "g-toalhas-banho",
        paymentMethod: "HOSTED"
      },
      "idem-test-hosted"
    );

    expect(asaasClient.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        billingTypes: ["PIX", "CREDIT_CARD"],
        chargeTypes: ["DETACHED", "INSTALLMENT"],
        installment: {
          maxInstallmentCount: 10
        }
      })
    );
    expect(result.payment.paymentMethod).toBe("HOSTED");
    expect(result.payment.checkout?.sessionId).toBe("checkout-hosted-1");
  });

  it("uses the unit cota amount for fractional PIX checkout items", async () => {
    const repository = createRepositoryMock({
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: true,
        reservation: {
          paymentId: "payment-test-fractional-pix-1"
        }
      }),
      getGift: vi.fn().mockResolvedValue(pratosGift)
    });
    const asaasClient = {
      createCheckout: vi.fn().mockResolvedValue({
        id: "checkout-fractional-pix-1"
      }),
      buildCheckoutUrl: vi.fn().mockReturnValue("https://www.asaas.com/c/checkout-fractional-pix-1")
    };

    const service = new PaymentService(repository as never, asaasClient as never);

    const result = await service.createPayment(
      {
        giftId: "g-pratos",
        paymentMethod: "PIX",
        quantity: 7
      },
      "idem-test-fractional-pix"
    );

    expect(asaasClient.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        billingTypes: ["PIX"],
        chargeTypes: ["DETACHED"],
        items: [
          expect.objectContaining({
            name: "Jogo de Pratos 12 Peças",
            quantity: 6,
            value: 50
          }),
          expect.objectContaining({
            name: "Jogo de Pratos 12 Peças",
            quantity: 1,
            value: 31
          })
        ]
      })
    );
    expect(result.payment.amountCents).toBe(33_100);
    expect(result.payment.gift.quantity).toBe(7);
    expect(result.payment.gift.unitAmountCents).toBeNull();
    expect(result.payment.gift.quotaValuesCents).toEqual([5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 3_100]);
  });

  it("uses the unit cota amount for fractional HOSTED checkout items", async () => {
    const repository = createRepositoryMock({
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: true,
        reservation: {
          paymentId: "payment-test-fractional-hosted-1"
        }
      }),
      getGift: vi.fn().mockResolvedValue(pratosGift)
    });
    const asaasClient = {
      createCheckout: vi.fn().mockResolvedValue({
        id: "checkout-fractional-hosted-1"
      }),
      buildCheckoutUrl: vi.fn().mockReturnValue("https://www.asaas.com/c/checkout-fractional-hosted-1")
    };

    const service = new PaymentService(repository as never, asaasClient as never);

    const result = await service.createPayment(
      {
        giftId: "g-pratos",
        paymentMethod: "HOSTED",
        quantity: 3
      },
      "idem-test-fractional-hosted"
    );

    expect(asaasClient.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        billingTypes: ["PIX", "CREDIT_CARD"],
        chargeTypes: ["DETACHED", "INSTALLMENT"],
        installment: {
          maxInstallmentCount: 10
        },
        items: [
          expect.objectContaining({
            name: "Jogo de Pratos 12 Peças",
            quantity: 3,
            value: 50
          })
        ]
      })
    );
    expect(result.payment.amountCents).toBe(15_000);
    expect(result.payment.gift.quantity).toBe(3);
    expect(result.payment.gift.unitAmountCents).toBe(5_000);
  });

  it("returns the existing payment when the same idempotency key is replayed", async () => {
    const existingPayment = {
      paymentId: "payment-1",
      paymentMethod: "PIX" as const,
      status: "CREATED" as const,
      amountCents: 17_600,
      currency: "BRL" as const,
      gift: {
        id: "g-toalhas-banho",
        name: "4 Toalhas de Banho",
        fractional: false,
        quantity: 1,
        unitAmountCents: null,
        amountCents: 17_600
      },
      checkout: {
        sessionId: "checkout-1",
        url: "https://www.asaas.com/c/checkout-1"
      },
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
      customerProfileStatus: "PENDING" as const
    };

    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: false,
        reservation: {
          fingerprint: "same",
          paymentId: "payment-1",
          status: "COMPLETED"
        }
      }),
      getGift: vi.fn().mockResolvedValue(toalhasGift),
      getPayment: vi.fn().mockResolvedValue(existingPayment),
      getPaymentShell: vi.fn().mockResolvedValue(null),
      getPaymentReservation: vi.fn().mockResolvedValue(null)
    };

    const service = new PaymentService(repository as never, {} as never);
    const result = await service.createPayment(
      {
        giftId: "g-toalhas-banho",
        paymentMethod: "PIX"
      },
      "idem-1"
    );

    expect(result.payment.paymentId).toBe("payment-1");
    expect(repository.getPayment).toHaveBeenCalledWith("payment-1");
  });

  it("reads hosted checkout values from stored payments", async () => {
    const repository = {
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-legacy-1",
        paymentMethod: "PIX" as const,
        status: "CREATED" as const,
        amountCents: 500,
        currency: "BRL" as const,
        gift: {
          id: "g-test-pix",
          name: "PIX Teste",
          fractional: false,
          quantity: 1,
          unitAmountCents: null,
          amountCents: 500
        },
        checkout: {
          sessionId: "checkout-1",
          url: "https://www.asaas.com/c/checkout-1",
          expiresAt: "2027-05-10T23:59:59.000Z"
        },
        createdAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:00.000Z",
        customerProfileStatus: "PENDING" as const
      })
    };

    const service = new PaymentService(repository as never, {} as never);
    const payment = await service.getPayment("payment-legacy-1");

    expect(payment.checkout?.expiresAt).toBe("2027-05-10T23:59:59.000Z");
  });

  it("expires a stale pending checkout on read and returns the expired summary without re-reading", async () => {
    const stalePayment = {
      paymentId: "payment-stale-1",
      paymentMethod: "PIX" as const,
      status: "CREATED" as const,
      amountCents: 500,
      currency: "BRL" as const,
      gift: {
        id: "g-test-pix",
        name: "PIX Teste",
        fractional: false,
        quantity: 1,
        unitAmountCents: null,
        amountCents: 500
      },
      checkout: {
        sessionId: "checkout-1",
        url: "https://www.asaas.com/c/checkout-1",
        expiresAt: "2026-01-01T00:00:00.000Z"
      },
      createdAt: "2025-12-31T23:00:00.000Z",
      updatedAt: "2025-12-31T23:00:00.000Z",
      customerProfileStatus: "PENDING" as const
    };
    const repository = {
      getPayment: vi.fn().mockResolvedValue(stalePayment),
      tryExpireStalePayment: vi.fn().mockResolvedValue(true)
    };

    const service = new PaymentService(repository as never, {} as never);
    const payment = await service.getPayment("payment-stale-1");

    expect(payment.status).toBe("EXPIRED");
    expect(repository.tryExpireStalePayment).toHaveBeenCalledWith({
      paymentId: "payment-stale-1",
      expectedCurrentStatus: "CREATED"
    });
    expect(repository.getPayment).toHaveBeenCalledTimes(1);
  });

  it("re-reads the payment when the lazy expiry loses the race", async () => {
    const stalePayment = {
      paymentId: "payment-stale-2",
      paymentMethod: "PIX" as const,
      status: "AWAITING_PAYMENT" as const,
      amountCents: 500,
      currency: "BRL" as const,
      gift: {
        id: "g-test-pix",
        name: "PIX Teste",
        fractional: false,
        quantity: 1,
        unitAmountCents: null,
        amountCents: 500
      },
      checkout: {
        sessionId: "checkout-2",
        url: "https://www.asaas.com/c/checkout-2",
        expiresAt: "2026-01-01T00:00:00.000Z"
      },
      createdAt: "2025-12-31T23:00:00.000Z",
      updatedAt: "2025-12-31T23:00:00.000Z",
      customerProfileStatus: "PENDING" as const
    };
    const repository = {
      getPayment: vi
        .fn()
        .mockResolvedValueOnce(stalePayment)
        .mockResolvedValueOnce({ ...stalePayment, status: "CONFIRMED" as const }),
      tryExpireStalePayment: vi.fn().mockResolvedValue(false)
    };

    const service = new PaymentService(repository as never, {} as never);
    const payment = await service.getPayment("payment-stale-2");

    expect(payment.status).toBe("CONFIRMED");
    expect(repository.getPayment).toHaveBeenCalledTimes(2);
  });

  it("leaves a pending payment untouched while its checkout is still fresh", async () => {
    const freshExpiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const repository = {
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-fresh-1",
        paymentMethod: "PIX" as const,
        status: "CREATED" as const,
        amountCents: 500,
        currency: "BRL" as const,
        gift: {
          id: "g-test-pix",
          name: "PIX Teste",
          fractional: false,
          quantity: 1,
          unitAmountCents: null,
          amountCents: 500
        },
        checkout: {
          sessionId: "checkout-3",
          url: "https://www.asaas.com/c/checkout-3",
          expiresAt: freshExpiresAt
        },
        createdAt: "2026-06-12T11:00:00.000Z",
        updatedAt: "2026-06-12T11:00:00.000Z",
        customerProfileStatus: "PENDING" as const
      }),
      tryExpireStalePayment: vi.fn()
    };

    const service = new PaymentService(repository as never, {} as never);
    const payment = await service.getPayment("payment-fresh-1");

    expect(payment.status).toBe("CREATED");
    expect(repository.tryExpireStalePayment).not.toHaveBeenCalled();
  });

  it("recovers the completed payment snapshot when the projection row is missing", async () => {
    const paymentSnapshot = {
      paymentId: "payment-recovered-1",
      paymentMethod: "PIX" as const,
      status: "CREATED" as const,
      amountCents: 500,
      currency: "BRL" as const,
      gift: {
        id: "g-test-pix",
        name: "PIX Teste",
        fractional: false,
        quantity: 1,
        unitAmountCents: null,
        amountCents: 500
      },
      checkout: {
        sessionId: "checkout-1",
        url: "https://www.asaas.com/c/checkout-1"
      },
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
      customerProfileStatus: "PENDING" as const
    };
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: false,
        reservation: {
          fingerprint: "same",
          paymentId: "payment-recovered-1",
          status: "COMPLETED",
          paymentSnapshot
        }
      }),
      getGift: vi.fn().mockResolvedValue(toalhasGift),
      getPayment: vi.fn().mockResolvedValueOnce(null),
      getPaymentShell: vi.fn().mockResolvedValue(null),
      getPaymentReservation: vi.fn().mockResolvedValue(null)
    };

    const service = new PaymentService(repository as never, {} as never);
    const result = await service.createPayment(
      {
        giftId: "g-toalhas-banho",
        paymentMethod: "PIX"
      },
      "idem-recovered"
    );

    expect(result.payment.paymentId).toBe("payment-recovered-1");
    expect(result.payment.checkout?.sessionId).toBe("checkout-1");
  });

  it("fails with 409 when only shell/reservation recovery would be possible", async () => {
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: false,
        reservation: {
          fingerprint: "same",
          paymentId: "payment-asaas-recovered-1",
          status: "IN_PROGRESS"
        }
      }),
      getGift: vi.fn().mockResolvedValue(toalhasGift),
      getPayment: vi.fn().mockResolvedValue(null),
      getPaymentShell: vi.fn().mockResolvedValue({
        paymentId: "payment-asaas-recovered-1"
      }),
      getPaymentReservation: vi.fn().mockResolvedValue({
        paymentId: "payment-asaas-recovered-1"
      })
    };
    const service = new PaymentService(repository as never, {} as never);

    await expect(
      service.createPayment(
        {
          giftId: "g-toalhas-banho",
          paymentMethod: "PIX"
        },
        "idem-asaas-recovered"
      )
    ).rejects.toThrow(/could not be recovered safely/);
  });

  it("fails with 409 when neither projection nor snapshot exists", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: false,
        reservation: {
          fingerprint: "same",
          paymentId: "payment-orphan-1",
          status: "IN_PROGRESS"
        }
      }),
      getGift: vi.fn().mockResolvedValue(toalhasGift),
      getPayment: vi.fn().mockResolvedValue(null),
      getPaymentShell: vi.fn().mockResolvedValue(null),
      getPaymentReservation: vi.fn().mockResolvedValue(null)
    };

    const service = new PaymentService(repository as never, {} as never);

    await expect(
      service.createPayment(
        {
          giftId: "g-toalhas-banho",
          paymentMethod: "PIX"
        },
        "idem-orphan"
      )
    ).rejects.toThrow(/could not be recovered safely/);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"PAYMENT_CREATE_SERVICE_TIMING\"")
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"outcome\":\"failure\"")
    );
    infoSpy.mockRestore();
  });
});
