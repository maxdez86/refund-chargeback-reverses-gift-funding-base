import { z } from "zod";

export const GuestMessageSchema = z.object({
  messageId: z.string().min(1),
  authorName: z.string().min(2).max(60),
  message: z.string().min(1).max(320),
  createdAt: z.string().datetime()
});

export const CreateGuestMessageRequestSchema = z.object({
  authorName: z.string().trim().min(2).max(60),
  message: z.string().trim().min(1).max(320)
});

export const CreateGuestMessageResponseSchema = z.object({
  ok: z.literal(true),
  message: GuestMessageSchema
});

export const ListGuestMessagesResponseSchema = z.object({
  ok: z.literal(true),
  messages: z.array(GuestMessageSchema),
  nextCursor: z.string().min(1).nullable()
});

export const DeleteGuestMessageResponseSchema = z.object({
  ok: z.literal(true),
  messageId: z.string().min(1),
  deletedAt: z.string().datetime()
});

export type GuestMessage = z.infer<typeof GuestMessageSchema>;
export type CreateGuestMessageRequest = z.infer<typeof CreateGuestMessageRequestSchema>;
export type CreateGuestMessageResponse = z.infer<typeof CreateGuestMessageResponseSchema>;
export type ListGuestMessagesResponse = z.infer<typeof ListGuestMessagesResponseSchema>;
export type DeleteGuestMessageResponse = z.infer<typeof DeleteGuestMessageResponseSchema>;
