import { z } from "zod";
import { InvitationCodeSchema } from "./invitation-code";

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
