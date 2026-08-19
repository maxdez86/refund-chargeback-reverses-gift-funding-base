import { describe, expect, it, vi } from "vitest";
import type { HouseholdInvitation } from "@brimax/contracts";
import type { WhatsappStoredComponent } from "../src/services/whatsapp/schemas";
import {
  deriveTemplateParameters,
  extractFirstName,
  formatGuestList,
  GUEST_LIST_MAX_LENGTH,
  invitationLinkSuffix,
  templateParameterSlots
} from "../src/domain/whatsapp-template-variables";
import { bindComponents } from "../src/services/whatsapp/template-message-service";

function invitationFixture(overrides: Partial<HouseholdInvitation> = {}): HouseholdInvitation {
  return {
    invitationCode: "SW2748",
    householdName: "Eugênia Ribeiro",
    phoneNumber: "5511963656517",
    guests: [
      { guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "attending" },
      { guestId: "g2", guestName: "Bruno", allowedPlusOnes: 0, rsvpStatus: "pending" },
      { guestId: "g3", guestName: "Carla", allowedPlusOnes: 0, rsvpStatus: "declined" }
    ],
    ...overrides
  };
}

const definition = (purpose: string, components: WhatsappStoredComponent[]) => ({
  purpose,
  components
});

describe("WhatsApp template variables", () => {
  it("derives all four approved values", () => {
    const result = deriveTemplateParameters(invitationFixture(), definition("wedding_rsvp_pending_reminder", [
      { type: "body", parameters: [
        { key: "household_name", type: "text" },
        { key: "guests", type: "text" },
        { key: "invitation_code", type: "text" }
      ] },
      { type: "button", subType: "url", index: 0, parameters: [{ key: "invitation_link_suffix", type: "text" }] }
    ]));
    expect(result).toEqual({
      household_name: { type: "text", text: "Eugênia" },
      guests: { type: "text", text: "Ana, Bruno e Carla" },
      invitation_code: { type: "text", text: "SW2748" },
      invitation_link_suffix: { type: "text", text: "?code=SW2748#confirmar-presenca" }
    });
  });

  it("extracts the first name from household names", () => {
    expect(extractFirstName("Cristiane Andrade da Silva e família")).toBe("Cristiane");
    expect(extractFirstName("Ronaldo da Silva")).toBe("Ronaldo");
    expect(extractFirstName(" Ana\n    Ribeiro\t")).toBe("Ana");
    expect(extractFirstName("Eugênia Ribeiro")).toBe("Eugênia");
    expect(extractFirstName("Ronaldo")).toBe("Ronaldo");
    expect(() => extractFirstName("   ")).toThrow("household name is empty");
  });

  it("rejects retired, unknown, non-text, and conflicting slots at derivation", () => {
    const base = { type: "body" as const, parameters: [{ key: "invitation_link", type: "text" as const }] };
    expect(() => templateParameterSlots([base])).toThrow("Unsupported");
    expect(() => templateParameterSlots([{ type: "body", parameters: [{ key: "unknown", type: "text" }] }])).toThrow("Unsupported");
    expect(() => templateParameterSlots([{ type: "body", parameters: [{ key: "guests", type: "date_time" }] }])).toThrow("must be a text slot");
    expect(() => templateParameterSlots([
      { type: "body", parameters: [{ key: "guests", type: "text" }] },
      { type: "button", subType: "url", index: 0, parameters: [{ key: "guests", type: "date_time" }] }
    ])).toThrow("must be a text slot");
  });

  it("formats Portuguese guest conjunctions and keeps source order", () => {
    expect(formatGuestList(["Ana"], 100)).toBe("Ana");
    expect(formatGuestList(["Ana", "Bruno"], 100)).toBe("Ana e Bruno");
    expect(formatGuestList(["Ana", "Bruno", "Carla"], 100)).toBe("Ana, Bruno e Carla");
    expect(formatGuestList(["Eugênia"], 100)).toBe("Eugênia");
  });

  it("uses purpose-aware guest scopes", () => {
    const invitation = invitationFixture();
    expect(deriveTemplateParameters(invitation, definition("wedding_rsvp_reconfirmation", [
      { type: "body", parameters: [{ key: "guests", type: "text" }] }
    ])).guests.text).toBe("Ana");
    expect(deriveTemplateParameters(invitation, definition("wedding_rsvp_pending_reminder", [
      { type: "body", parameters: [{ key: "guests", type: "text" }] }
    ])).guests.text).toBe("Ana, Bruno e Carla");
    expect(() => deriveTemplateParameters(invitationFixture({ guests: invitation.guests.map((guest) => ({ ...guest, rsvpStatus: "declined" })) }), definition("wedding_rsvp_reconfirmation", [
      { type: "body", parameters: [{ key: "guests", type: "text" }] }
    ]))).toThrow("pending_reminder");
  });

  it("sanitizes empty and inline whitespace values", () => {
    expect(() => deriveTemplateParameters(invitationFixture({ householdName: "   " }), definition("wedding_rsvp_pending_reminder", [
      { type: "body", parameters: [{ key: "household_name", type: "text" }] }
    ]))).toThrow("household name is empty");
    expect(deriveTemplateParameters(invitationFixture({ householdName: " Ana\n    Ribeiro\t" }), definition("wedding_rsvp_pending_reminder", [
      { type: "body", parameters: [{ key: "household_name", type: "text" }] }
    ])).household_name.text).toBe("Ana");
  });

  it("validates links and handles overflow without cutting a name", () => {
    expect(invitationLinkSuffix("SW2748")).toBe("?code=SW2748#confirmar-presenca");
    expect(() => invitationLinkSuffix("AAAAAA")).toThrow();
    const names = Array.from({ length: 100 }, (_, index) => `Guest ${index} with a long family name`);
    const result = formatGuestList(names, GUEST_LIST_MAX_LENGTH);
    expect(result.length).toBeLessThanOrEqual(GUEST_LIST_MAX_LENGTH);
    expect(result).toContain(" e mais ");
    expect(result).not.toMatch(/Guest \d+ with a long family nam[^e]/);
  });

  it("preserves slot order through named binding and supports zero variables", () => {
    const components = [
      { type: "body" as const, parameters: [
        { key: "household_name", type: "text" as const },
        { key: "guests", type: "text" as const }
      ] }
    ];
    const parameters = deriveTemplateParameters(invitationFixture(), definition("wedding_rsvp_pending_reminder", components));
    expect(bindComponents(components, parameters, "named")).toEqual([{
      type: "body",
      parameters: [
        { type: "text", text: "Eugênia", parameter_name: "household_name" },
        { type: "text", text: "Ana, Bruno e Carla", parameter_name: "guests" }
      ]
    }]);
    expect(deriveTemplateParameters(invitationFixture(), { purpose: "wedding_invitation", components: [] })).toEqual({});
    expect(bindComponents([], {}, "named")).toBeUndefined();
  });

  it("logs truncation without guest names", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const names = Array.from({ length: 100 }, (_, index) => ({ guestId: String(index), guestName: `Guest ${index} with a long family name`, allowedPlusOnes: 0, rsvpStatus: "pending" as const }));
    deriveTemplateParameters(invitationFixture({ guests: names }), definition("wedding_rsvp_pending_reminder", [
      { type: "body", parameters: [{ key: "guests", type: "text" }] }
    ]));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"metric":"WHATSAPP_GUEST_LIST_TRUNCATED"'));
    expect(info.mock.calls[0]?.[0]).not.toContain("Guest 0");
    info.mockRestore();
  });
});
