import { describe, expect, it } from "vitest";
import { parseWhatsappWebhook } from "../src/services/whatsapp/webhook-parser";

function envelope(value: Record<string, unknown>, options: { field?: string; wabaId?: string } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: options.wabaId ?? "waba-test",
        changes: [
          {
            field: options.field ?? "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "synthetic-display-number",
                phone_number_id: "phone-number-id-test"
              },
              ...value
            }
          }
        ]
      }
    ]
  };
}

function message(overrides: Record<string, unknown>) {
  return {
    id: "wamid.test-message",
    from: "sender-test",
    timestamp: "1750000000",
    ...overrides
  };
}

function accepted(input: unknown) {
  const result = parseWhatsappWebhook(input);
  expect(result.outcome).toBe("accepted");
  if (result.outcome !== "accepted") throw new Error("Expected an accepted payload.");
  return result;
}

describe("parseWhatsappWebhook", () => {
  it("normalizes interactive button and list replies", () => {
    const result = accepted(
      envelope({
        messages: [
          message({
            type: "interactive",
            context: { id: "wamid.original" },
            interactive: { type: "button_reply", button_reply: { id: "answer-a", title: "Answer A" } }
          }),
          message({
            id: "wamid.list",
            type: "interactive",
            interactive: {
              type: "list_reply",
              list_reply: { id: "row-a", title: "Row A", description: "Description A" }
            }
          })
        ]
      })
    );

    expect(result.events).toEqual([
      expect.objectContaining({
        type: "button_reply",
        eventId: "whatsapp:message:wamid.test-message",
        buttonId: "answer-a",
        title: "Answer A",
        sourceVariant: "interactive",
        senderWaId: "sender-test",
        replyContextMessageId: "wamid.original",
        wabaId: "waba-test",
        phoneNumberId: "phone-number-id-test"
      }),
      expect.objectContaining({
        type: "list_reply",
        listReplyId: "row-a",
        title: "Row A",
        description: "Description A"
      })
    ]);
  });

  it("normalizes template quick replies without requiring a display label", () => {
    const result = accepted(
      envelope({ messages: [message({ type: "button", button: { payload: "template-answer-a" } })] })
    );

    expect(result.events[0]).toMatchObject({
      type: "button_reply",
      buttonId: "template-answer-a",
      sourceVariant: "template_quick_reply"
    });
    expect(result.events[0]).toHaveProperty("title", undefined);
  });

  it("normalizes text and every supported media shape", () => {
    const messages = [
      message({ id: "text", type: "text", text: { body: "synthetic text" } }),
      message({ id: "audio", type: "audio", audio: { id: "media-a", mime_type: "audio/ogg", voice: true } }),
      message({ id: "image", type: "image", image: { id: "media-i", caption: "private image caption" } }),
      message({ id: "video", type: "video", video: { id: "media-v", caption: "private video caption" } }),
      message({
        id: "document",
        type: "document",
        document: { id: "media-d", filename: "test.pdf", caption: "private document caption" }
      }),
      message({ id: "sticker", type: "sticker", sticker: { id: "media-s", animated: true } })
    ];

    const result = accepted(envelope({ messages }));

    expect(result.events.map((event) => event.type)).toEqual([
      "text",
      "audio",
      "image",
      "video",
      "document",
      "sticker"
    ]);
    expect(result.events[0]).toMatchObject({ type: "text", body: "synthetic text" });
    expect(result.events[1]).toMatchObject({ type: "audio", media: { mediaId: "media-a", voice: true } });
    expect(result.events[2]).toMatchObject({ type: "image", media: { caption: "private image caption" } });
    expect(result.events[4]).toMatchObject({ type: "document", media: { filename: "test.pdf" } });
    expect(result.events[5]).toMatchObject({ type: "sticker", media: { animated: true } });
  });

  it("normalizes locations, shared contacts, and reaction removals", () => {
    const result = accepted(
      envelope({
        messages: [
          message({
            id: "location",
            type: "location",
            location: { latitude: -23.5, longitude: -46.6, name: "Private place", address: "Private address" }
          }),
          message({
            id: "contacts",
            type: "contacts",
            contacts: [
              {
                name: { formatted_name: "Synthetic Contact" },
                phones: [{ phone: "+000000000", wa_id: "contact-wa-id", type: "CELL" }],
                emails: [{ email: "discarded@example.invalid" }]
              }
            ]
          }),
          message({
            id: "reaction",
            type: "reaction",
            reaction: { message_id: "wamid.reacted", emoji: null }
          })
        ]
      })
    );

    expect(result.events[0]).toMatchObject({ type: "location", latitude: -23.5, longitude: -46.6 });
    expect(result.events[1]).toMatchObject({
      type: "contacts",
      contactCount: 1,
      contacts: [{ formattedName: "Synthetic Contact", phones: [{ waId: "contact-wa-id" }] }]
    });
    expect(JSON.stringify(result.events[1])).not.toContain("discarded@example.invalid");
    expect(result.events[2]).toMatchObject({
      type: "reaction",
      reactedMessageId: "wamid.reacted",
      emoji: null
    });
  });

  it("normalizes all delivery statuses, conversation metadata, pricing, and errors", () => {
    const statuses = ["sent", "delivered", "read", "failed"].map((status, index) => ({
      id: `wamid.status-${index}`,
      status,
      timestamp: `175000000${index}`,
      recipient_id: "recipient-test",
      conversation: {
        id: "conversation-test",
        expiration_timestamp: "1750009999",
        origin: { type: "utility" }
      },
      pricing: { billable: true, category: "utility", pricing_model: "CBP", type: "regular" },
      errors: status === "failed" ? [{ code: 131000, title: "Synthetic error", error_data: { details: "discard me" } }] : []
    }));

    const result = accepted(envelope({ statuses }));

    expect(result.events.map((event) => event.type)).toEqual([
      "status_sent",
      "status_delivered",
      "status_read",
      "status_failed"
    ]);
    expect(result.events[3]).toMatchObject({
      type: "status_failed",
      recipientWaId: "recipient-test",
      conversation: {
        id: "conversation-test",
        originType: "utility",
        expirationTimestamp: "1750009999"
      },
      pricing: { billable: true, category: "utility", pricingModel: "CBP", type: "regular" },
      errors: [{ code: 131000, title: "Synthetic error" }]
    });
    expect(JSON.stringify(result.events[3])).not.toContain("discard me");
  });

  it("preserves deterministic ordering across entries, changes, and collections", () => {
    const input = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [message({ id: "m1", type: "text", text: { body: "one" } })],
                statuses: [{ id: "s1", status: "sent" }],
                errors: [{ code: 100 }]
              }
            },
            { field: "messages", value: { messages: [message({ id: "m2", type: "text", text: { body: "two" } })] } }
          ]
        },
        { changes: [{ field: "messages", value: { statuses: [{ id: "s2", status: "read" }] } }] }
      ]
    };

    const result = accepted(input);
    expect(result.events.map((event) => `${event.source.entryIndex}:${event.source.changeIndex}:${event.source.collection}`)).toEqual([
      "0:0:messages",
      "0:0:statuses",
      "0:0:errors",
      "0:1:messages",
      "1:0:statuses"
    ]);
  });

  it("marks repeated events within one payload without dropping them", () => {
    const duplicateMessage = message({ type: "text", text: { body: "same" } });
    const duplicateStatus = { id: "wamid.status", status: "delivered", timestamp: "1750000000" };
    const result = accepted(
      envelope({
        messages: [duplicateMessage, duplicateMessage],
        statuses: [duplicateStatus, duplicateStatus]
      })
    );

    expect(result.events).toHaveLength(4);
    expect(result.events.map((event) => event.duplicateWithinPayload)).toEqual([false, true, false, true]);
    expect(result.duplicateEventIds).toEqual([
      "whatsapp:message:wamid.test-message",
      "whatsapp:status:wamid.status:delivered:1750000000"
    ]);
  });

  it("keeps future fields while classifying unknown messages, statuses, and changes safely", () => {
    const result = accepted(
      envelope(
        {
          messages: [message({ type: "future_message", future_private_data: "discarded" })],
          statuses: [{ id: "wamid.future-status", status: "future_status", errors: [{ code: "future-code" }] }],
          future_value_field: { private: "discarded" }
        },
        { field: "future_change" }
      )
    );

    expect(result.events.map((event) => event.type)).toEqual([
      "unsupported_message",
      "unknown_event",
      "unknown_event"
    ]);
    expect(result.events[0]).toMatchObject({ originalMessageType: "future_message" });
    expect(result.events[1]).toMatchObject({ originalType: "future_status", errorCodes: ["future-code"] });
    expect(result.events[2]).toMatchObject({ changeField: "future_change" });
    expect(JSON.stringify(result.events)).not.toContain("future_private_data");
  });

  it("sanitizes untrusted diagnostic labels before they can reach logs", () => {
    const result = accepted(
      envelope(
        {
          messages: [message({ type: "private content with spaces" })],
          statuses: [{ id: "wamid.unsafe-status", status: "private status content" }],
          errors: [{ code: "private error content" }]
        },
        { field: "private change content" }
      )
    );

    expect(result.events[0]).toMatchObject({ type: "unsupported_message", originalMessageType: "unknown" });
    expect(result.events[1]).toMatchObject({ type: "unknown_event", originalType: "unknown" });
    expect(result.events[2]).toMatchObject({ type: "unknown_event", errorCodes: ["unknown"] });
    expect(result.events[3]).toMatchObject({ type: "unknown_event", changeField: "unknown" });
    expect(JSON.stringify(result.events)).not.toContain("private content");
  });

  it("turns malformed child collections and items into accepted invalid-payload events", () => {
    const result = accepted(
      envelope({
        messages: [null, { id: "missing-type" }, message({ type: "text" })],
        statuses: "not-an-array"
      })
    );

    expect(result.events.map((event) => event.type)).toEqual([
      "invalid_payload",
      "invalid_payload",
      "invalid_payload",
      "invalid_payload"
    ]);
    expect(result.events.map((event) => (event.type === "invalid_payload" ? event.reason : ""))).toEqual([
      "item_not_object",
      "missing_message_type",
      "malformed_text",
      "collection_not_array"
    ]);
  });

  it("accepts the exact text limit and sanitizes empty or oversized text events", () => {
    const result = accepted(envelope({
      messages: [
        message({ id: "max", type: "text", text: { body: "x".repeat(4096) } }),
        message({ id: "unicode-max", type: "text", text: { body: "😀".repeat(4096) } }),
        message({ id: "spaces", type: "text", text: { body: "   " } }),
        message({ id: "empty", type: "text", text: { body: "" } }),
        message({ id: "oversized", type: "text", text: { body: "x".repeat(4097) } }),
        message({ id: "unicode-oversized", type: "text", text: { body: "😀".repeat(4097) } })
      ]
    }));

    expect(result.events[0]).toMatchObject({ type: "text", body: "x".repeat(4096) });
    expect(result.events[1]).toMatchObject({ type: "text", body: "😀".repeat(4096) });
    expect(result.events[2]).toMatchObject({ type: "text", body: "   " });
    expect(result.events[3]).toMatchObject({ type: "invalid_payload", reason: "malformed_text" });
    expect(result.events[4]).toMatchObject({ type: "invalid_payload", reason: "malformed_text" });
    expect(result.events[5]).toMatchObject({ type: "invalid_payload", reason: "malformed_text" });
    expect(JSON.stringify(result.events.slice(3))).not.toContain("x".repeat(100));
  });

  it.each([
    ["non-object", null, "not_object"],
    ["wrong object", { object: "page", entry: [{}] }, "wrong_object"],
    ["missing entry", { object: "whatsapp_business_account" }, "missing_or_empty_entry"],
    ["empty entry", { object: "whatsapp_business_account", entry: [] }, "missing_or_empty_entry"],
    ["invalid entry", { object: "whatsapp_business_account", entry: [null] }, "invalid_entry"],
    ["empty changes", { object: "whatsapp_business_account", entry: [{ changes: [] }] }, "missing_or_empty_changes"],
    ["invalid value", { object: "whatsapp_business_account", entry: [{ changes: [{ value: null }] }] }, "invalid_change_value"],
    ["wrong product", envelope({ messaging_product: "messenger" }), "invalid_messaging_product"]
  ])("rejects a foundational envelope with %s", (_name, input, reason) => {
    expect(parseWhatsappWebhook(input)).toMatchObject({ outcome: "invalid_payload", reason });
  });
});
