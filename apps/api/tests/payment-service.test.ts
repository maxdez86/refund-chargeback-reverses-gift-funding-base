import { describe, expect, it, vi } from "vitest";
import { PaymentService } from "../src/domain/payment-service";

describe("PaymentService", () => {
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
});
