import { describe, expect, it, vi } from "vitest";

async function loadModule() {
  return import("../../../scripts/lib/asaas-webhook-sync.mjs");
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body)
  };
}

function rawResponse({ ok, status, body }: { ok: boolean; status: number; body: string }) {
  return {
    ok,
    status,
    text: async () => body
  };
}

const managedEvents = [
  "CHECKOUT_CREATED",
  "CHECKOUT_CANCELED",
  "CHECKOUT_EXPIRED",
  "CHECKOUT_PAID",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL"
];

function verifiedWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh_123",
    name: "brimax-prod-asaas-webhook",
    url: "https://api.brimax.life/webhooks/asaas",
    email: "casamento@brimax.life",
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    hasAuthToken: true,
    sendType: "SEQUENTIALLY",
    events: managedEvents,
    ...overrides
  };
}

describe("asaas webhook sync", () => {
  it("creates a webhook when none matches", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "wh_new" }))
      .mockResolvedValueOnce(jsonResponse(verifiedWebhook({ id: "wh_new" })));

    const result = await syncAsaasWebhook({
      apiBaseUrl: "https://api.asaas.com/v3",
      apiDomain: "api.brimax.life",
      apiKey: "asaas-key",
      contactEmail: "casamento@brimax.life",
      fetchImpl,
      stage: "prod",
      webhookToken: "whsec_test_token_123456789012345678901234567890"
    });

    expect(result.action).toBe("created");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.asaas.com/v3/webhooks",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual(
      expect.objectContaining({
        name: "brimax-prod-asaas-webhook",
        url: "https://api.brimax.life/webhooks/asaas",
        email: "casamento@brimax.life",
        enabled: true,
        interrupted: false,
        apiVersion: 3,
        authToken: "whsec_test_token_123456789012345678901234567890",
        sendType: "SEQUENTIALLY"
      })
    );
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).events).toEqual(managedEvents);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://api.asaas.com/v3/webhooks/wh_new",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("updates a webhook when the URL already exists", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "wh_123", name: "legacy", url: "https://api.brimax.life/webhooks/asaas" }]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: "wh_123" }))
      .mockResolvedValueOnce(jsonResponse(verifiedWebhook()));

    const result = await syncAsaasWebhook({
      apiBaseUrl: "https://api.asaas.com/v3",
      apiDomain: "api.brimax.life",
      apiKey: "asaas-key",
      contactEmail: "casamento@brimax.life",
      fetchImpl,
      stage: "prod",
      webhookToken: "whsec_test_token_123456789012345678901234567890"
    });

    expect(result.action).toBe("updated");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.asaas.com/v3/webhooks/wh_123",
      expect.objectContaining({
        method: "PUT"
      })
    );
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual(
      expect.objectContaining({
        interrupted: false
      })
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails when multiple webhook candidates share the same URL", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: "wh_1", name: "one", url: "https://api.brimax.life/webhooks/asaas" },
          { id: "wh_2", name: "two", url: "https://api.brimax.life/webhooks/asaas" }
        ]
      })
    );

    await expect(
      syncAsaasWebhook({
        apiBaseUrl: "https://api.asaas.com/v3",
        apiDomain: "api.brimax.life",
        apiKey: "asaas-key",
        contactEmail: "casamento@brimax.life",
        fetchImpl,
        stage: "prod",
        webhookToken: "whsec_test_token_123456789012345678901234567890"
      })
    ).rejects.toThrow("Found multiple Asaas webhooks with URL");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("skips cleanly for unsupported stages", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi.fn();

    const result = await syncAsaasWebhook({
      apiBaseUrl: "https://api-sandbox.asaas.com/v3",
      apiDomain: "api.dev.brimax.life",
      apiKey: "asaas-key",
      contactEmail: "casamento@brimax.life",
      fetchImpl,
      stage: "qa",
      webhookToken: "whsec_test_token_123456789012345678901234567890"
    });

    expect(result).toEqual({
      action: "skipped",
      reason: "unsupported-stage"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a dev webhook in sandbox when none matches", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "wh_dev" }))
      .mockResolvedValueOnce(
        jsonResponse(
          verifiedWebhook({
            id: "wh_dev",
            name: "brimax-dev-asaas-webhook",
            url: "https://api.dev.brimax.life/webhooks/asaas",
            email: "maxreis86@gmail.com"
          })
        )
      );

    const result = await syncAsaasWebhook({
      apiBaseUrl: "https://api-sandbox.asaas.com/v3",
      apiDomain: "api.dev.brimax.life",
      apiKey: "asaas-key",
      contactEmail: "maxreis86@gmail.com",
      fetchImpl,
      stage: "dev",
      webhookToken: "whsec_dev_token_123456789012345678901234567890"
    });

    expect(result.action).toBe("created");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api-sandbox.asaas.com/v3/webhooks",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual(
      expect.objectContaining({
        name: "brimax-dev-asaas-webhook",
        url: "https://api.dev.brimax.life/webhooks/asaas",
        email: "maxreis86@gmail.com",
        enabled: true,
        interrupted: false,
        apiVersion: 3,
        authToken: "whsec_dev_token_123456789012345678901234567890",
        sendType: "SEQUENTIALLY"
      })
    );
  });

  it("updates a dev webhook by managed name when the URL is different", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "wh_dev_name",
              name: "brimax-dev-asaas-webhook",
              url: "https://old.dev.example.com/webhooks/asaas"
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: "wh_dev_name" }))
      .mockResolvedValueOnce(
        jsonResponse(
          verifiedWebhook({
            id: "wh_dev_name",
            name: "brimax-dev-asaas-webhook",
            url: "https://api.dev.brimax.life/webhooks/asaas",
            email: "maxreis86@gmail.com"
          })
        )
      );

    const result = await syncAsaasWebhook({
      apiBaseUrl: "https://api-sandbox.asaas.com/v3",
      apiDomain: "api.dev.brimax.life",
      apiKey: "asaas-key",
      contactEmail: "maxreis86@gmail.com",
      fetchImpl,
      stage: "dev",
      webhookToken: "whsec_dev_token_123456789012345678901234567890"
    });

    expect(result.action).toBe("updated");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api-sandbox.asaas.com/v3/webhooks/wh_dev_name",
      expect.objectContaining({
        method: "PUT"
      })
    );
  });

  it("updates by managed name when the URL is different", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "wh_name",
              name: "brimax-prod-asaas-webhook",
              url: "https://old.example.com/webhooks/asaas"
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: "wh_name" }))
      .mockResolvedValueOnce(jsonResponse(verifiedWebhook({ id: "wh_name" })));

    const result = await syncAsaasWebhook({
      apiBaseUrl: "https://api.asaas.com/v3",
      apiDomain: "api.brimax.life",
      apiKey: "asaas-key",
      contactEmail: "casamento@brimax.life",
      fetchImpl,
      stage: "prod",
      webhookToken: "whsec_test_token_123456789012345678901234567890"
    });

    expect(result.action).toBe("updated");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.asaas.com/v3/webhooks/wh_name",
      expect.objectContaining({
        method: "PUT"
      })
    );
  });

  it("fails when Asaas omits a managed checkout event after update", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "wh_123", name: "legacy", url: "https://api.brimax.life/webhooks/asaas" }]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: "wh_123" }))
      .mockResolvedValueOnce(
        jsonResponse(
          verifiedWebhook({
            events: managedEvents.filter((event) => event !== "CHECKOUT_EXPIRED")
          })
        )
      );

    await expect(
      syncAsaasWebhook({
        apiBaseUrl: "https://api.asaas.com/v3",
        apiDomain: "api.brimax.life",
        apiKey: "asaas-key",
        contactEmail: "casamento@brimax.life",
        fetchImpl,
        stage: "prod",
        webhookToken: "whsec_test_token_123456789012345678901234567890"
      })
    ).rejects.toThrow('events missing=["CHECKOUT_EXPIRED"]');
  });

  it("surfaces the HTTP status and a body snippet when Asaas returns an HTML error page", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const html = "<!DOCTYPE html><html><body>Unauthorized</body></html>";
    // 401 is not transient, so it must fail fast without retrying.
    const fetchImpl = vi.fn().mockResolvedValue(rawResponse({ ok: false, status: 401, body: html }));

    await expect(
      syncAsaasWebhook({
        apiBaseUrl: "https://api.asaas.com/v3",
        apiDomain: "api.brimax.life",
        apiKey: "asaas-key",
        contactEmail: "casamento@brimax.life",
        fetchImpl,
        stage: "prod",
        webhookToken: "whsec_test_token_123456789012345678901234567890"
      })
    ).rejects.toThrow(/failed with status 401: <!DOCTYPE/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 5xx HTML response on a GET and recovers", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        rawResponse({ ok: false, status: 503, body: "<!DOCTYPE html><html>maintenance</html>" })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "wh_new" }))
      .mockResolvedValueOnce(jsonResponse(verifiedWebhook({ id: "wh_new" })));

    const result = await syncAsaasWebhook({
      apiBaseUrl: "https://api.asaas.com/v3",
      apiDomain: "api.brimax.life",
      apiKey: "asaas-key",
      contactEmail: "casamento@brimax.life",
      fetchImpl,
      stage: "prod",
      webhookToken: "whsec_test_token_123456789012345678901234567890"
    });

    expect(result.action).toBe("created");
    // One extra call: the retried list request.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("throws an actionable non-JSON error when a 2xx body is not JSON after retries", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(rawResponse({ ok: true, status: 200, body: "<!DOCTYPE html><html></html>" }));

    await expect(
      syncAsaasWebhook({
        apiBaseUrl: "https://api.asaas.com/v3",
        apiDomain: "api.brimax.life",
        apiKey: "asaas-key",
        contactEmail: "casamento@brimax.life",
        fetchImpl,
        stage: "prod",
        webhookToken: "whsec_test_token_123456789012345678901234567890"
      })
    ).rejects.toThrow(/non-JSON 200 response/);
    // The list GET is retried up to the GET attempt budget before giving up.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails when the verified webhook is disabled or interrupted", async () => {
    const { verifyManagedWebhook, buildManagedWebhookConfig } = await loadModule();
    const desiredWebhook = buildManagedWebhookConfig({
      apiDomain: "api.brimax.life",
      contactEmail: "casamento@brimax.life",
      stage: "prod",
      webhookToken: "whsec_test_token_123456789012345678901234567890"
    });

    expect(() =>
      verifyManagedWebhook(
        verifiedWebhook({
          enabled: false,
          interrupted: true
        }),
        desiredWebhook
      )
    ).toThrow("enabled=false, interrupted=true");
  });
});
