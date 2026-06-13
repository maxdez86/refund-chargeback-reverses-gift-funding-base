import { getEnv } from "../../lib/env";
import {
  escapeHtml,
  renderDetailLine,
  renderEmailCard,
  renderEmailDocument,
  renderMultilineText
} from "./html";

type GuestMessageNotification = {
  authorName: string;
  createdAt: string;
  message: string;
  messageId: string;
};

export function buildGuestMessageNotificationText(message: GuestMessageNotification) {
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

export function buildGuestMessageNotificationHtml(message: GuestMessageNotification) {
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
      `<p style="margin:0;color:#6b7280;font-size:14px;">Enviado automaticamente por ${escapeHtml(getEnv().siteLabel)}.</p>`
  );
}
