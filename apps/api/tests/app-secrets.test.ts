import { beforeEach, describe, expect, it, vi } from "vitest";

const getSecretValueWithMetadataMock = vi.fn();

vi.mock("../src/services/secrets-manager/secret-cache", () => ({
  getSecretValueWithMetadata: (...args: unknown[]) => getSecretValueWithMetadataMock(...args)
}));

describe("app secrets accessor", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.APP_SECRET_ARN = "arn:app-secret-test";
    process.env.WEDDING_TABLE_NAME = "test-wedding-table";
    getSecretValueWithMetadataMock.mockReset();
  });

  it("extracts a single key from the JSON bucket", async () => {
    getSecretValueWithMetadataMock.mockResolvedValue({
      cacheHit: false,
      value: JSON.stringify({
        asaasApiKey: "api-key",
        asaasWebhookToken: "webhook-token",
        turnstileSecretKey: "turnstile-key",
        lookupProofSecret: "lookup-secret"
      })
    });

    const { getAppSecret } = await import("../src/services/secrets-manager/app-secrets");

    await expect(getAppSecret("asaasApiKey")).resolves.toBe("api-key");
    await expect(getAppSecret("turnstileSecretKey")).resolves.toBe("turnstile-key");
  });

  it("preserves the cacheHit flag from the underlying cache", async () => {
    getSecretValueWithMetadataMock.mockResolvedValue({
      cacheHit: true,
      value: JSON.stringify({ asaasApiKey: "api-key" })
    });

    const { getAppSecretWithMetadata } = await import(
      "../src/services/secrets-manager/app-secrets"
    );

    await expect(getAppSecretWithMetadata("asaasApiKey")).resolves.toEqual({
      cacheHit: true,
      value: "api-key"
    });
  });

  it("falls back to an empty string for malformed JSON", async () => {
    getSecretValueWithMetadataMock.mockResolvedValue({
      cacheHit: false,
      value: "not-json"
    });

    const { getAppSecret } = await import("../src/services/secrets-manager/app-secrets");

    await expect(getAppSecret("asaasApiKey")).resolves.toBe("");
  });

  it("returns an empty string for a missing key", async () => {
    getSecretValueWithMetadataMock.mockResolvedValue({
      cacheHit: false,
      value: JSON.stringify({ asaasApiKey: "api-key" })
    });

    const { getAppSecret } = await import("../src/services/secrets-manager/app-secrets");

    await expect(getAppSecret("lookupProofSecret")).resolves.toBe("");
  });
});
