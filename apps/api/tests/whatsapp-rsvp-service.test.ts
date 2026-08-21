import { describe, expect, it, vi } from "vitest";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { WhatsappPhoneUpdateRequestSchema } from "@brimax/contracts";
import { WhatsappRsvpService, normalizeWhatsappPhone, WHATSAPP_FALLBACK_TEXT } from "../src/domain/whatsapp-rsvp-service";

describe("WhatsApp RSVP service", () => {
  it("normalizes formatted Brazilian numbers and rejects invalid values", () => {
    expect(normalizeWhatsappPhone("+55 (11) 96365-6517")).toBe("5511963656517");
    expect(normalizeWhatsappPhone("11963656517")).toBe("11963656517");
    expect(normalizeWhatsappPhone("+1 202-555-0100")).toBe("12025550100");
    expect(() => normalizeWhatsappPhone("123")).toThrow("Invalid WhatsApp phone");
    expect(() => normalizeWhatsappPhone("55119abc6517")).toThrow("Invalid WhatsApp phone");
    expect(() => normalizeWhatsappPhone("+55 11 96365-6517 ramal 22")).toThrow("Invalid WhatsApp phone");
    expect(() => normalizeWhatsappPhone("012345678")).toThrow("Invalid WhatsApp phone");
    expect(() => normalizeWhatsappPhone("1234567890123456")).toThrow("Invalid WhatsApp phone");
  });

  it("validates formatted operator input at the contract boundary", () => {
    expect(WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber: "+55 (11) 96365-6517" })).toEqual({
      phoneNumber: "+55 (11) 96365-6517"
    });
    expect(() => WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber: "abcdefgh" })).toThrow();
    expect(() => WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber: "" })).toThrow();
    expect(() => WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber: "+55 11 96365-6517 ramal 22" })).toThrow();
  });

  it("returns the normalized phone and persistence timestamp", async () => {
    const updateInvitationWhatsappPhone = vi.fn().mockResolvedValue("2026-08-17T12:00:00.000Z");
    const service = new WhatsappRsvpService(
      { updateInvitationWhatsappPhone } as never,
      {} as never,
      {} as never
    );

    await expect(service.updatePhone("SW2748", "+55 (11) 96365-6517")).resolves.toEqual({
      invitationCode: "SW2748",
      phoneNumber: "5511963656517",
      updatedAt: "2026-08-17T12:00:00.000Z"
    });
    expect(updateInvitationWhatsappPhone).toHaveBeenCalledOnce();
    expect(updateInvitationWhatsappPhone).toHaveBeenCalledWith("SW2748", "5511963656517");
  });

  it("registers exactly one lookup row, keyed by the number as stored", async () => {
    const putWhatsappInvitationPhoneLookup = vi.fn().mockResolvedValue(undefined);
    const service = new WhatsappRsvpService(
      {
        updateInvitationWhatsappPhone: vi.fn().mockResolvedValue("2026-08-17T12:00:00.000Z"),
        putWhatsappInvitationPhoneLookup
      } as never,
      {} as never,
      {} as never
    );

    await service.updatePhone("SW2748", "+55 (11) 96365-6517");

    // The ninth-digit alias ("551163656517") must never be written alongside the canonical number.
    expect(putWhatsappInvitationPhoneLookup).toHaveBeenCalledOnce();
    expect(putWhatsappInvitationPhoneLookup).toHaveBeenCalledWith("5511963656517", "SW2748");
  });

  it("writes one lookup row for a guest outside Brazil", async () => {
    const putWhatsappInvitationPhoneLookup = vi.fn().mockResolvedValue(undefined);
    const service = new WhatsappRsvpService(
      {
        updateInvitationWhatsappPhone: vi.fn().mockResolvedValue("2026-08-17T12:00:00.000Z"),
        putWhatsappInvitationPhoneLookup
      } as never,
      {} as never,
      {} as never
    );

    await service.updatePhone("SW2748", "+66 81 234 5678");

    expect(putWhatsappInvitationPhoneLookup).toHaveBeenCalledOnce();
    expect(putWhatsappInvitationPhoneLookup).toHaveBeenCalledWith("66812345678", "SW2748");
  });

  it("keeps the agreed fallback text stable", () => {
    expect(WHATSAPP_FALLBACK_TEXT).toContain("casamento@brimax.life");
  });

  it("projects status with paginated metadata-only conversation history", async () => {
    const repository = {
      getInvitationWhatsappStatus: vi.fn().mockResolvedValue({
        invitationCode: "SW2748", status: "message_sent", phoneNumber: "5511963656517"
      }),
      listWhatsappConversation: vi.fn().mockResolvedValue({
        entries: [
          {
            entityType: "WhatsappMessage", messageId: "wamid.1", invitationCode: "SW2748",
            direction: "outbound", status: "sent", createdAt: "2026-08-17T12:00:00.000Z",
            body: "private message", recipientPhone: "5511963656517"
          }
        ],
        nextCursor: "next-1"
      })
    };
    const service = new WhatsappRsvpService(repository as never, {
      getActive: vi.fn().mockResolvedValue({ version: 1 })
    } as never, {} as never);

    await expect(service.getStatus("SW2748", { limit: 10, cursor: "cursor-1" })).resolves.toEqual({
      invitationCode: "SW2748", status: "message_sent", phoneNumber: "5511963656517",
      history: [{
        kind: "message", id: "wamid.1", direction: "outbound", status: "sent",
        createdAt: "2026-08-17T12:00:00.000Z", providerMessageId: "wamid.1"
      }],
      nextCursor: "next-1"
    });
    expect(repository.listWhatsappConversation).toHaveBeenCalledWith("SW2748", { limit: 10, cursor: "cursor-1" });
  });

  it("returns a safe command projection and reports a missing command", async () => {
    const repository = {
      getWhatsappCommand: vi.fn().mockResolvedValue({
        commandId: "cmd-1", invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder_group",
        templateVersion: 2, status: "reconciliation_required", retryCount: 3,
        reconciliationStatus: "required", failureReason: "ambiguous provider outcome",
        createdAt: "2026-08-17T12:00:00.000Z"
      })
    };
    const service = new WhatsappRsvpService(repository as never, {
      getActive: vi.fn().mockResolvedValue({ version: 1 })
    } as never, {} as never);
    await expect(service.getCommandStatus("cmd-1")).resolves.toMatchObject({
      commandId: "cmd-1", status: "reconciliation_required", retryCount: 3,
      reconciliationStatus: "required"
    });
    repository.getWhatsappCommand.mockResolvedValue(undefined);
    await expect(service.getCommandStatus("cmd-1")).rejects.toMatchObject({ statusCode: 404, code: "COMMAND_NOT_FOUND" });
  });

  it("returns a complete replay response for an identical idempotent send", async () => {
    const invitation = {
      invitationCode: "SW2748", householdName: "Household", phoneNumber: "5511963656517",
      whatsappFlowStatus: "idle" as const,
      guests: [{ guestId: "g1", guestName: "Guest", allowedPlusOnes: 0, rsvpStatus: "pending" as const }]
    };
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      createWhatsappCommand: vi.fn().mockRejectedValue({ name: "ConditionalCheckFailedException" }),
      getWhatsappCommand: vi.fn().mockResolvedValue({
        commandId: "idempotency-SW2748-key12345", invitationCode: "SW2748",
        templateId: "wedding_rsvp_pending_reminder_group", templateVersion: 3, status: "sent"
      })
    };
    const templates = { getActive: vi.fn().mockResolvedValue({ version: 3 }) };
    const service = new WhatsappRsvpService(repository as never, templates as never, {} as never);

    await expect(service.queueTemplate("SW2748", "wedding_rsvp_pending_reminder_group", "key12345")).resolves.toEqual({
      commandId: "idempotency-SW2748-key12345",
      invitationCode: "SW2748",
      templateId: "wedding_rsvp_pending_reminder_group",
      templateVersion: 3,
      status: "sent",
      replayed: true
    });
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({
        invitationCode: "SW2748", householdName: "Household", phoneNumber: "5511963656517",
        whatsappFlowStatus: "idle", guests: [{ guestId: "g1", guestName: "Guest", allowedPlusOnes: 0, rsvpStatus: "pending" }]
      }),
      createWhatsappCommand: vi.fn().mockRejectedValue({ name: "ConditionalCheckFailedException" }),
      getWhatsappCommand: vi.fn().mockResolvedValue({
        commandId: "idempotency-SW2748-key12345", invitationCode: "SW2748",
        templateId: "wedding_rsvp_other", templateVersion: 1, status: "sent"
      })
    };
    const service = new WhatsappRsvpService(
      repository as never,
      { getActive: vi.fn().mockResolvedValue({ version: 3 }) } as never,
      {} as never
    );

    await expect(service.queueTemplate("SW2748", "wedding_rsvp_pending_reminder_group", "key12345")).rejects.toMatchObject({
      statusCode: 409,
      code: "IDEMPOTENCY_CONFLICT"
    });
  });

  it("queues fallback text without mutating an already completed RSVP flow", async () => {
    const invitation = {
      invitationCode: "SW2748",
      householdName: "Família Silva",
      phoneNumber: "5511963656517",
      whatsappFlowStatus: "completed" as const,
      whatsappFlowCompletedAt: "2026-08-17T12:00:00.000Z",
      guests: [
        { guestId: "g1", guestName: "Silva 1", allowedPlusOnes: 0, rsvpStatus: "attending" as const }
      ]
    };
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(true),
      getWhatsappMessage: vi.fn().mockResolvedValue(undefined),
      getInvitationsByWhatsappPhone: vi.fn().mockResolvedValue(["SW2748"]),
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      putWhatsappMessage: vi.fn().mockResolvedValue({ created: true }),
      updateWhatsappFlow: vi.fn().mockResolvedValue(undefined),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      createWhatsappCommand: vi.fn().mockResolvedValue(undefined)
    };
    const service = new WhatsappRsvpService(repository as never, {} as never, {} as never);
    const queueFallbackSpy = vi.spyOn(service, "queueFallbackText").mockResolvedValue("cmd-fallback" as never);

    const result = await service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.free_text_1",
      type: "text",
      messageId: "wamid.free_text_1",
      senderWaId: "5511963656517",
      body: "Olá, tenho uma dúvida sobre o local",
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "req-2");

    expect(result).toEqual({ outcome: "processed" });
    expect(repository.updateWhatsappFlow).not.toHaveBeenCalled();
    expect(queueFallbackSpy).toHaveBeenCalledWith("SW2748", "whatsapp:message:wamid.free_text_1");
    // One query on the sender as delivered — no second lookup for a ninth-digit variant.
    expect(repository.getInvitationsByWhatsappPhone).toHaveBeenCalledOnce();
    expect(repository.getInvitationsByWhatsappPhone).toHaveBeenCalledWith("5511963656517");
  });

  it.each(["idle", "message_sent", "response_received"] as const)("queues fallback text without changing the %s RSVP flow", async (status) => {
    const invitation = {
      invitationCode: "SW2748",
      householdName: "Família Silva",
      phoneNumber: "5511963656517",
      whatsappFlowStatus: status,
      guests: [{ guestId: "g1", guestName: "Silva 1", allowedPlusOnes: 0, rsvpStatus: "pending" as const }]
    };
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(true),
      getWhatsappMessage: vi.fn().mockResolvedValue(undefined),
      getInvitationsByWhatsappPhone: vi.fn().mockResolvedValue(["SW2748"]),
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      putWhatsappMessage: vi.fn().mockResolvedValue({ created: true }),
      updateWhatsappFlow: vi.fn().mockResolvedValue(undefined),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      createWhatsappCommand: vi.fn().mockResolvedValue(undefined)
    };
    const service = new WhatsappRsvpService(repository as never, {} as never, {} as never);
    vi.spyOn(service, "queueFallbackText").mockResolvedValue("cmd-fallback" as never);

    await expect(service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.active_free_text",
      type: "text",
      messageId: "wamid.active_free_text",
      senderWaId: "5511963656517",
      body: "Tenho uma dúvida",
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "req-active")).resolves.toEqual({ outcome: "processed" });

    expect(repository.updateWhatsappFlow).not.toHaveBeenCalled();
    expect(repository.putWhatsappMessage).toHaveBeenCalledWith(expect.objectContaining({
      direction: "inbound",
      body: "Tenho uma dúvida"
    }));
  });

  it("rejects button replies when invitation flow is already completed (terminal)", async () => {
    const invitation = {
      invitationCode: "SW2748",
      householdName: "Família Silva",
      phoneNumber: "5511963656517",
      whatsappFlowStatus: "completed" as const,
      whatsappFlowCompletedAt: "2026-08-17T12:00:00.000Z",
      guests: [
        { guestId: "g1", guestName: "Silva 1", allowedPlusOnes: 0, rsvpStatus: "attending" as const }
      ]
    };
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(true),
      getWhatsappMessage: vi.fn().mockResolvedValue({ invitationCode: "SW2748" }),
      getWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      putWhatsappMessage: vi.fn().mockResolvedValue({ created: true }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const service = new WhatsappRsvpService(repository as never, {} as never, {} as never);

    const result = await service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.button_late",
      type: "button_reply",
      messageId: "wamid.button_late",
      senderWaId: "5511963656517",
      replyContextMessageId: "wamid.outbound.1",
      buttonId: "rsvp_b2_decline",
      title: "Não poderei ir",
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "req-3");

    expect(result).toEqual({ outcome: "rejected", reason: "terminal_flow" });
    expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith(
      "whatsapp",
      "whatsapp:message:wamid.button_late",
      { status: "processed", rejectionReason: "terminal_flow" }
    );
  });

  it("does not write a second inbound message or command for a duplicate webhook delivery", async () => {
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(false),
      getWebhookEvent: vi.fn().mockResolvedValue({ processingStatus: "processed" }),
      putWhatsappMessage: vi.fn(),
      getWhatsappMessage: vi.fn(),
      getInvitationByCode: vi.fn(),
      markWebhookEventProcessed: vi.fn()
    };
    const service = new WhatsappRsvpService(repository as never, {} as never, {} as never);

    await expect(service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.duplicate",
      type: "button_reply",
      messageId: "wamid.duplicate",
      senderWaId: "5511963656517",
      buttonId: "rsvp_b2_decline",
      title: "Decline",
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "request-duplicate")).resolves.toEqual({ outcome: "duplicate" });
    expect(repository.putWhatsappMessage).not.toHaveBeenCalled();
    expect(repository.markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("rejects a WhatsApp branch that loses the website conditional race", async () => {
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(true),
      getWhatsappMessage: vi.fn().mockResolvedValue({ invitationCode: "SW2748" }),
      getInvitationByCode: vi.fn().mockResolvedValue({
        invitationCode: "SW2748",
        phoneNumber: "5511963656517",
        whatsappFlowStatus: "message_sent",
        guests: [{ guestId: "g1", guestName: "Guest", allowedPlusOnes: 0, rsvpStatus: "pending" }]
      }),
      putWhatsappMessage: vi.fn().mockResolvedValue({ created: true }),
      getWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      reserveWhatsappBranch: vi.fn().mockRejectedValue(
        new TransactionCanceledException({ message: "website won", $metadata: {} })
      ),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      updateWhatsappFlow: vi.fn(),
      createWhatsappCommand: vi.fn()
    };
    const service = new WhatsappRsvpService(repository as never, {
      getActive: vi.fn().mockResolvedValue({ version: 1 })
    } as never, {} as never);

    await expect(service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.website-wins",
      type: "button_reply",
      messageId: "wamid.website-wins",
      senderWaId: "5511963656517",
      replyContextMessageId: "wamid.outbound.1",
      buttonId: "rsvp_b2_decline",
      title: "Decline",
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "request-race")).resolves.toEqual({ outcome: "rejected", reason: "stale_flow" });
    expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith(
      "whatsapp",
      "whatsapp:message:wamid.website-wins",
      { status: "processed", rejectionReason: "stale_flow" }
    );
  });

  it("does not reconcile a stale button over a live follow-up flow", async () => {
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(true),
      getWhatsappMessage: vi.fn().mockResolvedValue({ invitationCode: "SW2748" }),
      getInvitationByCode: vi.fn().mockResolvedValue({
        invitationCode: "SW2748", phoneNumber: "5511963656517", whatsappFlowStatus: "website_followup_pending",
        guests: [{ guestId: "g1", guestName: "Guest", rsvpStatus: "attending" }]
      }),
      putWhatsappMessage: vi.fn().mockResolvedValue({ created: true }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      updateWhatsappFlow: vi.fn(),
      createWhatsappCommand: vi.fn()
    };
    const service = new WhatsappRsvpService(repository as never, { getActive: vi.fn() } as never, {} as never);

    await expect(service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.stale-followup",
      type: "button_reply", messageId: "wamid.stale-followup", senderWaId: "5511963656517",
      replyContextMessageId: "wamid.outbound.1", buttonId: "rsvp_b2_decline", title: "Decline",
      duplicateWithinPayload: false, source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "request-stale-followup")).resolves.toEqual({ outcome: "rejected", reason: "invalid_transition" });
    expect(repository.updateWhatsappFlow).not.toHaveBeenCalled();
    expect(repository.markWebhookEventProcessed).toHaveBeenCalledWith(
      "whatsapp", "whatsapp:message:wamid.stale-followup",
      { status: "processed", rejectionReason: "invalid_transition" }
    );
  });

  it("propagates a non-conditional transaction failure instead of treating it as stale", async () => {
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(true),
      getWhatsappMessage: vi.fn().mockResolvedValue({ invitationCode: "SW2748" }),
      getInvitationByCode: vi.fn().mockResolvedValue({
        invitationCode: "SW2748", phoneNumber: "5511963656517", whatsappFlowStatus: "message_sent",
        guests: [{ guestId: "g1", guestName: "Guest", allowedPlusOnes: 0, rsvpStatus: "pending" }]
      }),
      putWhatsappMessage: vi.fn().mockResolvedValue({ created: true }),
      getWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      reserveWhatsappBranch: vi.fn().mockRejectedValue(new Error("Dynamo unavailable")),
      markWebhookEventProcessed: vi.fn(),
      updateWhatsappFlow: vi.fn(),
      createWhatsappCommand: vi.fn()
    };
    const service = new WhatsappRsvpService(repository as never, { getActive: vi.fn().mockResolvedValue({ version: 1 }) } as never, {} as never);

    await expect(service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.infrastructure-failure",
      type: "button_reply", messageId: "wamid.infrastructure-failure", senderWaId: "5511963656517",
      replyContextMessageId: "wamid.outbound.1", buttonId: "rsvp_b2_decline", title: "Decline",
      duplicateWithinPayload: false, source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "request-infrastructure")).rejects.toThrow("Dynamo unavailable");
    expect(repository.markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("reserves a branch outcome and its follow-up before publishing", async () => {
    const invitation = {
      invitationCode: "SW2748",
      householdName: "Família Silva",
      phoneNumber: "5511963656517",
      whatsappFlowStatus: "message_sent" as const,
      guests: [{ guestId: "g1", guestName: "Silva 1", allowedPlusOnes: 0, rsvpStatus: "attending" as const }]
    };
    const reserveWhatsappBranch = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue({ status: "queued", enqueuedAt: "2026-08-19T12:00:00.000Z" });
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(true),
      getWhatsappMessage: vi.fn().mockResolvedValue({ invitationCode: "SW2748" }),
      getWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      putWhatsappMessage: vi.fn().mockResolvedValue({ created: true }),
      reserveWhatsappBranch,
      updateWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      updateWhatsappFlow: vi.fn(),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const service = new WhatsappRsvpService(
      repository as never,
      { getActive: vi.fn().mockResolvedValue({ version: 1 }) } as never,
      {} as never,
      undefined,
      publish
    );

    await expect(service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.branch_1",
      type: "button_reply",
      messageId: "wamid.branch_1",
      senderWaId: "5511963656517",
      replyContextMessageId: "wamid.outbound.1",
      buttonId: "rsvp_single_a1_confirm_all",
      title: "Confirmar",
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "request-branch")).resolves.toEqual({ outcome: "processed" });

    expect(reserveWhatsappBranch).toHaveBeenCalledWith(expect.objectContaining({
      expectedStatus: "message_sent",
      status: "attendance_confirmed_whatsapp",
      command: expect.objectContaining({
        effect: "complete_on_send",
        expectedFlowStatus: "attendance_confirmed_whatsapp",
        templateId: "wedding_rsvp_attending_followup_single"
      })
    }));
    expect(publish).toHaveBeenCalledOnce();
    expect(repository.updateWhatsappFlow).not.toHaveBeenCalled();
  });

  it("passes a single-guest declined RSVP into the atomic branch reservation", async () => {
    const invitation = {
      invitationCode: "SV2543",
      householdName: "Família Silva",
      phoneNumber: "5511963656517",
      whatsappFlowStatus: "message_sent" as const,
      guests: [{
        guestId: "SV2543--guest-01",
        guestName: "Silva 1",
        allowedPlusOnes: 0,
        rsvpStatus: "pending" as const,
        isChildSixOrYounger: false
      }]
    };
    const reserveWhatsappBranch = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue({ status: "queued", enqueuedAt: "2026-08-19T12:00:00.000Z" });
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(true),
      getWhatsappMessage: vi.fn().mockResolvedValue({ invitationCode: "SV2543" }),
      getWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      putWhatsappMessage: vi.fn().mockResolvedValue({ created: true }),
      reserveWhatsappBranch,
      updateWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      updateWhatsappFlow: vi.fn(),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const service = new WhatsappRsvpService(
      repository as never,
      { getActive: vi.fn().mockResolvedValue({ version: 1 }) } as never,
      {} as never,
      undefined,
      publish
    );

    await expect(service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.decline_1",
      type: "button_reply",
      messageId: "wamid.decline_1",
      senderWaId: "5511963656517",
      replyContextMessageId: "wamid.outbound.1",
      buttonId: "rsvp_single_b2_decline",
      title: "Não poderei ir",
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "request-decline")).resolves.toEqual({ outcome: "processed" });

    expect(reserveWhatsappBranch).toHaveBeenCalledWith(expect.objectContaining({
      expectedStatus: "message_sent",
      status: "attendance_declined",
      declinedRsvp: {
        submittedBy: "whatsapp:wamid.decline_1",
        guestResponses: [{ guestId: "SV2543--guest-01", status: "declined", isChildSixOrYounger: false }]
      },
      command: expect.objectContaining({
        templateId: "wedding_rsvp_declined_followup_single",
        effect: "complete_on_send",
        expectedFlowStatus: "attendance_declined"
      })
    }));
    expect(publish).toHaveBeenCalledOnce();
  });

  it("passes every family guest into the existing family decline branch", async () => {
    const invitation = {
      invitationCode: "SW2748",
      householdName: "Família Silva",
      phoneNumber: "5511963656517",
      whatsappFlowStatus: "message_sent" as const,
      guests: [
        { guestId: "g1", guestName: "Silva 1", allowedPlusOnes: 0, rsvpStatus: "pending" as const, isChildSixOrYounger: true },
        { guestId: "g2", guestName: "Silva 2", allowedPlusOnes: 0, rsvpStatus: "pending" as const },
        { guestId: "g3", guestName: "Silva 3", allowedPlusOnes: 0, rsvpStatus: "pending" as const, isChildSixOrYounger: false }
      ]
    };
    const reserveWhatsappBranch = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue({ status: "queued", enqueuedAt: "2026-08-19T12:00:00.000Z" });
    const repository = {
      recordWebhookEventIfNew: vi.fn().mockResolvedValue(true),
      getWhatsappMessage: vi.fn().mockResolvedValue({ invitationCode: "SW2748" }),
      getWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      putWhatsappMessage: vi.fn().mockResolvedValue({ created: true }),
      reserveWhatsappBranch,
      updateWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      updateWhatsappFlow: vi.fn(),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const service = new WhatsappRsvpService(
      repository as never,
      { getActive: vi.fn().mockResolvedValue({ version: 2 }) } as never,
      {} as never,
      undefined,
      publish
    );

    await expect(service.handleWebhookEvent({
      eventId: "whatsapp:message:wamid.family-decline-1",
      type: "button_reply",
      messageId: "wamid.family-decline-1",
      senderWaId: "5511963656517",
      replyContextMessageId: "wamid.outbound.1",
      buttonId: "rsvp_b2_decline",
      title: "Não poderei ir",
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 }
    }, "request-family-decline")).resolves.toEqual({ outcome: "processed" });

    expect(reserveWhatsappBranch).toHaveBeenCalledWith(expect.objectContaining({
      status: "attendance_declined",
      declinedRsvp: {
        submittedBy: "whatsapp:wamid.family-decline-1",
        guestResponses: [
          { guestId: "g1", status: "declined", isChildSixOrYounger: true },
          { guestId: "g2", status: "declined", isChildSixOrYounger: false },
          { guestId: "g3", status: "declined", isChildSixOrYounger: false }
        ]
      },
      command: expect.objectContaining({
        templateId: "wedding_rsvp_declined_followup",
        effect: "complete_on_send",
        expectedFlowStatus: "attendance_declined"
      })
    }));
    expect(publish).toHaveBeenCalledOnce();
  });

  it("skips queueing fallback text if whatsappFallbackSentAt is already present", async () => {
    const invitation = {
      invitationCode: "SW2748",
      phoneNumber: "5511963656517",
      whatsappFallbackSentAt: "2026-08-17T12:00:00.000Z"
    };
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      createWhatsappCommand: vi.fn(),
      updateWhatsappFlow: vi.fn()
    };
    const service = new WhatsappRsvpService(repository as never, {} as never, {} as never);

    const commandId = await service.queueFallbackText("SW2748", "whatsapp:message:wamid.free_text_2");
    expect(commandId).toBe("idempotency-fallback-SW2748");
    expect(repository.createWhatsappCommand).not.toHaveBeenCalled();
    expect(repository.updateWhatsappFlow).not.toHaveBeenCalled();
  });

  it("does not mark the fallback as sent while only queueing it", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({ invitationCode: "SW2748", phoneNumber: "5511963656517" }),
      createWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      updateWhatsappFlow: vi.fn(),
      updateWhatsappCommand: vi.fn()
    };
    const service = new WhatsappRsvpService(repository as never, {} as never, {} as never);
    vi.spyOn(
      service as unknown as { enqueueCommand: (commandId: string) => Promise<string> },
      "enqueueCommand"
    ).mockResolvedValue("queued");

    await service.queueFallbackText("SW2748", "whatsapp:message:wamid.free_text_3");

    expect(repository.updateWhatsappFlow).not.toHaveBeenCalled();
  });
});
