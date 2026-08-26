import { describe, expect, it } from "vitest";
import {
  WhatsappIdempotencyKeySchema,
  WhatsappPhoneUpdateRequestSchema,
  WhatsappPhoneUpdateResponseSchema,
  WhatsappRsvpAutoSendRequestSchema,
  WhatsappRsvpSendAvailabilitySchema,
  WhatsappFreeTextWindowSchema,
  WhatsappOperatorTextSendRequestSchema,
  WhatsappOperatorTextSendResponseSchema,
  WhatsappRsvpErrorCodeSchema,
  WhatsappRsvpErrorResponseSchema,
  WhatsappRsvpSendRequestSchema,
  WhatsappRsvpSendResponseSchema,
  WhatsappRsvpStatusResponseSchema,
  WhatsappRsvpStatusQuerySchema,
  WhatsappTemplatePurposeSchema,
  WhatsappRsvpTemplatePurposeSchema,
  WHATSAPP_RSVP_TEMPLATE_PURPOSES,
  WhatsappWebhookProcessingResultSchema
} from "@brimax/contracts";

const invitationCode = "SW2748";
const blockedAvailability = { firstAllowed: false, resendAllowed: false } as const;

describe("WhatsApp RSVP contracts", () => {
  it("strictly validates automatic send modes and defaults legacy empty bodies", () => {
    expect(WhatsappRsvpAutoSendRequestSchema.parse({})).toEqual({ mode: "first" });
    expect(WhatsappRsvpAutoSendRequestSchema.parse({ mode: "first" })).toEqual({ mode: "first" });
    expect(WhatsappRsvpAutoSendRequestSchema.parse({ mode: "resend" })).toEqual({ mode: "resend" });
    expect(() => WhatsappRsvpAutoSendRequestSchema.parse({ mode: "later" })).toThrow();
    expect(() => WhatsappRsvpAutoSendRequestSchema.parse({ mode: "first", extra: true })).toThrow();
  });

  it("strictly validates authoritative send availability", () => {
    expect(WhatsappRsvpSendAvailabilitySchema.parse({
      firstAllowed: false,
      resendAllowed: true,
      resendReason: "completed_pending"
    })).toEqual({ firstAllowed: false, resendAllowed: true, resendReason: "completed_pending" });
    expect(() => WhatsappRsvpSendAvailabilitySchema.parse({ firstAllowed: false, resendAllowed: true })).toThrow();
    expect(() => WhatsappRsvpSendAvailabilitySchema.parse({ ...blockedAvailability, extra: true })).toThrow();
  });

  it("strictly validates the free-text window and its timestamp pairing", () => {
    expect(WhatsappFreeTextWindowSchema.parse({ open: false })).toEqual({ open: false });
    expect(WhatsappFreeTextWindowSchema.parse({
      open: true,
      lastInboundAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-21T12:00:00.000Z"
    })).toEqual({
      open: true,
      lastInboundAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-21T12:00:00.000Z"
    });
    // An open window without its timestamps would leave the UI unable to explain itself.
    expect(() => WhatsappFreeTextWindowSchema.parse({ open: true })).toThrow();
    expect(() => WhatsappFreeTextWindowSchema.parse({
      open: true, lastInboundAt: "2026-08-20T12:00:00.000Z"
    })).toThrow();
    expect(() => WhatsappFreeTextWindowSchema.parse({ open: false, extra: true })).toThrow();
  });

  it("strictly validates operator free-text sends", () => {
    expect(WhatsappOperatorTextSendRequestSchema.parse({ body: "Oi!" })).toEqual({ body: "Oi!" });
    expect(WhatsappOperatorTextSendRequestSchema.parse({ body: "a".repeat(4096) }).body).toHaveLength(4096);
    expect(() => WhatsappOperatorTextSendRequestSchema.parse({ body: "" })).toThrow();
    expect(() => WhatsappOperatorTextSendRequestSchema.parse({ body: "a".repeat(4097) })).toThrow();
    expect(() => WhatsappOperatorTextSendRequestSchema.parse({ body: "Oi!", invitationCode })).toThrow();

    const accepted = { commandId: "idempotency-key-1", invitationCode, status: "queued", replayed: false };
    expect(WhatsappOperatorTextSendResponseSchema.parse(accepted)).toEqual(accepted);
    // The synthetic sentinel is not a template purpose, so it never appears on the response.
    expect(() => WhatsappOperatorTextSendResponseSchema.parse({
      ...accepted, templateId: "__whatsapp_operator_text__"
    })).toThrow();
    expect(WhatsappRsvpErrorCodeSchema.parse("FREE_TEXT_WINDOW_CLOSED")).toBe("FREE_TEXT_WINDOW_CLOSED");
  });

  it("strictly validates operator send requests", () => {
    for (const templateId of WHATSAPP_RSVP_TEMPLATE_PURPOSES) {
      expect(WhatsappRsvpSendRequestSchema.parse({ invitationCode, templateId })).toEqual({ invitationCode, templateId });
      expect(WhatsappRsvpTemplatePurposeSchema.parse(templateId)).toBe(templateId);
    }
    expect(new Set(WHATSAPP_RSVP_TEMPLATE_PURPOSES).size).toBe(13);
    expect(() => WhatsappRsvpSendRequestSchema.parse({ invitationCode: "bad", templateId: "valid_template" })).toThrow();
    for (const templateId of ["Wedding_Rsvp", "wedding_rsvp_pending_reminde", "retired_template_2024", "future_template", "a".repeat(100)]) {
      expect(() => WhatsappRsvpSendRequestSchema.parse({ invitationCode, templateId })).toThrow();
    }
    expect(() => WhatsappRsvpSendRequestSchema.parse({ invitationCode, templateId: "valid_template", extra: true })).toThrow();
  });

  it("keeps the generic purpose schema available for storage and management", () => {
    expect(WhatsappTemplatePurposeSchema.parse("retired_template_2024")).toBe("retired_template_2024");
    expect(() => WhatsappRsvpTemplatePurposeSchema.parse("retired_template_2024")).toThrow();
  });

  it("validates formatted phone input and strict objects", () => {
    expect(WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber: "+55 (11) 96365-6517" })).toEqual({
      phoneNumber: "+55 (11) 96365-6517"
    });
    expect(() => WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber: "abcdefgh" })).toThrow();
    expect(() => WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber: "" })).toThrow();
    expect(() => WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber: "1".repeat(40) })).toThrow();
    expect(() => WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber: "+5511963656517", extra: true })).toThrow();
  });

  it("accepts safe idempotency keys and rejects key-space delimiters", () => {
    expect(WhatsappIdempotencyKeySchema.parse("550e8400-e29b-41d4-a716-446655440000")).toBeTruthy();
    for (const value of ["", "short", "a".repeat(200), "key#1", "key/1"]) {
      expect(() => WhatsappIdempotencyKeySchema.parse(value)).toThrow();
    }
  });

  it("parses fresh and replay send responses", () => {
    const base = {
      commandId: "idempotency-SW2748-key12345",
      invitationCode,
      templateId: "wedding_rsvp_pending_reminder_group",
      templateVersion: 3,
      status: "queued" as const
    };
    expect(WhatsappRsvpSendResponseSchema.parse({ ...base, replayed: false })).toEqual({ ...base, replayed: false });
    expect(WhatsappRsvpSendResponseSchema.parse({ ...base, replayed: true })).toEqual({ ...base, replayed: true });
  });

  it("parses status, phone, and shared error responses", () => {
    expect(WhatsappRsvpStatusResponseSchema.parse({ invitationCode, status: "idle", sendAvailability: { firstAllowed: true, resendAllowed: false }, freeTextWindow: { open: false } })).toEqual({ invitationCode, status: "idle", sendAvailability: { firstAllowed: true, resendAllowed: false }, freeTextWindow: { open: false } });
    expect(WhatsappRsvpStatusResponseSchema.parse({
      invitationCode,
      status: "website_followup_pending",
      sendAvailability: blockedAvailability,
      freeTextWindow: { open: false }
    })).toEqual({ invitationCode, status: "website_followup_pending", sendAvailability: blockedAvailability, freeTextWindow: { open: false } });
    expect(WhatsappRsvpStatusResponseSchema.parse({
      invitationCode,
      status: "website_update_required",
      sendAvailability: blockedAvailability,
      freeTextWindow: { open: false }
    })).toEqual({ invitationCode, status: "website_update_required", sendAvailability: blockedAvailability, freeTextWindow: { open: false } });
    expect(WhatsappPhoneUpdateResponseSchema.parse({ invitationCode, phoneNumber: "5511963656517", updatedAt: "2026-08-17T12:00:00.000Z" })).toBeTruthy();
    expect(WhatsappRsvpErrorResponseSchema.parse({ code: "VALIDATION_ERROR", message: "Invalid request." })).toBeTruthy();
    expect(WhatsappRsvpErrorResponseSchema.parse({ code: "VALIDATION_ERROR", message: "Invalid request.", issues: [{ path: ["templateId"], message: "Invalid" }] })).toBeTruthy();
  });

  it("validates optional invitation-scoped message bodies and history order", () => {
    expect(WhatsappRsvpStatusQuerySchema.parse({})).toEqual({ limit: 50, order: "asc" });
    expect(WhatsappRsvpStatusQuerySchema.parse({ order: "desc", limit: "25" })).toEqual({
      limit: 25,
      order: "desc"
    });
    expect(() => WhatsappRsvpStatusQuerySchema.parse({ order: "newest" })).toThrow();

    const base = { invitationCode, status: "message_sent" as const, sendAvailability: blockedAvailability, freeTextWindow: { open: false } };
    expect(WhatsappRsvpStatusResponseSchema.parse({
      ...base,
      history: [{
        kind: "message",
        id: "wamid.inbound",
        direction: "inbound",
        status: "received",
        createdAt: "2026-08-17T12:00:00.000Z",
        messageType: "text",
        body: "Olá!"
      }]
    }).history?.[0]).toMatchObject({ body: "Olá!", messageType: "text" });
    expect(() => WhatsappRsvpStatusResponseSchema.parse({
      ...base,
      history: [{
        kind: "message",
        id: "wamid.inbound",
        direction: "inbound",
        status: "received",
        createdAt: "2026-08-17T12:00:00.000Z",
        body: ""
      }]
    })).toThrow();
    expect(() => WhatsappRsvpStatusResponseSchema.parse({
      ...base,
      history: [{
        kind: "command",
        id: "command-1",
        status: "sent",
        createdAt: "2026-08-17T12:00:00.000Z",
        body: "must remain message-only"
      }]
    })).toThrow();
    expect(() => WhatsappRsvpStatusResponseSchema.parse({
      ...base,
      history: [{
        kind: "message",
        id: "wamid.missing-direction",
        status: "received",
        createdAt: "2026-08-17T12:00:00.000Z"
      }]
    })).toThrow();
  });

  it("accepts only the closed webhook-processing result union", () => {
    for (const result of [
      { outcome: "processed" },
      { outcome: "duplicate" },
      { outcome: "ignored", reason: "unknown_message" },
      { outcome: "reconciliation_required", reason: "marker is malformed" }
    ]) {
      expect(WhatsappWebhookProcessingResultSchema.parse(result)).toEqual(result);
    }
    expect(() => WhatsappWebhookProcessingResultSchema.parse({ outcome: "ignored", reason: "future_reason" })).toThrow();
    expect(() => WhatsappWebhookProcessingResultSchema.parse({ outcome: "processed", ignored: true })).toThrow();
  });
});
