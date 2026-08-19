import { describe, expect, it } from "vitest";
import { selectWhatsappRsvpTemplate } from "../src/domain/whatsapp-rsvp-template-selection";

const guest = (rsvpStatus: "pending" | "attending" | "declined") => ({
  guestId: `guest-${rsvpStatus}`,
  guestName: "Ana",
  allowedPlusOnes: 0,
  rsvpStatus
});

describe("selectWhatsappRsvpTemplate", () => {
  it("selects reconfirmation when any guest is attending", () => {
    expect(selectWhatsappRsvpTemplate({ guests: [guest("pending"), guest("attending")] })).toBe(
      "wedding_rsvp_reconfirmation"
    );
  });

  it.each([
    [[guest("pending")]],
    [[guest("declined")]],
    [[]]
  ])("selects the pending reminder when there are no attending guests", (guests) => {
    expect(selectWhatsappRsvpTemplate({ guests })).toBe("wedding_rsvp_pending_reminder");
  });
});
