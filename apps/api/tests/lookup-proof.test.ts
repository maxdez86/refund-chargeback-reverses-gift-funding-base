import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSecretValueWithMetadataMock = vi.fn();

vi.mock("../src/services/secrets-manager/secret-cache", () => ({
  getSecretValueWithMetadata: (...args: unknown[]) => getSecretValueWithMetadataMock(...args)
}));

function buildEvent(proof: string): APIGatewayProxyEventV2 {
  return {
    headers: { "x-rsvp-lookup-proof": proof }
  } as APIGatewayProxyEventV2;
}

describe("lookup proof", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    process.env.APP_SECRET_ARN = "arn:app-secret-test";
    process.env.WEDDING_TABLE_NAME = "test-wedding-table";
    getSecretValueWithMetadataMock.mockReset().mockResolvedValue({
      cacheHit: false,
      value: JSON.stringify({ lookupProofSecret: "lookup-secret-for-tests" })
    });
  });

  it("issues a proof and verifies it for the same invitation code", async () => {
    const { issueLookupProof, verifyLookupProof } = await import(
      "../src/lib/lookup-proof"
    );

    const proof = await issueLookupProof("AB2345");

    await expect(
      verifyLookupProof(buildEvent(proof.lookupProof), "AB2345")
    ).resolves.toBeUndefined();
    expect(proof.lookupProofExpiresAt).toMatch(/^20\d\d-/);
  });

  it("rejects a proof for the wrong invitation code", async () => {
    const { issueLookupProof, verifyLookupProof } = await import(
      "../src/lib/lookup-proof"
    );
    const { AppError } = await import("../src/lib/errors");

    const proof = await issueLookupProof("AB2345");

    await expect(
      verifyLookupProof(buildEvent(proof.lookupProof), "ZX9876")
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      verifyLookupProof(buildEvent(proof.lookupProof), "ZX9876")
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects an expired proof", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T12:00:00.000Z"));

    const { issueLookupProof, verifyLookupProof } = await import(
      "../src/lib/lookup-proof"
    );

    const proof = await issueLookupProof("AB2345");
    vi.setSystemTime(new Date("2026-05-29T12:31:00.000Z"));

    await expect(
      verifyLookupProof(buildEvent(proof.lookupProof), "AB2345")
    ).rejects.toMatchObject({
      message: "Verificação do convite expirou. Localize o convite novamente.",
      statusCode: 403
    });
  });
});
