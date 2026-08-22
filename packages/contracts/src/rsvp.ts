import { z } from "zod";
import { PublicHouseholdInvitationSchema, RsvpStatusSchema } from "./guest";
import { InvitationCodeSchema } from "./invitation-code";

/** Prefix the site puts on the RSVP note when the guest suggests a song. */
export const MUSIC_NOTE_PREFIX = "Música sugerida: ";

/** The song a guest suggested, or the raw note when it carries no prefix. */
export function musicSuggestionFromNote(note?: string) {
  if (!note) return undefined;
  return note.startsWith(MUSIC_NOTE_PREFIX) ? note.slice(MUSIC_NOTE_PREFIX.length) : note;
}

export const RsvpGuestAnswerSchema = z.object({
  guestId: z.string().min(1),
  status: RsvpStatusSchema,
  isChildSixOrYounger: z.boolean(),
  mealPreference: z.string().min(1).optional(),
  note: z.string().max(500).optional()
});

export const RsvpSubmissionRequestSchema = z.object({
  invitationCode: InvitationCodeSchema,
  submittedBy: z.string().min(1),
  guestResponses: z.array(RsvpGuestAnswerSchema).min(1),
  attendingGuestCount: z.number().int().nonnegative(),
  note: z.string().max(500).optional()
});

export const RsvpSubmissionResponseSchema = z.object({
  ok: z.literal(true),
  invitationCode: z.string(),
  status: RsvpStatusSchema,
  updatedAt: z.string()
});

export const InvitationLookupResponseSchema = z.object({
  invitation: PublicHouseholdInvitationSchema,
  lookupProof: z.string().min(1),
  lookupProofExpiresAt: z.string().datetime()
});

export type RsvpGuestAnswer = z.infer<typeof RsvpGuestAnswerSchema>;
export type InvitationLookupResponse = z.infer<typeof InvitationLookupResponseSchema>;
export type RsvpSubmissionRequest = z.infer<typeof RsvpSubmissionRequestSchema>;
export type RsvpSubmissionResponse = z.infer<typeof RsvpSubmissionResponseSchema>;
