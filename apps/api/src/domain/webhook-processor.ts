import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { mapAsaasWebhookToPaymentStatus, shouldApplyStatusTransition } from "./payment-state";
import { AppError } from "../lib/errors";
import { normalizeSettlementDate } from "./payment-settlement-date";
import { AsaasClient } from "../services/asaas/client";
import { EmailService } from "../services/email/client";
import { escapeHtml, renderDetailLine, renderEmailDocument } from "../services/email/html";

type AsaasWebhookPayload = {
  event?: string;
  payment?: {
    id?: string;
    customer?: string;
    checkoutSession?: string;
    status?: string;
    externalReference?: string;
    confirmedDate?: string | null;
    clientPaymentDate?: string | null;
    paymentDate?: string | null;
  };
  id?: string;
  status?: string;
  externalReference?: string;
};

function getFirstName(fullName: string | undefined) {
  if (!fullName) {
    return undefined;
  }

  const first = fullName.trim().split(/\s+/)[0];
  return first || undefined;
}

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

export class WebhookProcessor {
  constructor(
    private readonly repository = new PaymentRepository(),
    private readonly asaasClient = new AsaasClient(),
    private readonly emailService = new EmailService()
  ) {}

  async processEvent(eventId: string) {
    const storedEvent = await this.repository.getWebhookEvent(eventId);

    if (!storedEvent) {
      throw new AppError("Webhook event not found.", 404);
    }

    if (storedEvent.processedAt) {
      return { duplicate: true };
    }

    const payload = JSON.parse(storedEvent.payload) as AsaasWebhookPayload;
    const asaasPaymentId = payload.payment?.id ?? storedEvent.asaasPaymentId;
    const asaasCheckoutId = payload.payment?.checkoutSession ?? storedEvent.asaasCheckoutId;
    const externalReference = payload.payment?.externalReference ?? storedEvent.externalReference;
    const asaasCustomerIdFromPayload = payload.payment?.customer;

    if (!asaasPaymentId && !asaasCheckoutId && !externalReference) {
      throw new AppError("Webhook payload does not contain a payment reference.", 400);
    }

    const payment =
      (asaasPaymentId ? await this.repository.getPaymentByAsaasPaymentId(asaasPaymentId) : null) ??
      (asaasCheckoutId ? await this.repository.getPaymentByAsaasCheckoutId(asaasCheckoutId) : null) ??
      (externalReference ? await this.repository.getPayment(externalReference) : null);

    if (!payment) {
      throw new AppError("Payment not found for webhook event.", 404);
    }

    const nextStatus = mapAsaasWebhookToPaymentStatus(payload);
    if (!shouldApplyStatusTransition(payment.status, nextStatus)) {
      await this.repository.markWebhookProcessed(eventId, "ignored_stale");
      return { duplicate: false, updated: false };
    }

    const applied = await this.repository.applyWebhookUpdate({
      paymentId: payment.paymentId,
      expectedCurrentStatus: payment.status,
      nextStatus,
      confirmedOn: normalizeSettlementDate(payload.payment?.confirmedDate ?? undefined, "confirmedOn"),
      receivedOn: normalizeSettlementDate(
        payload.payment?.clientPaymentDate ?? payload.payment?.paymentDate ?? undefined,
        "receivedOn"
      ),
      asaasPaymentId: asaasPaymentId ?? payment.asaasPaymentId,
      asaasCheckoutId: asaasCheckoutId ?? payment.asaasCheckoutId
    });

    if (
      applied &&
      (nextStatus === "CONFIRMED" || nextStatus === "RECEIVED") &&
      payment.status !== "CONFIRMED" &&
      payment.status !== "RECEIVED" &&
      payment.gift?.id
    ) {
      await this.repository.incrementGiftFunding({
        giftId: payment.gift.id,
        paymentId: payment.paymentId,
        quantity: payment.gift.quantity
      });
    }

    if (applied && (nextStatus === "CONFIRMED" || nextStatus === "RECEIVED")) {
      await this.enrichCustomerProfile({
        asaasCustomerIdFromPayload,
        asaasPaymentId: asaasPaymentId ?? payment.asaasPaymentId,
        paymentId: payment.paymentId
      });
    }

    await this.repository.markWebhookProcessed(eventId, applied ? "updated" : "ignored_stale");

    return { duplicate: false, updated: applied };
  }

  private async enrichCustomerProfile(input: {
    asaasCustomerIdFromPayload?: string;
    asaasPaymentId?: string;
    paymentId: string;
  }) {
    const currentPayment = await this.repository.getPayment(input.paymentId);

    if (!currentPayment) {
      throw new AppError("Payment not found during customer enrichment.", 404);
    }

    if (
      currentPayment.customerProfileStatus === "READY" &&
      currentPayment.payerEmail &&
      currentPayment.payerFirstName
    ) {
      await this.sendPayerConfirmationEmailIfNeeded(currentPayment);
      return;
    }

    let asaasCustomerId = input.asaasCustomerIdFromPayload ?? currentPayment.asaasCustomerId;

    if (!asaasCustomerId && input.asaasPaymentId) {
      const asaasPayment = await this.asaasClient.getPaymentById(input.asaasPaymentId);
      asaasCustomerId = asaasPayment.customer;
    }

    if (!asaasCustomerId) {
      await this.repository.updatePaymentCustomerProfile({
        paymentId: input.paymentId,
        customerProfileStatus: "FAILED"
      });
      return;
    }

    const customer = await this.asaasClient.getCustomerById(asaasCustomerId);
    const payerName = toDisplayNameCase(customer.name);
    const payerEmail = customer.email?.trim().toLowerCase();
    const payerFirstName = toDisplayNameCase(getFirstName(payerName));

    await this.repository.updatePaymentCustomerProfile({
      paymentId: input.paymentId,
      asaasCustomerId,
      payerEmail,
      payerFirstName,
      payerName,
      customerProfileStatus: payerEmail && payerFirstName ? "READY" : "FAILED"
    });

    const enrichedPayment = await this.repository.getPayment(input.paymentId);
    if (enrichedPayment) {
      await this.sendPayerConfirmationEmailIfNeeded(enrichedPayment);
    }
  }

  private async sendPayerConfirmationEmailIfNeeded(payment: Awaited<ReturnType<PaymentRepository["getPayment"]>>) {
    if (!payment?.payerEmail || !payment.payerFirstName) {
      return;
    }

    const accepted = await this.repository.acquireNotificationSend({
      paymentId: payment.paymentId,
      type: "PAYER_CONFIRMATION",
      payload: {
        payerEmail: payment.payerEmail
      }
    });

    if (!accepted) {
      return;
    }

    const amount = (payment.amountCents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

    try {
      await this.emailService.sendEmail({
        to: payment.payerEmail,
        subject: `${payment.payerFirstName}, recebemos seu presente`,
        text:
          `Oi, ${payment.payerFirstName}!\n\n` +
          `O seu presente para Brida & Max foi recebido com sucesso.\n` +
          `Presente escolhido: ${payment.gift.name}\n` +
          `Valor: ${amount}\n\n` +
          `Obrigado por fazer parte desse momento.\n` +
          `Enviado por brimax.life.\n`,
        html: buildPayerConfirmationHtml({
          amount,
          giftName: payment.gift.name,
          payerFirstName: payment.payerFirstName
        })
      });
      await this.repository.markNotificationSent({
        paymentId: payment.paymentId,
        type: "PAYER_CONFIRMATION",
        payload: {
          payerEmail: payment.payerEmail
        }
      });
    } catch (error) {
      await this.repository.releaseNotificationSend(payment.paymentId, "PAYER_CONFIRMATION");
      throw error;
    }
  }
}

function buildPayerConfirmationHtml(input: {
  amount: string;
  giftName: string;
  payerFirstName: string;
}) {
  return renderEmailDocument(
    `<p style="margin:0 0 12px;">Oi, ${escapeHtml(input.payerFirstName)}!</p>` +
      '<p style="margin:0 0 16px;">O seu presente para Brida &amp; Max foi recebido com sucesso.</p>' +
      renderDetailLine("Presente escolhido", input.giftName) +
      renderDetailLine("Valor", input.amount) +
      '<p style="margin:16px 0 16px;">Obrigado por fazer parte desse momento.</p>' +
      '<p style="margin:0;color:#6b7280;font-size:14px;">Enviado automaticamente por brimax.life.</p>'
  );
}
