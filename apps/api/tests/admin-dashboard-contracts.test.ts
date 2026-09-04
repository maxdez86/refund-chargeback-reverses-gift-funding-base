import { describe, expect, it } from "vitest";
import {
  AdminConfirmGuestsRequestSchema,
  AdminDashboardInvitationSchema,
  AdminDashboardResponseSchema,
  AdminDashboardWhatsappConversationSchema,
  AdminAddGuestsRequestSchema,
  AdminCreateInvitationRequestSchema,
  AdminDeleteInvitationResponseSchema,
  AdminGuestUpdateRequestSchema,
  AdminInvitationGuestInputSchema,
  AdminInvitationRsvpWriteResponseSchema
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

describe("admin guest write contracts", () => {
  it("accepts a single-field guest patch", () => {
    expect(AdminGuestUpdateRequestSchema.parse({ rsvpStatus: "attending" })).toEqual({
      rsvpStatus: "attending"
    });
    expect(AdminGuestUpdateRequestSchema.parse({ isChild: false })).toEqual({ isChild: false });
  });

  it("accepts the seed flag and the per-response age answer together", () => {
    const patch = { isChild: false, isChildSixOrYounger: false };
    expect(AdminGuestUpdateRequestSchema.parse(patch)).toEqual(patch);
  });

  it("rejects an empty guest patch", () => {
    expect(AdminGuestUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown guest patch fields", () => {
    expect(
      AdminGuestUpdateRequestSchema.safeParse({ rsvpStatus: "attending", guestName: "Amanda" })
        .success
    ).toBe(false);
  });

  it("rejects a guest patch that cannot express a status", () => {
    expect(AdminGuestUpdateRequestSchema.safeParse({ rsvpStatus: "maybe" }).success).toBe(false);
  });

  it("refuses to un-answer a guest", () => {
    expect(AdminGuestUpdateRequestSchema.safeParse({ rsvpStatus: "pending" }).success).toBe(false);
    expect(AdminGuestUpdateRequestSchema.parse({ rsvpStatus: "declined" })).toEqual({
      rsvpStatus: "declined"
    });
  });

  it("requires at least one guest id to confirm", () => {
    expect(AdminConfirmGuestsRequestSchema.parse({ guestIds: ["guest-1"] })).toEqual({
      guestIds: ["guest-1"]
    });
    expect(AdminConfirmGuestsRequestSchema.safeParse({ guestIds: [] }).success).toBe(false);
    expect(AdminConfirmGuestsRequestSchema.safeParse({ guestIds: [""] }).success).toBe(false);
  });

  it("accepts the reconciliation payload both writes answer with", () => {
    const response = {
      ok: true as const,
      invitationCode: "AB2345",
      guests: [
        {
          guestId: "guest-1",
          guestName: "Amanda",
          allowedPlusOnes: 0,
          rsvpStatus: "attending" as const,
          isChild: true,
          isChildSixOrYounger: true
        }
      ],
      rsvp: {
        status: "attending" as const,
        updatedAt: "2026-08-20T12:00:00.000Z",
        submittedBy: "guest-1",
        attending: 1,
        paid: 0,
        childrenSixOrYounger: 1
      },
      updatedAt: "2026-08-20T12:00:00.000Z"
    };

    expect(AdminInvitationRsvpWriteResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects a reconciliation payload with no guests or a non-ISO timestamp", () => {
    const base = {
      ok: true as const,
      invitationCode: "AB2345",
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
      },
      updatedAt: "2026-08-20T12:00:00.000Z"
    };

    expect(AdminInvitationRsvpWriteResponseSchema.safeParse({ ...base, guests: [] }).success).toBe(
      false
    );
    expect(
      AdminInvitationRsvpWriteResponseSchema.safeParse({ ...base, updatedAt: "2026-08-20" }).success
    ).toBe(false);
  });
});

describe("AdminInvitationGuestInputSchema", () => {
  it("accepts the two fields an operator actually supplies", () => {
    expect(AdminInvitationGuestInputSchema.parse({ guestName: "Duda", isChild: true })).toEqual({
      guestName: "Duda",
      isChild: true
    });
  });

  it("rejects a client that tries to choose the slot or the guest id", () => {
    // The server derives both from max(sortOrder) + 1, so a client-sent value has to be a 400
    // rather than a field that is silently ignored.
    expect(AdminInvitationGuestInputSchema.safeParse({ guestName: "Duda", slot: 3 }).success).toBe(
      false
    );
    expect(
      AdminInvitationGuestInputSchema.safeParse({ guestName: "Duda", guestId: "AB2345--guest-03" })
        .success
    ).toBe(false);
  });

  it("rejects a blank name", () => {
    expect(AdminInvitationGuestInputSchema.safeParse({ guestName: "   " }).success).toBe(false);
  });
});

describe("AdminCreateInvitationRequestSchema", () => {
  const base = {
    invitationCode: "AB2345",
    householdName: "Amanda e Chris",
    guests: [{ guestName: "Amanda" }]
  };

  it("accepts a well-formed request with and without a phone number", () => {
    expect(AdminCreateInvitationRequestSchema.safeParse(base).success).toBe(true);
    expect(
      AdminCreateInvitationRequestSchema.safeParse({ ...base, phoneNumber: "5511999998888" }).success
    ).toBe(true);
  });

  it("rejects codes outside the unambiguous invitation-code alphabet", () => {
    // The format is two letters from A-HJ-NP-Z then four digits 2-9: no I, O, 0 or 1, and never
    // lower case or a separator.
    for (const invitationCode of ["brx-014", "BRX-014", "AB2345 ", "IO2345", "AB1234", "AB234"]) {
      expect(AdminCreateInvitationRequestSchema.safeParse({ ...base, invitationCode }).success).toBe(
        false
      );
    }
  });

  it("requires at least one guest and rejects unknown fields", () => {
    expect(AdminCreateInvitationRequestSchema.safeParse({ ...base, guests: [] }).success).toBe(false);
    expect(
      AdminCreateInvitationRequestSchema.safeParse({ ...base, whatsappFlowStatus: "idle" }).success
    ).toBe(false);
  });
});

describe("AdminAddGuestsRequestSchema", () => {
  it("requires at least one guest", () => {
    expect(AdminAddGuestsRequestSchema.safeParse({ guests: [] }).success).toBe(false);
    expect(AdminAddGuestsRequestSchema.safeParse({ guests: [{ guestName: "Duda" }] }).success).toBe(
      true
    );
  });
});

describe("AdminDeleteInvitationResponseSchema", () => {
  const base = {
    ok: true as const,
    invitationCode: "AB2345",
    deletedAt: "2026-08-20T12:00:00.000Z",
    deleted: { guests: 2, rsvp: 1, whatsappItems: 7, phoneLookups: 0 }
  };

  it("round-trips a cascade report", () => {
    expect(AdminDeleteInvitationResponseSchema.parse(base)).toEqual(base);
  });

  it("rejects counts that cannot describe a single invitation", () => {
    // There is exactly one RSVP item and at most one current phone lookup per invitation.
    expect(
      AdminDeleteInvitationResponseSchema.safeParse({
        ...base,
        deleted: { ...base.deleted, rsvp: 2 }
      }).success
    ).toBe(false);
    expect(
      AdminDeleteInvitationResponseSchema.safeParse({
        ...base,
        deleted: { ...base.deleted, extra: 1 }
      }).success
    ).toBe(false);
  });
});
