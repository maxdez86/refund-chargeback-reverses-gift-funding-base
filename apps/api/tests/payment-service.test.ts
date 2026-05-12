import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors";
import { PaymentService } from "../src/domain/payment-service";

describe("PaymentService", () => {
  it("creates a hosted PIX checkout for the dedicated R$ 5,00 test gift", async () => {
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: true,
        reservation: {
          paymentId: "payment-test-1"
        }
      }),
      putPayment: vi.fn().mockResolvedValue(undefined),
      completeCreatePayment: vi.fn().mockResolvedValue(undefined),
      getPayment: vi.fn()
    };
    const asaasClient = {
      createCheckout: vi.fn().mockResolvedValue({
        id: "checkout-1"
      }),
      buildCheckoutUrl: vi.fn().mockReturnValue("https://www.asaas.com/c/checkout-1")
    };

    const service = new PaymentService(repository as never, asaasClient as never);

    const result = await service.createPayment(
      {
        giftId: "g-test-pix",
        paymentMethod: "PIX",
        payerEmail: "test@example.com"
      },
      "idem-test-pix"
    );

    expect(asaasClient.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        billingTypes: ["PIX"],
        chargeTypes: ["DETACHED"],
        customerData: {
          email: "test@example.com"
        },
        externalReference: result.payment.paymentId,
        items: [
          expect.objectContaining({
            name: "PIX Teste",
            quantity: 1,
            value: 5
          })
        ]
      })
    );
    expect(result.payment.status).toBe("CREATED");
    expect(result.payment.amountCents).toBe(500);
    expect(result.payment.gift.id).toBe("g-test-pix");
    expect(result.payment.checkout).toEqual(
      expect.objectContaining({
        sessionId: "checkout-1",
        url: "https://www.asaas.com/c/checkout-1"
      })
    );
    expect(repository.putPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: result.payment.paymentId,
        asaasCheckoutId: "checkout-1"
      })
    );
    expect(repository.completeCreatePayment).toHaveBeenCalledWith("idem-test-pix", result.payment);
  });

  it("sends both billingTypes to Asaas when paymentMethod is HOSTED", async () => {
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: true,
        reservation: {
          paymentId: "payment-test-hosted-1"
        }
      }),
      putPayment: vi.fn().mockResolvedValue(undefined),
      completeCreatePayment: vi.fn().mockResolvedValue(undefined),
      getPayment: vi.fn()
    };
    const asaasClient = {
      createCheckout: vi.fn().mockResolvedValue({
        id: "checkout-hosted-1"
      }),
      buildCheckoutUrl: vi.fn().mockReturnValue("https://www.asaas.com/c/checkout-hosted-1")
    };

    const service = new PaymentService(repository as never, asaasClient as never);

    const result = await service.createPayment(
      {
        giftId: "g-test-pix",
        paymentMethod: "HOSTED",
        payerEmail: "test@example.com"
      },
      "idem-test-hosted"
    );

    expect(asaasClient.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        billingTypes: ["PIX", "CREDIT_CARD"],
        chargeTypes: ["DETACHED"]
      })
    );
    expect(result.payment.paymentMethod).toBe("HOSTED");
    expect(result.payment.checkout?.sessionId).toBe("checkout-hosted-1");
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
      updatedAt: "2026-05-09T00:00:00.000Z"
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
      getPayment: vi.fn().mockResolvedValue(existingPayment)
    };

    const service = new PaymentService(repository as never, {} as never);
    const result = await service.createPayment(
      {
        giftId: "g-toalhas-banho",
        paymentMethod: "PIX",
        payerEmail: "test@example.com"
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
        updatedAt: "2026-05-09T00:00:00.000Z"
      })
    };

    const service = new PaymentService(repository as never, {} as never);
    const payment = await service.getPayment("payment-legacy-1");

    expect(payment.checkout?.expiresAt).toBe("2027-05-10T23:59:59.000Z");
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
      updatedAt: "2026-05-09T00:00:00.000Z"
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
      getPayment: vi.fn().mockResolvedValueOnce(null)
    };

    const service = new PaymentService(repository as never, {} as never);
    const result = await service.createPayment(
      {
        giftId: "g-test-pix",
        paymentMethod: "PIX",
        payerEmail: "test@example.com"
      },
      "idem-recovered"
    );

    expect(result.payment.paymentId).toBe("payment-recovered-1");
    expect(result.payment.checkout?.sessionId).toBe("checkout-1");
  });

  it("recovers from Asaas when both the projection row and the snapshot are missing", async () => {
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: false,
        reservation: {
          fingerprint: "same",
          paymentId: "payment-asaas-recovered-1",
          status: "IN_PROGRESS"
        }
      }),
      getPayment: vi.fn().mockResolvedValue(null)
    };
    const asaasClient = {
      listPaymentsByExternalReference: vi.fn().mockResolvedValue([
        {
          id: "asaas-payment-1",
          billingType: "PIX",
          status: "PENDING",
          value: 5,
          checkoutSession: "checkout-recovery-1",
          description: "PIX Teste",
          externalReference: "payment-asaas-recovered-1"
        }
      ]),
      buildCheckoutUrl: vi.fn().mockReturnValue("https://www.asaas.com/c/checkout-recovery-1")
    };

    const service = new PaymentService(repository as never, asaasClient as never);
    const result = await service.createPayment(
      {
        giftId: "g-test-pix",
        paymentMethod: "PIX",
        payerEmail: "test@example.com"
      },
      "idem-asaas-recovered"
    );

    expect(asaasClient.listPaymentsByExternalReference).toHaveBeenCalledWith("payment-asaas-recovered-1");
    expect(asaasClient.buildCheckoutUrl).toHaveBeenCalledWith({ id: "checkout-recovery-1" });
    expect(result.payment.paymentId).toBe("payment-asaas-recovered-1");
    expect(result.payment.paymentMethod).toBe("PIX");
    expect(result.payment.status).toBe("CREATED");
    expect(result.payment.amountCents).toBe(500);
    expect(result.payment.checkout).toEqual({
      sessionId: "checkout-recovery-1",
      url: "https://www.asaas.com/c/checkout-recovery-1"
    });
    expect(result.payment.gift.id).toBe("recovered");
    expect(result.payment.gift.name).toBe("PIX Teste");
  });

  it("falls through to 409 when neither projection, snapshot, nor Asaas record exists", async () => {
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: false,
        reservation: {
          fingerprint: "same",
          paymentId: "payment-orphan-1",
          status: "IN_PROGRESS"
        }
      }),
      getPayment: vi.fn().mockResolvedValue(null)
    };
    const asaasClient = {
      listPaymentsByExternalReference: vi.fn().mockResolvedValue([])
    };

    const service = new PaymentService(repository as never, asaasClient as never);

    await expect(
      service.createPayment(
        {
          giftId: "g-test-pix",
          paymentMethod: "PIX",
          payerEmail: "test@example.com"
        },
        "idem-orphan"
      )
    ).rejects.toThrow(/could not be recovered safely/);
  });

  it("accepts the legacy payer payload during rollout and stores only payerEmail", async () => {
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: true,
        reservation: {
          paymentId: "payment-legacy-rollout-1"
        }
      }),
      putPayment: vi.fn().mockResolvedValue(undefined),
      completeCreatePayment: vi.fn().mockResolvedValue(undefined),
      getPayment: vi.fn()
    };
    const asaasClient = {
      createCheckout: vi.fn().mockResolvedValue({
        id: "checkout-legacy-rollout-1"
      }),
      buildCheckoutUrl: vi.fn().mockReturnValue("https://www.asaas.com/c/checkout-legacy-rollout-1")
    };

    const service = new PaymentService(repository as never, asaasClient as never);

    await service.createPayment(
      {
        giftId: "g-test-pix",
        paymentMethod: "PIX",
        payer: {
          cpf: "123.456.789-09",
          email: "legacy@example.com",
          name: "Legacy Guest"
        }
      },
      "idem-legacy-rollout"
    );

    expect(repository.putPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payerEmail: "legacy@example.com"
      })
    );
    expect(repository.putPayment.mock.calls[0][0]).not.toHaveProperty("payerCpfHash");
    expect(repository.putPayment.mock.calls[0][0]).not.toHaveProperty("payerName");
  });

  it("retries checkout creation without customerData when Asaas rejects the field", async () => {
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: true,
        reservation: {
          paymentId: "payment-customerdata-fallback-1"
        }
      }),
      putPayment: vi.fn().mockResolvedValue(undefined),
      completeCreatePayment: vi.fn().mockResolvedValue(undefined),
      getPayment: vi.fn()
    };
    const asaasClient = {
      createCheckout: vi
        .fn()
        .mockRejectedValueOnce(new AppError("Unknown field customerData", 502))
        .mockResolvedValueOnce({
          id: "checkout-fallback-1"
        }),
      buildCheckoutUrl: vi.fn().mockReturnValue("https://www.asaas.com/c/checkout-fallback-1")
    };

    const service = new PaymentService(repository as never, asaasClient as never);

    await service.createPayment(
      {
        giftId: "g-test-pix",
        paymentMethod: "PIX",
        payerEmail: "test@example.com"
      },
      "idem-customerdata-fallback"
    );

    expect(asaasClient.createCheckout).toHaveBeenCalledTimes(2);
    expect(asaasClient.createCheckout).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        customerData: {
          email: "test@example.com"
        }
      })
    );
    expect(asaasClient.createCheckout).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        customerData: undefined
      })
    );
  });
});
