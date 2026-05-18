import { z } from "zod";
import { RsvpStatusSchema } from "./guest";
import { InvitationCodeSchema } from "./invitation-code";

export const RsvpGuestAnswerSchema = z.object({
  guestId: z.string().min(1),
  status: RsvpStatusSchema,
  mealPreference: z.string().min(1).optional(),
  note: z.string().max(500).optional()
});

export const RsvpSubmissionRequestSchema = z.object({
  invitationCode: InvitationCodeSchema,
  householdId: z.string().min(1),
  submittedBy: z.string().min(1),
  guestResponses: z.array(RsvpGuestAnswerSchema).min(1),
  attendingGuestCount: z.number().int().nonnegative(),
  note: z.string().max(500).optional()
});

export const RsvpSubmissionResponseSchema = z.object({
  ok: z.literal(true),
  invitationCode: z.string(),
  householdId: z.string(),
  status: RsvpStatusSchema,
  updatedAt: z.string()
});

export type RsvpGuestAnswer = z.infer<typeof RsvpGuestAnswerSchema>;
export type RsvpSubmissionRequest = z.infer<typeof RsvpSubmissionRequestSchema>;
export type RsvpSubmissionResponse = z.infer<typeof RsvpSubmissionResponseSchema>;
