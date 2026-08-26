import { z } from "zod";
import { InvitationCodeSchema } from "./invitation-code";
import { WhatsappAttendanceEntrySchema, WhatsappFlowStageSchema, WhatsappFlowStatusSchema } from "./whatsapp-rsvp";

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
  phoneNumber: z.string().regex(/^[1-9]\d{7,14}$/).optional(),
  whatsappFlowStatus: WhatsappFlowStatusSchema.optional(),
  whatsappFlowStage: WhatsappFlowStageSchema.optional(),
  whatsappLastOutboundMessageId: z.string().min(1).optional(),
  whatsappLastInboundMessageId: z.string().min(1).optional(),
  // Normalized provider time of the newest inbound message. Drives the 24-hour free-text window.
  whatsappLastInboundAt: z.string().datetime().optional(),
  whatsappFlowUpdatedAt: z.string().datetime().optional(),
  whatsappFlowCompletedAt: z.string().datetime().optional(),
  whatsappFallbackSentAt: z.string().datetime().optional(),
  whatsappFailureReason: z.string().min(1).optional(),
  whatsappAttendance: z.array(WhatsappAttendanceEntrySchema).optional(),
  guests: z.array(GuestSummarySchema).min(1)
});

/** Shape allowed in the public invitation response; operational WhatsApp state is excluded. */
export const PublicHouseholdInvitationSchema = HouseholdInvitationSchema.omit({
  phoneNumber: true,
  whatsappFlowStatus: true,
  whatsappFlowStage: true,
  whatsappLastOutboundMessageId: true,
  whatsappLastInboundMessageId: true,
  whatsappLastInboundAt: true,
  whatsappFlowUpdatedAt: true,
  whatsappFlowCompletedAt: true,
  whatsappFallbackSentAt: true,
  whatsappFailureReason: true,
  whatsappAttendance: true
});

export type RsvpStatus = z.infer<typeof RsvpStatusSchema>;
export type GuestProfile = z.infer<typeof GuestProfileSchema>;
export type GuestSummary = z.infer<typeof GuestSummarySchema>;
export type HouseholdInvitation = z.infer<typeof HouseholdInvitationSchema>;
export type PublicHouseholdInvitation = z.infer<typeof PublicHouseholdInvitationSchema>;
