import { describe, expect, it, vi } from "vitest";
import { WhatsappRsvpService } from "../src/domain/whatsapp-rsvp-service";
import { WhatsappRsvpSendService } from "../src/services/whatsapp/rsvp-send-service";

describe("WhatsApp RSVP log hygiene and correlation", () => {
  it("logs send correlation identifiers without recipient or message content", async () => {
    const log = vi.fn();
    const service = new WhatsappRsvpSendService({
      repository: {
        getInvitationByCode: async () => ({
          invitationCode: "SW2748",
          householdName: "Private Household",
          phoneNumber: "5511963656517",
          whatsappFlowStatus: "idle",
          guests: []
        }),
        getWhatsappCommand: async () => undefined,
        reserveWhatsappCommand: async () => undefined,
        updateWhatsappCommand: async () => undefined,
        updateWhatsappFlow: async () => undefined
      },
      templates: {
        getActive: async () => ({
          purpose: "wedding_rsvp_pending_reminder_group",
          name: "wedding_rsvp_pending_reminder_group",
          language: "pt_BR",
          version: 1,
          parameterFormat: "named",
          components: [],
          createdAt: "2026-08-17T12:00:00.000Z"
        })
      },
      publish: async () => ({ status: "queued", enqueuedAt: "2026-08-17T12:00:00.000Z" }),
      validateVariables: () => undefined,
      createCommandId: () => "command-1",
      log
    });

    await service.queueTemplate("SW2748", "wedding_rsvp_pending_reminder_group", undefined, { requestId: "request-1" });
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).toContain("request-1");
    expect(serialized).toContain("command-1");
    expect(serialized).not.toContain("5511963656517");
    expect(serialized).not.toContain("Private Household");
  });

  it("logs webhook correlation identifiers without sender or body data", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const repository = {
      recordWebhookEventIfNew: async () => true,
      updateWhatsappMessage: async () => ({ applied: false }),
      markWebhookEventProcessed: async () => undefined
    };
    const service = new WhatsappRsvpService(repository as never, {
      getActive: async () => null
    } as never, {} as never);

    await service.handleWebhookEvent({
      type: "status_delivered",
      eventId: "event-1",
      messageId: "wamid.1",
      status: "delivered",
      errors: [],
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "statuses", itemIndex: 0 }
    } as never, "request-1");

    const serialized = info.mock.calls.map(([line]) => String(line)).join("\n");
    expect(serialized).toContain("request-1");
    expect(serialized).toContain("event-1");
    expect(serialized).toContain("wamid.1");
    expect(serialized).not.toContain("5511963656517");
    expect(serialized).not.toContain("private message body");
    info.mockRestore();
  });
});
