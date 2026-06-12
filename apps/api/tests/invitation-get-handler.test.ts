import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { AppError } from "../src/lib/errors";

const getInvitationMock = vi.fn();
const verifyTurnstileMock = vi.fn();
const issueLookupProofMock = vi.fn();
const getAppSecretMock = vi.fn();
let handler: typeof import("../src/functions/invitation-get/handler").handler;

vi.mock("../src/domain/invitation-service", () => ({
  InvitationService: class {
    getInvitation = getInvitationMock;
  }
}));

vi.mock("../src/lib/turnstile", () => ({
  verifyTurnstile: (...args: unknown[]) => verifyTurnstileMock(...args)
}));

vi.mock("../src/lib/lookup-proof", () => ({
  issueLookupProof: (...args: unknown[]) => issueLookupProofMock(...args)
}));

vi.mock("../src/services/secrets-manager/app-secrets", () => ({
  getAppSecret: (...args: unknown[]) => getAppSecretMock(...args)
}));

const context = {} as Context;
const callback = () => undefined;

function buildEvent(code?: string) {
  return {
    headers: {},
    pathParameters: code ? { code } : undefined,
    requestContext: { requestId: "req-1" }
  } as unknown as APIGatewayProxyEventV2;
}

describe("invitation-get handler", () => {
  beforeAll(async () => {
    ({ handler } = await import("../src/functions/invitation-get/handler"));
  });

  beforeEach(() => {
    getInvitationMock.mockReset();
    verifyTurnstileMock.mockReset().mockResolvedValue(undefined);
    issueLookupProofMock.mockReset();
    getAppSecretMock.mockReset().mockResolvedValue("secret");
  });

  it("short-circuits a warm ping without verifying or reading", async () => {
    const response = await handler(
      { warmer: true } as unknown as APIGatewayProxyEventV2,
      context,
      callback
    );

    expect(response).toEqual({ statusCode: 200, body: "warm" });
    expect(getAppSecretMock).toHaveBeenCalledWith("turnstileSecretKey");
    expect(verifyTurnstileMock).not.toHaveBeenCalled();
    expect(getInvitationMock).not.toHaveBeenCalled();
  });

  it("returns 403 with no invitation data when Turnstile rejects, even though the lookup started", async () => {
    verifyTurnstileMock.mockReset().mockRejectedValue(new AppError("Verificação anti-bot falhou.", 403));
    getInvitationMock.mockRejectedValue(new AppError("Convite não encontrado.", 404));

    const response = await handler(buildEvent("ABC123"), context, callback);

    expect(getInvitationMock).toHaveBeenCalledWith("ABC123");
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("invitation");
    // Drain the microtask queue: a floating lookup rejection would surface as
    // an unhandledRejection and fail the test run.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("returns the invitation with a lookup proof when verify and lookup succeed", async () => {
    const invitation = { invitationCode: "ABC123", household: "Família Reis" };
    getInvitationMock.mockResolvedValue(invitation);
    issueLookupProofMock.mockResolvedValue({
      lookupProof: "payload.signature",
      lookupProofExpiresAt: "2026-06-10T12:00:00.000Z"
    });

    const response = await handler(buildEvent("ABC123"), context, callback);

    expect(verifyTurnstileMock).toHaveBeenCalledTimes(1);
    expect(issueLookupProofMock).toHaveBeenCalledWith("ABC123");
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "")).toEqual({
      invitation,
      lookupProof: "payload.signature",
      lookupProofExpiresAt: "2026-06-10T12:00:00.000Z"
    });
  });

  it("returns 404 when verify passes but the invitation is missing", async () => {
    getInvitationMock.mockRejectedValue(new AppError("Convite não encontrado.", 404));

    const response = await handler(buildEvent("NOPE"), context, callback);

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when the invitation code is missing and verify passes", async () => {
    const response = await handler(buildEvent(), context, callback);

    expect(getInvitationMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
  });
});
