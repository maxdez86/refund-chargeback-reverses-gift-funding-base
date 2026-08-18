import {
  WhatsappCommandStatusSchema,
  WhatsappMessageDirectionSchema,
  WhatsappMessageStatusSchema,
  WhatsappReconciliationStatusSchema
} from "@brimax/contracts";
import { describe, expect, it } from "vitest";
import {
  WhatsappCommandInputSchema,
  WhatsappCommandItemSchema,
  WhatsappMessageInputSchema,
  WhatsappMessageItemSchema,
  parseStoredWhatsappItem
} from "../src/services/dynamodb/whatsapp-items";

const NOW = "2026-08-17T12:00:00.000Z";
const WAMID = "wamid.HBgNNTUxMTk2MzY1NjUxNxUCABIYFjNBMEE3RjhCQzc5RDk4RkY4QjNBMQA=";

describe("WhatsApp status unions", () => {
  it("names the command lifecycle in exactly one place", () => {
    expect(WhatsappCommandStatusSchema.options).toEqual([
      "queued",
      "sending",
      "sent",
      "failed",
      "queue_unavailable",
      "reconciliation_required"
    ]);
    expect(WhatsappCommandStatusSchema.safeParse("delivered").success).toBe(false);
  });

  it("covers every Meta status webhook value plus our inbound marker", () => {
    // The webhook derives these by stripping the "status_" prefix from status_sent,
    // status_delivered, status_read and status_failed.
    for (const status of ["sent", "delivered", "read", "failed", "received"]) {
      expect(WhatsappMessageStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(WhatsappMessageStatusSchema.safeParse("queued").success).toBe(false);
    expect(WhatsappMessageDirectionSchema.options).toEqual(["inbound", "outbound"]);
    expect(WhatsappReconciliationStatusSchema.options).toEqual(["none", "required", "resolved"]);
  });
});

describe("WhatsApp item schemas", () => {
  it("strips key attributes a caller tries to smuggle into a write", () => {
    const parsed = WhatsappMessageInputSchema.parse({
      messageId: WAMID,
      invitationCode: "SW2748",
      direction: "outbound",
      status: "sent",
      createdAt: NOW,
      PK: "ATTACKER#1",
      SK: "OWNED",
      entityType: "Invitation",
      GSI1PK: "RESERVATION#OPEN"
    });

    expect(parsed).not.toHaveProperty("PK");
    expect(parsed).not.toHaveProperty("SK");
    expect(parsed).not.toHaveProperty("entityType");
    expect(parsed).not.toHaveProperty("GSI1PK");
  });

  it("defaults the fields Steps 09 and 13 depend on", () => {
    const parsed = WhatsappCommandInputSchema.parse({
      commandId: "cmd-1",
      invitationCode: "SW2748",
      templateId: "wedding_rsvp_reconfirmation",
      status: "queued",
      createdAt: NOW
    });

    expect(parsed.retryCount).toBe(0);
    expect(parsed.reconciliationStatus).toBe("none");
  });

  it("rejects a message ID that would produce an undefined partition key", () => {
    expect(
      WhatsappMessageInputSchema.safeParse({
        messageId: "",
        invitationCode: "SW2748",
        direction: "outbound",
        status: "sent",
        createdAt: NOW
      }).success
    ).toBe(false);
  });

  it("names the offending field when a stored record is malformed", () => {
    // The shape a phantom item takes: an UpdateItem on a missing key creates PK, SK and the
    // status it was setting, and nothing else.
    expect(() =>
      parseStoredWhatsappItem(
        WhatsappMessageItemSchema,
        { PK: `WHATSAPP_MESSAGE#${WAMID}`, SK: "MESSAGE", status: "delivered" },
        "WhatsApp message"
      )
    ).toThrow(/invitationCode/);
  });

  it("accepts a stored record written before the optional fields existed", () => {
    const parsed = parseStoredWhatsappItem(
      WhatsappCommandItemSchema,
      {
        PK: "WHATSAPP_COMMAND#cmd-1",
        SK: "COMMAND",
        entityType: "WhatsappCommand",
        commandId: "cmd-1",
        invitationCode: "SW2748",
        templateId: "wedding_rsvp_reconfirmation",
        status: "queued",
        createdAt: NOW
      },
      "WhatsApp command"
    );

    expect(parsed.retryCount).toBe(0);
    expect(parsed.providerMessageId).toBeUndefined();
  });
});
