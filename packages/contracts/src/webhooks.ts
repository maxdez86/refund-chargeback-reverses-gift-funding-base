import { z } from "zod";

export const AsaasWebhookResponseSchema = z.object({
  ok: z.literal(true),
  duplicate: z.boolean(),
  eventId: z.string().min(1)
});

export type AsaasWebhookResponse = z.infer<typeof AsaasWebhookResponseSchema>;
