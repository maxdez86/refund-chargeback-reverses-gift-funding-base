import { describe, expect, it } from "vitest";
import {
  WHATSAPP_RSVP_TEMPLATE_PURPOSES,
  WhatsappFlowStageSchema,
  WhatsappRsvpActionSchema
} from "@brimax/contracts";
import {
  WHATSAPP_TEMPLATE_MANIFEST,
  WhatsappTemplateManifestError,
  actionForButtonId,
  flowStageForTemplate,
  getTemplateManifestEntry,
  listTemplateManifestEntries,
  templatesByStage
} from "../src/services/whatsapp/template-manifest";
import {
  WhatsappStoredComponentSchema,
  WhatsappTemplateDefinitionSchema,
  WhatsappTemplatePurposeSchema
} from "../src/services/whatsapp/schemas";
import {
  GUEST_LIST_SCOPE_BY_PURPOSE,
  WHATSAPP_DERIVABLE_PARAMETER_KEYS
} from "../src/domain/whatsapp-template-variables";

const entries = listTemplateManifestEntries();
const NEW_RSVP_PURPOSES = WHATSAPP_RSVP_TEMPLATE_PURPOSES.filter(
  (purpose) => purpose !== "wedding_invitation"
);

function buttonComponents(purpose: string) {
  return getTemplateManifestEntry(purpose).definition.components.filter(
    (component) => component.type === "button"
  );
}

describe("WhatsApp template manifest", () => {
  it("holds exactly the six known purposes, each keyed by its own definition purpose", () => {
    expect(entries).toHaveLength(6);
    expect(Object.keys(WHATSAPP_TEMPLATE_MANIFEST).sort()).toEqual(
      [...WHATSAPP_RSVP_TEMPLATE_PURPOSES].sort()
    );
    for (const [purpose, entry] of Object.entries(WHATSAPP_TEMPLATE_MANIFEST)) {
      expect(WhatsappTemplatePurposeSchema.safeParse(purpose).success).toBe(true);
      expect(entry.definition.purpose).toBe(purpose);
    }
  });

  it("carries definitions that are seedable as-is", () => {
    for (const entry of entries) {
      expect(WhatsappTemplateDefinitionSchema.safeParse(entry.definition).success).toBe(true);
      expect(entry.definition.version).toBe(1);
      expect(entry.approvalStatus).toBe("approved");
      for (const component of entry.definition.components) {
        expect(WhatsappStoredComponentSchema.safeParse(component).success).toBe(true);
      }
    }
  });

  it("marks the five RSVP templates pt_BR and named, and wedding_invitation en and positional", () => {
    for (const purpose of NEW_RSVP_PURPOSES) {
      const { definition, metaTemplateId } = getTemplateManifestEntry(purpose);
      expect(definition.language).toBe("pt_BR");
      expect(definition.parameterFormat).toBe("named");
      expect(definition.name).toBe(purpose);
      expect(metaTemplateId).toMatch(/^\d+$/);
    }

    const invitation = getTemplateManifestEntry("wedding_invitation");
    expect(invitation.definition.language).toBe("en");
    expect(invitation.definition.parameterFormat).toBe("positional");
    expect(invitation.definition.name).toBe("wedding");
    expect(invitation.definition.components).toEqual([]);
    expect(invitation.flowStage).toBeUndefined();
  });

  it("declares body slots in the order Meta approved", () => {
    const bodySlots = (purpose: string) =>
      getTemplateManifestEntry(purpose)
        .definition.components.filter((component) => component.type === "body")
        .flatMap((component) => component.parameters.map((slot) => slot.key));

    expect(bodySlots("wedding_rsvp_reconfirmation")).toEqual([
      "household_name",
      "invitation_code",
      "guests"
    ]);
    expect(bodySlots("wedding_rsvp_pending_reminder")).toEqual(["household_name", "guests"]);
    expect(bodySlots("wedding_rsvp_attending_followup")).toEqual(["household_name"]);
    expect(bodySlots("wedding_rsvp_declined_followup")).toEqual(["household_name"]);
    expect(bodySlots("wedding_rsvp_undecided_followup")).toEqual(["household_name"]);
  });

  it("mixes a quick reply and a URL button on the reconfirmation template", () => {
    expect(buttonComponents("wedding_rsvp_reconfirmation")).toEqual([
      { type: "button", subType: "quick_reply", index: 0, buttonId: "rsvp_a1_confirm_all", parameters: [] },
      {
        type: "button",
        subType: "url",
        index: 1,
        parameters: [{ key: "invitation_link_suffix", type: "text" }]
      }
    ]);
  });

  it("gives the pending reminder three contiguous quick replies and the MARKETING category", () => {
    const entry = getTemplateManifestEntry("wedding_rsvp_pending_reminder");
    expect(entry.category).toBe("MARKETING");
    expect(buttonComponents("wedding_rsvp_pending_reminder").map((button) => button.index)).toEqual([0, 1, 2]);
    expect(entry.buttons.map((button) => [button.index, button.buttonId, button.action])).toEqual([
      [0, "rsvp_b1_attend_all", "attend_all"],
      [1, "rsvp_b2_decline", "decline"],
      [2, "rsvp_b3_undecided", "undecided"]
    ]);
    expect(entries.filter((candidate) => candidate.category === "MARKETING")).toHaveLength(1);
  });

  it("records the attending follow-up's maps link as a static button, never a component", () => {
    const entry = getTemplateManifestEntry("wedding_rsvp_attending_followup");
    expect(buttonComponents("wedding_rsvp_attending_followup")).toEqual([]);
    expect(entry.buttons).toEqual([]);
    expect(entry.staticButtons).toEqual([
      { index: 0, subType: "url", text: "Ver no mapa", url: "https://maps.app.goo.gl/a7pZhhReympySbiq6" }
    ]);
  });

  it("satisfies the stored-component button rules for every entry", () => {
    for (const entry of entries) {
      for (const component of entry.definition.components) {
        if (component.type !== "button") continue;
        if (component.subType === "quick_reply") {
          expect(component.buttonId).toBeTruthy();
          expect(component.parameters).toEqual([]);
        } else {
          expect(component.buttonId).toBeUndefined();
          expect(component.parameters).toHaveLength(1);
          expect(component.parameters[0].type).toBe("text");
        }
      }
    }
  });

  it("keeps every button id unique, mapped, and free of substring collisions", () => {
    const buttonIds = entries.flatMap((entry) => entry.buttons.map((button) => button.buttonId));
    expect(buttonIds).toEqual([
      "rsvp_a1_confirm_all",
      "rsvp_b1_attend_all",
      "rsvp_b2_decline",
      "rsvp_b3_undecided"
    ]);
    expect(new Set(buttonIds).size).toBe(buttonIds.length);

    for (const buttonId of buttonIds) {
      expect(WhatsappRsvpActionSchema.safeParse(actionForButtonId(buttonId)).success).toBe(true);
      for (const other of buttonIds) {
        if (other !== buttonId) expect(other.includes(buttonId)).toBe(false);
      }
    }
  });

  it("declares a known flow stage wherever it declares one", () => {
    for (const entry of entries) {
      if (entry.flowStage === undefined) continue;
      expect(WhatsappFlowStageSchema.safeParse(entry.flowStage).success).toBe(true);
    }
    expect(flowStageForTemplate("wedding_rsvp_reconfirmation")).toBe("reconfirmation");
    expect(flowStageForTemplate("wedding_rsvp_pending_reminder")).toBe("pending");
    expect(flowStageForTemplate("wedding_rsvp_declined_followup")).toBe("followup");
    expect(flowStageForTemplate("wedding_invitation")).toBeUndefined();
  });

  it("only declares variables the deriver is expected to produce", () => {
    const declared = entries.flatMap((entry) =>
      entry.definition.components.flatMap((component) =>
        component.parameters.map((slot) => slot.key)
      )
    );
    for (const key of declared) {
      expect(WHATSAPP_DERIVABLE_PARAMETER_KEYS).toContain(key);
    }
    // The retired full-URL key must never come back; the approved buttons take the suffix only.
    expect(declared).not.toContain("invitation_link");
    for (const entry of entries) {
      const hasGuests = entry.definition.components.some((component) =>
        component.parameters.some((slot) => slot.key === "guests")
      );
      if (hasGuests) expect(GUEST_LIST_SCOPE_BY_PURPOSE[entry.definition.purpose]).toBeDefined();
    }
  });

  it("looks entries up by purpose and stage, and throws a typed error for an unknown purpose", () => {
    expect(getTemplateManifestEntry("wedding_rsvp_declined_followup").metaTemplateId).toBe("2372473870257723");
    expect(templatesByStage("followup").map((entry) => entry.definition.purpose)).toEqual([
      "wedding_rsvp_attending_followup",
      "wedding_rsvp_declined_followup",
      "wedding_rsvp_undecided_followup"
    ]);
    expect(templatesByStage("reconfirmation")).toHaveLength(1);
    expect(templatesByStage("fallback")).toEqual([]);

    expect(() => getTemplateManifestEntry("wedding_rsvp_typo")).toThrow(WhatsappTemplateManifestError);
    expect(() => getTemplateManifestEntry("wedding_rsvp_typo")).toThrow("Unknown WhatsApp template purpose");
    expect(actionForButtonId("rsvp_unknown")).toBeUndefined();
  });
});
