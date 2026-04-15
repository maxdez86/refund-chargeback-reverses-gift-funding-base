import { z } from "zod";

export const AdminGuestExportRowSchema = z.object({
  householdId: z.string(),
  guestId: z.string(),
  invitationCode: z.string(),
  guestName: z.string(),
  phoneNumber: z.string().optional(),
  rsvpStatus: z.string(),
  allowedPlusOnes: z.number().int().nonnegative()
});

export type AdminGuestExportRow = z.infer<typeof AdminGuestExportRowSchema>;
