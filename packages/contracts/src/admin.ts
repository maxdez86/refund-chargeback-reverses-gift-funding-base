import { z } from "zod";
import { GiftSchema } from "./gifts";
import { GuestSummarySchema, RsvpStatusSchema } from "./guest";
import { InvitationCodeSchema } from "./invitation-code";
import { GuestMessageSchema } from "./messages";
import {
  WhatsappFlowStageSchema,
  WhatsappFlowStatusSchema,
  WhatsappPhoneSourceSchema
} from "./whatsapp-rsvp";

export const AdminGuestExportRowSchema = z.object({
  householdName: z.string(),
  guestId: z.string(),
  invitationCode: InvitationCodeSchema,
  guestName: z.string(),
  phoneNumber: z.string().optional(),
  rsvpStatus: z.string(),
  allowedPlusOnes: z.number().int().nonnegative(),
  attending: z.boolean().optional(),
  isChildSeed: z.boolean().optional(),
  isChildSixOrYoungerConfirmed: z.boolean().optional()
});

export type AdminGuestExportRow = z.infer<typeof AdminGuestExportRowSchema>;

export const AdminSessionResponseSchema = z
  .object({
    authenticated: z.literal(true),
    stage: z.enum(["dev", "prod"]),
    admin: z
      .object({
        subject: z.string().min(1),
        email: z.string().email(),
        hostedDomain: z.literal("brimax.life"),
        name: z.string().min(1).optional(),
        pictureUrl: z.string().url().optional()
      })
      .strict()
  })
  .strict();

export type AdminSessionResponse = z.infer<typeof AdminSessionResponseSchema>;

export const AdminDashboardGuestSchema = GuestSummarySchema.strict();

export const AdminDashboardRsvpSummarySchema = z
  .object({
    status: RsvpStatusSchema,
    updatedAt: z.string().datetime().nullable(),
    submittedBy: z.string().min(1).nullable(),
    attending: z.number().int().nonnegative(),
    paid: z.number().int().nonnegative(),
    childrenSixOrYounger: z.number().int().nonnegative(),
    note: z.string().max(500).optional()
  })
  .strict();

export const AdminDashboardInvitationSchema = z
  .object({
    invitationCode: InvitationCodeSchema,
    householdName: z.string().min(1),
    phoneNumber: z.string().regex(/^[1-9]\d{7,14}$/).optional(),
    phoneNumberSource: WhatsappPhoneSourceSchema.optional(),
    phoneNumberUpdatedAt: z.string().datetime().optional(),
    whatsappFlowStatus: WhatsappFlowStatusSchema.optional(),
    whatsappFlowStage: WhatsappFlowStageSchema.optional(),
    whatsappFlowUpdatedAt: z.string().datetime().optional(),
    whatsappFlowCompletedAt: z.string().datetime().optional(),
    whatsappFallbackSentAt: z.string().datetime().optional(),
    whatsappLastInboundMessageId: z.string().min(1).optional(),
    whatsappLastOutboundMessageId: z.string().min(1).optional(),
    whatsappFailureReason: z.string().min(1).optional(),
    guests: z.array(AdminDashboardGuestSchema).min(1),
    rsvp: AdminDashboardRsvpSummarySchema
  })
  .strict();

export const AdminDashboardResponseSchema = z
  .object({
    ok: z.literal(true),
    invitations: z.array(AdminDashboardInvitationSchema),
    gifts: z.array(GiftSchema.strict()),
    guestMessages: z.array(GuestMessageSchema.strict())
  })
  .strict();

export type AdminDashboardGuest = z.infer<typeof AdminDashboardGuestSchema>;
export type AdminDashboardRsvpSummary = z.infer<typeof AdminDashboardRsvpSummarySchema>;
export type AdminDashboardInvitation = z.infer<typeof AdminDashboardInvitationSchema>;
export type AdminDashboardResponse = z.infer<typeof AdminDashboardResponseSchema>;
