import { z } from "zod";
import { InvitationCodeSchema } from "./invitation-code";

export const RegistryCheckoutRequestSchema = z.object({
  guestId: z.string().min(1),
  invitationCode: InvitationCodeSchema,
  amountInCents: z.number().int().positive(),
  currency: z.string().length(3),
  message: z.string().max(500).optional()
});

export const RegistryCheckoutResponseSchema = z.object({
  ok: z.literal(true),
  checkoutUrl: z.string().url(),
  contributionId: z.string().min(1)
});

export type RegistryCheckoutRequest = z.infer<typeof RegistryCheckoutRequestSchema>;
export type RegistryCheckoutResponse = z.infer<typeof RegistryCheckoutResponseSchema>;
