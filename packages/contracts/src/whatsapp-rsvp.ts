import { z } from "zod";
import { InvitationCodeSchema } from "./invitation-code";

export const WhatsappFlowStatusSchema = z.enum([
  "idle", "send_queued", "sending", "message_sent", "response_received",
  "attendance_confirmed_whatsapp", "attendance_declined", "website_update_required",
  "undecided", "completed", "failed", "reconciliation_required"
]);
export const WhatsappFlowStageSchema = z.enum(["reconfirmation", "pending", "followup", "fallback"]);

/** The business meaning of each persisted invitation flow status. */
export const WHATSAPP_FLOW_STATUS_MEANINGS = {
  idle: "No active WhatsApp confirmation attempt exists.",
  send_queued: "An outbound confirmation command is queued for delivery.",
  sending: "An outbound confirmation command is claimed by a worker.",
  message_sent: "Meta accepted the outbound message and returned a provider message id.",
  response_received: "An inbound response was durably recorded but not branched yet.",
  attendance_confirmed_whatsapp: "Attendance was confirmed in WhatsApp-only state.",
  attendance_declined: "The household declined attendance and any required follow-up was recorded.",
  website_update_required: "The household must update its website RSVP.",
  undecided: "The household is undecided and any required follow-up was recorded.",
  completed: "The flow's branch-specific action and any required follow-up were recorded.",
  failed: "A known permanent delivery or processing failure occurred.",
  reconciliation_required: "Delivery or processing outcome is ambiguous and requires operator reconciliation."
} as const satisfies Record<WhatsappFlowStatus, string>;

export const WhatsappAttendanceEntrySchema = z.object({
  guestId: z.string().min(1),
  status: z.enum(["attending", "declined"]),
  recordedAt: z.string().datetime()
});
export const WhatsappFlowStateSchema = z.object({
  status: WhatsappFlowStatusSchema,
  stage: WhatsappFlowStageSchema.optional(),
  lastOutboundMessageId: z.string().min(1).optional(),
  lastInboundMessageId: z.string().min(1).optional(),
  updatedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  fallbackSentAt: z.string().datetime().optional(),
  failureReason: z.string().min(1).optional(),
  attendance: z.array(WhatsappAttendanceEntrySchema).optional()
});

// Lifecycle of one outbound send intent (the command/outbox record). "queued" is set at
// creation, "queue_unavailable" when SQS is not configured for the stage.
export const WhatsappCommandStatusSchema = z.enum([
  "queued", "sending", "sent", "failed", "queue_unavailable", "reconciliation_required"
]);
export const WhatsappMessageDirectionSchema = z.enum(["inbound", "outbound"]);
// "received" is ours for inbound messages; the rest mirror Meta's status webhook values.
export const WhatsappMessageStatusSchema = z.enum([
  "received", "sent", "delivered", "read", "failed"
]);
export const WhatsappReconciliationStatusSchema = z.enum(["none", "required", "resolved"]);
export const WhatsappTemplatePurposeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
export const WHATSAPP_RSVP_TEMPLATE_PURPOSES = [
  "wedding_invitation",
  "wedding_rsvp_reconfirmation",
  "wedding_rsvp_attending_followup",
  "wedding_rsvp_pending_reminder",
  "wedding_rsvp_declined_followup",
  "wedding_rsvp_undecided_followup"
] as const;
export const WhatsappRsvpTemplatePurposeSchema = z.enum(WHATSAPP_RSVP_TEMPLATE_PURPOSES);
// The internal domain action a template quick reply maps to. The buttonId -> action map lives in
// the API's template manifest; Meta echoes our payload back verbatim on the inbound button message.
export const WhatsappRsvpActionSchema = z.enum([
  "confirm_all", "attend_all", "decline", "undecided"
]);
export const WhatsappIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export const WhatsappRsvpSendRequestSchema = z.object({
  invitationCode: InvitationCodeSchema,
  templateId: WhatsappRsvpTemplatePurposeSchema
}).strict();
export const WhatsappPhoneSourceSchema = z.enum(["operator", "import", "guest"]);
export const WhatsappPhoneInputSchema = z.string()
  .regex(/^\+?[1-9][\d\s().-]*$/)
  .refine((value) => {
    const digits = value.replace(/[\s()+.-]/g, "");
    return digits.length >= 8 && digits.length <= 15;
  }, "Phone number must contain 8 to 15 digits.");
export const WhatsappPhoneUpdateRequestSchema = z.object({ phoneNumber: WhatsappPhoneInputSchema }).strict();
export const WhatsappRsvpStatusResponseSchema = z.object({
  invitationCode: InvitationCodeSchema,
  phoneNumber: z.string().regex(/^[1-9]\d{7,14}$/).optional(),
  phoneNumberUpdatedAt: z.string().datetime().optional(),
  phoneNumberSource: WhatsappPhoneSourceSchema.optional(),
  status: WhatsappFlowStatusSchema,
  stage: WhatsappFlowStageSchema.optional(),
  lastOutboundMessageId: z.string().optional(),
  lastInboundMessageId: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  fallbackSentAt: z.string().datetime().optional(),
  failureReason: z.string().optional(),
  history: z.array(z.object({
    kind: z.enum(["command", "message"]),
    id: z.string().min(1).max(512),
    direction: WhatsappMessageDirectionSchema.optional(),
    status: z.union([WhatsappCommandStatusSchema, WhatsappMessageStatusSchema]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
    statusUpdatedAt: z.string().datetime().optional(),
    commandId: z.string().min(1).max(512).optional(),
    templateId: z.string().min(1).max(256).optional(),
    templateVersion: z.number().int().positive().optional(),
    stage: WhatsappFlowStageSchema.optional(),
    providerMessageId: z.string().min(1).max(512).optional(),
    retryCount: z.number().int().min(0).optional(),
    reconciliationStatus: WhatsappReconciliationStatusSchema.optional(),
    providerErrorCategory: z.string().min(1).max(128).optional(),
    failureReason: z.string().min(1).max(2048).optional()
  }).strict()).optional(),
  nextCursor: z.string().min(1).optional()
});
/** @deprecated Use WhatsappRsvpStatusResponseSchema. Kept as a compatibility alias. */
export const WhatsappRsvpStatusSchema = WhatsappRsvpStatusResponseSchema;
export const WhatsappRsvpSendResponseSchema = z.object({
  commandId: z.string().min(1).max(512),
  invitationCode: InvitationCodeSchema,
  templateId: WhatsappTemplatePurposeSchema,
  templateVersion: z.number().int().positive(),
  status: WhatsappCommandStatusSchema,
  replayed: z.boolean()
}).strict();
export const WhatsappCommandIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,512}$/);
export const WhatsappRsvpStatusQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).default("50"),
  cursor: z.string().min(1).optional()
}).strict();
export const WhatsappRsvpCommandStatusResponseSchema = z.object({
  commandId: WhatsappCommandIdSchema,
  invitationCode: InvitationCodeSchema,
  templateId: z.string().min(1).max(256),
  templateVersion: z.number().int().positive().optional(),
  status: WhatsappCommandStatusSchema,
  retryCount: z.number().int().min(0),
  reconciliationStatus: WhatsappReconciliationStatusSchema,
  providerMessageId: z.string().min(1).max(512).optional(),
  providerErrorCategory: z.string().min(1).max(128).optional(),
  failureReason: z.string().min(1).max(2048).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  enqueuedAt: z.string().datetime().optional(),
  startedAt: z.string().datetime().optional(),
  lastAttemptAt: z.string().datetime().optional(),
  sentAt: z.string().datetime().optional(),
  preserveFlowStatus: z.boolean().optional()
}).strict();
export const WhatsappPhoneUpdateResponseSchema = z.object({
  invitationCode: InvitationCodeSchema,
  phoneNumber: z.string().regex(/^[1-9]\d{7,14}$/),
  updatedAt: z.string().datetime()
}).strict();

export const WhatsappRsvpErrorCodeSchema = z.enum([
  "VALIDATION_ERROR", "INVITATION_NOT_FOUND", "TEMPLATE_NOT_FOUND", "INVALID_INVITATION_STATE",
  "INVALID_FLOW_TRANSITION", "IDEMPOTENCY_CONFLICT", "QUEUE_UNAVAILABLE", "QUEUE_FAILURE",
  "PROVIDER_FAILURE", "COMMAND_NOT_FOUND", "RECONCILIATION_REQUIRED", "INTERNAL_ERROR"
]);
export const WhatsappRsvpErrorResponseSchema = z.object({
  code: WhatsappRsvpErrorCodeSchema,
  message: z.string().min(1),
  issues: z.array(z.record(z.unknown())).optional()
}).strict();

export const WhatsappWebhookProcessingReasonSchema = z.enum([
  "unknown_message", "unknown_invitation", "wrong_sender", "terminal_flow", "stale_flow",
  "missing_message", "unsupported_type", "unknown_event", "invalid_payload", "rejected", "consistency_conflict", "invalid_transition"
]);
export const WhatsappWebhookProcessingResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("processed") }).strict(),
  z.object({ outcome: z.literal("duplicate") }).strict(),
  z.object({ outcome: z.literal("ignored"), reason: WhatsappWebhookProcessingReasonSchema }).strict(),
  z.object({ outcome: z.literal("rejected"), reason: WhatsappWebhookProcessingReasonSchema }).strict(),
  z.object({ outcome: z.literal("reconciliation_required"), reason: z.string().min(1) }).strict()
]);

export type WhatsappWebhookProcessingResult = z.infer<typeof WhatsappWebhookProcessingResultSchema>;
export type WhatsappFlowStatus = z.infer<typeof WhatsappFlowStatusSchema>;
export type WhatsappFlowStage = z.infer<typeof WhatsappFlowStageSchema>;
export type WhatsappAttendanceEntry = z.infer<typeof WhatsappAttendanceEntrySchema>;
export type WhatsappFlowState = z.infer<typeof WhatsappFlowStateSchema>;
export type WhatsappCommandStatus = z.infer<typeof WhatsappCommandStatusSchema>;
export type WhatsappMessageDirection = z.infer<typeof WhatsappMessageDirectionSchema>;
export type WhatsappMessageStatus = z.infer<typeof WhatsappMessageStatusSchema>;
export type WhatsappReconciliationStatus = z.infer<typeof WhatsappReconciliationStatusSchema>;
export type WhatsappPhoneSource = z.infer<typeof WhatsappPhoneSourceSchema>;
export type WhatsappRsvpSendRequest = z.infer<typeof WhatsappRsvpSendRequestSchema>;
export type WhatsappRsvpTemplatePurpose = z.infer<typeof WhatsappRsvpTemplatePurposeSchema>;
export type WhatsappRsvpAction = z.infer<typeof WhatsappRsvpActionSchema>;
export type WhatsappRsvpSendResponse = z.infer<typeof WhatsappRsvpSendResponseSchema>;
export type WhatsappRsvpCommandStatusResponse = z.infer<typeof WhatsappRsvpCommandStatusResponseSchema>;
export type WhatsappPhoneUpdateResponse = z.infer<typeof WhatsappPhoneUpdateResponseSchema>;
export type WhatsappRsvpStatusResponse = z.infer<typeof WhatsappRsvpStatusResponseSchema>;
export type WhatsappRsvpStatus = z.infer<typeof WhatsappRsvpStatusSchema>;
export type WhatsappRsvpErrorCode = z.infer<typeof WhatsappRsvpErrorCodeSchema>;
export type WhatsappRsvpErrorResponse = z.infer<typeof WhatsappRsvpErrorResponseSchema>;
