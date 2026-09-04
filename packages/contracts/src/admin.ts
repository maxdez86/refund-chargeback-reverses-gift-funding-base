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

export const AdminNextInvitationCodeResponseSchema = z
  .object({
    ok: z.literal(true),
    invitationCode: InvitationCodeSchema
  })
  .strict();

export type AdminNextInvitationCodeResponse = z.infer<
  typeof AdminNextInvitationCodeResponseSchema
>;

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

export const AdminGiftSchema = GiftSchema.extend({
  payerNames: z.array(z.string().min(1).max(120))
}).strict();

export const AdminDashboardResponseSchema = z
  .object({
    ok: z.literal(true),
    invitations: z.array(AdminDashboardInvitationSchema),
    gifts: z.array(AdminGiftSchema),
    guestMessages: z.array(GuestMessageSchema.strict())
  })
  .strict();

export type AdminDashboardGuest = z.infer<typeof AdminDashboardGuestSchema>;
export type AdminDashboardRsvpSummary = z.infer<typeof AdminDashboardRsvpSummarySchema>;
export type AdminDashboardWhatsappConversation = z.infer<
  typeof AdminDashboardWhatsappConversationSchema
>;
export type AdminDashboardInvitation = z.infer<typeof AdminDashboardInvitationSchema>;
export type AdminGift = z.infer<typeof AdminGiftSchema>;
export type AdminDashboardResponse = z.infer<typeof AdminDashboardResponseSchema>;

/**
 * Body of `PATCH /admin/invitations/{invitationCode}/guests/{guestId}`.
 *
 * Every field is an absolute value rather than a toggle, which is what makes the route naturally
 * idempotent and lets it skip the `Idempotency-Key` the WhatsApp sends carry. The two child fields
 * `rsvpStatus` cannot be set back to `pending`: a stored `pending` answer falls back to the guest
 * item's seed status, which this route does not edit, so "un-answering" a guest would leave the
 * response describing a state the dashboard would not recompute. The admin path corrects an
 * answer; it does not erase one.
 *
 * The two child fields
 * live in different places on the way down: `isChild` is the seed attribute on the guest item,
 * while `isChildSixOrYounger` is a per-response answer inside the invitation's `guestResponses`.
 * They are separate inputs because an operator may need to correct either one alone.
 */
export const AdminGuestUpdateRequestSchema = z
  .object({
    rsvpStatus: RsvpStatusSchema.exclude(["pending"]).optional(),
    isChild: z.boolean().optional(),
    isChildSixOrYounger: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one guest field must be provided."
  });

/**
 * Body of `POST /admin/invitations/{invitationCode}/confirm-all`.
 *
 * Only the listed guests are set to `attending`; every other guest on the invitation keeps the
 * status it already had, which is exactly what the confirmation modal promises the operator.
 */
export const AdminConfirmGuestsRequestSchema = z
  .object({
    guestIds: z.array(z.string().min(1)).min(1)
  })
  .strict();

/**
 * Shared answer for both admin guest writes.
 *
 * It carries the invitation's full guest list and its recomputed RSVP aggregate so the dashboard
 * can reconcile from the response alone — a refetch would replace the whole snapshot and undo
 * anything else the operator had open.
 */
export const AdminInvitationRsvpWriteResponseSchema = z
  .object({
    ok: z.literal(true),
    invitationCode: InvitationCodeSchema,
    guests: z.array(AdminDashboardGuestSchema).min(1),
    rsvp: AdminDashboardRsvpSummarySchema,
    updatedAt: z.string().datetime()
  })
  .strict();

export type AdminGuestUpdateRequest = z.infer<typeof AdminGuestUpdateRequestSchema>;
export type AdminConfirmGuestsRequest = z.infer<typeof AdminConfirmGuestsRequestSchema>;
export type AdminInvitationRsvpWriteResponse = z.infer<
  typeof AdminInvitationRsvpWriteResponseSchema
>;

/**
 * One guest as the operator supplies them when creating an invitation or adding to one.
 *
 * Deliberately carries neither `slot` nor `guestId`: the server derives both — `max(sortOrder) + 1`,
 * never reusing the gap a removed guest left — because `buildGuestId` derives the id from the slot,
 * and a reused slot would resurrect a removed guest's id. `.strict()` makes a client-sent slot a 400
 * rather than a field that is silently ignored.
 */
export const AdminInvitationGuestInputSchema = z
  .object({
    guestName: z.string().trim().min(1).max(120),
    isChild: z.boolean().optional()
  })
  .strict();

/**
 * Body of `POST /admin/invitations`.
 *
 * The operator supplies the code rather than the server minting one, so invitation codes stay
 * meaningful and match what the offline import writes. Format is validated here and uniqueness is
 * enforced by the conditional write, which is why this route carries no `Idempotency-Key`: a replay
 * lands on the same 409.
 */
export const AdminCreateInvitationRequestSchema = z
  .object({
    invitationCode: InvitationCodeSchema,
    householdName: z.string().trim().min(1).max(200),
    phoneNumber: z
      .string()
      .regex(/^[1-9]\d{7,14}$/)
      .optional(),
    guests: z.array(AdminInvitationGuestInputSchema).min(1).max(20)
  })
  .strict();

/**
 * Answer for `POST /admin/invitations`.
 *
 * Not the shared RSVP write response: that one carries no `householdName`, no `phoneNumber` and no
 * WhatsApp availability, and the dashboard cannot insert a new row without them.
 */
export const AdminCreateInvitationResponseSchema = z
  .object({
    ok: z.literal(true),
    invitation: AdminDashboardInvitationSchema,
    createdAt: z.string().datetime()
  })
  .strict();

/**
 * Body of `POST /admin/invitations/{invitationCode}/guests`.
 *
 * `DELETE /admin/invitations/{invitationCode}/guests/{guestId}` has no body at all — the guest is
 * fully identified by the path — and both routes answer with `AdminInvitationRsvpWriteResponse`,
 * since a guest joining or leaving changes exactly the guest list and the aggregate that envelope
 * already carries.
 */
export const AdminAddGuestsRequestSchema = z
  .object({
    guests: z.array(AdminInvitationGuestInputSchema).min(1).max(10)
  })
  .strict();

/**
 * Answer for `DELETE /admin/invitations/{invitationCode}`.
 *
 * The delete is a hard cascade, so there is no guest list left to reconcile against — the counts
 * report what was removed instead, which is the only evidence the operator has that the WhatsApp
 * history went with the invitation.
 */
export const AdminDeleteInvitationResponseSchema = z
  .object({
    ok: z.literal(true),
    invitationCode: InvitationCodeSchema,
    deletedAt: z.string().datetime(),
    deleted: z
      .object({
        guests: z.number().int().nonnegative(),
        rsvp: z.number().int().min(0).max(1),
        whatsappItems: z.number().int().nonnegative(),
        phoneLookups: z.number().int().min(0).max(1)
      })
      .strict()
  })
  .strict();

export type AdminInvitationGuestInput = z.infer<typeof AdminInvitationGuestInputSchema>;
export type AdminCreateInvitationRequest = z.infer<typeof AdminCreateInvitationRequestSchema>;
export type AdminCreateInvitationResponse = z.infer<typeof AdminCreateInvitationResponseSchema>;
export type AdminAddGuestsRequest = z.infer<typeof AdminAddGuestsRequestSchema>;
export type AdminDeleteInvitationResponse = z.infer<typeof AdminDeleteInvitationResponseSchema>;
