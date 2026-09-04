import { describe, expect, it } from "vitest";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import {
  adminDashboardReducer,
  createInitialState,
  giftIdFromName,
  unreadCount,
  type AdminDashboardAction,
  type AdminDashboardState
} from "@/lib/admin-dashboard-store";
import type { AdminInvitation } from "@/lib/admin-dashboard-types";

const NOW = "2026-08-20T12:00:00Z";

const freshState = () => createInitialState(createFixtureDashboardSnapshot());
const unloadedState = () => {
  const snapshot = createFixtureDashboardSnapshot();
  snapshot.threads = {};
  snapshot.invitations = snapshot.invitations.map((invitation) => ({ ...invitation, commands: [] }));
  return createInitialState(snapshot);
};
const invitationOf = (state: AdminDashboardState, code: string) =>
  state.invitations.find((invitation) => invitation.invitationCode === code)!;
const apply = (state: AdminDashboardState, ...actions: AdminDashboardAction[]) =>
  actions.reduce(adminDashboardReducer, state);

/** One invitation exactly as the create endpoint returns it, mapped into the panel's shape. */
function createdInvitation(
  invitationCode: string,
  guestNames: readonly string[] = ["Ana Moretti", "Caio Moretti"]
): AdminInvitation {
  return {
    invitationCode,
    householdName: "Família Moretti",
    phoneNumber: "5511912345678",
    phoneNumberSource: "operator",
    phoneNumberUpdatedAt: NOW,
    whatsappFlowStatus: "idle",
    whatsappFlowStage: "pending",
    whatsappFlowUpdatedAt: null,
    whatsappFlowCompletedAt: null,
    whatsappFallbackSentAt: null,
    whatsappLastInboundMessageId: null,
    whatsappLastOutboundMessageId: null,
    whatsappFailureReason: null,
    whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
    whatsappFreeTextWindow: { open: false },
    reconciliationStatus: "none",
    rsvp: {
      status: "pending",
      updatedAt: null,
      submittedBy: null,
      attending: 0,
      paid: 0,
      childrenSixOrYounger: 0
    },
    guests: guestNames.map((guestName, index) => ({
      guestId: `${invitationCode}--guest-${String(index + 1).padStart(2, "0")}`,
      guestName,
      allowedPlusOnes: 0,
      rsvpStatus: "pending" as const,
      isChild: false
    })),
    commands: [],
    whatsappConversation: null
  };
}

describe("admin dashboard reducer", () => {
  it("installs the guests and aggregate the API recomputed", () => {
    const state = freshState();
    const invitation = invitationOf(state, "LB6640");
    const next = apply(state, {
      type: "apply-invitation-rsvp",
      response: {
        ok: true,
        invitationCode: "LB6640",
        guests: invitation.guests.map((guest) => ({
          guestId: guest.guestId,
          guestName: guest.guestName,
          allowedPlusOnes: guest.allowedPlusOnes,
          rsvpStatus: "attending" as const,
          isChild: guest.isChild
        })),
        rsvp: {
          status: "attending" as const,
          updatedAt: NOW,
          submittedBy: "LB6640--guest-01",
          attending: 2,
          paid: 2,
          childrenSixOrYounger: 0
        },
        updatedAt: NOW
      }
    });
    const updated = invitationOf(next, "LB6640");

    expect(updated.guests.every((guest) => guest.rsvpStatus === "attending")).toBe(true);
    // The reducer never recomputes: the counts are exactly the ones the API returned, so the
    // panel cannot show a roll-up that a later refetch would contradict.
    expect(updated.rsvp).toEqual({
      status: "attending",
      updatedAt: NOW,
      submittedBy: "LB6640--guest-01",
      attending: 2,
      paid: 2,
      childrenSixOrYounger: 0
    });
  });

  it("leaves the WhatsApp flow untouched, because an admin edit sends nothing", () => {
    const state = freshState();
    const before = invitationOf(state, "LB6640");
    const next = apply(state, {
      type: "apply-invitation-rsvp",
      response: {
        ok: true,
        invitationCode: "LB6640",
        guests: before.guests.map((guest) => ({
          guestId: guest.guestId,
          guestName: guest.guestName,
          allowedPlusOnes: guest.allowedPlusOnes,
          rsvpStatus: "attending" as const
        })),
        rsvp: {
          status: "attending" as const,
          updatedAt: NOW,
          submittedBy: "LB6640--guest-01",
          attending: 2,
          paid: 2,
          childrenSixOrYounger: 0
        },
        updatedAt: NOW
      }
    });
    const after = invitationOf(next, "LB6640");

    expect(after.whatsappFlowStatus).toBe(before.whatsappFlowStatus);
    expect(after.whatsappFlowUpdatedAt).toBe(before.whatsappFlowUpdatedAt);
  });

  it("keeps the seed child flag a boolean and carries the answered age band through", () => {
    const state = freshState();
    const invitation = invitationOf(state, "HL4120");
    const next = apply(state, {
      type: "apply-invitation-rsvp",
      response: {
        ok: true,
        invitationCode: "HL4120",
        guests: invitation.guests.map((guest, index) => ({
          guestId: guest.guestId,
          guestName: guest.guestName,
          allowedPlusOnes: guest.allowedPlusOnes,
          rsvpStatus: guest.rsvpStatus,
          // The contract omits the flag rather than sending false; the panel keeps a boolean.
          ...(index === 1 ? { isChild: true, isChildSixOrYounger: false } : {})
        })),
        rsvp: {
          status: "attending" as const,
          updatedAt: NOW,
          submittedBy: "HL4120--guest-01",
          attending: 4,
          paid: 4,
          childrenSixOrYounger: 0
        },
        updatedAt: NOW
      }
    });
    const updated = invitationOf(next, "HL4120");

    expect(updated.guests[0].isChild).toBe(false);
    expect(updated.guests[0].isChildSixOrYounger).toBeUndefined();
    expect(updated.guests[1]).toMatchObject({ isChild: true, isChildSixOrYounger: false });
  });

  it("ignores a write for an invitation it does not hold", () => {
    const state = freshState();
    expect(
      apply(state, {
        type: "apply-invitation-rsvp",
        response: {
          ok: true,
          invitationCode: "ZY9999",
          guests: [
            {
              guestId: "ZY9999--guest-01",
              guestName: "Ninguém",
              allowedPlusOnes: 0,
              rsvpStatus: "attending" as const
            }
          ],
          rsvp: {
            status: "attending" as const,
            updatedAt: NOW,
            submittedBy: "ZY9999--guest-01",
            attending: 1,
            paid: 1,
            childrenSixOrYounger: 0
          },
          updatedAt: NOW
        }
      })
    ).toBe(state);
  });

  it("deletes an invitation together with its conversation", () => {
    const next = apply(freshState(), { type: "delete-invitation", invitationCode: "RQ7712" });
    expect(next.invitations.map((invitation) => invitation.invitationCode)).not.toContain("RQ7712");
    expect(next.threads.RQ7712).toBeUndefined();
  });

  it("inserts the invitation the API created at the top of the list", () => {
    // The reducer no longer mints guest ids or guesses a WhatsApp state: it installs the row the
    // server returned, exactly as `apply-invitation-rsvp` installs a recomputed guest list.
    const created = createdInvitation("KP3456");

    const next = apply(freshState(), { type: "create-invitation", invitation: created });

    expect(next.invitations[0]).toEqual(created);
    expect(next.invitations).toHaveLength(freshState().invitations.length + 1);
    // Nothing has been sent yet, so the invitation owns no conversation and stays out of the
    // WhatsApp tab until a real one exists.
    expect(next.invitations[0].whatsappConversation).toBeNull();
  });

  it("stores a new phone as operator-sourced, keeping only the digits", () => {
    const next = apply(freshState(), {
      type: "update-phone",
      invitationCode: "LB6640",
      phoneNumber: "+55 21 98877-6655",
      now: NOW
    });
    expect(invitationOf(next, "LB6640")).toMatchObject({
      phoneNumber: "5521988776655",
      phoneNumberSource: "operator",
      phoneNumberUpdatedAt: NOW
    });
  });

  it("records an accepted first send using backend facts", () => {
    const state = adminDashboardReducer(freshState(), {
      type: "create-invitation",
      invitation: createdInvitation("NEW001", ["Alguém"])
    });
    const next = apply(state, {
      type: "whatsapp-send-accepted",
      response: {
        commandId: "command-from-api",
        invitationCode: "NEW001",
        templateId: "wedding_rsvp_pending_reminder_single",
        templateVersion: 2,
        status: "queued",
        replayed: false
      },
      now: NOW
    });
    const invitation = invitationOf(next, "NEW001");

    expect(invitation.whatsappFlowStatus).toBe("idle");
    expect(invitation.commands[0]).toMatchObject({
      commandId: "command-from-api",
      templateId: "wedding_rsvp_pending_reminder_single",
      stage: "pending",
      status: "queued",
      retryCount: 0,
      replayed: false
    });
  });

  it("records an accepted resend as a distinct backend command", () => {
    const next = apply(freshState(), {
      type: "whatsapp-send-accepted",
      response: {
        commandId: "resend-from-api",
        invitationCode: "LB6640",
        templateId: "wedding_rsvp_pending_reminder_group",
        templateVersion: 3,
        status: "queued",
        replayed: false
      },
      now: NOW
    });
    const invitation = invitationOf(next, "LB6640");
    expect(invitation.commands[0]).toMatchObject({
      commandId: "resend-from-api",
      templateId: "wedding_rsvp_pending_reminder_group",
      status: "queued",
      retryCount: 0,
      stage: "pending"
    });
    expect(invitation.commands).toHaveLength(3);
  });

  it("removes one guest message and leaves the rest of the mural alone", () => {
    const state = freshState();
    const id = state.guestMessages[0].messageId;
    const next = apply(state, { type: "remove-message", messageId: id });
    expect(next.guestMessages).toHaveLength(state.guestMessages.length - 1);
    expect(next.guestMessages.some((message) => message.messageId === id)).toBe(false);
    expect(next.invitations).toEqual(state.invitations);
    expect(next.gifts).toEqual(state.gifts);
  });

  it("leaves the mural untouched when the removed message is unknown", () => {
    const state = freshState();
    const next = apply(state, { type: "remove-message", messageId: "does-not-exist" });
    expect(next.guestMessages).toEqual(state.guestMessages);
  });

  it("saves a gift, bumping its version and re-deriving the quotas", () => {
    const next = apply(freshState(), {
      type: "save-gift",
      giftId: "g-panelas",
      name: "Jogo de panelas",
      totalValueCents: 100_000,
      fractional: true,
      paused: true,
      photoUrl: null,
      now: NOW
    });
    const gift = next.gifts.find((candidate) => candidate.id === "g-panelas")!;
    expect(gift).toMatchObject({ totalParts: 20, paused: true, version: 8, updatedAt: NOW });
  });

  it("creates a gift with a slugged id at the top of the catalog", () => {
    const next = apply(freshState(), {
      type: "create-gift",
      name: "Jogo de jantar Ação",
      totalValueCents: 150_000,
      fractional: true,
      photoUrl: "blob:preview",
      now: NOW
    });
    expect(next.gifts[0]).toMatchObject({
      id: "g-jogo-de-jantar-acao",
      totalParts: 30,
      partsFunded: 0,
      version: 1,
      photoUrl: "blob:preview"
    });
  });

  it("slugs accented names into catalog ids", () => {
    expect(giftIdFromName("Adega climatizada")).toBe("g-adega-climatizada");
    expect(giftIdFromName("  Café & Chá  ")).toBe("g-cafe-cha");
  });
});

describe("WhatsApp conversation state", () => {
  it("counts only the trailing inbound run as unread", () => {
    const state = freshState();
    // QP8814 ends with two guest messages; SW2748 ends with our own reply.
    expect(unreadCount(state, "QP8814")).toBe(2);
    expect(unreadCount(state, "SW2748")).toBe(0);
  });

  it("reads the dashboard summary while the thread is unloaded", () => {
    const state = unloadedState();
    expect(state.threadLoads.QP8814).toEqual({ status: "unloaded" });
    expect(state.threads.QP8814).toBeUndefined();
    expect(unreadCount(state, "QP8814")).toBe(2);
    expect(unreadCount(state, "SW2748")).toBe(0);
  });

  it("keeps the response-needed count when a conversation is opened", () => {
    const state = unloadedState();
    expect(state.invitations.find((i) => i.invitationCode === "QP8814")!.whatsappConversation)
      .toMatchObject({ unreadCount: 2 });
    expect(unreadCount(state, "QP8814")).toBe(2);
    expect(unreadCount(freshState(), "QP8814")).toBe(2);
  });

  it("lets the loaded thread override a stale summary", () => {
    const state = apply(unloadedState(), {
      type: "thread-load-succeeded",
      loadMore: false,
      page: {
        invitationCode: "QP8814",
        // The guest answered since the dashboard snapshot: three trailing inbound, not two.
        messages: [
          { messageId: "p1", direction: "outbound", sentAt: "2026-08-19T21:00:00Z", text: "Oi" },
          { messageId: "p2", direction: "inbound", sentAt: "2026-08-19T21:40:12Z", text: "Vou sim" },
          { messageId: "p3", direction: "inbound", sentAt: "2026-08-19T21:41:05Z", text: "E acompanhante" },
          { messageId: "p4", direction: "inbound", sentAt: "2026-08-19T21:42:00Z", text: "Deu certo?" }
        ],
        commands: [],
        nextCursor: null
      }
    });
    expect(state.invitations.find((i) => i.invitationCode === "QP8814")!.whatsappConversation)
      .toMatchObject({ unreadCount: 2 });
    expect(unreadCount(state, "QP8814")).toBe(3);
  });

  it("keeps using the loaded thread once older pages are appended", () => {
    const first = apply(unloadedState(), {
      type: "thread-load-succeeded",
      loadMore: false,
      page: {
        invitationCode: "QP8814",
        messages: [
          { messageId: "n1", direction: "outbound", sentAt: "2026-08-19T21:00:00Z", text: "Oi" },
          { messageId: "n2", direction: "inbound", sentAt: "2026-08-19T21:40:12Z", text: "Vou sim" }
        ],
        commands: [],
        nextCursor: "older"
      }
    });
    // Older pages are prepended, so the newest end — where the unread run lives — never moves.
    const partial = apply(first, {
      type: "thread-load-succeeded",
      loadMore: true,
      page: {
        invitationCode: "QP8814",
        messages: [
          { messageId: "o1", direction: "inbound", sentAt: "2026-08-06T15:12:44Z", text: "Antiga" }
        ],
        commands: [],
        nextCursor: null
      }
    });
    expect(partial.threads.QP8814.map((message) => message.messageId)).toEqual(["o1", "n1", "n2"]);
    expect(partial.threadLoads.QP8814).toEqual({ status: "loaded", nextCursor: null });
    expect(unreadCount(partial, "QP8814")).toBe(1);
  });

  it("returns null only for an invitation with no summary and no loaded thread", () => {
    const state = unloadedState();
    // LB6640's sends all failed, so it owns no message and carries no summary.
    expect(state.invitations.find((i) => i.invitationCode === "LB6640")!.whatsappConversation).toBeNull();
    expect(unreadCount(state, "LB6640")).toBeNull();
    expect(unreadCount(state, "NOPE00")).toBeNull();

    const loaded = apply(state, {
      type: "thread-load-succeeded",
      loadMore: false,
      page: { invitationCode: "LB6640", messages: [], commands: [], nextCursor: null }
    });
    expect(unreadCount(loaded, "LB6640")).toBe(0);
  });

  it("does not clear the unread count just by opening the thread", () => {
    expect(unreadCount(freshState(), "QP8814")).toBe(2);
  });

  it("appends a pending outbound reply and clears the response-needed count", () => {
    const next = apply(freshState(), {
      type: "send-chat",
      invitationCode: "QP8814",
      messageId: "local-abc",
      text: "  Oi Helena!  ",
      now: NOW
    });
    expect(next.threads.QP8814.at(-1)).toEqual({
      messageId: "local-abc",
      direction: "outbound",
      sentAt: NOW,
      text: "Oi Helena!",
      pending: true
    });
    expect(unreadCount(next, "QP8814")).toBe(0);
  });

  it("settles the pending bubble when the backend accepts or rejects it", () => {
    const sent = apply(freshState(), {
      type: "send-chat", invitationCode: "QP8814", messageId: "local-abc", text: "Oi", now: NOW
    });

    const accepted = apply(sent, {
      type: "chat-send-succeeded", invitationCode: "QP8814", messageId: "local-abc"
    });
    expect(accepted.threads.QP8814.at(-1)).toMatchObject({ pending: false });
    expect(accepted.threads.QP8814.at(-1)).not.toMatchObject({ failed: true });

    const rejected = apply(sent, {
      type: "chat-send-failed", invitationCode: "QP8814", messageId: "local-abc"
    });
    expect(rejected.threads.QP8814.at(-1)).toMatchObject({ pending: false, failed: true });
    // The failed bubble is the operator's only record of what did not send.
    expect(rejected.threads.QP8814.at(-1)?.text).toBe("Oi");
  });

  it("leaves the thread untouched when settling an unknown message id", () => {
    const sent = apply(freshState(), {
      type: "send-chat", invitationCode: "QP8814", messageId: "local-abc", text: "Oi", now: NOW
    });
    expect(apply(sent, {
      type: "chat-send-failed", invitationCode: "QP8814", messageId: "local-other"
    })).toBe(sent);
  });

  it("ignores an empty reply", () => {
    const state = freshState();
    expect(
      apply(state, { type: "send-chat", invitationCode: "QP8814", messageId: "local-abc", text: "   ", now: NOW })
    ).toBe(state);
  });

  it("replaces the whole snapshot and restores the backend response-needed count", () => {
    const reloaded = apply(freshState(), {
      type: "replace-snapshot",
      snapshot: createFixtureDashboardSnapshot()
    });
    expect(reloaded.threadLoads.QP8814).toEqual({ status: "loaded", nextCursor: null });
    expect(reloaded.invitations).toHaveLength(8);
    expect(unreadCount(reloaded, "QP8814")).toBe(2);
  });

  it("keeps the summary count while the first page is in flight, then switches to the thread", () => {
    const state = unloadedState();
    expect(unreadCount(state, "QP8814")).toBe(2);

    const loading = apply(state, {
      type: "thread-load-started", invitationCode: "QP8814", loadMore: false
    });
    expect(loading.threadLoads.QP8814).toEqual({ status: "loading", hasLoaded: false, nextCursor: null });
    expect(unreadCount(loading, "QP8814")).toBe(2);

    const loaded = apply(loading, {
      type: "thread-load-succeeded",
      loadMore: false,
      page: {
        invitationCode: "QP8814",
        messages: [
          { messageId: "new-1", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "Oi" },
          { messageId: "new-2", direction: "inbound", sentAt: "2026-08-20T12:01:00Z", text: "Tudo bem?" }
        ],
        commands: [],
        nextCursor: "older"
      }
    });
    expect(unreadCount(loaded, "QP8814")).toBe(2);
    expect(loaded.threadLoads.QP8814).toEqual({ status: "loaded", nextCursor: "older" });
  });

  it("prepends older descending pages, deduplicates IDs, and keeps commands newest-first", () => {
    const first = apply(unloadedState(), {
      type: "thread-load-succeeded",
      loadMore: false,
      page: {
        invitationCode: "SW2748",
        messages: [
          { messageId: "m2", direction: "outbound", sentAt: "2026-08-20T11:00:00Z", text: "Dois" },
          { messageId: "m3", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "Três" }
        ],
        commands: [{
          commandId: "c3", createdAt: "2026-08-20T12:00:00Z", templateId: "wedding_invitation",
          stage: "pending", status: "sent", retryCount: 0, reconciliationStatus: "none"
        }],
        nextCursor: "older"
      }
    });
    const next = apply(first, {
      type: "thread-load-succeeded",
      loadMore: true,
      page: {
        invitationCode: "SW2748",
        messages: [
          { messageId: "m1", direction: "outbound", sentAt: "2026-08-20T10:00:00Z", text: "Um" },
          { messageId: "m2", direction: "outbound", sentAt: "2026-08-20T11:00:00Z", text: "Dois repetido" }
        ],
        commands: [
          {
            commandId: "c2", createdAt: "2026-08-20T11:00:00Z", templateId: "wedding_invitation",
            stage: "pending", status: "sent", retryCount: 0, reconciliationStatus: "none"
          },
          {
            commandId: "c3", createdAt: "2026-08-20T12:00:00Z", templateId: "wedding_invitation",
            stage: "pending", status: "sent", retryCount: 0, reconciliationStatus: "none"
          }
        ],
        nextCursor: null
      }
    });

    expect(next.threads.SW2748.map((message) => message.messageId)).toEqual(["m1", "m2", "m3"]);
    expect(invitationOf(next, "SW2748").commands.map((command) => command.commandId)).toEqual(["c3", "c2"]);
  });

  it("retains loaded data and retry cursor after a load-more failure", () => {
    const state = apply(unloadedState(), {
      type: "thread-load-succeeded",
      loadMore: false,
      page: {
        invitationCode: "SW2748",
        messages: [{ messageId: "m1", direction: "inbound", sentAt: NOW, text: "Oi" }],
        commands: [],
        nextCursor: "retry-cursor"
      }
    });
    const failed = apply(
      state,
      { type: "thread-load-started", invitationCode: "SW2748", loadMore: true },
      { type: "thread-load-failed", invitationCode: "SW2748", loadMore: true }
    );

    expect(failed.threads.SW2748).toEqual(state.threads.SW2748);
    expect(failed.threadLoads.SW2748).toEqual({
      status: "error", hasLoaded: true, nextCursor: "retry-cursor"
    });
  });

  it("walks descending pages backwards, keeping the newest end fixed and the cursor moving", () => {
    // Page 1 is the newest slice; every `nextCursor` after it walks further back in time.
    const first = apply(unloadedState(), {
      type: "thread-load-succeeded",
      loadMore: false,
      page: {
        invitationCode: "SW2748",
        messages: [
          { messageId: "p1-a", direction: "outbound", sentAt: "2026-08-20T10:00:00Z", text: "Cinco" },
          { messageId: "p1-b", direction: "inbound", sentAt: "2026-08-20T11:00:00Z", text: "Seis" }
        ],
        commands: [],
        nextCursor: "cursor-1"
      }
    });
    const second = apply(first, {
      type: "thread-load-succeeded",
      loadMore: true,
      page: {
        invitationCode: "SW2748",
        messages: [
          { messageId: "p2-a", direction: "outbound", sentAt: "2026-08-19T10:00:00Z", text: "Três" },
          { messageId: "p2-b", direction: "inbound", sentAt: "2026-08-19T11:00:00Z", text: "Quatro" }
        ],
        commands: [],
        nextCursor: "cursor-2"
      }
    });
    const third = apply(second, {
      type: "thread-load-succeeded",
      loadMore: true,
      page: {
        invitationCode: "SW2748",
        messages: [
          { messageId: "p3-a", direction: "outbound", sentAt: "2026-08-18T10:00:00Z", text: "Um" },
          { messageId: "p3-b", direction: "inbound", sentAt: "2026-08-18T11:00:00Z", text: "Dois" }
        ],
        commands: [],
        nextCursor: null
      }
    });

    expect(third.threads.SW2748.map((message) => message.messageId)).toEqual([
      "p3-a", "p3-b", "p2-a", "p2-b", "p1-a", "p1-b"
    ]);
    expect(third.threads.SW2748.map((message) => message.sentAt)).toEqual(
      [...third.threads.SW2748].map((message) => message.sentAt).sort()
    );
    expect([first, second, third].map((state) => state.threadLoads.SW2748)).toEqual([
      { status: "loaded", nextCursor: "cursor-1" },
      { status: "loaded", nextCursor: "cursor-2" },
      { status: "loaded", nextCursor: null }
    ]);
  });

  it("retires a failed load-more back to the page it still holds, cursor intact", () => {
    const loaded = apply(unloadedState(), {
      type: "thread-load-succeeded",
      loadMore: false,
      page: {
        invitationCode: "SW2748",
        messages: [{ messageId: "m1", direction: "inbound", sentAt: NOW, text: "Oi" }],
        commands: [],
        nextCursor: "retry-cursor"
      }
    });
    const failed = apply(
      loaded,
      { type: "thread-load-started", invitationCode: "SW2748", loadMore: true },
      { type: "thread-load-failed", invitationCode: "SW2748", loadMore: true }
    );

    const cleared = apply(failed, { type: "thread-error-cleared", invitationCode: "SW2748" });

    expect(cleared.threadLoads.SW2748).toEqual({ status: "loaded", nextCursor: "retry-cursor" });
    expect(cleared.threads.SW2748).toEqual(loaded.threads.SW2748);
  });

  it("leaves a failed first load, and every other load state, exactly as it found them", () => {
    const failedFirst = apply(
      unloadedState(),
      { type: "thread-load-started", invitationCode: "SW2748", loadMore: false },
      { type: "thread-load-failed", invitationCode: "SW2748", loadMore: false }
    );
    expect(
      apply(failedFirst, { type: "thread-error-cleared", invitationCode: "SW2748" })
    ).toBe(failedFirst);

    const unloaded = unloadedState();
    expect(apply(unloaded, { type: "thread-error-cleared", invitationCode: "SW2748" })).toBe(unloaded);
    expect(apply(unloaded, { type: "thread-error-cleared", invitationCode: "NOPE00" })).toBe(unloaded);
  });

  it("keeps a local composer reply after history that finishes loading later", () => {
    const local = apply(unloadedState(), {
      type: "send-chat", invitationCode: "SW2748", messageId: "local-sw", text: "Resposta local", now: NOW
    });
    const loaded = apply(local, {
      type: "thread-load-succeeded",
      loadMore: false,
      page: {
        invitationCode: "SW2748",
        messages: [{ messageId: "persisted", direction: "inbound", sentAt: "2026-08-20T11:00:00Z", text: "Histórico" }],
        commands: [],
        nextCursor: null
      }
    });

    expect(loaded.threads.SW2748.map((message) => message.text)).toEqual(["Histórico", "Resposta local"]);

    // And again for an older page arriving after the composer message: it prepends, never replaces.
    const older = apply(loaded, {
      type: "thread-load-succeeded",
      loadMore: true,
      page: {
        invitationCode: "SW2748",
        messages: [{ messageId: "anterior", direction: "outbound", sentAt: "2026-08-19T11:00:00Z", text: "Anterior" }],
        commands: [],
        nextCursor: null
      }
    });
    expect(older.threads.SW2748.map((message) => message.text)).toEqual([
      "Anterior", "Histórico", "Resposta local"
    ]);
  });
});

describe("WhatsApp invitation refreshed action", () => {
  const freshFlow = {
    phoneNumber: "5511988887777",
    phoneNumberSource: "guest" as const,
    phoneNumberUpdatedAt: "2026-08-20T15:00:00.000Z",
    whatsappFlowStatus: "message_sent" as const,
    whatsappFlowStage: "followup" as const,
    whatsappFlowUpdatedAt: "2026-08-20T15:00:00.000Z",
    whatsappFlowCompletedAt: null,
    whatsappFallbackSentAt: null,
    whatsappLastInboundMessageId: "wamid.inbound.1",
    whatsappLastOutboundMessageId: "wamid.outbound.1",
    whatsappFailureReason: null,
    whatsappSendAvailability: { firstAllowed: false, resendAllowed: false },
    whatsappFreeTextWindow: { open: false },
    reconciliationStatus: "none" as const
  };

  it("updates flow fields for the target invitation only and preserves list order and other invitations", () => {
    const initial = unloadedState();
    const originalCodes = initial.invitations.map((i) => i.invitationCode);
    const otherBefore = initial.invitations.find((i) => i.invitationCode !== "SW2748")!;

    const next = apply(initial, {
      type: "whatsapp-invitation-refreshed",
      invitationCode: "SW2748",
      flow: freshFlow
    });

    expect(next.invitations.map((i) => i.invitationCode)).toEqual(originalCodes);

    const updated = invitationOf(next, "SW2748");
    expect(updated.phoneNumber).toBe("5511988887777");
    expect(updated.phoneNumberSource).toBe("guest");
    expect(updated.phoneNumberUpdatedAt).toBe("2026-08-20T15:00:00.000Z");
    expect(updated.whatsappFlowStatus).toBe("message_sent");
    expect(updated.whatsappFlowStage).toBe("followup");
    expect(updated.whatsappFlowUpdatedAt).toBe("2026-08-20T15:00:00.000Z");
    expect(updated.whatsappLastInboundMessageId).toBe("wamid.inbound.1");
    expect(updated.whatsappLastOutboundMessageId).toBe("wamid.outbound.1");
    expect(updated.whatsappSendAvailability).toEqual({
      firstAllowed: false,
      resendAllowed: false
    });

    // Non-flow fields (householdName, rsvp, guests, commands, whatsappConversation) stay untouched
    const before = invitationOf(initial, "SW2748");
    expect(updated.householdName).toBe(before.householdName);
    expect(updated.rsvp).toEqual(before.rsvp);
    expect(updated.guests).toEqual(before.guests);
    expect(updated.commands).toEqual(before.commands);
    expect(updated.whatsappConversation).toEqual(before.whatsappConversation);

    // Other invitations are untouched
    const otherAfter = next.invitations.find((i) => i.invitationCode === otherBefore.invitationCode)!;
    expect(otherAfter).toEqual(otherBefore);
  });

  it("is a no-op when invitationCode is not in the store", () => {
    const initial = unloadedState();
    const next = apply(initial, {
      type: "whatsapp-invitation-refreshed",
      invitationCode: "UNKNOWN",
      flow: freshFlow
    });

    expect(next).toBe(initial);
  });

  it("preserves local phone update when local update timestamp is newer than refreshed flow", () => {
    const initial = unloadedState();
    const withLocalPhone = apply(initial, {
      type: "update-phone",
      invitationCode: "SW2748",
      phoneNumber: "5511911112222",
      now: "2026-08-20T16:00:00.000Z"
    });

    const olderServerFlow = {
      ...freshFlow,
      phoneNumber: "5511900000000",
      phoneNumberUpdatedAt: "2026-08-20T14:00:00.000Z"
    };

    const next = apply(withLocalPhone, {
      type: "whatsapp-invitation-refreshed",
      invitationCode: "SW2748",
      flow: olderServerFlow
    });

    const target = invitationOf(next, "SW2748");
    expect(target.phoneNumber).toBe("5511911112222");
    expect(target.phoneNumberSource).toBe("operator");
    expect(target.phoneNumberUpdatedAt).toBe("2026-08-20T16:00:00.000Z");
    // Non-phone flow fields still update from server
    expect(target.whatsappFlowStatus).toBe("message_sent");
  });

  it("preserves local flow mutations when local whatsappFlowUpdatedAt is newer than refreshed flow", () => {
    // The stamp is set on the snapshot rather than produced by a mutation: no reducer case writes
    // `whatsappFlowUpdatedAt` any more, but a snapshot can still carry one newer than a late
    // refresh, which is the race this branch exists to lose gracefully.
    const initial = unloadedState();
    const withLocalSend = apply(initial, {
      type: "replace-snapshot",
      snapshot: {
        ...initial,
        invitations: initial.invitations.map((invitation) =>
          invitation.invitationCode === "HL4120"
            ? {
                ...invitation,
                whatsappFlowStatus: "message_sent" as const,
                whatsappFlowUpdatedAt: "2026-08-20T16:00:00.000Z"
              }
            : invitation
        )
      }
    });
    const localStatus = invitationOf(withLocalSend, "HL4120").whatsappFlowStatus;

    const olderServerFlow = {
      ...freshFlow,
      whatsappFlowStatus: "idle" as const,
      whatsappFlowUpdatedAt: "2026-08-20T14:00:00.000Z"
    };

    const next = apply(withLocalSend, {
      type: "whatsapp-invitation-refreshed",
      invitationCode: "HL4120",
      flow: olderServerFlow
    });

    const target = invitationOf(next, "HL4120");
    expect(target.whatsappFlowStatus).toBe(localStatus);
    expect(target.whatsappFlowUpdatedAt).toBe("2026-08-20T16:00:00.000Z");
  });

  it("resets threadLoads and state on replace-snapshot", () => {
    const initial = unloadedState();
    const withRefreshed = apply(initial, {
      type: "whatsapp-invitation-refreshed",
      invitationCode: "SW2748",
      flow: freshFlow
    });

    const replaced = apply(withRefreshed, {
      type: "replace-snapshot",
      snapshot: initial
    });

    expect(replaced.threadLoads.SW2748).toEqual({ status: "unloaded" });
  });

  describe("count agreement across all six conversation states", () => {
    it("returns consistent response-needed counts in unloaded, loading, loaded-partial, loaded-complete, and error states", () => {
      // 1. Unloaded: reads dashboard summary (2 unread)
      const s1 = unloadedState();
      expect(s1.threadLoads.QP8814).toEqual({ status: "unloaded" });
      expect(unreadCount(s1, "QP8814")).toBe(2);

      // 2. Loading (first load in flight): still reads summary (2 unread)
      const s2 = apply(s1, {
        type: "thread-load-started",
        invitationCode: "QP8814",
        loadMore: false
      });
      expect(s2.threadLoads.QP8814).toEqual({ status: "loading", hasLoaded: false, nextCursor: null });
      expect(unreadCount(s2, "QP8814")).toBe(2);

      // 3. Loaded-partial (newest page in memory, older pages available): reads trailing inbound from thread (2 unread)
      const s3 = apply(s2, {
        type: "thread-load-succeeded",
        loadMore: false,
        page: {
          invitationCode: "QP8814",
          messages: [
            { messageId: "m3", direction: "outbound", sentAt: "2026-08-20T10:00:00Z", text: "Olá" },
            { messageId: "m4", direction: "inbound", sentAt: "2026-08-20T11:00:00Z", text: "Oi" },
            { messageId: "m5", direction: "inbound", sentAt: "2026-08-20T11:01:00Z", text: "Vou sim" }
          ],
          commands: [],
          nextCursor: "older-page"
        }
      });
      expect(s3.threadLoads.QP8814).toEqual({ status: "loaded", nextCursor: "older-page" });
      expect(unreadCount(s3, "QP8814")).toBe(2);

      // 4. Loaded-complete (all pages loaded, nextCursor is null): still 2 unread
      const s4 = apply(s3, {
        type: "thread-load-succeeded",
        loadMore: true,
        page: {
          invitationCode: "QP8814",
          messages: [
            { messageId: "m1", direction: "outbound", sentAt: "2026-08-19T10:00:00Z", text: "Convite" },
            { messageId: "m2", direction: "outbound", sentAt: "2026-08-19T11:00:00Z", text: "Lembrete" }
          ],
          commands: [],
          nextCursor: null
        }
      });
      expect(s4.threadLoads.QP8814).toEqual({ status: "loaded", nextCursor: null });
      expect(unreadCount(s4, "QP8814")).toBe(2);

      // 5. Error states:
      // 5a. First-load error (hasLoaded: false): retains summary count (2)
      const s5a = apply(s1, {
        type: "thread-load-started", invitationCode: "QP8814", loadMore: false
      }, {
        type: "thread-load-failed", invitationCode: "QP8814", loadMore: false
      });
      expect(s5a.threadLoads.QP8814).toEqual({ status: "error", hasLoaded: false, nextCursor: null });
      expect(unreadCount(s5a, "QP8814")).toBe(2);

      // 5b. Load-more error (hasLoaded: true): retains loaded thread count (2)
      const s5b = apply(s3, {
        type: "thread-load-started", invitationCode: "QP8814", loadMore: true
      }, {
        type: "thread-load-failed", invitationCode: "QP8814", loadMore: true
      });
      expect(s5b.threadLoads.QP8814).toEqual({ status: "error", hasLoaded: true, nextCursor: "older-page" });
      expect(unreadCount(s5b, "QP8814")).toBe(2);

      // 6. Opening the conversation does not change the response-needed count.
      expect(unreadCount(s3, "QP8814")).toBe(2);
    });
  });
});
