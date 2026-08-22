import type { AdminDashboardResponse } from "@brimax/contracts";
import { describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin-api";
import { formatLongDate, formatPhone } from "@/lib/admin-dashboard-format";
import { toMusicSuggestionRows } from "@/lib/admin-dashboard-model";
import {
  createLiveDashboardSource,
  fixtureDashboardSource,
  mapAdminDashboardResponse,
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
    expect(snapshot.threads).toEqual({});
  });

  it("maps absent persisted metadata honestly and keeps existing display fallbacks", () => {
    const sparse: AdminDashboardResponse = {
      ok: true,
      invitations: [
        {
          invitationCode: "CD6789",
          householdName: "Família Costa",
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
      commands: []
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

describe("admin dashboard source selection", () => {
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
});

describe("WhatsApp history page mapping", () => {
  it("maps mixed newest-first history into oldest-first messages and newest-first commands", () => {
    const page = mapAdminWhatsappThreadPage("AB2345", {
      invitationCode: "AB2345",
      status: "message_sent",
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

  it("returns fixture pages without mutating the fixture singleton", async () => {
    const initial = await fixtureDashboardSource.load();
    expect(initial.threads).toEqual({});

    const first = await fixtureDashboardSource.loadWhatsappThread("SW2748");
    first.messages[0].text = "Mutado";
    const second = await fixtureDashboardSource.loadWhatsappThread("SW2748");
    expect(second.messages[0].text).not.toBe("Mutado");
    expect(second.nextCursor).toBeNull();
  });
});
