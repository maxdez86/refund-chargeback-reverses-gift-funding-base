import { describe, expect, it, vi } from "vitest";
import { WebhookProcessor } from "../src/domain/webhook-processor";

describe("WebhookProcessor", () => {
  it("normalizes Asaas settlement dates into date-only payment projection fields", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_RECEIVED",
          payment: {
            id: "pay_asaas_1",
            checkoutSession: "checkout_1",
            externalReference: "payment-1",
            status: "RECEIVED",
            confirmedDate: "2026-05-10",
            clientPaymentDate: "2026-05-10"
          }
        }),
        asaasPaymentId: "pay_asaas_1",
        asaasCheckoutId: "checkout_1",
        externalReference: "payment-1"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue({
        paymentId: "payment-1",
        status: "AWAITING_PAYMENT",
        asaasPaymentId: "pay_asaas_1",
        asaasCheckoutId: "checkout_1"
      }),
      getPaymentByAsaasCheckoutId: vi.fn(),
      getPayment: vi.fn(),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };

    const processor = new WebhookProcessor(repository as never);
    const result = await processor.processEvent("event-1");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(repository.applyWebhookUpdate).toHaveBeenCalledWith({
      paymentId: "payment-1",
      expectedCurrentStatus: "AWAITING_PAYMENT",
      nextStatus: "RECEIVED",
      confirmedOn: "2026-05-10",
      receivedOn: "2026-05-10",
      asaasPaymentId: "pay_asaas_1",
      asaasCheckoutId: "checkout_1"
    });
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-1", "updated");
  });

  it("falls back to the checkout session lookup when the payment id is not known yet", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CREATED",
          payment: {
            id: "pay_asaas_2",
            checkoutSession: "checkout_2",
            status: "PENDING"
          }
        }),
        asaasPaymentId: "pay_asaas_2",
        asaasCheckoutId: "checkout_2"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
      getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue({
        paymentId: "payment-2",
        status: "CREATED",
        asaasCheckoutId: "checkout_2"
      }),
      getPayment: vi.fn(),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };

    const processor = new WebhookProcessor(repository as never);
    const result = await processor.processEvent("event-2");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(repository.getPaymentByAsaasCheckoutId).toHaveBeenCalledWith("checkout_2");
    expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "payment-2",
        nextStatus: "AWAITING_PAYMENT"
      })
    );
  });
});
