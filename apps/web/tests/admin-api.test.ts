import { describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  addAdminInvitationGuests,
  confirmAdminInvitationGuests,
  createAdminInvitation,
  getNextAdminInvitationCode,
  deleteAdminGuestMessage,
  deleteAdminInvitation,
  removeAdminInvitationGuest,
  getAdminDashboard,
  getAdminSession,
  getAdminWhatsappThread,
  resolveAdminApiUrl,
  sendAdminWhatsappRsvp,
  sendAdminWhatsappText,
  updateAdminGuest,
  updateAdminInvitationPhone
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
  it("gets and validates the next invitation code", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, invitationCode: "AA2223" }), { status: 200 })
    );
    await expect(getNextAdminInvitationCode(() => "id-token", { apiUrl: "/api", fetcher })).resolves.toEqual({
      ok: true,
      invitationCode: "AA2223"
    });
    expect(fetcher).toHaveBeenCalledWith("/api/admin/invitations/next-code", {
      method: "GET",
      headers: { Authorization: "Bearer id-token" },
      signal: undefined
    });
  });
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

describe("admin invitation phone API adapter", () => {
  it("updates the invitation phone and validates the matching response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      invitationCode: "SW2748",
      phoneNumber: "5511912345678",
      updatedAt: "2026-08-28T12:00:00.000Z"
    }), { status: 200 }));

    await expect(updateAdminInvitationPhone("SW2748", "+55 (11) 91234-5678", () => "id-token", {
      apiUrl: "/api", fetcher
    })).resolves.toMatchObject({ phoneNumber: "5511912345678" });
    expect(fetcher).toHaveBeenCalledWith("/api/admin/whatsapp/invitations/SW2748/phone", {
      method: "PUT",
      headers: { Authorization: "Bearer id-token", "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: "+55 (11) 91234-5678" }),
      signal: undefined
    });
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

describe("admin guest-message delete adapter", () => {
  const messageId = "b2f91fa5-41dc-4444-b466-9ca5f974cabc";
  const deleted = { ok: true, messageId, deletedAt: "2026-08-27T12:00:00.000Z" } as const;
  const ok = () => vi.fn().mockResolvedValue(new Response(JSON.stringify(deleted), { status: 200 }));

  it("sends a bearer DELETE with no idempotency header and no body", async () => {
    const fetcher = ok();
    await expect(
      deleteAdminGuestMessage(messageId, () => "id-token", { apiUrl: "/api", fetcher })
    ).resolves.toEqual(deleted);
    expect(fetcher).toHaveBeenCalledWith(`/api/admin/guest-messages/${messageId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer id-token" },
      signal: undefined
    });
    // DELETE here is naturally idempotent — a repeat is simply a 404 — so no key is minted.
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Idempotency-Key");
    expect(init.body).toBeUndefined();
  });

  it("percent-encodes the message id into the path", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ...deleted, messageId: "a/b" }), { status: 200 }));
    await deleteAdminGuestMessage("a/b", () => "id-token", { apiUrl: "/api", fetcher });
    expect(fetcher).toHaveBeenCalledWith("/api/admin/guest-messages/a%2Fb", expect.anything());
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [400, "rejected"],
    [404, "rejected"],
    [500, "unavailable"],
    [503, "unavailable"]
  ] as const)("maps HTTP %s to %s", async (status, kind) => {
    await expect(
      deleteAdminGuestMessage(messageId, () => "id-token", {
        apiUrl: "/api",
        fetcher: vi.fn().mockResolvedValue(new Response("", { status }))
      })
    ).rejects.toMatchObject({ kind, status });
  });

  it("replaces the backend message with a localized one", async () => {
    await expect(
      deleteAdminGuestMessage(messageId, () => "id-token", {
        apiUrl: "/api",
        fetcher: vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ message: "Guest message not found." }), { status: 404 }))
      })
    ).rejects.toThrow("Este recado não existe mais.");
  });

  it("reports an unparseable failure as unavailable rather than invalid-response", async () => {
    // The failure branch runs before the body is read, so a gateway HTML 500 stays a transport
    // problem instead of being misreported as a malformed payload.
    await expect(
      deleteAdminGuestMessage(messageId, () => "id-token", {
        apiUrl: "/api",
        fetcher: vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 }))
      })
    ).rejects.toMatchObject({ kind: "unavailable", status: 502 });
  });

  it.each([
    ["a malformed success body", new Response("not json", { status: 200 })],
    ["a payload failing the schema", new Response(JSON.stringify({ ok: false }), { status: 200 })],
    [
      "a confirmation for another message",
      new Response(JSON.stringify({ ...deleted, messageId: "someone-else" }), { status: 200 })
    ]
  ])("rejects %s as invalid-response", async (_label, response) => {
    await expect(
      deleteAdminGuestMessage(messageId, () => "id-token", {
        apiUrl: "/api",
        fetcher: vi.fn().mockResolvedValue(response)
      })
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("never reaches the network without a token", async () => {
    const fetcher = vi.fn();
    await expect(
      deleteAdminGuestMessage(messageId, () => null, { apiUrl: "/api", fetcher })
    ).rejects.toMatchObject({ kind: "unauthorized", status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps a network failure to unavailable and lets an abort through", async () => {
    await expect(
      deleteAdminGuestMessage(messageId, () => "id-token", {
        apiUrl: "/api",
        fetcher: vi.fn().mockRejectedValue(new Error("offline"))
      })
    ).rejects.toMatchObject({ kind: "unavailable", status: undefined });

    const abort = new Error("aborted");
    abort.name = "AbortError";
    await expect(
      deleteAdminGuestMessage(messageId, () => "id-token", {
        apiUrl: "/api",
        fetcher: vi.fn().mockRejectedValue(abort)
      })
    ).rejects.toBe(abort);
  });

  it("carries an AdminApiError, not a bare Error", async () => {
    await expect(
      deleteAdminGuestMessage(messageId, () => "id-token", {
        apiUrl: "/api",
        fetcher: vi.fn().mockResolvedValue(new Response("", { status: 404 }))
      })
    ).rejects.toBeInstanceOf(AdminApiError);
  });
});

describe("admin guest RSVP writes", () => {
  const written = {
    ok: true,
    invitationCode: "SW2748",
    guests: [
      {
        guestId: "SW2748--guest-01",
        guestName: "Eugênia",
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      }
    ],
    rsvp: {
      status: "attending",
      updatedAt: "2026-08-20T12:00:00.000Z",
      submittedBy: "SW2748--guest-01",
      attending: 1,
      paid: 1,
      childrenSixOrYounger: 0
    },
    updatedAt: "2026-08-20T12:00:00.000Z"
  };

  const ok = () =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(written), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

  it("PATCHes one guest with the bearer token and no idempotency key", async () => {
    const fetcher = ok();

    await expect(
      updateAdminGuest("SW2748", "SW2748--guest-01", { rsvpStatus: "attending" }, () => "id-token", {
        apiUrl: "/api",
        fetcher
      })
    ).resolves.toEqual(written);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/admin/invitations/SW2748/guests/SW2748--guest-01");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({
      Authorization: "Bearer id-token",
      "Content-Type": "application/json"
    });
    // The write sets an absolute state, so a repeat is a no-op and needs no dedupe header.
    expect(Object.keys(init.headers)).not.toContain("Idempotency-Key");
    expect(JSON.parse(init.body)).toEqual({ rsvpStatus: "attending" });
  });

  it("POSTs the confirm-all selection", async () => {
    const fetcher = ok();

    await confirmAdminInvitationGuests("SW2748", ["SW2748--guest-01"], () => "id-token", {
      apiUrl: "/api",
      fetcher
    });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/admin/invitations/SW2748/confirm-all");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ guestIds: ["SW2748--guest-01"] });
  });

  it("escapes path parameters", async () => {
    const fetcher = ok();

    await updateAdminGuest("SW2748", "guest/01 02", { isChild: true }, () => "id-token", {
      apiUrl: "/api",
      fetcher
    }).catch(() => undefined);

    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/admin/invitations/SW2748/guests/guest%2F01%2002"
    );
  });

  it("refuses to send a patch the contract rejects", async () => {
    const fetcher = vi.fn();

    await expect(
      updateAdminGuest("SW2748", "SW2748--guest-01", {}, () => "id-token", {
        apiUrl: "/api",
        fetcher
      })
    ).rejects.toThrow();
    await expect(
      confirmAdminInvitationGuests("SW2748", [], () => "id-token", { apiUrl: "/api", fetcher })
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [400, "rejected", "Esta alteração não pôde ser interpretada. Atualize os dados e tente novamente."],
    [404, "rejected", "Este convidado não está mais disponível. Atualize os dados do painel."],
    [409, "rejected", "Os dados do convite mudaram. Atualize o painel e tente novamente."],
    [422, "rejected", "Não foi possível salvar a alteração."],
    [503, "unavailable", "Não foi possível salvar a alteração."]
  ])("maps HTTP %i onto a localized error", async (status, kind, message) => {
    // A gateway error is not JSON; the status is read before the body so it stays classified.
    const fetcher = vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status }));

    await expect(
      updateAdminGuest("SW2748", "SW2748--guest-01", { rsvpStatus: "declined" }, () => "id-token", {
        apiUrl: "/api",
        fetcher
      })
    ).rejects.toMatchObject({ kind, status, message });
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"]
  ])("classifies HTTP %i as a session problem", async (status, kind) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));

    await expect(
      confirmAdminInvitationGuests("SW2748", ["SW2748--guest-01"], () => "id-token", {
        apiUrl: "/api",
        fetcher
      })
    ).rejects.toMatchObject({ kind, status });
  });

  it("rejects a payload that describes another invitation", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...written, invitationCode: "LB6640" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(
      updateAdminGuest("SW2748", "SW2748--guest-01", { rsvpStatus: "attending" }, () => "id-token", {
        apiUrl: "/api",
        fetcher
      })
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("rejects a malformed success body", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("not json", { status: 200, headers: { "content-type": "application/json" } })
    );

    await expect(
      updateAdminGuest("SW2748", "SW2748--guest-01", { rsvpStatus: "attending" }, () => "id-token", {
        apiUrl: "/api",
        fetcher
      })
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("never reaches the network without a token, and lets an abort through", async () => {
    const fetcher = vi.fn();
    await expect(
      updateAdminGuest("SW2748", "SW2748--guest-01", { isChild: true }, () => null, {
        apiUrl: "/api",
        fetcher
      })
    ).rejects.toMatchObject({ kind: "unauthorized", status: 401 });
    expect(fetcher).not.toHaveBeenCalled();

    const abort = new Error("aborted");
    abort.name = "AbortError";
    await expect(
      updateAdminGuest("SW2748", "SW2748--guest-01", { isChild: true }, () => "id-token", {
        apiUrl: "/api",
        fetcher: vi.fn().mockRejectedValue(abort)
      })
    ).rejects.toBe(abort);
  });
});

describe("admin invitation and guest structural writes", () => {
  const written = {
    ok: true,
    invitationCode: "SW2748",
    guests: [
      {
        guestId: "SW2748--guest-01",
        guestName: "Eugênia",
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      }
    ],
    rsvp: {
      status: "attending",
      updatedAt: "2026-08-20T12:00:00.000Z",
      submittedBy: "SW2748--guest-01",
      attending: 1,
      paid: 1,
      childrenSixOrYounger: 0
    },
    updatedAt: "2026-08-20T12:00:00.000Z"
  };

  const created = {
    ok: true,
    invitation: {
      invitationCode: "KP3456",
      householdName: "Família Moretti",
      phoneNumber: "5511912345678",
      phoneNumberSource: "operator",
      phoneNumberUpdatedAt: "2026-08-20T12:00:00.000Z",
      whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
      whatsappFreeTextWindow: { open: false },
      guests: [
        {
          guestId: "KP3456--guest-01",
          guestName: "Ana Moretti",
          allowedPlusOnes: 0,
          rsvpStatus: "pending",
          isChild: false
        }
      ],
      rsvp: {
        status: "pending",
        updatedAt: null,
        submittedBy: null,
        attending: 0,
        paid: 0,
        childrenSixOrYounger: 0
      }
    },
    createdAt: "2026-08-20T12:00:00.000Z"
  };

  const deleted = {
    ok: true,
    invitationCode: "SW2748",
    deletedAt: "2026-08-20T12:00:00.000Z",
    deleted: { guests: 2, rsvp: 1, whatsappItems: 7, phoneLookups: 1 }
  };

  const draft = {
    invitationCode: "KP3456",
    householdName: "Família Moretti",
    phoneNumber: "5511912345678",
    guests: [{ guestName: "Ana Moretti" }]
  };

  const respond = (payload: unknown, status = 200) =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" }
      })
    );

  it("POSTs a new invitation and returns the row the API created", async () => {
    const fetcher = respond(created, 201);

    await expect(
      createAdminInvitation(draft, () => "id-token", { apiUrl: "/api", fetcher })
    ).resolves.toEqual(created);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/admin/invitations");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer id-token",
      "Content-Type": "application/json"
    });
    // Uniqueness is the server's conditional write, so no dedupe header is sent.
    expect(Object.keys(init.headers)).not.toContain("Idempotency-Key");
    expect(JSON.parse(init.body)).toEqual(draft);
  });

  it("refuses a code the contract rejects before reaching the network", async () => {
    const fetcher = vi.fn();

    await expect(
      createAdminInvitation({ ...draft, invitationCode: "brx-014" }, () => "id-token", {
        apiUrl: "/api",
        fetcher
      })
    ).rejects.toBeInstanceOf(Error);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("explains a duplicate code rather than telling the operator to refresh", async () => {
    await expect(
      createAdminInvitation(draft, () => "id-token", {
        apiUrl: "/api",
        fetcher: respond({ message: "Invitation code already in use." }, 409)
      })
    ).rejects.toMatchObject({
      kind: "rejected",
      status: 409,
      message: "Já existe um convite com este código. Escolha outro código."
    });
  });

  it("rejects a creation confirmation that describes another invitation", async () => {
    await expect(
      createAdminInvitation(draft, () => "id-token", {
        apiUrl: "/api",
        fetcher: respond({
          ...created,
          invitation: { ...created.invitation, invitationCode: "AB2345" }
        }, 201)
      })
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("DELETEs an invitation with no body and reports what was removed", async () => {
    const fetcher = respond(deleted);

    await expect(
      deleteAdminInvitation("SW2748", () => "id-token", { apiUrl: "/api", fetcher })
    ).resolves.toEqual(deleted);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/admin/invitations/SW2748");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ Authorization: "Bearer id-token" });
    expect(init.body).toBeUndefined();
  });

  it("percent-encodes the invitation code into the delete path", async () => {
    // No well-formed code needs escaping, so this pins the path building alone: the response is
    // rejected for describing a different invitation, after the request has already gone out.
    const fetcher = respond(deleted);

    await expect(
      deleteAdminInvitation("SW 2748", () => "id-token", { apiUrl: "/api", fetcher })
    ).rejects.toMatchObject({ kind: "invalid-response" });
    expect(fetcher.mock.calls[0][0]).toBe("/api/admin/invitations/SW%202748");
  });

  it("POSTs added guests and returns the reconciliation payload", async () => {
    const fetcher = respond(written);

    await expect(
      addAdminInvitationGuests("SW2748", [{ guestName: "Duda" }], () => "id-token", {
        apiUrl: "/api",
        fetcher
      })
    ).resolves.toEqual(written);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/admin/invitations/SW2748/guests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ guests: [{ guestName: "Duda" }] });
  });

  it("refuses an empty add-guests request before reaching the network", async () => {
    const fetcher = vi.fn();

    await expect(
      addAdminInvitationGuests("SW2748", [], () => "id-token", { apiUrl: "/api", fetcher })
    ).rejects.toBeInstanceOf(Error);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("DELETEs one guest with no body at all", async () => {
    const fetcher = respond(written);

    await expect(
      removeAdminInvitationGuest("SW2748", "SW2748--guest-02", () => "id-token", {
        apiUrl: "/api",
        fetcher
      })
    ).resolves.toEqual(written);

    const [url, init] = fetcher.mock.calls[0];
    // The guest is fully identified by the path, so there is nothing to send.
    expect(url).toBe("/api/admin/invitations/SW2748/guests/SW2748--guest-02");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ Authorization: "Bearer id-token" });
    expect(init.body).toBeUndefined();
  });

  it("names the last-guest refusal instead of blaming stale data", async () => {
    await expect(
      removeAdminInvitationGuest("SW2748", "SW2748--guest-01", () => "id-token", {
        apiUrl: "/api",
        fetcher: respond({ message: "Cannot remove the last guest of an invitation." }, 409)
      })
    ).rejects.toMatchObject({
      kind: "rejected",
      status: 409,
      message: "Este é o último convidado do convite. Exclua o convite em vez de remover o convidado."
    });
  });

  it("treats a 5xx as unavailable on every structural write", async () => {
    for (const call of [
      () => createAdminInvitation(draft, () => "id-token", { apiUrl: "/api", fetcher: respond({}, 502) }),
      () => deleteAdminInvitation("SW2748", () => "id-token", { apiUrl: "/api", fetcher: respond({}, 502) }),
      () =>
        addAdminInvitationGuests("SW2748", [{ guestName: "Duda" }], () => "id-token", {
          apiUrl: "/api",
          fetcher: respond({}, 502)
        }),
      () =>
        removeAdminInvitationGuest("SW2748", "SW2748--guest-02", () => "id-token", {
          apiUrl: "/api",
          fetcher: respond({}, 502)
        })
    ]) {
      await expect(call()).rejects.toMatchObject({ kind: "unavailable", status: 502 });
    }
  });

  it("never reaches the network without a token, and lets an abort through", async () => {
    const fetcher = vi.fn();
    await expect(
      deleteAdminInvitation("SW2748", () => null, { apiUrl: "/api", fetcher })
    ).rejects.toMatchObject({ kind: "unauthorized", status: 401 });
    expect(fetcher).not.toHaveBeenCalled();

    const abort = new Error("aborted");
    abort.name = "AbortError";
    await expect(
      deleteAdminInvitation("SW2748", () => "id-token", {
        apiUrl: "/api",
        fetcher: vi.fn().mockRejectedValue(abort)
      })
    ).rejects.toBe(abort);
  });
});
