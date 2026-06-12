import { z } from "zod";

export const GiftSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  image: z.string().min(1),
  fractional: z.boolean(),
  totalValueCents: z.number().int().positive(),
  partValueCents: z.number().int().positive().nullable(),
  totalParts: z.number().int().positive().nullable(),
  finalPartValueCents: z.number().int().positive().nullable(),
  fundingModelVersion: z.enum(["LEGACY_FIXED_50", "EXACT_FINAL_QUOTA"]),
  partsFunded: z.number().int().nonnegative(),
  partsReserved: z.number().int().nonnegative(),
  confirmedAmountCents: z.number().int().nonnegative(),
  reservedAmountCents: z.number().int().nonnegative(),
  availableAmountCents: z.number().int().nonnegative(),
  availableParts: z.number().int().nonnegative(),
  fullyFunded: z.boolean(),
  updatedAt: z.string().datetime().nullable()
});

export const GetGiftsResponseSchema = z.object({
  ok: z.literal(true),
  gifts: z.array(GiftSchema)
});

export type Gift = z.infer<typeof GiftSchema>;
export type GetGiftsResponse = z.infer<typeof GetGiftsResponseSchema>;
