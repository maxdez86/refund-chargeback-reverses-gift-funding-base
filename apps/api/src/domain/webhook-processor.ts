import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { mapAsaasWebhookToPaymentStatus, shouldApplyStatusTransition } from "./payment-state";
import { AppError } from "../lib/errors";
import { normalizeSettlementDate } from "./payment-settlement-date";

type AsaasWebhookPayload = {
  event?: string;
  payment?: {
    id?: string;
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

export class WebhookProcessor {
  constructor(private readonly repository = new PaymentRepository()) {}

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

    await this.repository.markWebhookProcessed(eventId, applied ? "updated" : "ignored_stale");

    return { duplicate: false, updated: applied };
  }
}
