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
  CHARGEBACK: ["CHARGEBACK", "CONFIRMED", "RECEIVED", "REFUNDED"],
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

export function mapAsaasWebhookToPaymentStatus(payload: AsaasWebhookPayload): PaymentStatus {
  const status = String(payload.payment?.status ?? payload.status ?? "").toUpperCase();
  const event = String(payload.event ?? "").toUpperCase();

  if (status === "RECEIVED_IN_CASH" || status === "RECEIVED" || event.includes("RECEIVED")) {
    return "RECEIVED";
  }

  if (status === "CONFIRMED" || event.includes("CONFIRMED")) {
    return "CONFIRMED";
  }

  if (status === "REFUNDED" || event.includes("REFUND")) {
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
