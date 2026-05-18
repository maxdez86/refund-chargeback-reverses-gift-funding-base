import {
  HouseholdInvitationSchema,
  RsvpSubmissionResponseSchema,
  type HouseholdInvitation,
  type RsvpSubmissionRequest,
  type RsvpSubmissionResponse,
} from "@brimax/contracts";

const API_URL = import.meta.env.VITE_API_URL;

export class RsvpApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RsvpApiError";
  }
}

export function normalizeInvitationCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function fetchInvitation(code: string): Promise<HouseholdInvitation> {
  if (!API_URL) {
    throw new RsvpApiError("API URL não configurada (VITE_API_URL).");
  }

  const normalized = normalizeInvitationCode(code);
  const response = await fetch(
    `${API_URL}/invitation/${encodeURIComponent(normalized)}`
  );
  const text = await response.text();
  const body: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = extractErrorMessage(body) ?? `HTTP ${response.status}`;
    throw new RsvpApiError(message, response.status);
  }

  const parsed = HouseholdInvitationSchema.safeParse(body);
  if (!parsed.success) {
    throw new RsvpApiError("Resposta inválida do servidor de convites.");
  }

  return parsed.data;
}

export async function submitRsvp(
  input: RsvpSubmissionRequest
): Promise<RsvpSubmissionResponse> {
  if (!API_URL) {
    throw new RsvpApiError("API URL não configurada (VITE_API_URL).");
  }

  const response = await fetch(`${API_URL}/rsvp`, {
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
    throw new RsvpApiError(message, response.status);
  }

  const parsed = RsvpSubmissionResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new RsvpApiError("Resposta inválida do servidor de RSVP.");
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
  if (typeof err === "object" && err !== null) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  const topMsg = (body as { message?: unknown }).message;
  if (typeof topMsg === "string") return topMsg;
  return undefined;
}
