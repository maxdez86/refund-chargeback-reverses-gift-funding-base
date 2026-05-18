import {
  CreatePaymentMessageResponseSchema,
  CreatePaymentMessageRequestSchema
} from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { getEnv } from "../lib/env";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { EmailService } from "../services/email/client";

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
            subject: `Novo presente recebido pelo site: ${storedMessage.giftName}`,
            text:
              `Presente: ${storedMessage.giftName}\n` +
              `Valor: ${amount}\n` +
              `Pagamento: ${paymentId}\n` +
              `Nome: ${storedMessage.payerName ?? "não informado"}\n` +
              `Remetente: ${storedMessage.payerEmail ?? "não informado"}\n\n` +
              `Aqui está a mensagem que a pessoa enviou para vocês:\n\n` +
              `${storedMessage.body}\n`
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
