import type { PaymentGift } from "@brimax/config";
import type { PaymentStatus } from "@brimax/contracts";
import { AppError } from "../lib/errors";

const ALLOWED_STATUS_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ["CREATED", "AWAITING_PAYMENT", "PROCESSING", "CONFIRMED", "RECEIVED", "EXPIRED", "CANCELED", "FAILED"],
  AWAITING_PAYMENT: ["AWAITING_PAYMENT", "PROCESSING", "CONFIRMED", "RECEIVED", "EXPIRED", "CANCELED", "FAILED"],
  PROCESSING: ["PROCESSING", "CONFIRMED", "RECEIVED", "EXPIRED", "CANCELED", "FAILED"],
  CONFIRMED: ["CONFIRMED", "RECEIVED", "REFUNDED", "CHARGEBACK"],
  RECEIVED: ["RECEIVED", "REFUNDED", "CHARGEBACK"],
  EXPIRED: ["EXPIRED", "CONFIRMED", "RECEIVED", "CANCELED"],
  CANCELED: ["CANCELED"],
  REFUNDED: ["REFUNDED"],
  // A dispute the couple wins does bring the payment back to CONFIRMED, but
  // only the explicit reversal signal may do it — see
  // isChargebackReversalSignal. The webhook queue is a standard SQS queue, so
  // a redelivered PAYMENT_RECEIVED must never re-fund a charged-back gift.
  CHARGEBACK: ["CHARGEBACK", "REFUNDED"],
  FAILED: ["FAILED"]
};

export type ResolvedGiftSelection = {
  amountCents: number;
  quantity: number;
  unitAmountCents: number | null;
  quotaValuesCents?: number[];
};

type AsaasWebhookPayload = {
  event?: string;
  payment?: {
    id?: string;
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

export function resolveGiftSelection(gift: PaymentGift, quantity: number | undefined): ResolvedGiftSelection {
  if (!gift.fractional) {
    if (quantity && quantity !== 1) {
      throw new AppError("This gift does not allow fractional contributions.", 400);
    }

    return {
      amountCents: gift.totalValueCents,
      quantity: 1,
      unitAmountCents: null,
      quotaValuesCents: undefined
    };
  }

  const normalizedQuantity = quantity ?? 1;

  if (!gift.partValueCents || !gift.totalParts) {
    throw new AppError("Gift configuration is invalid.", 500);
  }

  if (normalizedQuantity > gift.totalParts) {
    throw new AppError("Requested quantity exceeds the available gift parts.", 400);
  }

  return {
    quantity: normalizedQuantity,
    amountCents: normalizedQuantity * gift.partValueCents,
    unitAmountCents: gift.partValueCents,
    quotaValuesCents: undefined
  };
}

export function initialPaymentStatus(): PaymentStatus {
  return "CREATED";
}

// "Disputa vencida, aguardando repasse da adquirente": the only signal Asaas
// sends that genuinely overturns a chargeback. Reinstating funded parts is
// gated on this and nothing else — an ordinary PAYMENT_CONFIRMED or
// PAYMENT_RECEIVED arriving after a chargeback is a redelivery, not a win.
export function isChargebackReversalSignal(payload: AsaasWebhookPayload): boolean {
  const status = String(payload.payment?.status ?? payload.status ?? "").toUpperCase();
  const event = String(payload.event ?? "").toUpperCase();

  return event === "PAYMENT_AWAITING_CHARGEBACK_REVERSAL" || status === "AWAITING_CHARGEBACK_REVERSAL";
}

export function mapAsaasWebhookToPaymentStatus(payload: AsaasWebhookPayload): PaymentStatus {
  const status = String(payload.payment?.status ?? payload.status ?? "").toUpperCase();
  const event = String(payload.event ?? "").toUpperCase();

  // The chargeback was overturned, so the payment is confirmed again. Checked
  // before the generic CHARGEBACK match below, which would otherwise swallow it.
  if (isChargebackReversalSignal(payload)) {
    return "CONFIRMED";
  }

  if (status === "RECEIVED_IN_CASH" || status === "RECEIVED" || event.includes("RECEIVED")) {
    return "RECEIVED";
  }

  if (status === "CONFIRMED" || event.includes("CONFIRMED")) {
    return "CONFIRMED";
  }

  if (status === "REFUNDED" || event === "PAYMENT_REFUNDED") {
    return "REFUNDED";
  }

  if (status === "CHARGEBACK" || event.includes("CHARGEBACK")) {
    return "CHARGEBACK";
  }

  if (status === "CANCELED" || status === "CANCELLED" || event.includes("CANCELED")) {
    return "CANCELED";
  }

  if (status === "OVERDUE" || status === "EXPIRED" || event.includes("OVERDUE")) {
    return "EXPIRED";
  }

  if (
    status === "FAILED" ||
    status === "ERROR" ||
    event.includes("DENIED") ||
    event.includes("REFUSED") ||
    event.includes("FAILED")
  ) {
    return "FAILED";
  }

  if (status === "PENDING" || event.includes("CREATED")) {
    return "AWAITING_PAYMENT";
  }

  if (status === "PROCESSING" || event.includes("PROCESSING")) {
    return "PROCESSING";
  }

  return "PROCESSING";
}

export function shouldApplyStatusTransition(currentStatus: PaymentStatus, nextStatus: PaymentStatus) {
  return ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(nextStatus);
}

// Grace beyond the checkout's own expiry before the platform expires a pending
// payment on its own. Asaas blocks new payment attempts at expiresAt, so the
// grace only shields in-flight confirmations from racing the release.
export const CHECKOUT_EXPIRY_GRACE_MS = 5 * 60_000;

export function isStalePendingCheckout(
  status: PaymentStatus,
  expiresAt: string | undefined,
  nowMs: number
): boolean {
  if (status !== "CREATED" && status !== "AWAITING_PAYMENT") {
    return false;
  }

  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return nowMs > expiresAtMs + CHECKOUT_EXPIRY_GRACE_MS;
}
