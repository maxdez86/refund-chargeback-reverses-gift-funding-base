import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { mapAsaasWebhookToPaymentStatus, shouldApplyStatusTransition } from "./payment-state";
import { AppError } from "../lib/errors";
import { getEnv, resolveSiteLabel, resolveSiteOrigin } from "../lib/env";
import { normalizeSettlementDate } from "./payment-settlement-date";
import { AsaasClient } from "../services/asaas/client";
import { EmailService } from "../services/email/client";
import {
  escapeHtml,
  renderDetailLine,
  renderEmailCard,
  renderEmailDocument,
  renderEmailImage,
  renderEmailSection
} from "../services/email/html";

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

function getSiteOrigin() {
  return resolveSiteOrigin();
}

function getGiftImageUrl(imageSlug: string | undefined) {
  if (!imageSlug) {
    return undefined;
  }

  return `${getSiteOrigin()}/media/presentes/${encodeURIComponent(imageSlug)}/480.jpeg`;
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
      const siteLabel = resolveSiteLabel();
      const giftImageSlug = payment.gift.image ?? (await this.repository.getGift(payment.gift.id))?.image;
      const giftImageUrl = getGiftImageUrl(giftImageSlug);

      await this.emailService.sendEmail({
        to: payment.payerEmail,
        subject: "Confirmacao do seu presente para Brida & Max",
        text:
          `Oi, ${payment.payerFirstName}!\n\n` +
          "Confirmamos o recebimento do seu presente para Brida & Max.\n\n" +
          `Presente: ${payment.gift.name}\n` +
          `Valor: ${amount}\n\n` +
          "Se precisar de ajuda, basta responder este e-mail.\n" +
          `${siteLabel}\n`,
        html: buildPayerConfirmationHtml({
          amount,
          giftName: payment.gift.name,
          giftImageUrl,
          payerFirstName: payment.payerFirstName,
          siteLabel
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
  giftImageUrl?: string;
  payerFirstName: string;
  siteLabel: string;
}) {
  return renderEmailDocument(
    renderEmailSection(
      '<p style="margin:0;color:#6b7280;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Brida &amp; Max</p>' +
        `<p style="margin:8px 0 0;font-size:14px;color:#6b7280;">${escapeHtml(input.siteLabel)}</p>`
    ) +
      renderEmailSection(
        `<p style="margin:0 0 12px;font-size:18px;color:#111827;">Oi, ${escapeHtml(input.payerFirstName)}!</p>` +
          '<p style="margin:0;font-size:16px;color:#1f2937;">Confirmamos o recebimento do seu presente para Brida &amp; Max.</p>'
      ) +
      (input.giftImageUrl
        ? renderEmailImage({
            alt: input.giftName,
            src: input.giftImageUrl
          })
        : "") +
      renderEmailCard(
        renderDetailLine("Presente", input.giftName) +
          renderDetailLine("Valor", input.amount) +
          '<p style="margin:16px 0 0;color:#4b5563;font-size:14px;">Se precisar de ajuda, basta responder este e-mail.</p>'
      ) +
      `<p style="margin:0;color:#6b7280;font-size:14px;">Enviado por ${escapeHtml(input.siteLabel)}.</p>`,
    {
      preheader: "Confirmamos o recebimento do seu presente para Brida & Max."
    }
  );
}
