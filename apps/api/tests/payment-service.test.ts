import { describe, expect, it, vi } from "vitest";
import { PaymentService } from "../src/domain/payment-service";

describe("PaymentService", () => {
  it("creates a hosted PIX checkout without collecting payer data", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
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
    expect(repository.putPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: result.payment.paymentId,
        asaasCheckoutId: "checkout-1",
        customerProfileStatus: "PENDING"
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
      getPayment: vi.fn().mockResolvedValue(existingPayment)
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
      getPayment: vi.fn().mockResolvedValueOnce(null)
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
        giftId: "g-toalhas-banho",
        paymentMethod: "PIX"
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

  it("fails with 409 when neither projection, snapshot, nor Asaas record exists", async () => {
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
      getPayment: vi.fn().mockResolvedValue(null)
    };
    const asaasClient = {
      listPaymentsByExternalReference: vi.fn().mockResolvedValue([])
    };

    const service = new PaymentService(repository as never, asaasClient as never);

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
