import { z } from "zod";
import { InvitationCodeSchema } from "./invitation-code";

export const RsvpStatusSchema = z.enum(["pending", "attending", "declined"]);

export const GuestProfileSchema = z.object({
  invitationCode: InvitationCodeSchema,
  guestId: z.string().min(1),
  guestName: z.string().min(1),
  phoneNumber: z.string().min(8).optional(),
  allowedPlusOnes: z.number().int().nonnegative(),
  rsvpStatus: RsvpStatusSchema,
  isChild: z.boolean().optional(),
  isChildSixOrYounger: z.boolean().optional(),
  dietaryNotes: z.string().optional()
});

export const GuestSummarySchema = z.object({
  guestId: z.string().min(1),
  guestName: z.string().min(1),
  allowedPlusOnes: z.number().int().nonnegative(),
  rsvpStatus: RsvpStatusSchema,
  isChild: z.boolean().optional(),
  isChildSixOrYounger: z.boolean().optional(),
  dietaryNotes: z.string().optional()
});

export const HouseholdInvitationSchema = z.object({
  invitationCode: InvitationCodeSchema,
  householdName: z.string().min(1),
  guests: z.array(GuestSummarySchema).min(1)
});

export type RsvpStatus = z.infer<typeof RsvpStatusSchema>;
export type GuestProfile = z.infer<typeof GuestProfileSchema>;
export type GuestSummary = z.infer<typeof GuestSummarySchema>;
export type HouseholdInvitation = z.infer<typeof HouseholdInvitationSchema>;
