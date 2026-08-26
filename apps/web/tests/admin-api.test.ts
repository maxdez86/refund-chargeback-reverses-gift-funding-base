import { describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  getAdminDashboard,
  getAdminSession,
  getAdminWhatsappThread,
  resolveAdminApiUrl,
  sendAdminWhatsappRsvp,
  sendAdminWhatsappText
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
    sendAvailability: { firstAllowed: false, resendAllowed: false },
    freeTextWindow: { open: false },
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

describe("admin WhatsApp send API adapter", () => {
  const accepted = {
    commandId: "idempotency-admin-rsvp-first-12345678",
    invitationCode: "AB2345",
    templateId: "wedding_rsvp_pending_reminder_single",
    templateVersion: 2,
    status: "queued",
    replayed: false
  } as const;

  it("posts the mode with bearer auth and an idempotency key, then validates the response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(accepted), { status: 202 }));
    await expect(sendAdminWhatsappRsvp(
      "AB2345",
      "first",
      "admin-rsvp-first-12345678",
      () => "test-token",
      { apiUrl: "/api", fetcher }
    )).resolves.toEqual(accepted);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/whatsapp/invitations/AB2345/send-rsvp",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          "Idempotency-Key": "admin-rsvp-first-12345678"
        },
        body: JSON.stringify({ mode: "first" }),
        signal: undefined
      }
    );
  });

  it.each([[401, "unauthorized"], [403, "forbidden"]] as const)(
    "maps send HTTP %s to %s without parsing gateway bodies",
    async (status, kind) => {
      await expect(sendAdminWhatsappRsvp("AB2345", "first", "admin-rsvp-first-12345678", () => "token", {
        apiUrl: "/api",
        fetcher: vi.fn().mockResolvedValue(new Response("", { status }))
      })).rejects.toMatchObject({ kind, status });
    }
  );

  it.each([
    [409, "INVALID_FLOW_TRANSITION", "rejected"],
    [422, "INVALID_INVITATION_STATE", "rejected"],
    [503, "QUEUE_FAILURE", "unavailable"]
  ] as const)("parses a structured %s send rejection", async (status, code, kind) => {
    await expect(sendAdminWhatsappRsvp("AB2345", "resend", "admin-rsvp-resend-12345678", () => "token", {
      apiUrl: "/api",
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, message: "safe backend message" }), { status }))
    })).rejects.toMatchObject({ kind, status, code });
  });

  it("rejects missing credentials, network failures, and mismatched success payloads", async () => {
    const fetcher = vi.fn();
    await expect(sendAdminWhatsappRsvp("AB2345", "first", "admin-rsvp-first-12345678", () => null, {
      apiUrl: "/api", fetcher
    })).rejects.toMatchObject({ kind: "unauthorized" });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(sendAdminWhatsappRsvp("AB2345", "first", "admin-rsvp-first-12345678", () => "secret-token", {
      apiUrl: "/api", fetcher: vi.fn().mockRejectedValue(new Error("offline"))
    })).rejects.toMatchObject({ kind: "unavailable", status: undefined });

    await expect(sendAdminWhatsappRsvp("AB2345", "first", "admin-rsvp-first-12345678", () => "secret-token", {
      apiUrl: "/api",
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...accepted, invitationCode: "CD6789" }), { status: 202 }))
    })).rejects.toMatchObject({ kind: "invalid-response" });
  });
});

describe("admin WhatsApp free-text API adapter", () => {
  const accepted = {
    commandId: "idempotency-admin-text-12345678",
    invitationCode: "AB2345",
    status: "queued",
    replayed: false
  } as const;

  it("posts the body with bearer auth and an idempotency key, then validates the response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(accepted), { status: 202 }));
    await expect(sendAdminWhatsappText(
      "AB2345",
      "Oi! Podemos ajudar?",
      "admin-text-12345678",
      () => "test-token",
      { apiUrl: "/api", fetcher }
    )).resolves.toEqual(accepted);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/whatsapp/invitations/AB2345/messages",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          "Idempotency-Key": "admin-text-12345678"
        },
        body: JSON.stringify({ body: "Oi! Podemos ajudar?" }),
        signal: undefined
      }
    );
  });

  it("rejects an empty or oversized body before reaching the network", async () => {
    const fetcher = vi.fn();
    await expect(sendAdminWhatsappText("AB2345", "", "admin-text-12345678", () => "test-token", { apiUrl: "/api", fetcher }))
      .rejects.toThrow();
    await expect(sendAdminWhatsappText("AB2345", "a".repeat(4097), "admin-text-12345678", () => "test-token", { apiUrl: "/api", fetcher }))
      .rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[401, "unauthorized"], [403, "forbidden"]] as const)(
    "maps %i onto the %s error kind",
    async (status, kind) => {
      const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status }));
      await expect(sendAdminWhatsappText("AB2345", "Oi!", "admin-text-12345678", () => "test-token", { apiUrl: "/api", fetcher }))
        .rejects.toMatchObject({ kind, status });
    }
  );

  it("surfaces a closed 24-hour window as a localized rejection carrying its code", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "FREE_TEXT_WINDOW_CLOSED", message: "closed" }),
      { status: 409 }
    ));
    await expect(sendAdminWhatsappText("AB2345", "Oi!", "admin-text-12345678", () => "test-token", { apiUrl: "/api", fetcher }))
      .rejects.toMatchObject({
        kind: "rejected",
        status: 409,
        code: "FREE_TEXT_WINDOW_CLOSED",
        message: "A janela de 24 horas do WhatsApp expirou. Envie um modelo aprovado."
      });
  });

  it("treats a 5xx as unavailable and a mismatched invitation as an invalid response", async () => {
    const unavailable = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "QUEUE_FAILURE", message: "down" }),
      { status: 503 }
    ));
    await expect(sendAdminWhatsappText("AB2345", "Oi!", "admin-text-12345678", () => "test-token", { apiUrl: "/api", fetcher: unavailable }))
      .rejects.toMatchObject({ kind: "unavailable", status: 503 });

    const mismatched = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ...accepted, invitationCode: "ZZ9999" }),
      { status: 202 }
    ));
    await expect(sendAdminWhatsappText("AB2345", "Oi!", "admin-text-12345678", () => "test-token", { apiUrl: "/api", fetcher: mismatched }))
      .rejects.toMatchObject({ kind: "invalid-response" });
  });
});
