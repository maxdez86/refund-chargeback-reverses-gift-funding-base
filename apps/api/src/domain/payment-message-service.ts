import {
  CreatePaymentMessageResponseSchema,
  CreatePaymentMessageRequestSchema
} from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { getEnv } from "../lib/env";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { EmailService } from "../services/email/client";
import {
  renderDetailLine,
  renderEmailDocument,
  renderMultilineText
} from "../services/email/html";

function toDisplayNameCase(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1))
    .join(" ");
}

export class PaymentMessageService {
  constructor(
    private readonly repository = new PaymentRepository(),
    private readonly emailService = new EmailService()
  ) {}

  async createMessage(paymentId: string, request: unknown) {
    const parsed = CreatePaymentMessageRequestSchema.parse(request);
    const payment = await this.repository.getPayment(paymentId);

    if (!payment) {
      throw new AppError("Payment not found.", 404);
    }

    if (payment.status !== "CONFIRMED" && payment.status !== "RECEIVED") {
      throw new AppError("Message can only be sent after payment confirmation.", 409);
    }

    const existing = await this.repository.getPaymentMessage(paymentId);
    if (existing) {
      return CreatePaymentMessageResponseSchema.parse({
        ok: true,
        message: existing
      });
    }

    const message = {
      paymentId,
      body: parsed.body,
      submittedAt: new Date().toISOString(),
      payerEmail: payment.payerEmail,
      payerName: toDisplayNameCase(payment.payerFirstName),
      giftName: payment.gift.name
    };

    const accepted = await this.repository.putPaymentMessage(message);
    const storedMessage = accepted ? message : await this.repository.getPaymentMessage(paymentId);

    if (!storedMessage) {
      throw new AppError("Message could not be stored safely.", 500);
    }

    if (accepted) {
      const sendAccepted = await this.repository.acquireNotificationSend({
        paymentId,
        type: "COUPLE_MESSAGE",
        payload: {
          payerEmail: storedMessage.payerEmail
        }
      });

      if (sendAccepted) {
        const amount = (payment.amountCents / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL"
        });

        try {
          await this.emailService.sendEmail({
            to: getEnv().rsvpNotificationTo,
            subject: `${storedMessage.payerName}, enviou um presente para vocês 🤍`,
            text: buildCoupleMessageText({
              amount,
              giftName: storedMessage.giftName,
              message: storedMessage.body,
              payerEmail: storedMessage.payerEmail,
              payerName: storedMessage.payerName,
              paymentId
            }),
            html: buildCoupleMessageHtml({
              amount,
              giftName: storedMessage.giftName,
              message: storedMessage.body,
              payerEmail: storedMessage.payerEmail,
              payerName: storedMessage.payerName,
              paymentId
            })
          });
          await this.repository.markNotificationSent({
            paymentId,
            type: "COUPLE_MESSAGE",
            payload: {
              payerEmail: storedMessage.payerEmail
            }
          });
        } catch (error) {
          await this.repository.releaseNotificationSend(paymentId, "COUPLE_MESSAGE");
          throw error;
        }
      }
    }

    return CreatePaymentMessageResponseSchema.parse({
      ok: true,
      message: storedMessage
    });
  }
}

function buildCoupleMessageText(input: {
  amount: string;
  giftName: string;
  message: string;
  payerEmail?: string;
  payerName?: string;
  paymentId: string;
}) {
  return (
    `Oi, Brida & Max!\n\n` +
    `Vocês receberam um novo presente pelo site do casamento ✨\n\n` +
    `Presente: ${input.giftName}\n` +
    `Valor: ${input.amount}\n` +
    `Pagamento: ${input.paymentId}\n` +
    `Enviado por: ${input.payerName ?? "não informado"}\n` +
    `Remetente: ${input.payerEmail ?? "não informado"}\n\n` +
    `💌 Mensagem deixada:\n\n` +
    `${input.message}\n`
  );
}

function buildCoupleMessageHtml(input: {
  amount: string;
  giftName: string;
  message: string;
  payerEmail?: string;
  payerName?: string;
  paymentId: string;
}) {
  return renderEmailDocument(
    '<p style="margin:0 0 12px;">Oi, Brida &amp; Max!</p>' +
      '<p style="margin:0 0 16px;">Vocês receberam um novo presente pelo site do casamento ✨</p>' +
      renderDetailLine("Presente", input.giftName) +
      renderDetailLine("Valor", input.amount) +
      renderDetailLine("Pagamento", input.paymentId) +
      renderDetailLine("Enviado por", input.payerName ?? "não informado") +
      renderDetailLine("Remetente", input.payerEmail ?? "não informado") +
      '<p style="margin:16px 0 8px;"><strong>💌 Mensagem deixada:</strong></p>' +
      `<p style="margin:0 0 16px;">${renderMultilineText(input.message)}</p>` +
      '<p style="margin:0;color:#6b7280;font-size:14px;">Enviado automaticamente por brimax.life.</p>'
  );
}
