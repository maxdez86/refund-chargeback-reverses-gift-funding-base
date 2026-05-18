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

describe("asaas webhook sync", () => {
  it("creates a webhook when none matches", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "wh_new" }));

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
      .mockResolvedValueOnce(jsonResponse({ id: "wh_123" }));

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

  it("skips cleanly outside prod", async () => {
    const { syncAsaasWebhook } = await loadModule();
    const fetchImpl = vi.fn();

    const result = await syncAsaasWebhook({
      apiBaseUrl: "https://api-sandbox.asaas.com/v3",
      apiDomain: "api.dev.brimax.life",
      apiKey: "asaas-key",
      contactEmail: "casamento@brimax.life",
      fetchImpl,
      stage: "dev",
      webhookToken: "whsec_test_token_123456789012345678901234567890"
    });

    expect(result).toEqual({
      action: "skipped",
      reason: "non-prod"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce(jsonResponse({ id: "wh_name" }));

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
});
