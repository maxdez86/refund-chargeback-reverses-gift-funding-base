import { beforeEach, describe, expect, it, vi } from "vitest";
import * as secretCache from "../src/services/secrets-manager/secret-cache";
import { AsaasClient, extractAsaasErrorMessage } from "../src/services/asaas/client";

process.env.WEDDING_TABLE_NAME = process.env.WEDDING_TABLE_NAME ?? "payments-test-table";

describe("AsaasClient checkout timing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs checkout timing with a cache miss when the secret comes from Secrets Manager", async () => {
    const secretSpy = vi
      .spyOn(secretCache, "getSecretValueWithMetadata")
      .mockResolvedValue({
        cacheHit: false,
        value: JSON.stringify({ asaasApiKey: "secret-token" })
      });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "checkout-123" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const client = new AsaasClient();
    await client.createCheckout({
      billingTypes: ["PIX"],
      callback: {
        cancelUrl: "https://brimax.life/cancel",
        expiredUrl: "https://brimax.life/expired",
        successUrl: "https://brimax.life/success"
      },
      chargeTypes: ["DETACHED"],
      externalReference: "payment-1",
      items: [{ description: "Brimax payment", name: "Gift", quantity: 1, value: 5 }],
      minutesToExpire: 60
    });

    expect(secretSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"ASAAS_REQUEST_TIMING\"")
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"secretCacheHit\":false")
    );
  });

  it("logs checkout timing with a cache hit when the secret is already cached", async () => {
    vi.spyOn(secretCache, "getSecretValueWithMetadata").mockResolvedValue({
      cacheHit: true,
      value: JSON.stringify({ asaasApiKey: "secret-token" })
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "checkout-456" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const client = new AsaasClient();
    await client.createCheckout({
      billingTypes: ["PIX", "CREDIT_CARD"],
      callback: {
        cancelUrl: "https://brimax.life/cancel",
        expiredUrl: "https://brimax.life/expired",
        successUrl: "https://brimax.life/success"
      },
      chargeTypes: ["DETACHED"],
      externalReference: "payment-2",
      items: [{ description: "Brimax payment", name: "Gift", quantity: 1, value: 5 }],
      minutesToExpire: 60
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"secretCacheHit\":true")
    );
  });
});

describe("extractAsaasErrorMessage", () => {
  it("prefers Asaas error descriptions over object stringification", () => {
    const message = extractAsaasErrorMessage(
      {
        errors: [
          {
            code: "invalid_object",
            description: "O valor da cobrança não pode ser menor que R$ 5,00."
          }
        ]
      },
      400
    );

    expect(message).toBe("O valor da cobrança não pode ser menor que R$ 5,00.");
  });

  it("falls back to the top-level message when no detailed errors are present", () => {
    const message = extractAsaasErrorMessage({ message: "Customer not found." }, 404);

    expect(message).toBe("Customer not found.");
  });

  it("falls back to the response status when the body is empty", () => {
    const message = extractAsaasErrorMessage({}, 500);

    expect(message).toBe("Asaas request failed with status 500.");
  });

  it("builds the public checkout url when Asaas only returns the checkout id", () => {
    const client = Object.create(AsaasClient.prototype) as AsaasClient & {
      checkoutBaseUrl: string;
    };
    client.checkoutBaseUrl = "https://www.asaas.com/checkoutSession/show";

    expect(client.buildCheckoutUrl({ id: "checkout_123" })).toBe(
      "https://www.asaas.com/checkoutSession/show/checkout_123"
    );
    expect(
      client.buildCheckoutUrl({
        id: "checkout_123",
        url: "https://www.asaas.com/checkoutSession/show/checkout_123"
      })
    ).toBe("https://www.asaas.com/checkoutSession/show/checkout_123");
  });

  it("trims trailing slashes from checkoutBaseUrl", () => {
    const client = Object.create(AsaasClient.prototype) as AsaasClient & {
      checkoutBaseUrl: string;
    };
    client.checkoutBaseUrl = "https://www.asaas.com/checkoutSession/show/";

    expect(client.buildCheckoutUrl({ id: "abc" })).toBe(
      "https://www.asaas.com/checkoutSession/show/abc"
    );
  });
});
