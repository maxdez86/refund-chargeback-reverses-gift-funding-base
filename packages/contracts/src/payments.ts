import { z } from "zod";

export const PaymentMethodSchema = z.enum(["HOSTED", "PIX", "CREDIT_CARD"]);
export const PaymentStatusSchema = z.enum([
  "CREATED",
  "AWAITING_PAYMENT",
  "PROCESSING",
  "CONFIRMED",
  "RECEIVED",
  "EXPIRED",
  "CANCELED",
  "REFUNDED",
  "CHARGEBACK",
  "FAILED"
]);

export const PaymentPayerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(255),
  cpf: z.string().min(11).max(18),
  phone: z.string().min(8).max(20).optional()
});

export const CreatePaymentRequestSchema = z.object({
  giftId: z.string().min(1),
  quantity: z.number().int().positive().max(100).optional(),
  paymentMethod: PaymentMethodSchema,
  payerEmail: z.string().email().max(255)
});

export const PaymentGiftSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fractional: z.boolean(),
  quantity: z.number().int().positive(),
  unitAmountCents: z.number().int().positive().nullable(),
  amountCents: z.number().int().positive()
});

export const PaymentCheckoutSchema = z.object({
  sessionId: z.string().min(1),
  url: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }).optional()
});

export const PaymentSummarySchema = z.object({
  paymentId: z.string().min(1),
  paymentMethod: PaymentMethodSchema,
  status: PaymentStatusSchema,
  amountCents: z.number().int().positive(),
  currency: z.literal("BRL"),
  gift: PaymentGiftSummarySchema,
  checkout: PaymentCheckoutSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  confirmedOn: z.string().date().optional(),
  receivedOn: z.string().date().optional()
});

export const CreatePaymentResponseSchema = z.object({
  ok: z.literal(true),
  payment: PaymentSummarySchema
});

export const GetPaymentResponseSchema = z.object({
  ok: z.literal(true),
  payment: PaymentSummarySchema
});

export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type PaymentPayer = z.infer<typeof PaymentPayerSchema>;
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;
export type PaymentGiftSummary = z.infer<typeof PaymentGiftSummarySchema>;
export type PaymentCheckout = z.infer<typeof PaymentCheckoutSchema>;
export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;
export type CreatePaymentResponse = z.infer<typeof CreatePaymentResponseSchema>;
export type GetPaymentResponse = z.infer<typeof GetPaymentResponseSchema>;
