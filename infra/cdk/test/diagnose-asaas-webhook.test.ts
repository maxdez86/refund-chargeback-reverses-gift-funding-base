import { describe, expect, it, vi } from "vitest";

async function loadModule() {
  return import("../../../scripts/lib/diagnose-asaas-webhook.mjs");
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body)
  };
}

describe("diagnose asaas webhook", () => {
  it("classifies a resolvable incident as stale deployment", async () => {
    const { diagnoseAsaasWebhook } = await loadModule();

    const result = await diagnoseAsaasWebhook({
      apiBaseUrl: "https://api.asaas.com/v3",
      apiKey: "asaas-key",
      eventId: "event-1",
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({
          checkoutSession: "checkout-1",
          externalReference: "payment-1",
          id: "pay-1"
        })
      ),
      repository: {
        getPayment: vi.fn().mockResolvedValue({ paymentId: "payment-1" }),
        getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-1",
          payload: JSON.stringify({
            payment: {
              id: "pay-1"
            }
          })
        })
      }
    });

    expect(result.classification).toBe("stale-deployment");
    expect(result.resolutionSource).toBe("asaas_fallback_external_reference");
    expect(result.payment?.paymentId).toBe("payment-1");
  });

  it("classifies missing Asaas fallback references", async () => {
    const { diagnoseAsaasWebhook } = await loadModule();

    const result = await diagnoseAsaasWebhook({
      apiBaseUrl: "https://api.asaas.com/v3",
      apiKey: "asaas-key",
      eventId: "event-2",
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({
          id: "pay-2"
        })
      ),
      repository: {
        getPayment: vi.fn().mockResolvedValue(null),
        getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-2",
          payload: JSON.stringify({
            payment: {
              id: "pay-2"
            }
          })
        })
      }
    });

    expect(result.classification).toBe("asaas-missing-references");
  });

  it("classifies local payment missing when identifiers exist but no record matches", async () => {
    const { diagnoseAsaasWebhook } = await loadModule();

    const result = await diagnoseAsaasWebhook({
      apiBaseUrl: "https://api.asaas.com/v3",
      apiKey: "asaas-key",
      eventId: "event-3",
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({
          checkoutSession: "checkout-3",
          externalReference: "payment-3",
          id: "pay-3"
        })
      ),
      repository: {
        getPayment: vi.fn().mockResolvedValue(null),
        getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-3",
          payload: JSON.stringify({
            payment: {
              id: "pay-3"
            }
          })
        })
      }
    });

    expect(result.classification).toBe("local-payment-missing");
    expect(result.recoveredIdentifiers.externalReference).toBe("payment-3");
    expect(result.recoveredIdentifiers.asaasCheckoutId).toBe("checkout-3");
  });

  it("fails fast when no identifier is provided", async () => {
    const { diagnoseAsaasWebhook } = await loadModule();

    await expect(
      diagnoseAsaasWebhook({
        repository: {
          getPayment: vi.fn(),
          getPaymentByAsaasCheckoutId: vi.fn(),
          getPaymentByAsaasPaymentId: vi.fn(),
          getWebhookEvent: vi.fn()
        }
      })
    ).rejects.toThrow("Provide --event-id or --asaas-payment-id.");
  });

  it("surfaces a clear classification when the webhook event is missing", async () => {
    const { diagnoseAsaasWebhook } = await loadModule();

    const result = await diagnoseAsaasWebhook({
      apiBaseUrl: "https://api.asaas.com/v3",
      apiKey: "asaas-key",
      asaasPaymentId: "pay-missing-event",
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({
          id: "pay-missing-event"
        })
      ),
      repository: {
        getPayment: vi.fn().mockResolvedValue(null),
        getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
        getWebhookEvent: vi.fn().mockResolvedValue(null)
      }
    });

    expect(result.eventFound).toBe(false);
    expect(result.classification).toBe("asaas-missing-references");
  });
});
