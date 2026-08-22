import { describe, expect, it } from "vitest";
import {
  AdminDashboardInvitationSchema,
  AdminDashboardResponseSchema
} from "@brimax/contracts";

const completeInvitation = {
  invitationCode: "AB2345",
  householdName: "Amanda e Chris",
  phoneNumber: "5511963656517",
  phoneNumberSource: "operator" as const,
  phoneNumberUpdatedAt: "2026-08-20T12:00:00.000Z",
  whatsappFlowStatus: "completed" as const,
  whatsappFlowStage: "followup" as const,
  whatsappFlowUpdatedAt: "2026-08-20T12:01:00.000Z",
  whatsappFlowCompletedAt: "2026-08-20T12:02:00.000Z",
  whatsappFallbackSentAt: "2026-08-20T12:03:00.000Z",
  whatsappLastInboundMessageId: "wamid.in",
  whatsappLastOutboundMessageId: "wamid.out",
  whatsappFailureReason: "Previous attempt failed.",
  guests: [
    {
      guestId: "guest-1",
      guestName: "Amanda",
      allowedPlusOnes: 0,
      rsvpStatus: "attending" as const,
      isChild: true,
      isChildSixOrYounger: true,
      dietaryNotes: "Sem lactose"
    }
  ],
  rsvp: {
    status: "attending" as const,
    updatedAt: "2026-08-20T12:00:00.000Z",
    submittedBy: "guest-1",
    attending: 1,
    paid: 0,
    childrenSixOrYounger: 1,
    note: "Música sugerida: Dreams"
  }
};

describe("admin dashboard contracts", () => {
  it("accepts a complete persisted operational invitation", () => {
    expect(AdminDashboardInvitationSchema.parse(completeInvitation)).toEqual(completeInvitation);
  });

  it("accepts an invitation without RSVP or operational metadata", () => {
    const invitation = {
      invitationCode: "CD6789",
      householdName: "Família Silva",
      guests: [{
        guestId: "guest-2",
        guestName: "Carlos",
        allowedPlusOnes: 0,
        rsvpStatus: "pending" as const
      }],
      rsvp: {
        status: "pending" as const,
        updatedAt: null,
        submittedBy: null,
        attending: 0,
        paid: 0,
        childrenSixOrYounger: 0
      }
    };

    expect(AdminDashboardInvitationSchema.parse(invitation)).toEqual(invitation);
  });

  it.each([
    ["DynamoDB keys", { ...completeInvitation, PK: "INVITATION#AB2345" }],
    ["WhatsApp timeline", { ...completeInvitation, commands: [] }],
    ["internal RSVP fields", {
      ...completeInvitation,
      rsvp: { ...completeInvitation.rsvp, websitePayloadDigest: "secret" }
    }],
    ["guest internals", {
      ...completeInvitation,
      guests: [{ ...completeInvitation.guests[0], SK: "GUEST#guest-1" }]
    }]
  ])("rejects %s", (_label, invitation) => {
    expect(() => AdminDashboardInvitationSchema.parse(invitation)).toThrow();
  });

  it("rejects top-level, gift-only, and guest-message fixture fields", () => {
    expect(() => AdminDashboardResponseSchema.parse({
      ok: true,
      invitations: [],
      gifts: [],
      guestMessages: [],
      threads: {}
    })).toThrow();

    expect(() => AdminDashboardResponseSchema.parse({
      ok: true,
      invitations: [],
      gifts: [{
        id: "gift-1",
        name: "Gift",
        image: "/gift.webp",
        fractional: false,
        totalValueCents: 10000,
        partValueCents: null,
        totalParts: null,
        finalPartValueCents: null,
        fundingModelVersion: "LEGACY_FIXED_50",
        partsFunded: 0,
        partsReserved: 0,
        confirmedAmountCents: 0,
        reservedAmountCents: 0,
        availableAmountCents: 10000,
        availableParts: 1,
        fullyFunded: false,
        updatedAt: null,
        paused: true
      }],
      guestMessages: []
    })).toThrow();

    expect(() => AdminDashboardResponseSchema.parse({
      ok: true,
      invitations: [],
      gifts: [],
      guestMessages: [{
        messageId: "message-1",
        authorName: "Ana",
        message: "Parabéns!",
        createdAt: "2026-08-20T12:00:00.000Z",
        hidden: true
      }]
    })).toThrow();
  });
});
