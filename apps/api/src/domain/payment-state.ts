import type { PaymentGift } from "@brimax/config";
import type { PaymentMethod, PaymentStatus } from "@brimax/contracts";
import { AppError } from "../lib/errors";

export const PAYMENT_STATUS_RANK: Record<PaymentStatus, number> = {
  CREATED: 10,
  AWAITING_PAYMENT: 20,
  PROCESSING: 30,
  CONFIRMED: 40,
  RECEIVED: 50,
  EXPIRED: 60,
  CANCELED: 70,
  FAILED: 80,
  REFUNDED: 90,
  CHARGEBACK: 100
};

export type ResolvedGiftSelection = {
  amountCents: number;
  quantity: number;
  unitAmountCents: number | null;
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
      unitAmountCents: null
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
    amountCents: normalizedQuantity * gift.partValueCents,
    quantity: normalizedQuantity,
    unitAmountCents: gift.partValueCents
  };
}

export function initialPaymentStatus(paymentMethod: PaymentMethod): PaymentStatus {
  return paymentMethod === "PIX" ? "AWAITING_PAYMENT" : "CREATED";
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
  return PAYMENT_STATUS_RANK[nextStatus] >= PAYMENT_STATUS_RANK[currentStatus];
}
