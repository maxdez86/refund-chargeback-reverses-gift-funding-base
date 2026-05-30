import { GetGiftsResponseSchema, type Gift } from "@brimax/contracts";
import { PaymentApiError } from "@/lib/payments-api";

// In dev, use the same-origin `/api` base so the Vite dev server read-only
// proxies the request to the deployed API (the prod CORS allowlist excludes
// localhost). Production builds use the absolute VITE_API_URL as before.
const API_URL = import.meta.env.DEV ? "/api" : import.meta.env.VITE_API_URL;

export const giftsQueryKey = ["gifts"] as const;

export async function getGifts(): Promise<Gift[]> {
  if (!API_URL) {
    throw new PaymentApiError("API URL não configurada (VITE_API_URL).");
  }

  const response = await fetch(`${API_URL}/gifts`);
  const text = await response.text();
  const body: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = extractErrorMessage(body) ?? `HTTP ${response.status}`;
    throw new PaymentApiError(message, response.status);
  }

  const parsed = GetGiftsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new PaymentApiError("Resposta inválida do servidor de presentes.");
  }

  return parsed.data.gifts;
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
  const topMsg = (body as { message?: unknown }).message;
  if (typeof topMsg === "string") return topMsg;
  return undefined;
}
