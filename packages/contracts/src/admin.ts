import { z } from "zod";
import { InvitationCodeSchema } from "./invitation-code";

export const AdminGuestExportRowSchema = z.object({
  householdId: z.string(),
  guestId: z.string(),
  invitationCode: InvitationCodeSchema,
  guestName: z.string(),
  phoneNumber: z.string().optional(),
  rsvpStatus: z.string(),
  allowedPlusOnes: z.number().int().nonnegative(),
  attending: z.boolean().optional(),
  isChildSixOrYoungerSeed: z.boolean().optional(),
  isChildSixOrYoungerConfirmed: z.boolean().optional()
});

export type AdminGuestExportRow = z.infer<typeof AdminGuestExportRowSchema>;
