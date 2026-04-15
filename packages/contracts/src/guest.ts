import { z } from "zod";

export const RsvpStatusSchema = z.enum(["pending", "attending", "declined"]);

export const GuestProfileSchema = z.object({
  invitationCode: z.string().min(4),
  householdId: z.string().min(1),
  guestId: z.string().min(1),
  guestName: z.string().min(1),
  phoneNumber: z.string().min(8).optional(),
  allowedPlusOnes: z.number().int().nonnegative(),
  rsvpStatus: RsvpStatusSchema,
  dietaryNotes: z.string().optional()
});

export type RsvpStatus = z.infer<typeof RsvpStatusSchema>;
export type GuestProfile = z.infer<typeof GuestProfileSchema>;
