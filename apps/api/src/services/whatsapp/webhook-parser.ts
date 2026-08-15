import {
  WhatsappWebhookParseResultSchema,
  type WhatsappInvalidEnvelopeReason,
  type WhatsappInvalidItemReason,
  type WhatsappWebhookError,
  type WhatsappWebhookEvent,
  type WhatsappWebhookParseResult
} from "@brimax/contracts";
import { z } from "zod";
import { stableJsonHash } from "../../lib/security";

const rawEnvelopeSchema = z
  .object({
    object: z.literal("whatsapp_business_account"),
    entry: z
      .array(
        z
          .object({
            id: z.string().optional(),
            changes: z
              .array(
                z
                  .object({
                    field: z.string().optional(),
                    value: z.record(z.unknown())
                  })
                  .passthrough()
              )
              .min(1)
          })
          .passthrough()
      )
      .min(1)
  })
  .passthrough();

type RawEnvelope = z.infer<typeof rawEnvelopeSchema>;
type EventSource = WhatsappWebhookEvent["source"];
type EventBase = {
  eventId: string;
  duplicateWithinPayload: false;
  source: EventSource;
  wabaId?: string;
  phoneNumberId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function safeIdentifier(value: string) {
  return /^[a-zA-Z0-9_.:-]{1,64}$/.test(value) ? value : "unknown";
}

function hashId(prefix: string, value: unknown) {
  return `whatsapp:${prefix}:${stableJsonHash(value)}`;
}

function envelopeFailure(input: unknown): WhatsappInvalidEnvelopeReason {
  if (!isRecord(input)) return "not_object";
  if (input.object !== "whatsapp_business_account") return "wrong_object";
  if (!Array.isArray(input.entry) || input.entry.length === 0) return "missing_or_empty_entry";

  for (const entry of input.entry) {
    if (!isRecord(entry)) return "invalid_entry";
    if (!Array.isArray(entry.changes) || entry.changes.length === 0) {
      return "missing_or_empty_changes";
    }
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) return "invalid_change_value";
    }
  }

  return "invalid_change_value";
}

function eventBase(
  envelope: RawEnvelope,
  value: Record<string, unknown>,
  source: EventSource,
  eventId: string
): EventBase {
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  return {
    eventId,
    duplicateWithinPayload: false,
    source,
    wabaId: nonEmptyString(envelope.entry[source.entryIndex]?.id),
    phoneNumberId: nonEmptyString(metadata?.phone_number_id)
  };
}

function senderWaId(message: Record<string, unknown>, value: Record<string, unknown>) {
  const direct = nonEmptyString(message.from);
  if (direct) return direct;

  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  if (contacts.length !== 1 || !isRecord(contacts[0])) return undefined;
  return nonEmptyString(contacts[0].wa_id);
}

function messageCommon(
  envelope: RawEnvelope,
  value: Record<string, unknown>,
  message: Record<string, unknown>,
  source: EventSource,
  messageId: string
) {
  const context = isRecord(message.context) ? message.context : undefined;
  return {
    ...eventBase(envelope, value, source, `whatsapp:message:${messageId}`),
    messageId,
    timestamp: nonEmptyString(message.timestamp),
    senderWaId: senderWaId(message, value),
    replyContextMessageId: nonEmptyString(context?.id)
  };
}

function invalidItem(
  envelope: RawEnvelope,
  value: Record<string, unknown>,
  source: EventSource,
  reason: WhatsappInvalidItemReason,
  item: unknown
): WhatsappWebhookEvent {
  return {
    ...eventBase(envelope, value, source, hashId(`invalid:${reason}`, item)),
    type: "invalid_payload",
    reason
  };
}

function media(value: unknown) {
  if (!isRecord(value)) return null;
  const mediaId = nonEmptyString(value.id);
  if (!mediaId) return null;
  return {
    mediaId,
    mimeType: nonEmptyString(value.mime_type),
    sha256: nonEmptyString(value.sha256)
  };
}

function normalizeMessage(
  envelope: RawEnvelope,
  value: Record<string, unknown>,
  item: unknown,
  source: EventSource
): WhatsappWebhookEvent {
  if (!isRecord(item)) return invalidItem(envelope, value, source, "item_not_object", item);
  const messageId = nonEmptyString(item.id);
  if (!messageId) return invalidItem(envelope, value, source, "missing_message_id", item);
  const messageType = nonEmptyString(item.type);
  if (!messageType) return invalidItem(envelope, value, source, "missing_message_type", item);
  const common = messageCommon(envelope, value, item, source, messageId);

  if (messageType === "interactive") {
    const interactive = isRecord(item.interactive) ? item.interactive : undefined;
    const interactiveType = nonEmptyString(interactive?.type);
    if (interactiveType === "button_reply") {
      const reply = isRecord(interactive?.button_reply) ? interactive.button_reply : undefined;
      const buttonId = nonEmptyString(reply?.id);
      if (!buttonId) return invalidItem(envelope, value, source, "malformed_button_reply", item);
      return {
        ...common,
        type: "button_reply",
        buttonId,
        title: nonEmptyString(reply?.title),
        sourceVariant: "interactive"
      };
    }
    if (interactiveType === "list_reply") {
      const reply = isRecord(interactive?.list_reply) ? interactive.list_reply : undefined;
      const listReplyId = nonEmptyString(reply?.id);
      if (!listReplyId) return invalidItem(envelope, value, source, "malformed_list_reply", item);
      return {
        ...common,
        type: "list_reply",
        listReplyId,
        title: nonEmptyString(reply?.title),
        description: nonEmptyString(reply?.description)
      };
    }
    return {
      ...common,
      type: "unsupported_message",
      originalMessageType: safeIdentifier(`interactive:${interactiveType ?? "unknown"}`)
    };
  }

  if (messageType === "button") {
    const button = isRecord(item.button) ? item.button : undefined;
    const buttonId = nonEmptyString(button?.payload);
    if (!buttonId) return invalidItem(envelope, value, source, "malformed_button_reply", item);
    return {
      ...common,
      type: "button_reply",
      buttonId,
      title: nonEmptyString(button?.text),
      sourceVariant: "template_quick_reply"
    };
  }

  if (messageType === "text") {
    const text = isRecord(item.text) ? item.text : undefined;
    const body = stringValue(text?.body);
    if (body === undefined) return invalidItem(envelope, value, source, "malformed_text", item);
    return { ...common, type: "text", body };
  }

  if (["audio", "image", "video", "document", "sticker"].includes(messageType)) {
    const normalizedMedia = media(item[messageType]);
    if (!normalizedMedia) return invalidItem(envelope, value, source, "malformed_media", item);
    const rawMedia = item[messageType] as Record<string, unknown>;
    if (messageType === "audio") {
      return { ...common, type: "audio", media: { ...normalizedMedia, voice: booleanValue(rawMedia.voice) } };
    }
    if (messageType === "image") {
      return { ...common, type: "image", media: { ...normalizedMedia, caption: stringValue(rawMedia.caption) } };
    }
    if (messageType === "video") {
      return { ...common, type: "video", media: { ...normalizedMedia, caption: stringValue(rawMedia.caption) } };
    }
    if (messageType === "document") {
      return {
        ...common,
        type: "document",
        media: {
          ...normalizedMedia,
          caption: stringValue(rawMedia.caption),
          filename: nonEmptyString(rawMedia.filename)
        }
      };
    }
    return {
      ...common,
      type: "sticker",
      media: { ...normalizedMedia, animated: booleanValue(rawMedia.animated) }
    };
  }

  if (messageType === "location") {
    const location = isRecord(item.location) ? item.location : undefined;
    const latitude = numberValue(location?.latitude);
    const longitude = numberValue(location?.longitude);
    if (latitude === undefined || longitude === undefined) {
      return invalidItem(envelope, value, source, "malformed_location", item);
    }
    return {
      ...common,
      type: "location",
      latitude,
      longitude,
      name: nonEmptyString(location?.name),
      address: nonEmptyString(location?.address),
      url: nonEmptyString(location?.url)
    };
  }

  if (messageType === "contacts") {
    if (!Array.isArray(item.contacts)) {
      return invalidItem(envelope, value, source, "malformed_contacts", item);
    }
    const contacts = item.contacts.filter(isRecord).map((contact) => {
      const name = isRecord(contact.name) ? contact.name : undefined;
      const phones = Array.isArray(contact.phones) ? contact.phones : [];
      return {
        formattedName: nonEmptyString(name?.formatted_name),
        phones: phones.filter(isRecord).map((phone) => ({
          phone: nonEmptyString(phone.phone),
          waId: nonEmptyString(phone.wa_id),
          type: nonEmptyString(phone.type)
        }))
      };
    });
    return { ...common, type: "contacts", contactCount: item.contacts.length, contacts };
  }

  if (messageType === "reaction") {
    const reaction = isRecord(item.reaction) ? item.reaction : undefined;
    const reactedMessageId = nonEmptyString(reaction?.message_id);
    if (!reactedMessageId) return invalidItem(envelope, value, source, "malformed_reaction", item);
    const emoji = reaction?.emoji === null ? null : stringValue(reaction?.emoji);
    return { ...common, type: "reaction", reactedMessageId, emoji };
  }

  return { ...common, type: "unsupported_message", originalMessageType: safeIdentifier(messageType) };
}

function normalizeErrors(value: unknown): WhatsappWebhookError[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((error) => ({
    code:
      typeof error.code === "number"
        ? error.code
        : typeof error.code === "string" && error.code.length > 0
          ? safeIdentifier(error.code)
          : undefined,
    type: nonEmptyString(error.type),
    title: nonEmptyString(error.title),
    message: nonEmptyString(error.message)
  }));
}

function normalizeStatus(
  envelope: RawEnvelope,
  value: Record<string, unknown>,
  item: unknown,
  source: EventSource
): WhatsappWebhookEvent {
  if (!isRecord(item)) return invalidItem(envelope, value, source, "item_not_object", item);
  const messageId = nonEmptyString(item.id);
  if (!messageId) return invalidItem(envelope, value, source, "missing_status_id", item);
  const status = nonEmptyString(item.status);
  if (!status) return invalidItem(envelope, value, source, "missing_status_value", item);
  const timestamp = nonEmptyString(item.timestamp);
  const eventId = `whatsapp:status:${messageId}:${status}:${timestamp ?? stableJsonHash(item)}`;
  const conversation = isRecord(item.conversation) ? item.conversation : undefined;
  const origin = isRecord(conversation?.origin) ? conversation.origin : undefined;
  const pricing = isRecord(item.pricing) ? item.pricing : undefined;
  const common = {
    ...eventBase(envelope, value, source, eventId),
    messageId,
    timestamp,
    recipientWaId: nonEmptyString(item.recipient_id),
    conversation: conversation
      ? {
          id: nonEmptyString(conversation.id),
          originType: nonEmptyString(origin?.type),
          expirationTimestamp: nonEmptyString(conversation.expiration_timestamp)
        }
      : undefined,
    pricing: pricing
      ? {
          billable: booleanValue(pricing.billable),
          category: nonEmptyString(pricing.category),
          pricingModel: nonEmptyString(pricing.pricing_model),
          type: nonEmptyString(pricing.type)
        }
      : undefined,
    errors: normalizeErrors(item.errors)
  };

  if (status === "sent") return { ...common, type: "status_sent", status };
  if (status === "delivered") return { ...common, type: "status_delivered", status };
  if (status === "read") return { ...common, type: "status_read", status };
  if (status === "failed") return { ...common, type: "status_failed", status };

  return {
    ...eventBase(envelope, value, source, eventId),
    type: "unknown_event",
    reason: "unknown_status",
    originalType: safeIdentifier(status),
    messageId,
    errorCodes: common.errors.flatMap((error) => (error.code === undefined ? [] : [error.code]))
  };
}

function normalizeStandaloneError(
  envelope: RawEnvelope,
  value: Record<string, unknown>,
  item: unknown,
  source: EventSource
): WhatsappWebhookEvent {
  if (!isRecord(item)) return invalidItem(envelope, value, source, "item_not_object", item);
  const errors = normalizeErrors([item]);
  return {
    ...eventBase(envelope, value, source, hashId("standalone-error", item)),
    type: "unknown_event",
    reason: "standalone_error",
    errorCodes: errors.flatMap((error) => (error.code === undefined ? [] : [error.code]))
  };
}

function collectionEvents(
  envelope: RawEnvelope,
  value: Record<string, unknown>,
  entryIndex: number,
  changeIndex: number,
  collection: "messages" | "statuses" | "errors"
) {
  if (!Object.prototype.hasOwnProperty.call(value, collection)) return [];
  const items = value[collection];
  const baseSource = { entryIndex, changeIndex, collection, itemIndex: 0 } satisfies EventSource;
  if (!Array.isArray(items)) {
    return [invalidItem(envelope, value, baseSource, "collection_not_array", items)];
  }

  return items.map((item, itemIndex) => {
    const source = { ...baseSource, itemIndex };
    if (collection === "messages") return normalizeMessage(envelope, value, item, source);
    if (collection === "statuses") return normalizeStatus(envelope, value, item, source);
    return normalizeStandaloneError(envelope, value, item, source);
  });
}

function markDuplicates(events: WhatsappWebhookEvent[]) {
  const seen = new Set<string>();
  const duplicateEventIds = new Set<string>();
  const marked = events.map((event) => {
    const duplicateWithinPayload = seen.has(event.eventId);
    seen.add(event.eventId);
    if (duplicateWithinPayload) duplicateEventIds.add(event.eventId);
    return { ...event, duplicateWithinPayload } as WhatsappWebhookEvent;
  });
  return { events: marked, duplicateEventIds: [...duplicateEventIds] };
}

export function parseWhatsappWebhook(input: unknown): WhatsappWebhookParseResult {
  const parsed = rawEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return WhatsappWebhookParseResultSchema.parse({
      outcome: "invalid_payload",
      reason: envelopeFailure(input),
      issueCount: Math.max(1, parsed.error.issues.length)
    });
  }

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (
        Object.prototype.hasOwnProperty.call(change.value, "messaging_product") &&
        change.value.messaging_product !== "whatsapp"
      ) {
        return {
          outcome: "invalid_payload",
          reason: "invalid_messaging_product",
          issueCount: 1
        };
      }
    }
  }

  const events: WhatsappWebhookEvent[] = [];
  parsed.data.entry.forEach((entry, entryIndex) => {
    entry.changes.forEach((change, changeIndex) => {
      const value = change.value;
      const before = events.length;
      events.push(...collectionEvents(parsed.data, value, entryIndex, changeIndex, "messages"));
      events.push(...collectionEvents(parsed.data, value, entryIndex, changeIndex, "statuses"));
      events.push(...collectionEvents(parsed.data, value, entryIndex, changeIndex, "errors"));

      if (change.field && change.field !== "messages") {
        const source = { entryIndex, changeIndex, collection: "change", itemIndex: 0 } satisfies EventSource;
        const changeField = safeIdentifier(change.field);
        events.push({
          ...eventBase(parsed.data, value, source, hashId(`change:${changeField}`, value)),
          type: "unknown_event",
          reason: "unknown_change_field",
          changeField,
          errorCodes: []
        });
      } else if (events.length === before && !["messages", "statuses", "errors"].some((key) => key in value)) {
        const source = { entryIndex, changeIndex, collection: "change", itemIndex: 0 } satisfies EventSource;
        events.push({
          ...eventBase(parsed.data, value, source, hashId("unrecognized-change", value)),
          type: "unknown_event",
          reason: "unrecognized_change_value",
          changeField: change.field,
          errorCodes: []
        });
      }
    });
  });

  const deduplicated = markDuplicates(events);
  return WhatsappWebhookParseResultSchema.parse({ outcome: "accepted", ...deduplicated });
}
