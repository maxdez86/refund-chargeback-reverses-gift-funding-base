import { AdminSessionResponseSchema } from "@brimax/contracts";
import { describe, expect, it } from "vitest";

const validSession = {
  authenticated: true,
  stage: "dev",
  admin: {
    subject: "google-subject",
    email: "casamento@brimax.life",
    hostedDomain: "brimax.life",
    name: "Casamento Brimax",
    pictureUrl: "https://example.com/profile.jpg"
  }
} as const;

describe("AdminSessionResponseSchema", () => {
  it("accepts the exact admin session contract and omitted optional fields", () => {
    expect(AdminSessionResponseSchema.parse(validSession)).toEqual(validSession);
    expect(
      AdminSessionResponseSchema.parse({
        ...validSession,
        admin: {
          subject: validSession.admin.subject,
          email: validSession.admin.email,
          hostedDomain: validSession.admin.hostedDomain
        }
      })
    ).toBeDefined();
  });

  it.each([
    { ...validSession, unexpected: true },
    { ...validSession, stage: "staging" },
    { ...validSession, admin: { ...validSession.admin, hostedDomain: "example.com" } },
    { ...validSession, admin: { ...validSession.admin, pictureUrl: "not-a-url" } },
    { ...validSession, admin: { ...validSession.admin, name: null } },
    { ...validSession, admin: { ...validSession.admin, extra: true } },
    { authenticated: true, stage: "dev", admin: { email: "casamento@brimax.life" } }
  ])("rejects an invalid session payload", (payload) => {
    expect(AdminSessionResponseSchema.safeParse(payload).success).toBe(false);
  });
});
