import {
  WhatsappCommandStatusSchema,
  WhatsappCommandEffectSchema,
  WhatsappFlowStatusSchema,
  WhatsappFlowStageSchema,
  WhatsappMessageDirectionSchema,
  WhatsappMessageStatusSchema,
  WhatsappReconciliationStatusSchema
} from "@brimax/contracts";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import { WhatsappRecipientSchema } from "../whatsapp/schemas";

/**
 * Stored shapes for the WhatsApp command (outbox) and message records.
 *
 * These are plain `z.object` schemas on purpose: parsing strips unknown keys, so a caller can
 * never smuggle `PK`, `SK`, or `entityType` into an item through the write path. The repository
 * parses first and spreads the key builder output last, which also guarantees the key segment
 * is a validated non-empty string rather than a stringified `undefined`.
 */

export class WhatsappItemCorruptError extends AppError {
  constructor(message: string) {
    super(message, 500, "RECONCILIATION_REQUIRED");
    this.name = "WhatsappItemCorruptError";
  }
}

const isoTimestamp = z.string().datetime();
const providerId = z.string().min(1).max(512);

export const WhatsappMessageInputSchema = z.object({
  messageId: providerId,
  invitationCode: z.string().min(1),
  direction: WhatsappMessageDirectionSchema,
  status: WhatsappMessageStatusSchema,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp.optional(),
  statusUpdatedAt: isoTimestamp.optional(),
  commandId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
  templateVersion: z.number().int().positive().optional(),
  stage: WhatsappFlowStageSchema.optional(),
  // Normalized digits only. Never logged — see Step 14 redaction.
  recipientPhone: WhatsappRecipientSchema.optional(),
  senderPhone: WhatsappRecipientSchema.optional(),
  replyContextMessageId: providerId.optional(),
  buttonId: z.string().min(1).max(256).optional(),
  body: z.string().min(1).max(4096).optional(),
  providerErrorCode: z.union([z.number().int(), z.string().min(1)]).optional(),
  providerErrorCategory: z.string().min(1).max(128).optional(),
  providerErrorTitle: z.string().min(1).max(256).optional()
});

const WhatsappCommandShapeSchema = z.object({
  commandId: z.string().min(1).max(512),
  invitationCode: z.string().min(1),
  templateId: z.string().min(1),
  status: WhatsappCommandStatusSchema,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp.optional(),
  templateVersion: z.number().int().positive().optional(),
  stage: WhatsappFlowStageSchema.optional(),
  retryCount: z.number().int().min(0).default(0),
  reconciliationStatus: WhatsappReconciliationStatusSchema.default("none"),
  providerMessageId: providerId.optional(),
  providerErrorCode: z.union([z.number().int(), z.string().min(1)]).optional(),
  providerErrorCategory: z.string().min(1).max(128).optional(),
  providerErrorTitle: z.string().min(1).max(256).optional(),
  failureReason: z.string().min(1).max(2048).optional(),
  enqueuedAt: isoTimestamp.optional(),
  startedAt: isoTimestamp.optional(),
  lastAttemptAt: isoTimestamp.optional(),
  lastAttemptReceiveCount: z.number().int().min(1).optional(),
  sentAt: isoTimestamp.optional()
  ,effect: WhatsappCommandEffectSchema.optional()
  ,expectedFlowStatus: WhatsappFlowStatusSchema.optional()
  // Read compatibility for records deployed before the explicit effect field.
  ,preserveFlowStatus: z.boolean().optional()
}).superRefine((value, context) => {
  const effect = value.effect ?? (value.preserveFlowStatus === true ? "preserve" : "opener");
  if (effect === "complete_on_send" && !value.expectedFlowStatus) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expectedFlowStatus"], message: "complete_on_send commands require expectedFlowStatus" });
  }
});

export const WhatsappCommandInputSchema = WhatsappCommandShapeSchema.transform((value) => {
  const current = { ...value };
  delete current.preserveFlowStatus;
  return {
    ...current,
    effect: value.effect ?? (value.preserveFlowStatus === true ? "preserve" : "opener")
  };
});

// Read-side shapes. Optional fields stay optional so a record written before a later step adds
// a field still parses; the required set is exactly what consumers dereference for correlation.
// A phantom item — one conjured by an UpdateItem on a missing key — fails here rather than
// flowing on as `String(undefined)`.
const storedKeys = {
  PK: z.string().min(1),
  SK: z.string().min(1),
  GSI1PK: z.string().min(1).optional(),
  GSI1SK: z.string().min(1).optional()
};

export const WhatsappMessageItemSchema = WhatsappMessageInputSchema.extend({
  ...storedKeys,
  entityType: z.literal("WhatsappMessage")
});

export const WhatsappCommandItemSchema = WhatsappCommandInputSchema.and(z.object({
  ...storedKeys,
  entityType: z.literal("WhatsappCommand")
}));
export const WhatsappWebhookMarkerSchema = z.object({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("WebhookEvent").optional(),
  provider: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),
  providerMessageId: z.string().min(1).optional(),
  replayEvent: z.string().min(1).optional(),
  processingOutcome: z.enum(["processed", "rejected"]).optional(),
  rejectionReason: z.string().min(1).optional(),
  attemptCount: z.number().int().min(0).optional(),
  processingStartedAt: isoTimestamp.optional(),
  lastAttemptAt: isoTimestamp.optional(),
  processingStatus: z.enum(["pending", "processing", "processed", "failed"]),
  receivedAt: isoTimestamp.optional(),
  processedAt: isoTimestamp.optional(),
  updatedAt: isoTimestamp.optional(),
  failureReason: z.string().min(1).optional(),
  ttl: z.number().int().optional()
});

export type WhatsappMessageInput = z.input<typeof WhatsappMessageInputSchema>;
export type WhatsappCommandInput = z.input<typeof WhatsappCommandInputSchema>;
export type WhatsappMessageItem = z.infer<typeof WhatsappMessageItemSchema>;
export type WhatsappCommandItem = z.infer<typeof WhatsappCommandItemSchema>;
export type WhatsappWebhookMarker = z.infer<typeof WhatsappWebhookMarkerSchema>;

function describeIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Parses a stored item, turning a malformed record into a named error instead of `unknown`. */
export function parseStoredWhatsappItem<T extends z.ZodTypeAny>(
  schema: T,
  item: Record<string, unknown>,
  label: string
): z.infer<T> {
  const result = schema.safeParse(item);
  if (!result.success) {
    throw new WhatsappItemCorruptError(
      `Stored ${label} record is malformed — ${describeIssues(result.error)}`
    );
  }
  return result.data;
}
