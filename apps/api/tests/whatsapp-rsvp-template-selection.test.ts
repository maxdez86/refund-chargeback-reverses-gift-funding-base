import { describe, expect, it } from "vitest";
import { WhatsappRsvpTemplatePurposeSchema } from "@brimax/contracts";
import {
  selectWebsiteAttendanceFollowupTemplate,
  selectWhatsappAttendanceFollowupTemplate,
  selectWhatsappDeclinedFollowupTemplate,
  selectWhatsappRsvpTemplate,
  selectWhatsappUndecidedFollowupTemplate
} from "../src/domain/whatsapp-rsvp-template-selection";
import { getTemplateManifestEntry } from "../src/services/whatsapp/template-manifest";

const guest = (id: string, rsvpStatus: "pending" | "attending" | "declined") => ({
  guestId: id,
  guestName: "Ana",
  allowedPlusOnes: 0,
  rsvpStatus
});

const invitation = (...statuses: Array<"pending" | "attending" | "declined">) => ({
  guests: statuses.map((status, index) => guest(`guest-${index}`, status))
});

describe("selectWhatsappRsvpTemplate", () => {
  it.each([
    [["attending"], "wedding_rsvp_reconfirmation_single"],
    [["pending"], "wedding_rsvp_pending_reminder_single"],
    [["declined"], "wedding_rsvp_pending_reminder_single"],
    [["pending", "attending"], "wedding_rsvp_reconfirmation"],
    [["declined", "pending"], "wedding_rsvp_pending_reminder_group"],
    [["declined", "attending", "pending"], "wedding_rsvp_reconfirmation"]
  ] as const)("selects the expected opener for %j", (statuses, expected) => {
    expect(selectWhatsappRsvpTemplate(invitation(...statuses))).toBe(expected);
  });

  it("rejects an empty guest list", () => {
    expect(() => selectWhatsappRsvpTemplate({ guests: [] })).toThrow(
      "Invitation must contain at least one guest."
    );
  });
});

describe("audience-aware RSVP follow-up selectors", () => {
  it.each([
    [selectWhatsappAttendanceFollowupTemplate, "wedding_rsvp_attending_followup_single", "wedding_rsvp_attending_followup"],
    [selectWhatsappDeclinedFollowupTemplate, "wedding_rsvp_declined_followup_single", "wedding_rsvp_declined_followup"],
    [selectWhatsappUndecidedFollowupTemplate, "wedding_rsvp_undecided_followup_single", "wedding_rsvp_undecided_followup"],
    [selectWebsiteAttendanceFollowupTemplate, "wedding_rsvp_attending_followup_website_single", "wedding_rsvp_attending_followup_website"]
  ] as const)("selects single and group variants", (selector, single, group) => {
    expect(selector(invitation("attending"))).toBe(single);
    expect(selector(invitation("attending", "declined"))).toBe(group);
  });

  it("uses the website attendance selector for partial attendance and the decline selector for all-declined responses", () => {
    expect(selectWebsiteAttendanceFollowupTemplate(invitation("attending", "declined"))).toBe(
      "wedding_rsvp_attending_followup_website"
    );
    expect(selectWhatsappDeclinedFollowupTemplate(invitation("declined", "declined"))).toBe(
      "wedding_rsvp_declined_followup"
    );
  });

  it("rejects empty guest lists for every follow-up selector", () => {
    const selectors = [
      selectWhatsappAttendanceFollowupTemplate,
      selectWhatsappDeclinedFollowupTemplate,
      selectWhatsappUndecidedFollowupTemplate,
      selectWebsiteAttendanceFollowupTemplate
    ];
    for (const selector of selectors) {
      expect(() => selector({ guests: [] })).toThrow("Invitation must contain at least one guest.");
    }
  });

  it("returns purposes present in both the closed contract and manifest", () => {
    const purposes = [
      selectWhatsappRsvpTemplate(invitation("attending")),
      selectWhatsappRsvpTemplate(invitation("pending")),
      selectWhatsappAttendanceFollowupTemplate(invitation("attending")),
      selectWhatsappDeclinedFollowupTemplate(invitation("declined")),
      selectWhatsappUndecidedFollowupTemplate(invitation("pending")),
      selectWebsiteAttendanceFollowupTemplate(invitation("attending"))
    ];
    for (const purpose of purposes) {
      expect(WhatsappRsvpTemplatePurposeSchema.safeParse(purpose).success).toBe(true);
      expect(getTemplateManifestEntry(purpose).definition.purpose).toBe(purpose);
    }
  });
});
