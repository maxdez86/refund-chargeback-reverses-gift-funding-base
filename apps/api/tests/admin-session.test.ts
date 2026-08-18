import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Context } from "aws-lambda";
import { AdminSessionResponseSchema } from "@brimax/contracts";

vi.mock("../src/lib/sentry", () => ({
  reportHandledError: vi.fn(),
  wrapLambdaHandler: <T>(handler: T) => handler
}));

let handler: typeof import("../src/functions/admin-session/handler").handler;
const lambdaContext = {} as Context;

describe("GET /admin/session", () => {
  beforeAll(async () => {
    vi.stubEnv("STAGE", "dev");
    ({ handler } = await import("../src/functions/admin-session/handler"));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("returns the strict session contract from verified authorizer context", async () => {
    const response = await handler({
      headers: { origin: "https://dev.brimax.life" },
      requestContext: {
        requestId: "request-1",
        authorizer: {
          lambda: {
            subject: "google-subject",
            email: "casamento@brimax.life",
            hostedDomain: "brimax.life",
            name: "Casamento Brimax",
            pictureUrl: "https://example.com/profile.jpg"
          }
        }
      }
    }, lambdaContext);

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "access-control-allow-origin": "https://dev.brimax.life",
      "access-control-allow-headers": expect.stringContaining("authorization"),
      "access-control-allow-methods": expect.stringContaining("PUT")
    });
    const body = JSON.parse(response.body ?? "null");
    expect(AdminSessionResponseSchema.parse(body)).toEqual({
      authenticated: true,
      stage: "dev",
      admin: {
        subject: "google-subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life",
        name: "Casamento Brimax",
        pictureUrl: "https://example.com/profile.jpg"
      }
    });
  });

  it("ignores spoofed identity in request inputs", async () => {
    const response = await handler({
      headers: { origin: "https://dev.brimax.life", "x-admin-email": "attacker@example.com" },
      body: JSON.stringify({ email: "attacker@example.com" }),
      queryStringParameters: { email: "attacker@example.com" },
      requestContext: {
        authorizer: {
          lambda: {
            subject: "verified-subject",
            email: "verified@brimax.life",
            hostedDomain: "brimax.life"
          }
        }
      }
    } as Parameters<typeof handler>[0], lambdaContext);

    expect(JSON.parse(response.body ?? "null").admin).toEqual({
      subject: "verified-subject",
      email: "verified@brimax.life",
      hostedDomain: "brimax.life"
    });
  });

  it.each([
    ["missing context", undefined],
    ["wrong hosted domain", { subject: "sub", email: "admin@example.com", hostedDomain: "example.com" }],
    ["unknown context field", { subject: "sub", email: "admin@brimax.life", hostedDomain: "brimax.life", token: "secret" }]
  ])("fails closed for %s", async (_label, identity) => {
    const response = await handler({
      headers: {},
      requestContext: { authorizer: identity ? { lambda: identity } : undefined }
    }, lambdaContext);

    expect(response.statusCode).toBe(500);
    expect(response.body).toBe(JSON.stringify({ message: "Unexpected administrator session error." }));
  });
});
