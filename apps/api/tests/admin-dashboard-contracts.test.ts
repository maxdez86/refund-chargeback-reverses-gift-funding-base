import { describe, expect, it } from "vitest";
import {
  AdminDashboardInvitationSchema,
  AdminDashboardResponseSchema,
  AdminDashboardWhatsappConversationSchema
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
  whatsappSendAvailability: { firstAllowed: false, resendAllowed: false },
  whatsappFreeTextWindow: { open: false },
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
  },
  whatsappConversation: {
    messageCount: 4,
    unreadCount: 2,
    lastMessageAt: "2026-08-20T12:05:00.000Z",
    lastMessageDirection: "inbound" as const,
    lastMessageType: "text" as const,
    lastMessagePreview: "Vamos sim!"
  }
};

const conversation = {
  messageCount: 3,
  unreadCount: 1,
  lastMessageAt: "2026-08-20T12:05:00.000Z",
  lastMessageDirection: "inbound" as const
};

describe("admin dashboard contracts", () => {
  it("accepts a complete persisted operational invitation", () => {
    expect(AdminDashboardInvitationSchema.parse(completeInvitation)).toEqual(completeInvitation);
  });

  it("accepts an invitation without RSVP or operational metadata", () => {
    const invitation = {
      invitationCode: "CD6789",
      householdName: "Família Silva",
      whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
      whatsappFreeTextWindow: { open: false },
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

  it("omits the conversation summary for an invitation without one", () => {
    const invitation = {
      invitationCode: "EF7893",
      householdName: "Família Souza",
      whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
      whatsappFreeTextWindow: { open: false },
      guests: [{
        guestId: "guest-3",
        guestName: "Duda",
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

    const parsed = AdminDashboardInvitationSchema.parse(invitation);
    expect(parsed).toEqual(invitation);
    expect("whatsappConversation" in parsed).toBe(false);
  });

  describe("whatsapp conversation summary", () => {
    it("accepts a minimal summary and a fully populated one", () => {
      expect(AdminDashboardWhatsappConversationSchema.parse(conversation)).toEqual(conversation);

      const populated = {
        ...conversation,
        lastMessageDirection: "outbound" as const,
        lastMessageType: "template" as const,
        lastMessageTemplateId: "wedding_invitation",
        lastMessagePreview: "Olá! Confirma presença?",
        lastOutboundMessageTemplateId: "wedding_invitation",
        lastOutboundMessagePreview: "Olá! Confirma presença?",
        lastInboundMessagePreview: "Vamos sim!",
        unreadCount: 0
      };
      expect(AdminDashboardWhatsappConversationSchema.parse(populated)).toEqual(populated);
    });

    it.each([
      ["a zero messageCount", { ...conversation, messageCount: 0, unreadCount: 0 }],
      ["a negative messageCount", { ...conversation, messageCount: -1, unreadCount: 0 }],
      ["a fractional messageCount", { ...conversation, messageCount: 1.5, unreadCount: 0 }],
      ["a negative unreadCount", { ...conversation, unreadCount: -1 }],
      ["an unreadCount above messageCount", { ...conversation, unreadCount: 4 }],
      ["an unknown key", { ...conversation, lastMessageBody: "leaked" }],
      ["a non-datetime lastMessageAt", { ...conversation, lastMessageAt: "2026-08-20" }],
      ["an unknown direction", { ...conversation, lastMessageDirection: "sideways" }],
      ["an unknown message type", { ...conversation, lastMessageType: "hologram" }],
      ["an empty preview", { ...conversation, lastMessagePreview: "" }],
      ["an empty template id", { ...conversation, lastMessageTemplateId: "" }],
      ["an empty outbound preview", { ...conversation, lastOutboundMessagePreview: "" }],
      ["an empty inbound preview", { ...conversation, lastInboundMessagePreview: "" }],
      ["an empty outbound template id", { ...conversation, lastOutboundMessageTemplateId: "" }],
      ["an empty inbound template id", { ...conversation, lastInboundMessageTemplateId: "" }]
    ])("rejects %s", (_label, value) => {
      expect(() => AdminDashboardWhatsappConversationSchema.parse(value)).toThrow();
    });

    it("accepts an unreadCount equal to messageCount", () => {
      expect(
        AdminDashboardWhatsappConversationSchema.parse({ ...conversation, unreadCount: 3 }).unreadCount
      ).toBe(3);
    });

    it("accepts a preview at the 160-character boundary and rejects one character more", () => {
      const atBoundary = "a".repeat(160);
      expect(
        AdminDashboardWhatsappConversationSchema.parse({
          ...conversation,
          lastMessagePreview: atBoundary
        }).lastMessagePreview
      ).toBe(atBoundary);

      expect(() => AdminDashboardWhatsappConversationSchema.parse({
        ...conversation,
        lastMessagePreview: "a".repeat(161)
      })).toThrow();

      expect(AdminDashboardWhatsappConversationSchema.parse({
        ...conversation,
        lastOutboundMessagePreview: atBoundary,
        lastInboundMessagePreview: atBoundary
      })).toMatchObject({
        lastOutboundMessagePreview: atBoundary,
        lastInboundMessagePreview: atBoundary
      });

      expect(() => AdminDashboardWhatsappConversationSchema.parse({
        ...conversation,
        lastInboundMessagePreview: "a".repeat(161)
      })).toThrow();
    });

    it("rejects a template id one character past the 256 bound", () => {
      expect(AdminDashboardWhatsappConversationSchema.parse({
        ...conversation,
        lastMessageTemplateId: "t".repeat(256)
      }).lastMessageTemplateId).toHaveLength(256);

      expect(() => AdminDashboardWhatsappConversationSchema.parse({
        ...conversation,
        lastMessageTemplateId: "t".repeat(257)
      })).toThrow();
    });
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

  it("parses a pre-rework dashboard response where all added WhatsApp fields are absent", () => {
    const legacyDashboard = {
      ok: true as const,
      invitations: [
        {
          invitationCode: "AB2345",
          householdName: "Amanda e Chris",
          whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
          whatsappFreeTextWindow: { open: false },
          guests: [
            {
              guestId: "guest-1",
              guestName: "Amanda",
              allowedPlusOnes: 0,
              rsvpStatus: "pending" as const
            }
          ],
          rsvp: {
            status: "pending" as const,
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

    const parsed = AdminDashboardResponseSchema.parse(legacyDashboard);
    expect(parsed).toEqual(legacyDashboard);
    const parsedInvitation = parsed.invitations[0]!;
    expect(parsedInvitation.whatsappConversation).toBeUndefined();
    expect(parsedInvitation.whatsappFlowStatus).toBeUndefined();
    expect(parsedInvitation.phoneNumber).toBeUndefined();
  });
});
