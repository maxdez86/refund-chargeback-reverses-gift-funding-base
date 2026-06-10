import { z } from "zod";

export const StripeWebhookEventSchema = z.object({
  provider: z.literal("stripe"),
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  receivedAt: z.string(),
  contributionId: z.string().optional()
});

export const WhatsappWebhookEventSchema = z.object({
  provider: z.literal("whatsapp"),
  eventId: z.string().min(1),
  phoneNumber: z.string().min(8),
  messageType: z.string().min(1),
  receivedAt: z.string()
});

export const AsaasWebhookResponseSchema = z.object({
  ok: z.literal(true),
  duplicate: z.boolean(),
  eventId: z.string().min(1)
});

export type StripeWebhookEvent = z.infer<typeof StripeWebhookEventSchema>;
export type WhatsappWebhookEvent = z.infer<typeof WhatsappWebhookEventSchema>;
export type AsaasWebhookResponse = z.infer<typeof AsaasWebhookResponseSchema>;
