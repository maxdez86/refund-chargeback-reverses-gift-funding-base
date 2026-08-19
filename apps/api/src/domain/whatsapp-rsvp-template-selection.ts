import type { HouseholdInvitation, WhatsappRsvpTemplatePurpose } from "@brimax/contracts";

export const WHATSAPP_AUTO_RSVP_TEMPLATES = {
  reconfirmation: "wedding_rsvp_reconfirmation",
  pending: "wedding_rsvp_pending_reminder"
} as const satisfies Record<string, WhatsappRsvpTemplatePurpose>;

export function selectWhatsappRsvpTemplate(invitation: Pick<HouseholdInvitation, "guests">): WhatsappRsvpTemplatePurpose {
  return invitation.guests.some((guest) => guest.rsvpStatus === "attending")
    ? WHATSAPP_AUTO_RSVP_TEMPLATES.reconfirmation
    : WHATSAPP_AUTO_RSVP_TEMPLATES.pending;
}
