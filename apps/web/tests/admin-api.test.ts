import { describe, expect, it, vi } from "vitest";
import { AdminApiError, getAdminSession } from "@/lib/admin-api";

const session = {
  authenticated: true,
  stage: "dev",
  admin: {
    subject: "subject",
    email: "casamento@brimax.life",
    hostedDomain: "brimax.life"
  }
} as const;

describe("admin API adapter", () => {
  it("sends the Google ID token and validates the response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(session), { status: 200, headers: { "content-type": "application/json" } })
    );
    await expect(getAdminSession("id-token", "dev", { apiUrl: "https://api.dev.brimax.life", fetcher })).resolves.toEqual(session);
    expect(fetcher).toHaveBeenCalledWith("https://api.dev.brimax.life/admin/session", {
      headers: { Authorization: "Bearer id-token" }
    });
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "unavailable"],
    [503, "unavailable"]
  ])("maps HTTP %s to %s", async (status, kind) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
    await expect(getAdminSession("token", "dev", { apiUrl: "/api", fetcher })).rejects.toMatchObject({ kind, status });
  });

  it("maps network failures to unavailable", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(getAdminSession("token", "dev", { apiUrl: "/api", fetcher })).rejects.toEqual(expect.objectContaining({ kind: "unavailable" }));
  });

  it.each([
    [{ ...session, stage: "prod" }, "invalid-response"],
    [{ ...session, extra: true }, "invalid-response"]
  ])("rejects stage mismatches and non-strict payloads", async (body, kind) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(getAdminSession("token", "dev", { apiUrl: "/api", fetcher })).rejects.toBeInstanceOf(AdminApiError);
    await expect(getAdminSession("token", "dev", { apiUrl: "/api", fetcher })).rejects.toMatchObject({ kind });
  });
});
