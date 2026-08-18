import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "aws-lambda";
import type { TokenPayload } from "google-auth-library";
import {
  GOOGLE_ID_TOKEN_ISSUER,
  parseBearerToken,
  verifyGoogleAdminToken,
  type GoogleIdTokenVerifier
} from "../src/lib/admin-google-auth";

vi.mock("../src/lib/sentry", () => ({
  wrapLambdaHandler: <T>(handler: T) => handler
}));

const productionAudience = "prod.apps.googleusercontent.com";
const developmentAudience = "dev.apps.googleusercontent.com";
const rawToken = "header.payload.signature";
const lambdaContext = {} as Context;
const validTokenNowSeconds = Math.floor(Date.now() / 1000);

function payload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    iss: GOOGLE_ID_TOKEN_ISSUER,
    aud: productionAudience,
    exp: validTokenNowSeconds + 3_600,
    iat: validTokenNowSeconds - 60,
    sub: "google-subject",
    email: "casamento@brimax.life",
    email_verified: true,
    hd: "brimax.life",
    name: "Casamento Brimax",
    picture: "https://example.com/profile.jpg",
    ...overrides
  };
}

function verifierFor(tokenPayload: TokenPayload | undefined): GoogleIdTokenVerifier {
  return {
    verifyIdToken: vi.fn().mockResolvedValue({ getPayload: () => tokenPayload })
  };
}

describe("Google administrator token verification", () => {
  it.each([
    ["production", productionAudience],
    ["development", developmentAudience]
  ])("accepts a valid %s token for its exact audience", async (_stage, audience) => {
    const verifier = verifierFor(payload({ aud: audience }));

    await expect(verifyGoogleAdminToken(rawToken, {
      audience,
      hostedDomain: "brimax.life",
      nowSeconds: 1_500,
      verifier
    })).resolves.toEqual({
      ok: true,
      identity: {
        subject: "google-subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life",
        name: "Casamento Brimax",
        pictureUrl: "https://example.com/profile.jpg"
      }
    });
    expect(verifier.verifyIdToken).toHaveBeenCalledWith({ idToken: rawToken, audience });
  });

  it.each([
    ["development token in production", productionAudience, developmentAudience],
    ["production token in development", developmentAudience, productionAudience]
  ])("rejects a %s", async (_label, expectedAudience, tokenAudience) => {
    await expect(verifyGoogleAdminToken(rawToken, {
      audience: expectedAudience,
      hostedDomain: "brimax.life",
      nowSeconds: 1_500,
      verifier: verifierFor(payload({ aud: tokenAudience }))
    })).resolves.toEqual({ ok: false, reason: "invalid_audience" });
  });

  it.each([
    ["wrong hosted domain", { hd: "example.com" }, "invalid_hosted_domain"],
    ["absent hosted domain", { hd: undefined }, "invalid_hosted_domain"],
    ["unverified email", { email_verified: false }, "invalid_email"],
    ["expired token", { exp: 1_500 }, "expired"],
    ["invalid issuer", { iss: "accounts.google.com" }, "invalid_issuer"],
    ["missing subject", { sub: "" }, "invalid_subject"]
  ])("rejects %s", async (_label, overrides, reason) => {
    await expect(verifyGoogleAdminToken(rawToken, {
      audience: productionAudience,
      hostedDomain: "brimax.life",
      nowSeconds: 1_500,
      verifier: verifierFor(payload(overrides))
    })).resolves.toEqual({ ok: false, reason });
  });

  it("rejects invalid signatures and network failures without exposing verifier errors", async () => {
    const verifier: GoogleIdTokenVerifier = {
      verifyIdToken: vi.fn().mockRejectedValue(new Error(`invalid signature for ${rawToken}`))
    };

    await expect(verifyGoogleAdminToken(rawToken, {
      audience: productionAudience,
      hostedDomain: "brimax.life",
      verifier
    })).resolves.toEqual({ ok: false, reason: "verification_failed" });
  });

  it("drops malformed optional display fields", async () => {
    const result = await verifyGoogleAdminToken(rawToken, {
      audience: productionAudience,
      hostedDomain: "brimax.life",
      nowSeconds: 1_500,
      verifier: verifierFor(payload({ name: " ", picture: "javascript:alert(1)" }))
    });

    expect(result).toEqual({
      ok: true,
      identity: {
        subject: "google-subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life"
      }
    });
  });

  it.each([
    [undefined, null],
    ["", null],
    ["Basic token", null],
    ["Bearer", null],
    ["Bearer one two", null],
    ["Bearer header.payload.signature", rawToken],
    ["bearer header.payload.signature", rawToken]
  ])("parses bearer header %j", (authorization, expected) => {
    expect(parseBearerToken(authorization)).toBe(expected);
  });
});

describe("administrator Lambda authorizer", () => {
  beforeEach(() => {
    vi.stubEnv("STAGE", "prod");
    vi.stubEnv("GOOGLE_WEB_CLIENT_ID", productionAudience);
    vi.stubEnv("ADMIN_GOOGLE_HOSTED_DOMAIN", "brimax.life");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("denies a malformed bearer header without logging it", async () => {
    const { createAdminAuthorizer } = await import("../src/functions/admin-authorizer/handler");
    const handler = createAdminAuthorizer(verifierFor(payload()));
    const authorization = "Basic secret-value";
    const response = await handler({
      headers: { Authorization: authorization },
      routeKey: "GET /admin/session",
      requestContext: { requestId: "request-1" }
    }, lambdaContext);

    expect(response).toEqual({ isAuthorized: false });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(authorization);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain("malformed_bearer");
  });

  it("maps verified identity to the minimal context without token leakage", async () => {
    const { createAdminAuthorizer } = await import("../src/functions/admin-authorizer/handler");
    const handler = createAdminAuthorizer(verifierFor(payload()));
    const response = await handler({
      headers: { authorization: `Bearer ${rawToken}` },
      routeKey: "GET /admin/session",
      requestContext: { requestId: "request-2" }
    }, lambdaContext);

    expect(response).toEqual({
      isAuthorized: true,
      context: {
        subject: "google-subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life",
        name: "Casamento Brimax",
        pictureUrl: "https://example.com/profile.jpg"
      }
    });
    const observableOutput = JSON.stringify({
      response,
      info: vi.mocked(console.info).mock.calls,
      warn: vi.mocked(console.warn).mock.calls
    });
    expect(observableOutput).not.toContain(rawToken);
    expect(observableOutput).toContain("ADMIN_AUTH_ALLOWED");
  });

  it("fails closed and emits sanitized metrics when Google verification fails", async () => {
    const { createAdminAuthorizer } = await import("../src/functions/admin-authorizer/handler");
    const verifier: GoogleIdTokenVerifier = {
      verifyIdToken: vi.fn().mockRejectedValue(new Error(`network failure for ${rawToken}`))
    };
    const response = await createAdminAuthorizer(verifier)({
      headers: { authorization: `Bearer ${rawToken}` },
      routeKey: "DELETE /admin/guest-messages/{messageId}",
      requestContext: { requestId: "request-3" }
    }, lambdaContext);

    expect(response).toEqual({ isAuthorized: false });
    const warnings = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(warnings).toContain("ADMIN_AUTH_DENIED");
    expect(warnings).toContain("ADMIN_AUTH_VERIFICATION_FAILED");
    expect(warnings).not.toContain(rawToken);
    expect(warnings).not.toContain("network failure");
  });
});
