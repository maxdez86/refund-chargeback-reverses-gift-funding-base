import {
  WhatsappRsvpSendAvailabilitySchema,
  type HouseholdInvitation,
  type WhatsappRsvpSendAvailability
} from "@brimax/contracts";

/**
 * Derives the operator actions the automatic RSVP endpoint can accept from the
 * authoritative invitation state. Completed journeys may restart only while
 * every guest is still pending and WhatsApp has not recorded a decisive outcome.
 */
export function deriveWhatsappRsvpSendAvailability(
  invitation: HouseholdInvitation
): WhatsappRsvpSendAvailability {
  const status = invitation.whatsappFlowStatus ?? "idle";
  const completed = Boolean(invitation.whatsappFlowCompletedAt);
  const completedPending =
    status === "completed" &&
    completed &&
    invitation.guests.every((guest) => guest.rsvpStatus === "pending") &&
    (invitation.whatsappAttendance?.length ?? 0) === 0;

  const resendReason = !completed && status === "failed"
    ? "failed" as const
    : !completed && status === "undecided"
      ? "undecided" as const
      : completedPending
        ? "completed_pending" as const
        : undefined;

  return WhatsappRsvpSendAvailabilitySchema.parse({
    firstAllowed: !completed && status === "idle",
    resendAllowed: resendReason !== undefined,
    ...(resendReason ? { resendReason } : {})
  });
}
