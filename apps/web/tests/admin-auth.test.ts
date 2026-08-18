import { describe, expect, it } from "vitest";
import { getAdminRuntimeConfig, validateGoogleCredential } from "@/lib/admin-auth";

function token(payload: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}.signature`;
}

const config = { googleClientId: "dev-client", hostedDomain: "brimax.life" };
const validClaims = {
  aud: "dev-client",
  exp: 2_000,
  sub: "google-subject",
  email: "casamento@brimax.life",
  email_verified: true,
  hd: "brimax.life",
  name: "Casamento Brimax"
};

describe("admin authentication helpers", () => {
  it("loads a valid dev fixture configuration", () => {
    expect(
      getAdminRuntimeConfig({
        VITE_APP_STAGE: "dev",
        VITE_ADMIN_SESSION_MODE: "fixture",
        VITE_GOOGLE_WEB_CLIENT_ID: "dev-client",
        VITE_ADMIN_GOOGLE_HOSTED_DOMAIN: "brimax.life"
      })
    ).toEqual({
      stage: "dev",
      sessionMode: "fixture",
      googleClientId: "dev-client",
      hostedDomain: "brimax.life"
    });
  });

  it.each([
    [{ VITE_APP_STAGE: "staging" }, "VITE_APP_STAGE"],
    [{ VITE_APP_STAGE: "prod", VITE_ADMIN_SESSION_MODE: "fixture", VITE_GOOGLE_WEB_CLIENT_ID: "prod", VITE_ADMIN_GOOGLE_HOSTED_DOMAIN: "brimax.life" }, "produção"],
    [{ VITE_APP_STAGE: "dev", VITE_ADMIN_SESSION_MODE: "live", VITE_GOOGLE_WEB_CLIENT_ID: "", VITE_ADMIN_GOOGLE_HOSTED_DOMAIN: "brimax.life" }, "CLIENT_ID"],
    [{ VITE_APP_STAGE: "dev", VITE_ADMIN_SESSION_MODE: "live", VITE_GOOGLE_WEB_CLIENT_ID: "dev", VITE_ADMIN_GOOGLE_HOSTED_DOMAIN: "example.com" }, "brimax.life"]
  ])("rejects unsafe or incomplete runtime configuration", (env, message) => {
    expect(() => getAdminRuntimeConfig(env)).toThrow(message);
  });

  it("decodes valid claims for display without claiming signature verification", () => {
    expect(validateGoogleCredential(token(validClaims), config, 1_000_000)).toEqual({
      ok: true,
      claims: {
        subject: "google-subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life",
        expiresAtMs: 2_000_000,
        name: "Casamento Brimax"
      }
    });
  });

  it.each([
    ["not-a-token", "invalid"],
    [token({ ...validClaims, aud: "another-client" }), "invalid"],
    [token({ ...validClaims, exp: 999 }), "expired"],
    [token({ ...validClaims, email_verified: false }), "access-denied"],
    [token({ ...validClaims, hd: "example.com" }), "access-denied"]
  ])("rejects malformed, expired, or unauthorized credentials", (credential, reason) => {
    expect(validateGoogleCredential(credential, config, 1_000_000)).toMatchObject({ ok: false, reason });
  });
});
