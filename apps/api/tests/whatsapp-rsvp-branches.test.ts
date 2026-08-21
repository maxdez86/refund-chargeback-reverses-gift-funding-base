import { describe, expect, it } from "vitest";
import { decideWhatsappRsvpBranch } from "../src/domain/whatsapp-rsvp-branches";
import { actionForButtonId } from "../src/services/whatsapp/template-manifest";

const pendingInvitation = {
  invitationCode: "SW2748",
  householdName: "Household",
  guests: [
    { guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "pending" as const },
    { guestId: "g2", guestName: "Bruno", allowedPlusOnes: 0, rsvpStatus: "pending" as const }
  ]
};

const confirmedInvitation = {
  ...pendingInvitation,
  guests: pendingInvitation.guests.map((guest, index) => ({
    ...guest,
    rsvpStatus: index === 0 ? "attending" as const : "declined" as const
  }))
};

const singlePendingInvitation = {
  ...pendingInvitation,
  guests: [pendingInvitation.guests[0]!]
};

const singleConfirmedInvitation = {
  ...singlePendingInvitation,
  guests: [{ ...singlePendingInvitation.guests[0]!, rsvpStatus: "attending" as const }]
};

describe("WhatsApp RSVP branch orchestration", () => {
  it.each([
    ["rsvp_a1_confirm_all", "confirm_all", "attendance_confirmed_whatsapp", "wedding_rsvp_attending_followup"],
    ["rsvp_b2_decline", "decline", "attendance_declined", "wedding_rsvp_declined_followup"],
    ["rsvp_b3_undecided", "undecided", "undecided", "wedding_rsvp_undecided_followup"]
  ] as const)("routes the exact manifest id %s", (buttonId, action, status, templateId) => {
    expect(actionForButtonId(buttonId)).toBe(action);
    const invitation = action === "confirm_all" ? confirmedInvitation : pendingInvitation;
    expect(decideWhatsappRsvpBranch(invitation, buttonId, "message_sent")).toEqual({
      kind: "branch", action, status, templateId
    });
  });

  it.each([
    ["rsvp_single_a1_confirm_all", "confirm_all", "attendance_confirmed_whatsapp", "wedding_rsvp_attending_followup_single", singleConfirmedInvitation],
    ["rsvp_single_b2_decline", "decline", "attendance_declined", "wedding_rsvp_declined_followup_single", singlePendingInvitation],
    ["rsvp_single_b3_undecided", "undecided", "undecided", "wedding_rsvp_undecided_followup_single", singlePendingInvitation]
  ] as const)("routes %s to the single variant", (buttonId, action, status, templateId, invitation) => {
    expect(actionForButtonId(buttonId)).toBe(action);
    expect(decideWhatsappRsvpBranch(invitation, buttonId, "message_sent")).toEqual({
      kind: "branch", action, status, templateId
    });
  });

  it.each(["not_attending", "RSVP_B2_DECLINE", "unmapped", undefined])(
    "never routes unsupported payload %s by substring or case folding",
    (buttonId) => {
      expect(decideWhatsappRsvpBranch(pendingInvitation, buttonId, "message_sent")).toEqual({ kind: "fallback" });
    }
  );

  it.each(["rsvp_b2_decline", "rsvp_b3_undecided"] as const)(
    "records a website-confirmed %s as a conflict rather than rerouting",
    (buttonId) => {
      expect(decideWhatsappRsvpBranch(confirmedInvitation, buttonId, "message_sent")).toEqual({
        kind: "rejected", reason: "consistency_conflict"
      });
    }
  );

  it.each([
    "rsvp_a1_confirm_all",
    "rsvp_b2_decline",
    "rsvp_b3_undecided"
  ] as const)("rejects action buttons after a terminal outcome: %s", (buttonId) => {
    const invitation = buttonId === "rsvp_a1_confirm_all" ? confirmedInvitation : pendingInvitation;
    expect(decideWhatsappRsvpBranch(invitation, buttonId, "completed"))
      .toEqual({ kind: "rejected", reason: "terminal_flow" });
    expect(decideWhatsappRsvpBranch(invitation, buttonId, "website_update_required"))
      .toEqual({ kind: "rejected", reason: "terminal_flow" });
  });

  it("rejects action buttons after an intermediate outcome without reopening it", () => {
    expect(decideWhatsappRsvpBranch(pendingInvitation, "rsvp_b2_decline", "attendance_confirmed_whatsapp"))
      .toEqual({ kind: "rejected", reason: "invalid_transition" });
    expect(decideWhatsappRsvpBranch(confirmedInvitation, "rsvp_b2_decline", "website_followup_pending"))
      .toEqual({ kind: "rejected", reason: "invalid_transition" });
  });

  it.each([
    "completed",
    "attendance_confirmed_whatsapp",
    "attendance_declined",
    "website_followup_pending",
    "website_update_required",
    "undecided",
    "failed",
    "reconciliation_required"
  ] as const)("routes free text and unmapped payloads to fallback even if flow is terminal (%s)", (terminalStatus) => {
    expect(decideWhatsappRsvpBranch(pendingInvitation, undefined, terminalStatus))
      .toEqual({ kind: "fallback" });
    expect(decideWhatsappRsvpBranch(pendingInvitation, "unmapped_text", terminalStatus))
      .toEqual({ kind: "fallback" });
  });

  it("does not interpret free text as a branch action", () => {
    expect(decideWhatsappRsvpBranch(pendingInvitation, undefined, "response_received"))
      .toEqual({ kind: "fallback" });
  });
});
