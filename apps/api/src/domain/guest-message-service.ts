import {
  CreateGuestMessageRequestSchema,
  CreateGuestMessageResponseSchema,
  DeleteGuestMessageResponseSchema,
  ListGuestMessagesResponseSchema
} from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { getEnv } from "../lib/env";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";
import { EmailService } from "../services/email/client";
import {
  escapeHtml,
  renderDetailLine,
  renderEmailCard,
  renderEmailDocument,
  renderMultilineText
} from "../services/email/html";

const PAGE_SIZE = 50;

type CreateResult = {
  response: ReturnType<typeof CreateGuestMessageResponseSchema.parse>;
  notificationSent: boolean;
};

export class GuestMessageService {
  constructor(
    private readonly repository = new WeddingRepository(),
    private readonly emailService = new EmailService()
  ) {}

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
    let notificationSent = false;

    try {
      await this.emailService.sendEmail({
        to: getEnv().contactEmail,
        subject: "Novo recado recebido no site",
        text: buildGuestMessageNotificationText(message),
        html: buildGuestMessageNotificationHtml(message)
      });
      notificationSent = true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "GUEST_MESSAGE_EMAIL_FAILED",
          messageId: message.messageId,
          message: error instanceof Error ? error.message : "Unknown guest message email error"
        })
      );
    }

    return {
      response: CreateGuestMessageResponseSchema.parse({
        ok: true,
        message
      }),
      notificationSent
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

function normalizeInlineWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMessageBody(value: string) {
  const normalizedLines = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "));

  return normalizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildGuestMessageNotificationText(message: { authorName: string; createdAt: string; message: string; messageId: string }) {
  return [
    "Novo recado recebido no site.",
    "",
    `Nome: ${message.authorName}`,
    `Data: ${message.createdAt}`,
    `Message ID: ${message.messageId}`,
    "",
    "Recado:",
    message.message
  ].join("\n");
}

function buildGuestMessageNotificationHtml(message: { authorName: string; createdAt: string; message: string; messageId: string }) {
  return renderEmailDocument(
    '<p style="margin:0 0 12px;">Oi, Brida &amp; Max!</p>' +
      '<p style="margin:0 0 16px;">Vocês receberam um novo recado pelo site.</p>' +
      renderDetailLine("Nome", message.authorName) +
      renderDetailLine("Data", message.createdAt) +
      renderDetailLine("Message ID", message.messageId) +
      renderEmailCard(
        '<p style="margin:0 0 8px;"><strong>Recado:</strong></p>' +
          `<p style="margin:0;white-space:normal;">${renderMultilineText(message.message)}</p>`
      ) +
      `<p style="margin:0;color:#6b7280;font-size:14px;">Enviado automaticamente por ${escapeHtml("brimax.life")}.</p>`
  );
}
