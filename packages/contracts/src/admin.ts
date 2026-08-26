import { z } from "zod";
import { GiftSchema } from "./gifts";
import { GuestSummarySchema, RsvpStatusSchema } from "./guest";
import { InvitationCodeSchema } from "./invitation-code";
import { GuestMessageSchema } from "./messages";
import {
  WhatsappFlowStageSchema,
  WhatsappFreeTextWindowSchema,
  WhatsappFlowStatusSchema,
  WhatsappMessageDirectionSchema,
  WhatsappMessageTypeSchema,
  WhatsappPhoneSourceSchema,
  WhatsappRsvpActionSchema,
  WhatsappRsvpSendAvailabilitySchema
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

/**
 * Exact per-invitation WhatsApp conversation summary, aggregated from the stored message items
 * the dashboard scan already walks. It exists only when the invitation owns at least one matched
 * message — absence is the "no conversation" signal, so `messageCount` is positive by construction
 * and never zero-valued. `unreadCount` is the trailing run of consecutive inbound messages at the
 * newest end, the same rule the web panel applies to a loaded thread, so a summary and a loaded
 * thread can never disagree. At most one bounded body is exposed, from the newest message only.
 */
export const AdminDashboardWhatsappConversationSchema = z
  .object({
    messageCount: z.number().int().positive(),
    unreadCount: z.number().int().nonnegative(),
    lastMessageAt: z.string().datetime(),
    lastMessageDirection: WhatsappMessageDirectionSchema,
    lastMessageType: WhatsappMessageTypeSchema.optional(),
    lastMessageTemplateId: z.string().min(1).max(256).optional(),
    lastMessagePreview: z.string().min(1).max(160).optional(),
    lastOutboundMessageTemplateId: z.string().min(1).max(256).optional(),
    lastOutboundMessagePreview: z.string().min(1).max(160).optional(),
    lastInboundMessageTemplateId: z.string().min(1).max(256).optional(),
    lastInboundMessagePreview: z.string().min(1).max(160).optional(),
    lastInboundMessageButtonId: z.string().min(1).max(256).optional(),
    lastInboundMessageButtonAction: WhatsappRsvpActionSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.unreadCount > value.messageCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unreadCount"],
        message: "unreadCount cannot exceed messageCount."
      });
    }
  });

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
    whatsappSendAvailability: WhatsappRsvpSendAvailabilitySchema,
    whatsappFreeTextWindow: WhatsappFreeTextWindowSchema,
    guests: z.array(AdminDashboardGuestSchema).min(1),
    rsvp: AdminDashboardRsvpSummarySchema,
    whatsappConversation: AdminDashboardWhatsappConversationSchema.optional()
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
export type AdminDashboardWhatsappConversation = z.infer<
  typeof AdminDashboardWhatsappConversationSchema
>;
export type AdminDashboardInvitation = z.infer<typeof AdminDashboardInvitationSchema>;
export type AdminDashboardResponse = z.infer<typeof AdminDashboardResponseSchema>;
