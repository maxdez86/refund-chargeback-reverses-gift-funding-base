import type { AdminDashboardResponse, WhatsappRsvpStatusResponse } from "@brimax/contracts";
import { describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin-api";
import { formatLongDate, formatPhone } from "@/lib/admin-dashboard-format";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import { deriveReconciliationStatus, toMusicSuggestionRows, trailingInboundCount } from "@/lib/admin-dashboard-model";
import {
  createLiveDashboardSource,
  fixtureDashboardSource,
  mapAdminDashboardResponse,
  mapAdminWhatsappFlowSnapshot,
  mapAdminWhatsappThreadPage,
  selectAdminDashboardSource
} from "@/lib/admin-dashboard-source";

const completeResponse: AdminDashboardResponse = {
  ok: true,
  invitations: [
    {
      invitationCode: "AB2345",
      householdName: "Amanda e Chris",
      phoneNumber: "5511999999999",
      phoneNumberSource: "guest",
      phoneNumberUpdatedAt: "2026-08-20T10:00:00.000Z",
      whatsappFlowStatus: "reconciliation_required",
      whatsappFlowStage: "followup",
      whatsappFlowUpdatedAt: "2026-08-20T11:00:00.000Z",
      whatsappFlowCompletedAt: "2026-08-20T12:00:00.000Z",
      whatsappFallbackSentAt: "2026-08-20T13:00:00.000Z",
      whatsappLastInboundMessageId: "wamid.inbound",
      whatsappLastOutboundMessageId: "wamid.outbound",
      whatsappFailureReason: "provider mismatch",
      whatsappSendAvailability: { firstAllowed: false, resendAllowed: false },
      whatsappFreeTextWindow: { open: false },
      guests: [
        {
          guestId: "guest-2",
          guestName: "Chris",
          allowedPlusOnes: 1,
          rsvpStatus: "declined",
          isChild: false
        },
        {
          guestId: "guest-1",
          guestName: "Amanda",
          allowedPlusOnes: 0,
          rsvpStatus: "attending",
          isChild: true,
          isChildSixOrYounger: true,
          dietaryNotes: "Sem lactose"
        }
      ],
      rsvp: {
        status: "attending",
        updatedAt: "2026-08-20T09:00:00.000Z",
        submittedBy: "guest-1",
        attending: 1,
        paid: 0,
        childrenSixOrYounger: 1,
        note: "Música sugerida: Dreams - Fleetwood Mac"
      },
      whatsappConversation: {
        messageCount: 7,
        unreadCount: 2,
        lastMessageAt: "2026-08-20T12:00:00.000Z",
        lastMessageDirection: "inbound",
        lastMessageType: "text",
        lastMessagePreview: "Consegui atualizar no site?"
      }
    }
  ],
  gifts: [
    {
      id: "gift-1",
      name: "Presente",
      image: "presente",
      fractional: false,
      totalValueCents: 10_000,
      partValueCents: null,
      totalParts: null,
      finalPartValueCents: null,
      fundingModelVersion: "LEGACY_FIXED_50",
      partsFunded: 0,
      partsReserved: 0,
      confirmedAmountCents: 0,
      reservedAmountCents: 0,
      availableAmountCents: 10_000,
      availableParts: 1,
      fullyFunded: false,
      updatedAt: null
    }
  ],
  guestMessages: [
    {
      messageId: "message-1",
      authorName: "Beatriz",
      message: "Felicidades!",
      createdAt: "2026-08-20T08:00:00.000Z"
    }
  ]
};

describe("admin dashboard response mapping", () => {
  it("preserves complete invitation data and adds only frontend compatibility fields", () => {
    const snapshot = mapAdminDashboardResponse(completeResponse);

    expect(snapshot.invitations[0]).toMatchObject({
      invitationCode: "AB2345",
      householdName: "Amanda e Chris",
      phoneNumber: "5511999999999",
      phoneNumberSource: "guest",
      phoneNumberUpdatedAt: "2026-08-20T10:00:00.000Z",
      whatsappFlowStatus: "reconciliation_required",
      whatsappFlowStage: "followup",
      whatsappLastInboundMessageId: "wamid.inbound",
      whatsappLastOutboundMessageId: "wamid.outbound",
      whatsappFailureReason: "provider mismatch",
      whatsappSendAvailability: { firstAllowed: false, resendAllowed: false },
      whatsappFreeTextWindow: { open: false },
      reconciliationStatus: "required",
      rsvp: {
        status: "attending",
        submittedBy: "guest-1",
        attending: 1,
        paid: 0,
        childrenSixOrYounger: 1
      }
    });
    expect(snapshot.invitations[0].guests.map((guest) => guest.guestId)).toEqual([
      "guest-2",
      "guest-1"
    ]);
    expect(snapshot.invitations[0].guests[1]).toMatchObject({
      isChild: true,
      isChildSixOrYounger: true,
      dietaryNotes: "Sem lactose"
    });
    expect(toMusicSuggestionRows(snapshot.invitations)[0]).toMatchObject({
      music: "Dreams - Fleetwood Mac",
      suggestedAt: "2026-08-20T09:00:00.000Z"
    });
    expect(snapshot.gifts[0]).toEqual({
      ...completeResponse.gifts[0],
      paused: false,
      photoUrl: null,
      version: 0
    });
    expect(snapshot.guestMessages[0]).toEqual({
      ...completeResponse.guestMessages[0],
      hidden: false
    });
    expect(snapshot.invitations[0].commands).toEqual([]);
    expect(snapshot.invitations[0].whatsappConversation).toEqual(
      completeResponse.invitations[0].whatsappConversation
    );
    expect(snapshot.threads).toEqual({});
  });

  it("maps absent persisted metadata honestly and keeps existing display fallbacks", () => {
    const sparse: AdminDashboardResponse = {
      ok: true,
      invitations: [
        {
          invitationCode: "CD6789",
          householdName: "Família Costa",
          whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
          whatsappFreeTextWindow: { open: false },
          guests: [
            {
              guestId: "guest-1",
              guestName: "Carla",
              allowedPlusOnes: 0,
              rsvpStatus: "pending"
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
        }
      ],
      gifts: [],
      guestMessages: []
    };

    const invitation = mapAdminDashboardResponse(sparse).invitations[0];
    expect(invitation).toMatchObject({
      phoneNumber: "",
      phoneNumberSource: "import",
      phoneNumberUpdatedAt: null,
      whatsappFlowStatus: "idle",
      whatsappFlowStage: "pending",
      whatsappFlowUpdatedAt: null,
      whatsappFlowCompletedAt: null,
      whatsappFallbackSentAt: null,
      whatsappLastInboundMessageId: null,
      whatsappLastOutboundMessageId: null,
      whatsappFailureReason: null,
      reconciliationStatus: "none",
      rsvp: { updatedAt: null, submittedBy: null },
      commands: [],
      // Absent, not zero-valued: this invitation owns no WhatsApp message at all.
      whatsappConversation: null
    });
    expect(invitation.guests[0].isChild).toBe(false);
    expect(formatPhone(invitation.phoneNumber)).toBe("—");
    expect(formatLongDate(invitation.phoneNumberUpdatedAt)).toBe("—");
    expect(formatLongDate(invitation.rsvp.updatedAt)).toBe("—");
  });

  it("returns independent arrays and objects on every mapping", () => {
    const first = mapAdminDashboardResponse(completeResponse);
    const second = mapAdminDashboardResponse(completeResponse);
    first.invitations[0].householdName = "Mutado";
    first.invitations[0].guests[0].guestName = "Mutado";
    first.gifts[0].name = "Mutado";
    first.guestMessages[0].message = "Mutado";

    expect(second.invitations[0].householdName).toBe("Amanda e Chris");
    expect(second.invitations[0].guests[0].guestName).toBe("Chris");
    expect(second.gifts[0].name).toBe("Presente");
    expect(second.guestMessages[0].message).toBe("Felicidades!");
  });
});

describe("admin WhatsApp free-text source", () => {
  it("delegates a live free-text send with auth and reports auth failures", async () => {
    const response = {
      commandId: "idempotency-admin-text-12345678",
      invitationCode: "SW2748",
      status: "queued",
      replayed: false
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 202 }));
    const live = createLiveDashboardSource({ getToken: () => "test-token", apiUrl: "/api", fetcher });

    await expect(live.sendWhatsappText?.("SW2748", "Oi!", "admin-text-12345678")).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/admin/whatsapp/invitations/SW2748/messages");

    const onAuthError = vi.fn();
    const unauthorized = createLiveDashboardSource({
      getToken: () => "test-token",
      apiUrl: "/api",
      fetcher: vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
      onAuthError
    });
    await expect(unauthorized.sendWhatsappText?.("SW2748", "Oi!", "admin-text-12345678")).rejects.toThrow();
    expect(onAuthError).toHaveBeenCalledOnce();
  });

  it("refuses a fixture free-text send once the fixture window has lapsed", async () => {
    const snapshot = await fixtureDashboardSource.load();
    const open = snapshot.invitations.find((invitation) => invitation.whatsappFreeTextWindow.open);
    const closed = snapshot.invitations.find((invitation) => !invitation.whatsappFreeTextWindow.open);
    // The fixture set is meant to demonstrate both composer states.
    expect(open).toBeDefined();
    expect(closed).toBeDefined();

    await expect(fixtureDashboardSource.sendWhatsappText?.(open!.invitationCode, "Oi!", "admin-text-12345678"))
      .resolves.toMatchObject({ invitationCode: open!.invitationCode, status: "queued" });
    await expect(fixtureDashboardSource.sendWhatsappText?.(closed!.invitationCode, "Oi!", "admin-text-12345678"))
      .rejects.toMatchObject({ code: "FREE_TEXT_WINDOW_CLOSED", status: 409 });
  });
});

describe("admin dashboard source selection", () => {
  it("delegates live sends with auth and keeps fixture sends local", async () => {
    const response = {
      commandId: "idempotency-admin-rsvp-first-12345678",
      invitationCode: "SW2748",
      templateId: "wedding_rsvp_pending_reminder_group",
      templateVersion: 2,
      status: "queued",
      replayed: false
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 202 }));
    const live = createLiveDashboardSource({ getToken: () => "test-token", apiUrl: "/api", fetcher });

    await expect(live.sendWhatsappRsvp?.("SW2748", "first", "admin-rsvp-first-12345678")).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await expect(fixtureDashboardSource.sendWhatsappRsvp?.(
      "SW2748", "first", "admin-rsvp-first-abcdefgh"
    )).resolves.toMatchObject({ invitationCode: "SW2748", status: "queued" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps fixture mode isolated without calling the live endpoint", async () => {
    const fetcher = vi.fn();
    const live = createLiveDashboardSource({ getToken: () => "test-token", fetcher });
    const selected = selectAdminDashboardSource("fixture", live);

    expect(selected).toBe(fixtureDashboardSource);
    await expect(selected.load()).resolves.toMatchObject({ threads: expect.any(Object) });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("loads and maps live data without silently falling back on failure", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(completeResponse), { status: 200 }))
      .mockRejectedValueOnce(new Error("offline"));
    const live = createLiveDashboardSource({
      getToken: () => "test-token",
      apiUrl: "/api",
      fetcher
    });

    expect(selectAdminDashboardSource("live", live)).toBe(live);
    await expect(live.load()).resolves.toMatchObject({
      invitations: [{ invitationCode: "AB2345" }]
    });
    await expect(live.load()).rejects.toMatchObject({ kind: "unavailable" });
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"]
  ])("reports HTTP %s auth failures without exposing the credential", async (status, kind) => {
    const onAuthError = vi.fn();
    const source = createLiveDashboardSource({
      getToken: () => "test-token",
      apiUrl: "/api",
      fetcher: vi.fn().mockResolvedValue(new Response("", { status })),
      onAuthError
    });

    await expect(source.load()).rejects.toMatchObject({ kind });
    expect(onAuthError).toHaveBeenCalledWith(expect.any(AdminApiError));
    expect(onAuthError.mock.calls[0][0].message).not.toContain("test-token");
  });

  it("requests threads with order=desc, limit=50, cursor propagation and bearer auth", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const threadResponse = {
      invitationCode: "SW2748",
      status: "message_sent",
      sendAvailability: { firstAllowed: false, resendAllowed: false },
      freeTextWindow: { open: false },
      history: [
        {
          kind: "message",
          id: "msg-1",
          direction: "inbound",
          status: "received",
          createdAt: "2026-08-20T12:00:00.000Z",
          messageType: "text",
          body: "Olá"
        }
      ],
      nextCursor: "cursor-older"
    };
    const fetcher = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify(threadResponse), { status: 200 }));
    });
    const live = createLiveDashboardSource({
      getToken: () => "live-admin-token",
      apiUrl: "https://api.brimax.life",
      fetcher: fetcher as typeof fetch
    });

    const result = await live.loadWhatsappInvitation("SW2748");
    expect(capturedUrl).toBe("https://api.brimax.life/admin/whatsapp/invitations/SW2748?limit=50&order=desc");
    expect(capturedHeaders).toMatchObject({ Authorization: "Bearer live-admin-token" });
    expect(result.page.invitationCode).toBe("SW2748");
    expect(result.page.messages).toHaveLength(1);
    expect(result.page.nextCursor).toBe("cursor-older");

    await live.loadWhatsappInvitation("SW2748", "cursor-older");
    expect(capturedUrl).toBe("https://api.brimax.life/admin/whatsapp/invitations/SW2748?limit=50&order=desc&cursor=cursor-older");
    expect(capturedHeaders).toMatchObject({ Authorization: "Bearer live-admin-token" });
  });

  it("handles auth failures on thread loads without leaking the token", async () => {
    const onAuthError = vi.fn();
    const source = createLiveDashboardSource({
      getToken: () => "secret-token",
      apiUrl: "/api",
      fetcher: vi.fn().mockResolvedValue(new Response("", { status: 401 })),
      onAuthError
    });

    await expect(source.loadWhatsappInvitation("SW2748")).rejects.toMatchObject({ kind: "unauthorized" });
    expect(onAuthError).toHaveBeenCalledWith(expect.any(AdminApiError));
    expect(onAuthError.mock.calls[0][0].message).not.toContain("secret-token");
  });
});

describe("WhatsApp flow snapshot mapping", () => {
  it("maps a complete status response into an AdminWhatsappFlowSnapshot", () => {
    const response: WhatsappRsvpStatusResponse = {
      invitationCode: "AB2345",
      phoneNumber: "5511999999999",
      phoneNumberSource: "guest",
      phoneNumberUpdatedAt: "2026-08-20T10:00:00.000Z",
      status: "reconciliation_required",
      sendAvailability: { firstAllowed: false, resendAllowed: false },
      freeTextWindow: { open: false },
      stage: "followup",
      updatedAt: "2026-08-20T11:00:00.000Z",
      completedAt: "2026-08-20T12:00:00.000Z",
      fallbackSentAt: "2026-08-20T13:00:00.000Z",
      lastInboundMessageId: "wamid.inbound",
      lastOutboundMessageId: "wamid.outbound",
      failureReason: "provider mismatch"
    };

    const flow = mapAdminWhatsappFlowSnapshot(response);

    expect(flow).toEqual({
      phoneNumber: "5511999999999",
      phoneNumberSource: "guest",
      phoneNumberUpdatedAt: "2026-08-20T10:00:00.000Z",
      whatsappFlowStatus: "reconciliation_required",
      whatsappFlowStage: "followup",
      whatsappFlowUpdatedAt: "2026-08-20T11:00:00.000Z",
      whatsappFlowCompletedAt: "2026-08-20T12:00:00.000Z",
      whatsappFallbackSentAt: "2026-08-20T13:00:00.000Z",
      whatsappLastInboundMessageId: "wamid.inbound",
      whatsappLastOutboundMessageId: "wamid.outbound",
      whatsappFailureReason: "provider mismatch",
      whatsappSendAvailability: { firstAllowed: false, resendAllowed: false },
      whatsappFreeTextWindow: { open: false },
      reconciliationStatus: "required"
    });
  });

  it("maps a minimal status response with optional fields absent and default fallbacks", () => {
    const response: WhatsappRsvpStatusResponse = {
      invitationCode: "AB2345",
      status: "message_sent",
      sendAvailability: { firstAllowed: false, resendAllowed: false },
      freeTextWindow: { open: false }
    };

    const flow = mapAdminWhatsappFlowSnapshot(response);

    expect(flow).toEqual({
      phoneNumber: "",
      phoneNumberSource: "import",
      phoneNumberUpdatedAt: null,
      whatsappFlowStatus: "message_sent",
      whatsappFlowStage: "pending",
      whatsappFlowUpdatedAt: null,
      whatsappFlowCompletedAt: null,
      whatsappFallbackSentAt: null,
      whatsappLastInboundMessageId: null,
      whatsappLastOutboundMessageId: null,
      whatsappFailureReason: null,
      whatsappSendAvailability: { firstAllowed: false, resendAllowed: false },
      whatsappFreeTextWindow: { open: false },
      reconciliationStatus: "none"
    });
  });

  it("derives reconciliationStatus consistently across dashboard and flow mappers", () => {
    expect(deriveReconciliationStatus("reconciliation_required")).toBe("required");
    expect(deriveReconciliationStatus("attendance_confirmed_whatsapp")).toBe("none");
    expect(deriveReconciliationStatus("failed")).toBe("none");
    expect(deriveReconciliationStatus("idle")).toBe("none");
    expect(deriveReconciliationStatus(undefined)).toBe("none");
    expect(deriveReconciliationStatus(null)).toBe("none");
  });
});

describe("WhatsApp history page mapping", () => {
  it("maps mixed newest-first history into oldest-first messages and newest-first commands", () => {
    const page = mapAdminWhatsappThreadPage("AB2345", {
      invitationCode: "AB2345",
      status: "message_sent",
      sendAvailability: { firstAllowed: false, resendAllowed: false },
      freeTextWindow: { open: false },
      history: [
        {
          kind: "message", id: "message-new", direction: "inbound", status: "received",
          createdAt: "2026-08-20T12:00:00.000Z", messageType: "text", body: "Mais nova"
        },
        {
          kind: "command", id: "command-new", commandId: "command-new", status: "failed",
          createdAt: "2026-08-20T11:00:00.000Z", templateId: "wedding_invitation",
          stage: "pending", retryCount: 2, reconciliationStatus: "required"
        },
        {
          kind: "message", id: "message-old", direction: "outbound", status: "failed",
          createdAt: "2026-08-20T10:00:00.000Z", messageType: "template",
          templateId: "wedding_rsvp_reconfirmation_single"
        },
        {
          kind: "command", id: "command-old", commandId: "command-old", status: "sent",
          createdAt: "2026-08-20T09:00:00.000Z", templateId: "__whatsapp_fallback_text__"
        }
      ],
      nextCursor: "older-page"
    });

    expect(page.messages.map((message) => message.messageId)).toEqual(["message-old", "message-new"]);
    expect(page.messages[0]).toMatchObject({
      text: "Mensagem de modelo: wedding_rsvp_reconfirmation_single",
      failed: true
    });
    expect(page.commands.map((command) => command.commandId)).toEqual(["command-new", "command-old"]);
    expect(page.commands[1]).toMatchObject({
      templateId: "__whatsapp_fallback_text__",
      stage: "pending",
      retryCount: 0,
      reconciliationStatus: "none"
    });
    expect(page.nextCursor).toBe("older-page");
  });

  it("maps a bodyless decline button into a visible response", () => {
    const page = mapAdminWhatsappThreadPage("AB2345", {
      invitationCode: "AB2345", status: "completed",
      sendAvailability: { firstAllowed: false, resendAllowed: false }, freeTextWindow: { open: false }, history: [{
        kind: "message", id: "message-decline", direction: "inbound", status: "received",
        createdAt: "2026-08-20T12:00:00.000Z", messageType: "button_reply",
        buttonId: "rsvp_b2_decline", buttonAction: "decline"
      }]
    });

    expect(page.messages[0]).toMatchObject({
      text: "Não vai", buttonId: "rsvp_b2_decline", buttonAction: "decline"
    });
  });

  it("derives every fixture summary from the fixture thread it belongs to", () => {
    const snapshot = createFixtureDashboardSnapshot();
    const withMessages = snapshot.invitations.filter(
      (invitation) => snapshot.threads[invitation.invitationCode]?.length
    );
    expect(withMessages.length).toBeGreaterThan(0);

    for (const invitation of withMessages) {
      const thread = snapshot.threads[invitation.invitationCode];
      const newest = thread.at(-1)!;
      const newestOutbound = thread.filter((message) => message.direction === "outbound").at(-1);
      const newestInbound = thread.filter((message) => message.direction === "inbound").at(-1);
      expect(invitation.whatsappConversation).toEqual({
        messageCount: thread.length,
        unreadCount: trailingInboundCount(thread),
        lastMessageAt: newest.sentAt,
        lastMessageDirection: newest.direction,
        lastMessageType: newest.templateId ? "template" : "text",
        lastMessageTemplateId: newest.templateId,
        lastMessagePreview: newest.text.slice(0, 160),
        lastOutboundMessageTemplateId: newestOutbound?.templateId,
        lastOutboundMessagePreview: newestOutbound?.text.slice(0, 160),
        lastInboundMessageTemplateId: newestInbound?.templateId,
        lastInboundMessagePreview: newestInbound?.text.slice(0, 160)
      });
    }
  });

  it("keeps a zero-message invitation in the fixture set with no summary at all", () => {
    const snapshot = createFixtureDashboardSnapshot();
    const withoutMessages = snapshot.invitations.filter(
      (invitation) => !invitation.whatsappConversation
    );

    expect(withoutMessages.map((invitation) => invitation.invitationCode)).toEqual(["LB6640"]);
    expect(snapshot.threads.LB6640).toBeUndefined();
    // Still a real invitation everywhere else in the panel.
    expect(withoutMessages[0].guests).toHaveLength(2);
    expect(withoutMessages[0].commands).toHaveLength(2);
  });

  it("returns fixture pages without mutating the fixture singleton", async () => {
    const initial = await fixtureDashboardSource.load();
    expect(initial.threads).toEqual({});

    const first = await fixtureDashboardSource.loadWhatsappInvitation("SW2748");
    first.page.messages[0].text = "Mutado";
    const second = await fixtureDashboardSource.loadWhatsappInvitation("SW2748");
    expect(second.page.messages[0].text).not.toBe("Mutado");
    expect(second.page.nextCursor).toBeNull();
  });

  it("returns one complete page and flow snapshot with a null cursor and isolated messages and commands for fixture source", async () => {
    const result = await fixtureDashboardSource.loadWhatsappInvitation("SW2748");
    expect(result.page.invitationCode).toBe("SW2748");
    expect(result.page.nextCursor).toBeNull();
    expect(result.page.messages.length).toBeGreaterThan(0);
    expect(result.page.commands.length).toBeGreaterThan(0);
    expect(result.flow.whatsappFlowStatus).toBeDefined();
    expect(result.flow.reconciliationStatus).toBe("none");
  });

  it("returns both flow snapshot and thread page in one live request", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        invitationCode: "SW2748",
        status: "message_sent",
        sendAvailability: { firstAllowed: false, resendAllowed: false },
        freeTextWindow: { open: false },
        stage: "pending",
        phoneNumber: "5511999999999",
        phoneNumberSource: "guest",
        history: [
          {
            kind: "message",
            id: "msg-1",
            direction: "inbound",
            status: "delivered",
            createdAt: "2026-08-20T12:00:00.000Z",
            body: "Olá"
          },
          {
            kind: "command",
            id: "cmd-1",
            commandId: "cmd-1",
            status: "sent",
            templateId: "wedding_invitation",
            createdAt: "2026-08-20T11:00:00.000Z"
          }
        ]
      })
    });

    const source = createLiveDashboardSource({
      getToken: () => "token",
      apiUrl: "https://api.test",
      fetcher
    });

    const result = await source.loadWhatsappInvitation("SW2748");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.flow).toEqual({
      phoneNumber: "5511999999999",
      phoneNumberSource: "guest",
      phoneNumberUpdatedAt: null,
      whatsappFlowStatus: "message_sent",
      whatsappFlowStage: "pending",
      whatsappFlowUpdatedAt: null,
      whatsappFlowCompletedAt: null,
      whatsappFallbackSentAt: null,
      whatsappLastInboundMessageId: null,
      whatsappLastOutboundMessageId: null,
      whatsappFailureReason: null,
      whatsappSendAvailability: { firstAllowed: false, resendAllowed: false },
      whatsappFreeTextWindow: { open: false },
      reconciliationStatus: "none"
    });
    expect(result.page.invitationCode).toBe("SW2748");
    expect(result.page.messages).toHaveLength(1);
    expect(result.page.commands).toHaveLength(1);
  });
});
