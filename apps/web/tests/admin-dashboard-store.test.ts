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

  it("clears the unread count once the thread is opened", () => {
    const next = apply(freshState(), { type: "open-chat", invitationCode: "QP8814" });
    expect(unreadCount(next, "QP8814")).toBe(0);
  });

  it("appends an outbound reply and marks the thread read", () => {
    const next = apply(freshState(), {
      type: "send-chat",
      invitationCode: "QP8814",
      text: "  Oi Helena!  ",
      now: NOW
    });
    expect(next.threads.QP8814.at(-1)).toEqual({
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

  it("replaces the whole snapshot on load", () => {
    const state = apply(freshState(), { type: "open-chat", invitationCode: "QP8814" });
    const reloaded = apply(state, {
      type: "replace-snapshot",
      snapshot: createFixtureDashboardSnapshot()
    });
    expect(reloaded.readChats).toEqual([]);
    expect(reloaded.invitations).toHaveLength(8);
  });
});
