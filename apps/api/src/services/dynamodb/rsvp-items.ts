import { RsvpGuestAnswerSchema, RsvpStatusSchema } from "@brimax/contracts";
import { z } from "zod";

export const RsvpResponseItemSchema = z.object({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("RsvpResponse"),
  invitationCode: z.string().min(1),
  submittedBy: z.string().min(1),
  guestResponses: z.array(RsvpGuestAnswerSchema),
  attendingGuestCount: z.number().int().nonnegative(),
  paidAttendingGuestCount: z.number().int().nonnegative(),
  childSixOrYoungerAttendingCount: z.number().int().nonnegative(),
  note: z.string().max(500).optional(),
  status: RsvpStatusSchema,
  updatedAt: z.string().datetime(),
  websiteOperationId: z.string().min(1).max(128).optional(),
  websitePayloadDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  websiteIdempotencyKeyDigest: z.string().regex(/^[a-f0-9]{64}$/).optional()
});

export type RsvpResponseItem = z.infer<typeof RsvpResponseItemSchema>;
