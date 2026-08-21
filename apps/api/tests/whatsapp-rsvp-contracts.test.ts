import { describe, expect, it } from "vitest";
import {
  WhatsappIdempotencyKeySchema,
  WhatsappPhoneUpdateRequestSchema,
  WhatsappPhoneUpdateResponseSchema,
  WhatsappRsvpErrorResponseSchema,
  WhatsappRsvpSendRequestSchema,
  WhatsappRsvpSendResponseSchema,
  WhatsappRsvpStatusResponseSchema,
  WhatsappTemplatePurposeSchema,
  WhatsappRsvpTemplatePurposeSchema,
  WHATSAPP_RSVP_TEMPLATE_PURPOSES,
  WhatsappWebhookProcessingResultSchema
} from "@brimax/contracts";

const invitationCode = "SW2748";

describe("WhatsApp RSVP contracts", () => {
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
    expect(WhatsappRsvpStatusResponseSchema.parse({ invitationCode, status: "idle" })).toEqual({ invitationCode, status: "idle" });
    expect(WhatsappRsvpStatusResponseSchema.parse({
      invitationCode,
      status: "website_followup_pending"
    })).toEqual({ invitationCode, status: "website_followup_pending" });
    expect(WhatsappRsvpStatusResponseSchema.parse({
      invitationCode,
      status: "website_update_required"
    })).toEqual({ invitationCode, status: "website_update_required" });
    expect(WhatsappPhoneUpdateResponseSchema.parse({ invitationCode, phoneNumber: "5511963656517", updatedAt: "2026-08-17T12:00:00.000Z" })).toBeTruthy();
    expect(WhatsappRsvpErrorResponseSchema.parse({ code: "VALIDATION_ERROR", message: "Invalid request." })).toBeTruthy();
    expect(WhatsappRsvpErrorResponseSchema.parse({ code: "VALIDATION_ERROR", message: "Invalid request.", issues: [{ path: ["templateId"], message: "Invalid" }] })).toBeTruthy();
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
