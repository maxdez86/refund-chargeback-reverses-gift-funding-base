import { describe, expect, it, vi } from "vitest";
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
      findCustomerByCpf: vi.fn().mockResolvedValue({ id: "customer-1" }),
      createCustomer: vi.fn(),
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
        payer: {
          cpf: "123.456.789-09",
          email: "test@example.com",
          name: "Test Guest"
        }
      },
      "idem-test-pix"
    );

    expect(asaasClient.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        billingTypes: ["PIX"],
        chargeTypes: ["DETACHED"],
        customer: "customer-1",
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
        payer: {
          cpf: "123.456.789-09",
          email: "test@example.com",
          name: "Test Guest"
        }
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
        payer: {
          cpf: "123.456.789-09",
          email: "test@example.com",
          name: "Test Guest"
        }
      },
      "idem-recovered"
    );

    expect(result.payment.paymentId).toBe("payment-recovered-1");
    expect(result.payment.checkout?.sessionId).toBe("checkout-1");
  });
});
