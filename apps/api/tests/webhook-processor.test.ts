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
            externalReference: "payment-1",
            status: "RECEIVED",
            confirmedDate: "2026-05-10",
            clientPaymentDate: "2026-05-10"
          }
        }),
        asaasPaymentId: "pay_asaas_1",
        externalReference: "payment-1"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue({
        paymentId: "payment-1",
        asaasPaymentId: "pay_asaas_1"
      }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };

    const processor = new WebhookProcessor(repository as never);
    const result = await processor.processEvent("event-1");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(repository.applyWebhookUpdate).toHaveBeenCalledWith({
      paymentId: "payment-1",
      nextStatus: "RECEIVED",
      confirmedOn: "2026-05-10",
      receivedOn: "2026-05-10",
      asaasPaymentId: "pay_asaas_1"
    });
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-1", "updated");
  });
});
