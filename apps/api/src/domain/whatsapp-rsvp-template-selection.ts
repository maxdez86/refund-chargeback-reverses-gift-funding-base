import type { HouseholdInvitation, WhatsappRsvpTemplatePurpose } from "@brimax/contracts";

type InvitationWithGuests = Pick<HouseholdInvitation, "guests">;
type Audience = "single" | "group";
type AudienceAwarePurpose = { single: WhatsappRsvpTemplatePurpose; group: WhatsappRsvpTemplatePurpose };

const WHATSAPP_RSVP_TEMPLATES = {
  reconfirmation: {
    single: "wedding_rsvp_reconfirmation_single",
    group: "wedding_rsvp_reconfirmation"
  },
  pending: {
    single: "wedding_rsvp_pending_reminder_single",
    group: "wedding_rsvp_pending_reminder_group"
  },
  attendance: {
    single: "wedding_rsvp_attending_followup_single",
    group: "wedding_rsvp_attending_followup"
  },
  declined: {
    single: "wedding_rsvp_declined_followup_single",
    group: "wedding_rsvp_declined_followup"
  },
  undecided: {
    single: "wedding_rsvp_undecided_followup_single",
    group: "wedding_rsvp_undecided_followup"
  },
  websiteAttendance: {
    single: "wedding_rsvp_attending_followup_website_single",
    group: "wedding_rsvp_attending_followup_website"
  }
} as const satisfies Record<string, AudienceAwarePurpose>;

function audienceForInvitation(invitation: InvitationWithGuests): Audience {
  if (invitation.guests.length === 0) {
    throw new Error("Invitation must contain at least one guest.");
  }
  return invitation.guests.length === 1 ? "single" : "group";
}

function selectAudienceAwareTemplate(
  invitation: InvitationWithGuests,
  templates: AudienceAwarePurpose
): WhatsappRsvpTemplatePurpose {
  return templates[audienceForInvitation(invitation)];
}

export function selectWhatsappRsvpTemplate(invitation: InvitationWithGuests): WhatsappRsvpTemplatePurpose {
  const templates = invitation.guests.some((guest) => guest.rsvpStatus === "attending")
    ? WHATSAPP_RSVP_TEMPLATES.reconfirmation
    : WHATSAPP_RSVP_TEMPLATES.pending;

  return selectAudienceAwareTemplate(invitation, templates);
}

export function selectWhatsappAttendanceFollowupTemplate(invitation: InvitationWithGuests): WhatsappRsvpTemplatePurpose {
  return selectAudienceAwareTemplate(invitation, WHATSAPP_RSVP_TEMPLATES.attendance);
}

export function selectWhatsappDeclinedFollowupTemplate(invitation: InvitationWithGuests): WhatsappRsvpTemplatePurpose {
  return selectAudienceAwareTemplate(invitation, WHATSAPP_RSVP_TEMPLATES.declined);
}

export function selectWhatsappUndecidedFollowupTemplate(invitation: InvitationWithGuests): WhatsappRsvpTemplatePurpose {
  return selectAudienceAwareTemplate(invitation, WHATSAPP_RSVP_TEMPLATES.undecided);
}

export function selectWebsiteAttendanceFollowupTemplate(invitation: InvitationWithGuests): WhatsappRsvpTemplatePurpose {
  return selectAudienceAwareTemplate(invitation, WHATSAPP_RSVP_TEMPLATES.websiteAttendance);
}
