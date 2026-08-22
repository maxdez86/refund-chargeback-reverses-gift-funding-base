import { describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  getAdminDashboard,
  getAdminSession,
  getAdminWhatsappThread,
  resolveAdminApiUrl
} from "@/lib/admin-api";

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
  it("selects the development proxy and configured production API", () => {
    expect(resolveAdminApiUrl({ dev: true, configuredApiUrl: "https://ignored.example" })).toBe(
      "/api"
    );
    expect(
      resolveAdminApiUrl({ dev: false, configuredApiUrl: "https://api.brimax.life" })
    ).toBe("https://api.brimax.life");
    expect(resolveAdminApiUrl({ apiUrl: "https://override.example", dev: true })).toBe(
      "https://override.example"
    );
  });

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

describe("admin WhatsApp history API adapter", () => {
  const history = {
    invitationCode: "AB2345",
    status: "message_sent",
    history: [{
      kind: "message", id: "wamid.1", direction: "inbound", status: "received",
      createdAt: "2026-08-20T12:00:00.000Z", body: "Olá"
    }],
    nextCursor: "older"
  };

  it("requests a bounded descending page with bearer auth and cursor", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(history), { status: 200 }));
    await expect(
      getAdminWhatsappThread("AB2345", () => "test-token", "cursor with spaces", { apiUrl: "/api", fetcher })
    ).resolves.toEqual(history);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/whatsapp/invitations/AB2345?limit=50&order=desc&cursor=cursor+with+spaces",
      { headers: { Authorization: "Bearer test-token" }, signal: undefined }
    );
  });

  it("rejects a mismatched invitation and never requests without a token", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(history), { status: 200 }));
    await expect(
      getAdminWhatsappThread("CD6789", () => "test-token", undefined, { apiUrl: "/api", fetcher })
    ).rejects.toMatchObject({ kind: "invalid-response" });

    fetcher.mockClear();
    await expect(
      getAdminWhatsappThread("AB2345", () => null, undefined, { apiUrl: "/api", fetcher })
    ).rejects.toMatchObject({ kind: "unauthorized" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("admin dashboard API adapter", () => {
  const dashboard = { ok: true as const, invitations: [], gifts: [], guestMessages: [] };

  it("makes one authenticated dashboard request and validates the whole response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(dashboard), { status: 200 })
    );

    await expect(
      getAdminDashboard(() => "test-token", { apiUrl: "/api", fetcher })
    ).resolves.toEqual(dashboard);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/admin/dashboard", {
      headers: { Authorization: "Bearer test-token" },
      signal: undefined
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("whatsapp"))).toBe(false);
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [418, "unavailable"],
    [503, "unavailable"]
  ])("maps dashboard HTTP %s to %s", async (status, kind) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
    await expect(
      getAdminDashboard(() => "test-token", { apiUrl: "/api", fetcher })
    ).rejects.toMatchObject({ kind, status });
  });

  it("rejects missing credentials before making a request", async () => {
    const fetcher = vi.fn();
    await expect(
      getAdminDashboard(() => null, { apiUrl: "/api", fetcher })
    ).rejects.toMatchObject({ kind: "unauthorized", status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps network failures to unavailable", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      getAdminDashboard(() => "test-token", { apiUrl: "/api", fetcher })
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it.each([
    ["not-json", "invalid JSON"],
    [JSON.stringify({ ...dashboard, threads: {} }), "schema-invalid JSON"]
  ])("rejects %s dashboard responses", async (body) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    await expect(
      getAdminDashboard(() => "test-token", { apiUrl: "/api", fetcher })
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });
});
