import { z } from "zod";

export const RegistryCheckoutRequestSchema = z.object({
  guestId: z.string().min(1),
  invitationCode: z.string().min(4),
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
