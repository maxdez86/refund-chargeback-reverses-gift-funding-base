import {
  CreatePaymentMessageResponseSchema,
  CreatePaymentResponseSchema,
  GetPaymentResponseSchema,
  type CreatePaymentMessageRequest,
  type CreatePaymentRequest,
  type PaymentSummary,
} from "@brimax/contracts";

const API_URL = import.meta.env.VITE_API_URL;

export class PaymentApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PaymentApiError";
  }
}

export async function createPayment(
  input: CreatePaymentRequest
): Promise<PaymentSummary> {
  if (!API_URL) {
    throw new PaymentApiError(
      "API URL não configurada (VITE_API_URL)."
    );
  }

  const response = await fetch(`${API_URL}/payments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(input),
  });

  const text = await response.text();
  const body: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = extractErrorMessage(body) ?? `HTTP ${response.status}`;
    throw new PaymentApiError(message, response.status);
  }

  const parsed = CreatePaymentResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new PaymentApiError(
      "Resposta inválida do servidor de pagamentos."
    );
  }

  return parsed.data.payment;
}

export async function getPayment(paymentId: string): Promise<PaymentSummary> {
  if (!API_URL) {
    throw new PaymentApiError(
      "API URL não configurada (VITE_API_URL)."
    );
  }

  const response = await fetch(`${API_URL}/payments/${encodeURIComponent(paymentId)}`);
  const text = await response.text();
  const body: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = extractErrorMessage(body) ?? `HTTP ${response.status}`;
    throw new PaymentApiError(message, response.status);
  }

  const parsed = GetPaymentResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new PaymentApiError(
      "Resposta inválida do servidor de pagamentos."
    );
  }

  return parsed.data.payment;
}

export async function createPaymentMessage(
  paymentId: string,
  input: CreatePaymentMessageRequest
) {
  if (!API_URL) {
    throw new PaymentApiError(
      "API URL não configurada (VITE_API_URL)."
    );
  }

  const response = await fetch(`${API_URL}/payments/${encodeURIComponent(paymentId)}/message`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(input),
  });

  const text = await response.text();
  const body: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = extractErrorMessage(body) ?? `HTTP ${response.status}`;
    throw new PaymentApiError(message, response.status);
  }

  const parsed = CreatePaymentMessageResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new PaymentApiError(
      "Resposta inválida do servidor de pagamentos."
    );
  }

  return parsed.data.message;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const err = (body as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  const topMsg = (body as { message?: unknown }).message;
  if (typeof topMsg === "string") return topMsg;
  return undefined;
}
