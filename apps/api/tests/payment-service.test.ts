import { describe, expect, it, vi } from "vitest";
import { PaymentService } from "../src/domain/payment-service";

describe("PaymentService", () => {
  it("creates a PIX payment for the dedicated R$ 5,00 test gift", async () => {
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
      createPayment: vi.fn().mockResolvedValue({
        id: "asaas-payment-1",
        invoiceUrl: undefined
      }),
      getPixQrCode: vi.fn().mockResolvedValue({
        payload: "pix-payload",
        encodedImage: "pix-base64",
        expirationDate: "2027-05-10 23:59:59"
      })
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

    expect(asaasClient.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        billingType: "PIX",
        description: "PIX Teste",
        externalReference: "payment-test-1",
        value: 5
      })
    );
    expect(result.payment.amountCents).toBe(500);
    expect(result.payment.gift.id).toBe("g-test-pix");
    expect(result.payment.pix?.copyPaste).toBe("pix-payload");
    expect(result.payment.pix?.expiresAt).toBe("2027-05-10T23:59:59-03:00");
  });

  it("returns the existing payment when the same idempotency key is replayed", async () => {
    const existingPayment = {
      paymentId: "payment-1",
      paymentMethod: "PIX" as const,
      status: "AWAITING_PAYMENT" as const,
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
      pix: {
        copyPaste: "payload",
        qrCodeBase64: "base64"
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
    const asaasClient = {
      listPaymentsByExternalReference: vi.fn()
    };

    const service = new PaymentService(repository as never, asaasClient as never);

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

  it("reads normalized PIX expiration values from stored payments", async () => {
    const repository = {
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-legacy-1",
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
        pix: {
          copyPaste: "payload",
          qrCodeBase64: "base64",
          expiresAt: "2027-05-10T23:59:59-03:00"
        },
        createdAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:00.000Z"
      })
    };

    const service = new PaymentService(repository as never, {} as never);
    const payment = await service.getPayment("payment-legacy-1");

    expect(payment.pix?.expiresAt).toBe("2027-05-10T23:59:59-03:00");
  });

  it("rebuilds replayed PIX payments with normalized Asaas expiration values", async () => {
    const repository = {
      reserveCreatePayment: vi.fn().mockResolvedValue({
        accepted: false,
        reservation: {
          fingerprint: "same",
          paymentId: "payment-recovered-1",
          status: "COMPLETED"
        }
      }),
      getPayment: vi.fn().mockResolvedValueOnce(null)
    };
    const asaasClient = {
      listPaymentsByExternalReference: vi.fn().mockResolvedValue([
        {
          id: "asaas-payment-1",
          value: 5,
          description: "PIX Teste"
        }
      ]),
      getPixQrCode: vi.fn().mockResolvedValue({
        payload: "pix-payload",
        encodedImage: "pix-base64",
        expirationDate: "2027-05-10 23:59:59"
      })
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
      "idem-recovered"
    );

    expect(result.payment.paymentId).toBe("payment-recovered-1");
    expect(result.payment.pix?.expiresAt).toBe("2027-05-10T23:59:59-03:00");
  });
});
