import {
  CreateGuestMessageRequestSchema,
  CreateGuestMessageResponseSchema,
  DeleteGuestMessageResponseSchema,
  ListGuestMessagesResponseSchema
} from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";
import { enqueueGuestMessageNotification } from "../services/sqs/guest-message-notification-publisher";
import { normalizeInlineWhitespace } from "../lib/normalize-inline-whitespace";

const PAGE_SIZE = 50;

type CreateResult = {
  response: ReturnType<typeof CreateGuestMessageResponseSchema.parse>;
  notificationEnqueued: boolean;
};

export class GuestMessageService {
  constructor(private readonly repository = new WeddingRepository()) {}

  async list(cursor?: string | null) {
    const { messages, nextCursor } = await this.repository.listGuestMessages(cursor, PAGE_SIZE);

    return ListGuestMessagesResponseSchema.parse({
      ok: true,
      messages,
      nextCursor
    });
  }

  async create(request: unknown): Promise<CreateResult> {
    const parsed = CreateGuestMessageRequestSchema.parse(request);
    const sanitized = sanitizeGuestMessageInput(parsed);
    const message = await this.repository.createGuestMessage(sanitized);

    // The couple's notification email is dispatched off the request path by the
    // guest-message-notify worker (durable via the queue's redrive + DLQ), so a
    // slow/cold SES send never blocks the guest's "Recado enviado." response.
    const enqueueResult = await enqueueGuestMessageNotification(message);

    return {
      response: CreateGuestMessageResponseSchema.parse({
        ok: true,
        message
      }),
      notificationEnqueued: enqueueResult === "accepted"
    };
  }

  async delete(messageId: string) {
    if (!messageId.trim()) {
      throw new AppError("Missing guest message id.", 400);
    }

    await this.repository.deleteGuestMessage(messageId);
    const deletedAt = new Date().toISOString();

    return DeleteGuestMessageResponseSchema.parse({
      ok: true,
      messageId,
      deletedAt
    });
  }
}

function sanitizeGuestMessageInput(input: { authorName: string; message: string }) {
  return {
    authorName: normalizeInlineWhitespace(input.authorName),
    message: normalizeMessageBody(input.message)
  };
}

function normalizeMessageBody(value: string) {
  const normalizedLines = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "));

  return normalizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
