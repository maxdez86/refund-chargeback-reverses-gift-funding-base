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

describe("admin dashboard reducer", () => {
  it("confirms the selected guests and rolls the invitation RSVP up", () => {
    const next = apply(freshState(), {
      type: "confirm-guests",
      invitationCode: "LB6640",
      guestIds: ["LB6640--guest-01", "LB6640--guest-02"],
      now: NOW
    });
    const invitation = invitationOf(next, "LB6640");

    expect(invitation.guests.every((guest) => guest.rsvpStatus === "attending")).toBe(true);
    // Antônio is a criança, but nobody has answered the age question for him yet, so the
    // panel bills his seat until the guest confirms "6 anos ou menos" in the RSVP.
    expect(invitation.rsvp).toMatchObject({
      status: "attending",
      attending: 2,
      paid: 2,
      childrenSixOrYounger: 0
    });
    expect(invitation.whatsappFlowStatus).toBe("attendance_confirmed_whatsapp");
    expect(invitation.rsvp.submittedBy).toBe("LB6640--guest-01");
  });

  it("ignores a confirmation with nothing selected", () => {
    const state = freshState();
    expect(
      apply(state, { type: "confirm-guests", invitationCode: "LB6640", guestIds: [], now: NOW })
    ).toBe(state);
  });

  it("recalculates the roll-up when one guest changes status", () => {
    const next = apply(freshState(), {
      type: "set-guest-status",
      guestId: "HL4120--guest-02",
      status: "declined",
      now: NOW
    });
    const invitation = invitationOf(next, "HL4120");
    expect(invitation.rsvp).toMatchObject({
      status: "attending",
      attending: 3,
      paid: 2,
      childrenSixOrYounger: 1
    });
  });

  it("removes an accompanying guest and re-derives the RSVP", () => {
    const next = apply(freshState(), {
      type: "remove-guest",
      guestId: "HL4120--guest-04",
      now: NOW
    });
    const invitation = invitationOf(next, "HL4120");
    expect(invitation.guests.map((guest) => guest.guestId)).not.toContain("HL4120--guest-04");
    expect(invitation.rsvp).toMatchObject({ attending: 3, paid: 2, childrenSixOrYounger: 1 });
  });

  it("refuses to remove the primary guest, who answers for the invitation", () => {
    const state = freshState();
    expect(apply(state, { type: "remove-guest", guestId: "HL4120--guest-01", now: NOW })).toBe(state);
  });

  it("deletes an invitation together with its conversation", () => {
    const next = apply(freshState(), { type: "delete-invitation", invitationCode: "RQ7712" });
    expect(next.invitations.map((invitation) => invitation.invitationCode)).not.toContain("RQ7712");
    expect(next.threads.RQ7712).toBeUndefined();
  });

  it("creates an invitation at the top of the list with pending guests", () => {
    const next = apply(freshState(), {
      type: "create-invitation",
      invitationCode: " brx-014 ",
      householdName: " Família Moretti ",
      phoneNumber: "+55 (11) 91234-5678",
      guests: [
        { name: "Ana Moretti", isChild: false },
        { name: "Caio Moretti", isChild: false }
      ],
      now: NOW
    });
    const invitation = next.invitations[0];

    expect(invitation.invitationCode).toBe("BRX-014");
    expect(invitation.householdName).toBe("Família Moretti");
    expect(invitation.phoneNumber).toBe("5511912345678");
    expect(invitation.guests.map((guest) => guest.guestId)).toEqual([
      "BRX-014--guest-01",
      "BRX-014--guest-02"
    ]);
    expect(invitation.guests.every((guest) => guest.rsvpStatus === "pending")).toBe(true);
    expect(invitation.whatsappFlowStatus).toBe("idle");
    expect(invitation.commands).toEqual([]);
  });

  it("creates children with the seed flag only, trimming their names", () => {
    const next = apply(freshState(), {
      type: "create-invitation",
      invitationCode: "BRX-015",
      householdName: "Família Moretti",
      phoneNumber: "+55 (11) 91234-5678",
      guests: [
        { name: "Ana Moretti", isChild: false },
        { name: " Caio Moretti ", isChild: true }
      ],
      now: NOW
    });
    const guests = next.invitations[0].guests;

    expect(guests[0]).toMatchObject({ guestName: "Ana Moretti", isChild: false });
    expect(guests[1]).toMatchObject({ guestName: "Caio Moretti", isChild: true });
    // Neither one has answered the RSVP, so neither carries a confirmed age band.
    expect(guests.every((seat) => seat.isChildSixOrYounger === undefined)).toBe(true);
  });

  it("adds guests after the existing ones without inventing a courtesy", () => {
    const next = apply(freshState(), {
      type: "add-guests",
      invitationCode: "SW2748",
      rows: [{ name: " Pedro Ribeiro ", isChild: true }],
      now: NOW
    });
    const invitation = invitationOf(next, "SW2748");
    const added = invitation.guests[1];

    expect(added).toMatchObject({
      guestId: "SW2748--guest-02",
      guestName: "Pedro Ribeiro",
      isChild: true,
      rsvpStatus: "pending"
    });
    // The ≤6 answer belongs to the guest, so a freshly added criança has none.
    expect(added.isChildSixOrYounger).toBeUndefined();
    // Eugênia is still attending, so the invitation stays confirmed for one seat.
    expect(invitation.rsvp).toMatchObject({ status: "attending", attending: 1, paid: 1 });
  });

  it("seeds a guest as a criança without touching the paying seats", () => {
    const next = apply(freshState(), {
      type: "set-guest-child",
      guestId: "HL4120--guest-02",
      isChild: true,
      now: NOW
    });
    const invitation = invitationOf(next, "HL4120");

    expect(invitation.guests[1]).toMatchObject({ isChild: true, isChildSixOrYounger: false });
    // Paulo already answered "7 anos ou mais", so seeding the flag changes no count.
    expect(invitation.rsvp).toMatchObject({ attending: 4, paid: 3, childrenSixOrYounger: 1 });
  });

  it("discards the confirmed age band when the criança flag is cleared", () => {
    const next = apply(freshState(), {
      type: "set-guest-child",
      guestId: "HL4120--guest-03",
      isChild: false,
      now: NOW
    });
    const invitation = invitationOf(next, "HL4120");

    // Manuela's cortesia came from the age question that no longer applies to her.
    expect(invitation.guests[2]).toMatchObject({ isChild: false });
    expect(invitation.guests[2].isChildSixOrYounger).toBeUndefined();
    expect(invitation.rsvp).toMatchObject({ attending: 4, paid: 4, childrenSixOrYounger: 0 });
  });

  it("ignores a criança toggle for a guest that does not exist", () => {
    const state = freshState();
    expect(apply(state, { type: "set-guest-child", guestId: "nope", isChild: true, now: NOW })).toBe(
      state
    );
  });

  it("moves a fully declined invitation back to pending when a guest is added", () => {
    const next = apply(freshState(), {
      type: "add-guests",
      invitationCode: "RQ7712",
      rows: [{ name: "Bruna Queiroz", isChild: false }],
      now: NOW
    });
    expect(invitationOf(next, "RQ7712").rsvp.status).toBe("pending");
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

  it("queues a first send as a fresh opener attempt", () => {
    const state = adminDashboardReducer(freshState(), {
      type: "create-invitation",
      invitationCode: "NEW001",
      householdName: "Casa Nova",
      phoneNumber: "5511999999999",
      guests: [{ name: "Alguém", isChild: false }],
      now: NOW
    });
    const next = apply(state, {
      type: "queue-send",
      invitationCode: "NEW001",
      mode: "first",
      now: NOW
    });
    const invitation = invitationOf(next, "NEW001");

    expect(invitation.whatsappFlowStatus).toBe("send_queued");
    expect(invitation.commands[0]).toMatchObject({
      templateId: "wedding_invitation",
      stage: "pending",
      status: "queued",
      retryCount: 0
    });
  });

  it("counts a resend as another attempt on the same template", () => {
    const next = apply(freshState(), {
      type: "queue-send",
      invitationCode: "LB6640",
      mode: "resend",
      now: NOW
    });
    const invitation = invitationOf(next, "LB6640");
    // LB6640 failed, so the resend repeats the opener — one was already sent.
    expect(invitation.commands[0]).toMatchObject({
      templateId: "wedding_invitation",
      status: "queued",
      retryCount: 1,
      stage: "fallback"
    });
    expect(invitation.commands).toHaveLength(3);
  });

  it("toggles a guest message between the mural and the moderation queue", () => {
    const state = freshState();
    const id = state.guestMessages[0].messageId;
    const hidden = apply(state, { type: "toggle-message-hidden", messageId: id });
    expect(hidden.guestMessages[0].hidden).toBe(true);
    expect(apply(hidden, { type: "toggle-message-hidden", messageId: id }).guestMessages[0].hidden).toBe(
      false
    );
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

  it("appends an outbound reply and clears the response-needed count", () => {
    const next = apply(freshState(), {
      type: "send-chat",
      invitationCode: "QP8814",
      text: "  Oi Helena!  ",
      now: NOW
    });
    expect(next.threads.QP8814.at(-1)).toEqual({
      messageId: `local-QP8814-${NOW}`,
      direction: "outbound",
      sentAt: NOW,
      text: "Oi Helena!"
    });
    expect(unreadCount(next, "QP8814")).toBe(0);
  });

  it("ignores an empty reply", () => {
    const state = freshState();
    expect(
      apply(state, { type: "send-chat", invitationCode: "QP8814", text: "   ", now: NOW })
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
      type: "send-chat", invitationCode: "SW2748", text: "Resposta local", now: NOW
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
    const initial = unloadedState();
    const withLocalSend = apply(initial, {
      type: "queue-send",
      invitationCode: "SW2748",
      mode: "first",
      now: "2026-08-20T16:00:00.000Z"
    });

    const olderServerFlow = {
      ...freshFlow,
      whatsappFlowStatus: "idle" as const,
      whatsappFlowUpdatedAt: "2026-08-20T14:00:00.000Z"
    };

    const next = apply(withLocalSend, {
      type: "whatsapp-invitation-refreshed",
      invitationCode: "SW2748",
      flow: olderServerFlow
    });

    const target = invitationOf(next, "SW2748");
    expect(target.whatsappFlowStatus).toBe("send_queued");
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
