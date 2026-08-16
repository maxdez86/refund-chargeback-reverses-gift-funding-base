import { describe, expect, it, vi } from "vitest";
import { bindComponents, WhatsappTemplateMessageService } from "../src/services/whatsapp/template-message-service";
import { WhatsappStoredComponentSchema } from "../src/services/whatsapp/schemas";

describe("WhatsApp template binding", () => {
  const definitions = [
    { type: "body" as const, parameters: [{ key: "guest_name", type: "text" as const }] },
    {
      type: "button" as const,
      subType: "quick_reply" as const,
      index: 0,
      buttonId: "attending",
      parameters: []
    }
  ];

  it("binds typed parameters and static button identifiers", () => {
    expect(bindComponents(definitions, { guest_name: { type: "text", text: "Amanda" } })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Amanda" }] },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "0",
        parameters: [{ type: "payload", payload: "attending" }]
      }
    ]);
  });

  it("rejects missing, unexpected, and incorrectly typed values", () => {
    expect(() => bindComponents(definitions, {})).toThrow("Missing WhatsApp template parameter");
    expect(() =>
      bindComponents(definitions, { guest_name: { type: "payload", payload: "wrong" } })
    ).toThrow("wrong type");
    expect(() =>
      bindComponents(definitions, {
        guest_name: { type: "text", text: "Amanda" },
        extra: { type: "text", text: "unexpected" }
      })
    ).toThrow("Unexpected WhatsApp template parameter");
  });

  it("validates quick-reply and URL button definitions", () => {
    expect(
      WhatsappStoredComponentSchema.safeParse({
        type: "button",
        subType: "quick_reply",
        index: 0,
        buttonId: "attending",
        parameters: []
      }).success
    ).toBe(true);
    expect(
      WhatsappStoredComponentSchema.safeParse({
        type: "button",
        subType: "quick_reply",
        index: 0,
        parameters: [{ key: "payload", type: "payload" }]
      }).success
    ).toBe(false);
    expect(
      WhatsappStoredComponentSchema.safeParse({
        type: "button",
        subType: "url",
        index: 0,
        parameters: [{ key: "invitation_code", type: "text" }]
      }).success
    ).toBe(true);
  });
});

describe("WhatsappTemplateMessageService", () => {
  it("resolves a purpose and forwards safe correlation metadata", async () => {
    const repository = {
      getActive: vi.fn().mockResolvedValue({
        purpose: "wedding_invitation",
        version: 1,
        name: "wedding",
        language: "en",
        components: [],
        createdAt: "2026-08-15T12:00:00.000Z"
      })
    };
    const client = {
      sendTemplate: vi.fn().mockResolvedValue({ messageId: "wamid.1" })
    };
    const service = new WhatsappTemplateMessageService(repository as never, client as never);

    await expect(
      service.send({ purpose: "wedding_invitation", to: "5511999999999" }, { requestId: "request-1" })
    ).resolves.toEqual({
      messageId: "wamid.1",
      templatePurpose: "wedding_invitation",
      templateVersion: 1
    });
    expect(client.sendTemplate).toHaveBeenCalledWith(
      { to: "5511999999999", template: { name: "wedding", language: "en" } },
      { requestId: "request-1", templatePurpose: "wedding_invitation", templateVersion: 1 }
    );
  });
});
