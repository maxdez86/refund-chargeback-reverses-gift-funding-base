import { describe, expect, it, vi } from "vitest";
import { toAdminDashboardWhatsappConversation } from "../src/services/dynamodb/mappers";

type MessageOverrides = Record<string, unknown>;

const message = (overrides: MessageOverrides = {}) => ({
  entityType: "WhatsappMessage",
  invitationCode: "AB2345",
  messageId: "wamid.1",
  direction: "inbound",
  messageType: "text",
  correlationStatus: "matched",
  status: "received",
  createdAt: "2026-08-20T12:00:00.000Z",
  ...overrides
});

describe("toAdminDashboardWhatsappConversation", () => {
  it("returns undefined for an empty input", () => {
    expect(toAdminDashboardWhatsappConversation([])).toBeUndefined();
  });

  it("summarizes a single inbound message as one unread", () => {
    expect(toAdminDashboardWhatsappConversation([
      message({ body: "Vamos sim!" })
    ])).toEqual({
      messageCount: 1,
      unreadCount: 1,
      lastMessageAt: "2026-08-20T12:00:00.000Z",
      lastMessageDirection: "inbound",
      lastMessageType: "text",
      lastMessagePreview: "Vamos sim!",
      lastInboundMessagePreview: "Vamos sim!"
    });
  });

  it("summarizes a bodyless decline button with its id and semantic action", () => {
    expect(toAdminDashboardWhatsappConversation([
      message({ messageType: "button_reply", buttonId: "rsvp_b2_decline" })
    ])).toMatchObject({
      lastInboundMessageButtonId: "rsvp_b2_decline",
      lastInboundMessageButtonAction: "decline"
    });
    expect(toAdminDashboardWhatsappConversation([
      message({ messageType: "button_reply", buttonId: "unknown_button" })
    ])).toMatchObject({ lastInboundMessageButtonId: "unknown_button" });
  });

  it("summarizes a single outbound message as zero unread", () => {
    expect(toAdminDashboardWhatsappConversation([
      message({
        messageId: "wamid.out",
        direction: "outbound",
        messageType: "template",
        templateId: "wedding_invitation",
        status: "sent"
      })
    ])).toEqual({
      messageCount: 1,
      unreadCount: 0,
      lastMessageAt: "2026-08-20T12:00:00.000Z",
      lastMessageDirection: "outbound",
      lastMessageType: "template",
      lastMessageTemplateId: "wedding_invitation",
      lastOutboundMessageTemplateId: "wedding_invitation"
    });
  });

  it("counts the trailing run of consecutive inbound messages", () => {
    const summary = toAdminDashboardWhatsappConversation([
      message({ messageId: "m1", direction: "outbound", createdAt: "2026-08-20T12:00:00.000Z" }),
      message({ messageId: "m2", direction: "inbound", createdAt: "2026-08-20T12:01:00.000Z" }),
      message({ messageId: "m3", direction: "inbound", createdAt: "2026-08-20T12:02:00.000Z" }),
      message({ messageId: "m4", direction: "inbound", createdAt: "2026-08-20T12:03:00.000Z", body: "Última" })
    ]);

    expect(summary).toMatchObject({
      messageCount: 4,
      unreadCount: 3,
      lastMessageAt: "2026-08-20T12:03:00.000Z",
      lastMessageDirection: "inbound",
      lastMessagePreview: "Última"
    });
  });

  it("stops the unread run at the first outbound message, whatever the input order", () => {
    const summary = toAdminDashboardWhatsappConversation([
      message({ messageId: "m4", direction: "inbound", createdAt: "2026-08-20T12:03:00.000Z" }),
      message({ messageId: "m1", direction: "inbound", createdAt: "2026-08-20T12:00:00.000Z" }),
      message({ messageId: "m3", direction: "outbound", createdAt: "2026-08-20T12:02:00.000Z" }),
      message({ messageId: "m2", direction: "inbound", createdAt: "2026-08-20T12:01:00.000Z" })
    ]);

    expect(summary).toMatchObject({ messageCount: 4, unreadCount: 1 });
  });

  it("excludes unmatched, ambiguous, mismatched, and unknown-invitation messages", () => {
    const summary = toAdminDashboardWhatsappConversation([
      message({ messageId: "kept", body: "Contada" }),
      message({ messageId: "ambiguous", correlationStatus: "ambiguous_sender", createdAt: "2026-08-20T13:00:00.000Z" }),
      message({ messageId: "mismatch", correlationStatus: "sender_mismatch", createdAt: "2026-08-20T14:00:00.000Z" }),
      message({ messageId: "unknown", correlationStatus: "unknown_invitation", createdAt: "2026-08-20T15:00:00.000Z" }),
      message({ messageId: "unmatched", correlationStatus: "unmatched_sender", createdAt: "2026-08-20T16:00:00.000Z" })
    ]);

    expect(summary).toEqual({
      messageCount: 1,
      unreadCount: 1,
      lastMessageAt: "2026-08-20T12:00:00.000Z",
      lastMessageDirection: "inbound",
      lastMessageType: "text",
      lastMessagePreview: "Contada",
      lastInboundMessagePreview: "Contada"
    });
  });

  it("excludes a message whose invitationCode is absent even when it claims to be matched", () => {
    expect(toAdminDashboardWhatsappConversation([
      message({ invitationCode: undefined })
    ])).toBeUndefined();
  });

  it("treats an absent correlationStatus with a present invitationCode as matched", () => {
    expect(toAdminDashboardWhatsappConversation([
      message({ correlationStatus: undefined })
    ])).toMatchObject({ messageCount: 1, unreadCount: 1 });
  });

  it("treats an absent correlationStatus with no invitationCode as unmatched", () => {
    expect(toAdminDashboardWhatsappConversation([
      message({ correlationStatus: undefined, invitationCode: undefined })
    ])).toBeUndefined();
  });

  it("omits the preview for a template message with no stored body", () => {
    const summary = toAdminDashboardWhatsappConversation([
      message({
        direction: "outbound",
        messageType: "template",
        templateId: "wedding_rsvp_reconfirmation",
        status: "delivered"
      })
    ]);

    expect(summary).toMatchObject({
      lastMessageTemplateId: "wedding_rsvp_reconfirmation",
      lastOutboundMessageTemplateId: "wedding_rsvp_reconfirmation"
    });
    expect(summary?.lastMessagePreview).toBeUndefined();
    expect(summary?.lastOutboundMessagePreview).toBeUndefined();
  });

  it("summarizes the newest message independently for each direction", () => {
    const summary = toAdminDashboardWhatsappConversation([
      message({
        messageId: "out-old",
        direction: "outbound",
        createdAt: "2026-08-20T12:00:00.000Z",
        templateId: "wedding_invitation",
        messageType: "template",
        status: "sent"
      }),
      message({
        messageId: "in-new",
        direction: "inbound",
        createdAt: "2026-08-20T12:01:00.000Z",
        body: "Resposta mais recente"
      }),
      message({
        messageId: "out-new",
        direction: "outbound",
        createdAt: "2026-08-20T12:02:00.000Z",
        body: "Envio mais recente",
        messageType: "text",
        status: "sent"
      })
    ]);

    expect(summary).toMatchObject({
      lastMessageDirection: "outbound",
      lastOutboundMessagePreview: "Envio mais recente",
      lastInboundMessagePreview: "Resposta mais recente"
    });
    expect(summary?.lastOutboundMessageTemplateId).toBeUndefined();
    expect(summary?.lastInboundMessageTemplateId).toBeUndefined();
  });

  it("uses the template ID for a direction when its body is unavailable", () => {
    const summary = toAdminDashboardWhatsappConversation([
      message({
        messageId: "out-template",
        direction: "outbound",
        messageType: "template",
        templateId: "wedding_rsvp_attending_followup_website",
        status: "delivered"
      }),
      message({
        messageId: "in-media",
        direction: "inbound",
        messageType: "image",
        status: "received",
        createdAt: "2026-08-20T12:01:00.000Z"
      })
    ]);

    expect(summary).toMatchObject({
      lastOutboundMessageTemplateId: "wedding_rsvp_attending_followup_website"
    });
    expect(summary?.lastInboundMessagePreview).toBeUndefined();
    expect(summary?.lastInboundMessageTemplateId).toBeUndefined();
  });

  it("breaks ties on an equal createdAt with the messageId", () => {
    const summary = toAdminDashboardWhatsappConversation([
      message({ messageId: "wamid.b", direction: "inbound", body: "segunda" }),
      message({ messageId: "wamid.a", direction: "outbound" })
    ]);

    expect(summary).toMatchObject({
      messageCount: 2,
      unreadCount: 1,
      lastMessageDirection: "inbound",
      lastMessagePreview: "segunda"
    });

    const reversed = toAdminDashboardWhatsappConversation([
      message({ messageId: "wamid.a", direction: "outbound" }),
      message({ messageId: "wamid.b", direction: "inbound", body: "segunda" })
    ]);
    expect(reversed).toEqual(summary);
  });

  it.each([
    ["a missing messageId", { messageId: undefined }],
    ["a non-string messageId", { messageId: 12 }],
    ["a missing createdAt", { createdAt: undefined }],
    ["a missing direction", { direction: undefined }],
    ["an unknown direction", { direction: "sideways" }]
  ])("skips a record with %s and reports it once", (_label, overrides) => {
    const onSkippedMessage = vi.fn();

    const summary = toAdminDashboardWhatsappConversation(
      [message({ messageId: "good", body: "Válida" }), message({ messageId: "bad", ...overrides })],
      { onSkippedMessage }
    );

    expect(summary).toMatchObject({ messageCount: 1, unreadCount: 1 });
    expect(onSkippedMessage).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when every record is malformed and never throws", () => {
    const onSkippedMessage = vi.fn();

    expect(toAdminDashboardWhatsappConversation(
      [message({ createdAt: undefined }), message({ messageId: undefined })],
      { onSkippedMessage }
    )).toBeUndefined();
    expect(onSkippedMessage).toHaveBeenCalledTimes(2);
  });

  it("truncates the preview to 160 characters without appending an ellipsis", () => {
    const body = `${"a".repeat(160)}bcd`;

    const summary = toAdminDashboardWhatsappConversation([message({ body })]);

    expect(summary?.lastMessagePreview).toBe("a".repeat(160));
    expect(summary?.lastMessagePreview).toHaveLength(160);
    expect(summary?.lastMessagePreview?.endsWith("…")).toBe(false);
  });

  it("keeps a body that is exactly at the boundary intact", () => {
    const body = "b".repeat(160);

    expect(toAdminDashboardWhatsappConversation([message({ body })])?.lastMessagePreview).toBe(body);
  });

  it("exposes at most one body, from the newest message only", () => {
    const summary = toAdminDashboardWhatsappConversation([
      message({ messageId: "m1", createdAt: "2026-08-20T12:00:00.000Z", body: "corpo-antigo" }),
      message({ messageId: "m2", createdAt: "2026-08-20T12:01:00.000Z", body: "corpo-novo" })
    ]);

    expect(summary?.lastMessagePreview).toBe("corpo-novo");
    expect(JSON.stringify(summary)).not.toContain("corpo-antigo");
    expect(
      Object.entries(summary ?? {}).filter(
        ([key]) => !key.toLowerCase().includes("preview")
      )
        .map(([, value]) => String(value))
    ).not.toContain("corpo-novo");
  });

  it("never includes an unassigned or unmatched message body in the preview, even if newer", () => {
    const summary = toAdminDashboardWhatsappConversation([
      message({
        messageId: "m-matched",
        createdAt: "2026-08-20T12:00:00.000Z",
        body: "corpo-autorizado-do-convite",
        correlationStatus: "matched",
        invitationCode: "AB2345"
      }),
      message({
        messageId: "m-unassigned",
        createdAt: "2026-08-20T12:05:00.000Z",
        body: "corpo-privado-nao-atribuido",
        correlationStatus: "unmatched_sender",
        invitationCode: undefined
      })
    ]);

    expect(summary?.lastMessagePreview).toBe("corpo-autorizado-do-convite");
    expect(JSON.stringify(summary)).not.toContain("corpo-privado-nao-atribuido");
  });
});
