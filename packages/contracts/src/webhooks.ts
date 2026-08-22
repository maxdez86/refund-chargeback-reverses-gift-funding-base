import { z } from "zod";
import { WhatsappTextBodySchema } from "./whatsapp-rsvp";

export const AsaasWebhookResponseSchema = z.object({
  ok: z.literal(true),
  duplicate: z.boolean(),
  eventId: z.string().min(1)
});

export type AsaasWebhookResponse = z.infer<typeof AsaasWebhookResponseSchema>;

export const WhatsappWebhookEventSourceSchema = z.object({
  entryIndex: z.number().int().nonnegative(),
  changeIndex: z.number().int().nonnegative(),
  collection: z.enum(["messages", "statuses", "errors", "change"]),
  itemIndex: z.number().int().nonnegative()
});

const WhatsappWebhookEventBaseSchema = z.object({
  eventId: z.string().min(1),
  duplicateWithinPayload: z.boolean(),
  source: WhatsappWebhookEventSourceSchema,
  wabaId: z.string().min(1).optional(),
  phoneNumberId: z.string().min(1).optional()
});

const WhatsappMessageEventBaseSchema = WhatsappWebhookEventBaseSchema.extend({
  messageId: z.string().min(1),
  timestamp: z.string().min(1).optional(),
  senderWaId: z.string().min(1).optional(),
  replyContextMessageId: z.string().min(1).optional()
});

export const WhatsappWebhookErrorSchema = z.object({
  code: z.union([z.number(), z.string().min(1).max(64)]).optional(),
  type: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  message: z.string().min(1).optional()
});

export const WhatsappConversationMetadataSchema = z.object({
  id: z.string().min(1).optional(),
  originType: z.string().min(1).optional(),
  expirationTimestamp: z.string().min(1).optional()
});

export const WhatsappPricingMetadataSchema = z.object({
  billable: z.boolean().optional(),
  category: z.string().min(1).optional(),
  pricingModel: z.string().min(1).optional(),
  type: z.string().min(1).optional()
});

const WhatsappMediaSchema = z.object({
  mediaId: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  sha256: z.string().min(1).optional()
});

const WhatsappButtonReplyEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("button_reply"),
  buttonId: z.string().min(1),
  title: z.string().min(1).optional(),
  sourceVariant: z.enum(["interactive", "template_quick_reply"])
});

const WhatsappListReplyEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("list_reply"),
  listReplyId: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional()
});

const WhatsappTextEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("text"),
  body: WhatsappTextBodySchema
});

const WhatsappAudioEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("audio"),
  media: WhatsappMediaSchema.extend({ voice: z.boolean().optional() })
});

const WhatsappImageEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("image"),
  media: WhatsappMediaSchema.extend({ caption: z.string().optional() })
});

const WhatsappVideoEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("video"),
  media: WhatsappMediaSchema.extend({ caption: z.string().optional() })
});

const WhatsappDocumentEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("document"),
  media: WhatsappMediaSchema.extend({
    caption: z.string().optional(),
    filename: z.string().min(1).optional()
  })
});

const WhatsappStickerEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("sticker"),
  media: WhatsappMediaSchema.extend({ animated: z.boolean().optional() })
});

const WhatsappLocationEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("location"),
  latitude: z.number(),
  longitude: z.number(),
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  url: z.string().min(1).optional()
});

const WhatsappSharedContactSchema = z.object({
  formattedName: z.string().min(1).optional(),
  phones: z.array(
    z.object({
      phone: z.string().min(1).optional(),
      waId: z.string().min(1).optional(),
      type: z.string().min(1).optional()
    })
  )
});

const WhatsappContactsEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("contacts"),
  contactCount: z.number().int().nonnegative(),
  contacts: z.array(WhatsappSharedContactSchema)
});

const WhatsappReactionEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("reaction"),
  reactedMessageId: z.string().min(1),
  emoji: z.string().nullable().optional()
});

const WhatsappUnsupportedMessageEventSchema = WhatsappMessageEventBaseSchema.extend({
  type: z.literal("unsupported_message"),
  originalMessageType: z.string().min(1).max(64)
});

const WhatsappStatusEventBaseSchema = WhatsappWebhookEventBaseSchema.extend({
  messageId: z.string().min(1),
  timestamp: z.string().min(1).optional(),
  recipientWaId: z.string().min(1).optional(),
  conversation: WhatsappConversationMetadataSchema.optional(),
  pricing: WhatsappPricingMetadataSchema.optional(),
  errors: z.array(WhatsappWebhookErrorSchema)
});

const WhatsappSentStatusEventSchema = WhatsappStatusEventBaseSchema.extend({
  type: z.literal("status_sent"),
  status: z.literal("sent")
});

const WhatsappDeliveredStatusEventSchema = WhatsappStatusEventBaseSchema.extend({
  type: z.literal("status_delivered"),
  status: z.literal("delivered")
});

const WhatsappReadStatusEventSchema = WhatsappStatusEventBaseSchema.extend({
  type: z.literal("status_read"),
  status: z.literal("read")
});

const WhatsappFailedStatusEventSchema = WhatsappStatusEventBaseSchema.extend({
  type: z.literal("status_failed"),
  status: z.literal("failed")
});

const WhatsappUnknownEventSchema = WhatsappWebhookEventBaseSchema.extend({
  type: z.literal("unknown_event"),
  reason: z.string().min(1),
  originalType: z.string().min(1).max(64).optional(),
  changeField: z.string().min(1).max(64).optional(),
  messageId: z.string().min(1).optional(),
  errorCodes: z.array(z.union([z.number(), z.string().min(1).max(64)]))
});

export const WhatsappInvalidItemReasonSchema = z.enum([
  "collection_not_array",
  "item_not_object",
  "missing_message_id",
  "missing_message_type",
  "malformed_button_reply",
  "malformed_list_reply",
  "malformed_text",
  "malformed_media",
  "malformed_location",
  "malformed_contacts",
  "malformed_reaction",
  "missing_status_id",
  "missing_status_value"
]);

const WhatsappInvalidPayloadEventSchema = WhatsappWebhookEventBaseSchema.extend({
  type: z.literal("invalid_payload"),
  reason: WhatsappInvalidItemReasonSchema
});

export const WhatsappWebhookEventSchema = z.discriminatedUnion("type", [
  WhatsappButtonReplyEventSchema,
  WhatsappListReplyEventSchema,
  WhatsappTextEventSchema,
  WhatsappAudioEventSchema,
  WhatsappImageEventSchema,
  WhatsappVideoEventSchema,
  WhatsappDocumentEventSchema,
  WhatsappStickerEventSchema,
  WhatsappLocationEventSchema,
  WhatsappContactsEventSchema,
  WhatsappReactionEventSchema,
  WhatsappUnsupportedMessageEventSchema,
  WhatsappSentStatusEventSchema,
  WhatsappDeliveredStatusEventSchema,
  WhatsappReadStatusEventSchema,
  WhatsappFailedStatusEventSchema,
  WhatsappUnknownEventSchema,
  WhatsappInvalidPayloadEventSchema
]);

export const WhatsappInvalidEnvelopeReasonSchema = z.enum([
  "not_object",
  "wrong_object",
  "missing_or_empty_entry",
  "invalid_entry",
  "missing_or_empty_changes",
  "invalid_change_value",
  "invalid_messaging_product"
]);

export const WhatsappWebhookParseResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("accepted"),
    events: z.array(WhatsappWebhookEventSchema),
    duplicateEventIds: z.array(z.string().min(1))
  }),
  z.object({
    outcome: z.literal("invalid_payload"),
    reason: WhatsappInvalidEnvelopeReasonSchema,
    issueCount: z.number().int().positive()
  })
]);

export type WhatsappWebhookError = z.infer<typeof WhatsappWebhookErrorSchema>;
export type WhatsappWebhookEvent = z.infer<typeof WhatsappWebhookEventSchema>;
export type WhatsappWebhookParseResult = z.infer<typeof WhatsappWebhookParseResultSchema>;
export type WhatsappInvalidEnvelopeReason = z.infer<typeof WhatsappInvalidEnvelopeReasonSchema>;
export type WhatsappInvalidItemReason = z.infer<typeof WhatsappInvalidItemReasonSchema>;
