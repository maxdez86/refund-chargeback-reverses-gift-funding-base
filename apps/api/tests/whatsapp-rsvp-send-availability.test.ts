import { describe, expect, it } from "vitest";
import type { HouseholdInvitation } from "@brimax/contracts";
import { deriveWhatsappRsvpSendAvailability } from "../src/domain/whatsapp-rsvp-send-availability";

const invitation: HouseholdInvitation = {
  invitationCode: "AE8546",
  householdName: "Família Teste",
  whatsappFlowStatus: "completed",
  whatsappFlowCompletedAt: "2026-08-26T16:54:07.954Z",
  guests: [
    { guestId: "g1", guestName: "Pessoa 1", allowedPlusOnes: 0, rsvpStatus: "pending" },
    { guestId: "g2", guestName: "Pessoa 2", allowedPlusOnes: 0, rsvpStatus: "pending" }
  ]
};

describe("deriveWhatsappRsvpSendAvailability", () => {
  it("allows completed journeys while every guest remains pending", () => {
    expect(deriveWhatsappRsvpSendAvailability(invitation)).toEqual({
      firstAllowed: false,
      resendAllowed: true,
      resendReason: "completed_pending"
    });
  });

  it.each(["attending", "declined"] as const)("blocks a completed journey with a %s guest", (rsvpStatus) => {
    expect(deriveWhatsappRsvpSendAvailability({
      ...invitation,
      guests: [{ ...invitation.guests[0]!, rsvpStatus }]
    }).resendAllowed).toBe(false);
  });

  it("blocks a completed journey with decisive WhatsApp attendance", () => {
    expect(deriveWhatsappRsvpSendAvailability({
      ...invitation,
      whatsappAttendance: [{ guestId: "g1", status: "attending", recordedAt: "2026-08-26T16:54:07.000Z" }]
    }).resendAllowed).toBe(false);
  });

  it("preserves first, failed, undecided, active, and reconciliation rules", () => {
    expect(deriveWhatsappRsvpSendAvailability({ ...invitation, whatsappFlowStatus: "idle", whatsappFlowCompletedAt: undefined })).toEqual({ firstAllowed: true, resendAllowed: false });
    expect(deriveWhatsappRsvpSendAvailability({ ...invitation, whatsappFlowStatus: "failed", whatsappFlowCompletedAt: undefined }).resendReason).toBe("failed");
    expect(deriveWhatsappRsvpSendAvailability({ ...invitation, whatsappFlowStatus: "undecided", whatsappFlowCompletedAt: undefined }).resendReason).toBe("undecided");
    expect(deriveWhatsappRsvpSendAvailability({ ...invitation, whatsappFlowStatus: "message_sent", whatsappFlowCompletedAt: undefined }).resendAllowed).toBe(false);
    expect(deriveWhatsappRsvpSendAvailability({ ...invitation, whatsappFlowStatus: "reconciliation_required", whatsappFlowCompletedAt: undefined }).resendAllowed).toBe(false);
  });
});
