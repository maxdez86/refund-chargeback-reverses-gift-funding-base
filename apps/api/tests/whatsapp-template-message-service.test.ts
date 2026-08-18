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

  it("names header and body parameters for a NAMED definition", () => {
    const named = [
      {
        type: "body" as const,
        parameters: [
          { key: "household_name", type: "text" as const },
          { key: "guests", type: "text" as const }
        ]
      }
    ];

    expect(
      bindComponents(
        named,
        {
          household_name: { type: "text", text: "Família Silva" },
          guests: { type: "text", text: "Ana, Bruno" }
        },
        "named"
      )
    ).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", parameter_name: "household_name", text: "Família Silva" },
          { type: "text", parameter_name: "guests", text: "Ana, Bruno" }
        ]
      }
    ]);
  });

  it("leaves a POSITIONAL definition unnamed", () => {
    const bound = bindComponents(definitions, { guest_name: { type: "text", text: "Amanda" } });
    expect(bound?.[0]).toEqual({ type: "body", parameters: [{ type: "text", text: "Amanda" }] });
    expect(bound?.[0].parameters[0]).not.toHaveProperty("parameter_name");
  });

  it("never names a URL-button parameter, even under NAMED", () => {
    const named = [
      { type: "body" as const, parameters: [{ key: "household_name", type: "text" as const }] },
      {
        type: "button" as const,
        subType: "url" as const,
        index: 0,
        parameters: [{ key: "invitation_link_suffix", type: "text" as const }]
      }
    ];

    const bound = bindComponents(
      named,
      {
        household_name: { type: "text", text: "Família Silva" },
        invitation_link_suffix: { type: "text", text: "?code=SW2748#confirmar-presenca" }
      },
      "named"
    );

    expect(bound?.[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "?code=SW2748#confirmar-presenca" }]
    });
    expect(bound?.[1].parameters[0]).not.toHaveProperty("parameter_name");
  });

  it("fails closed when a NAMED definition declares a non-text body slot", () => {
    const named = [
      { type: "body" as const, parameters: [{ key: "when", type: "date_time" as const }] }
    ];
    expect(() =>
      bindComponents(named, { when: { type: "date_time", date_time: { fallback_value: "6 dez" } } }, "named")
    ).toThrow("must be a text parameter");
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

  it("carries a stored definition's NAMED format through to the sent parameters", async () => {
    const repository = {
      getActive: vi.fn().mockResolvedValue({
        purpose: "wedding_rsvp_attending_followup",
        version: 1,
        name: "wedding_rsvp_attending_followup",
        language: "pt_BR",
        parameterFormat: "named",
        components: [{ type: "body", parameters: [{ key: "household_name", type: "text" }] }],
        createdAt: "2026-08-16T00:00:00.000Z"
      })
    };
    const client = { sendTemplate: vi.fn().mockResolvedValue({ messageId: "wamid.2" }) };
    const service = new WhatsappTemplateMessageService(repository as never, client as never);

    await service.send(
      {
        purpose: "wedding_rsvp_attending_followup",
        to: "5511999999999",
        parameters: { household_name: { type: "text", text: "Família Silva" } }
      },
      { requestId: "request-2" }
    );

    expect(client.sendTemplate.mock.calls[0][0].template.components).toEqual([
      {
        type: "body",
        parameters: [{ type: "text", parameter_name: "household_name", text: "Família Silva" }]
      }
    ]);
  });
});
