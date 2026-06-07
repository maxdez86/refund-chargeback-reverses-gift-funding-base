export const LAST_PAYMENT_ID_STORAGE_KEY = "brimax.lastPaymentId";
export const LAST_PAYMENT_ID_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PAYMENT_FLOW_UPDATED_EVENT = "brimax:payment-flow-updated";
export const PAYMENT_CONFIRMATION_OPEN_EVENT = "brimax:payment-confirmation-open";

export type StoredPendingPayment = {
  paymentId: string;
  createdAt: number;
  checkoutUrl?: string;
  giftName?: string;
  amountCents?: number;
};

export type PaymentConfirmationOpenDetail = {
  paymentId: string;
  paymentStatus: "success" | "cancel" | "expired" | "unknown";
};

export type PaymentReturnState = {
  paymentId: string;
  paymentStatus: "success" | "cancel" | "expired" | "unknown";
};

function dispatchPaymentFlowUpdated() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(PAYMENT_FLOW_UPDATED_EVENT));
}

export function readStoredPendingPayment(): StoredPendingPayment | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as StoredPendingPayment;

    if (
      !parsed.paymentId ||
      typeof parsed.paymentId !== "string" ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > LAST_PAYMENT_ID_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(LAST_PAYMENT_ID_STORAGE_KEY);
      return null;
    }

    return {
      paymentId: parsed.paymentId,
      createdAt: parsed.createdAt,
      checkoutUrl: typeof parsed.checkoutUrl === "string" ? parsed.checkoutUrl : undefined,
      giftName: typeof parsed.giftName === "string" ? parsed.giftName : undefined,
      amountCents: typeof parsed.amountCents === "number" ? parsed.amountCents : undefined,
    };
  } catch {
    window.localStorage.removeItem(LAST_PAYMENT_ID_STORAGE_KEY);
    return null;
  }
}

export function writeStoredPendingPayment(payment: StoredPendingPayment) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LAST_PAYMENT_ID_STORAGE_KEY, JSON.stringify(payment));
  dispatchPaymentFlowUpdated();
}

export function clearStoredPendingPayment() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LAST_PAYMENT_ID_STORAGE_KEY);
  dispatchPaymentFlowUpdated();
}

export function openPaymentConfirmationDialog(detail: PaymentConfirmationOpenDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<PaymentConfirmationOpenDetail>(PAYMENT_CONFIRMATION_OPEN_EVENT, {
    detail,
  }));
}

function parsePaymentStatus(value: string | null): PaymentReturnState["paymentStatus"] | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized === "success") return "success";
  if (normalized === "cancel") return "cancel";
  if (normalized === "expired") return "expired";
  return "unknown";
}

export function readPaymentReturnFromHash(hash: string): PaymentReturnState | null {
  const hashContent = hash.startsWith("#") ? hash.slice(1) : hash;
  const hashParams = new URLSearchParams(hashContent);
  const paymentId = hashParams.get("paymentId");
  const paymentStatus = parsePaymentStatus(hashParams.get("paymentStatus"));

  if (!paymentId || !paymentStatus) {
    return null;
  }

  return {
    paymentId,
    paymentStatus,
  };
}

export function readCurrentPaymentReturn(): PaymentReturnState | null {
  if (typeof window === "undefined") {
    return null;
  }

  return readPaymentReturnFromHash(window.location.hash ?? "");
}
