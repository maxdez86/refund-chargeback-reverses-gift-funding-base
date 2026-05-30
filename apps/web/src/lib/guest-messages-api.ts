import {
  CreateGuestMessageResponseSchema,
  type CreateGuestMessageRequest,
  type GuestMessage,
  ListGuestMessagesResponseSchema
} from "@brimax/contracts";

// In dev, call the same-origin `/api` base so the Vite dev server proxies the
// request to the deployed API (avoids the prod CORS allowlist, which excludes
// localhost). Production builds use the absolute VITE_API_URL as before.
const API_URL = import.meta.env.DEV ? "/api" : import.meta.env.VITE_API_URL;

export class GuestMessagesApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GuestMessagesApiError";
  }
}

export const guestMessagesQueryKey = ["guest-messages"] as const;

export type GuestMessagesPage = {
  messages: GuestMessage[];
  nextCursor: string | null;
};

export async function listGuestMessages(cursor?: string | null): Promise<GuestMessagesPage> {
  if (!API_URL) {
    throw new GuestMessagesApiError("API URL não configurada (VITE_API_URL).");
  }

  // Base is only used when API_URL is relative (the dev `/api` proxy base);
  // an absolute VITE_API_URL (prod) ignores it, so behavior is unchanged there.
  const url = new URL(`${API_URL}/guest-messages`, window.location.origin);
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetch(url.toString());
  const text = await response.text();
  const body: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = extractErrorMessage(body) ?? `HTTP ${response.status}`;
    throw new GuestMessagesApiError(message, response.status);
  }

  const parsed = ListGuestMessagesResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new GuestMessagesApiError("Resposta inválida do servidor de recados.");
  }

  return {
    messages: parsed.data.messages,
    nextCursor: parsed.data.nextCursor
  };
}

export async function createGuestMessage(
  input: CreateGuestMessageRequest,
  turnstileToken?: string | null
) {
  if (!API_URL) {
    throw new GuestMessagesApiError("API URL não configurada (VITE_API_URL).");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (turnstileToken) {
    headers["x-turnstile-token"] = turnstileToken;
  }

  const response = await fetch(`${API_URL}/guest-messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(input)
  });
  const text = await response.text();
  const body: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = extractErrorMessage(body) ?? `HTTP ${response.status}`;
    throw new GuestMessagesApiError(message, response.status);
  }

  const parsed = CreateGuestMessageResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new GuestMessagesApiError("Resposta inválida do servidor de recados.");
  }

  return parsed.data;
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
  const topMsg = (body as { message?: unknown }).message;
  if (typeof topMsg === "string") return topMsg;
  return undefined;
}
