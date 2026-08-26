import {
  AdminDashboardResponseSchema,
  AdminSessionResponseSchema,
  type AdminDashboardResponse,
  type AdminSessionResponse,
  WhatsappOperatorTextSendRequestSchema,
  WhatsappOperatorTextSendResponseSchema,
  type WhatsappOperatorTextSendResponse,
  WhatsappRsvpAutoSendRequestSchema,
  WhatsappRsvpErrorResponseSchema,
  WhatsappRsvpSendResponseSchema,
  type WhatsappRsvpErrorCode,
  type WhatsappRsvpSendMode,
  type WhatsappRsvpSendResponse,
  WhatsappRsvpStatusResponseSchema,
  type WhatsappRsvpStatusResponse
} from "@brimax/contracts";
import type { AppStage } from "@/lib/admin-auth";

export type AdminApiErrorKind = "forbidden" | "invalid-response" | "rejected" | "unauthorized" | "unavailable";

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly kind: AdminApiErrorKind,
    readonly status?: number,
    readonly code?: WhatsappRsvpErrorCode
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

const SEND_ERROR_MESSAGES: Partial<Record<WhatsappRsvpErrorCode, string>> = {
  VALIDATION_ERROR: "A solicitação de envio é inválida. Atualize os dados e tente novamente.",
  INVITATION_NOT_FOUND: "Este convite não está mais disponível.",
  TEMPLATE_NOT_FOUND: "O modelo de WhatsApp necessário não está disponível.",
  INVALID_INVITATION_STATE: "O convite não está pronto para este envio. Confira telefone e convidados.",
  INVALID_FLOW_TRANSITION: "O estado do fluxo mudou e este envio não é mais permitido.",
  IDEMPOTENCY_CONFLICT: "Esta tentativa de envio entrou em conflito com uma solicitação anterior.",
  QUEUE_UNAVAILABLE: "A fila de WhatsApp está indisponível. Tente novamente em instantes.",
  QUEUE_FAILURE: "Não foi possível colocar a mensagem na fila. Tente novamente em instantes.",
  FREE_TEXT_WINDOW_CLOSED: "A janela de 24 horas do WhatsApp expirou. Envie um modelo aprovado."
};

export type AdminTokenAccessor = () => string | null;

type AdminApiOptions = {
  apiUrl?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

export function resolveAdminApiUrl(
  options: { apiUrl?: string; dev?: boolean; configuredApiUrl?: string } = {}
) {
  if (options.apiUrl) return options.apiUrl;
  const dev = options.dev ?? import.meta.env.DEV;
  return dev ? "/api" : options.configuredApiUrl ?? import.meta.env.VITE_API_URL;
}

export async function getAdminSession(
  idToken: string,
  expectedStage: AppStage,
  options: AdminApiOptions = {}
): Promise<AdminSessionResponse> {
  const apiUrl = resolveAdminApiUrl(options);
  if (!apiUrl) {
    throw new AdminApiError("A API administrativa não está configurada.", "unavailable");
  }

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${apiUrl}/admin/session`, {
      headers: { Authorization: `Bearer ${idToken}` }
    });
  } catch {
    throw new AdminApiError("Não foi possível acessar o serviço administrativo.", "unavailable");
  }

  if (response.status === 401) {
    throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  }
  if (response.status === 403) {
    throw new AdminApiError("Esta conta não tem acesso ao painel.", "forbidden", 403);
  }
  if (!response.ok) {
    throw new AdminApiError("O serviço administrativo está indisponível.", "unavailable", response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminApiError("O serviço retornou uma resposta inválida.", "invalid-response");
  }

  const parsed = AdminSessionResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.stage !== expectedStage) {
    throw new AdminApiError("O serviço retornou uma resposta inválida para este ambiente.", "invalid-response");
  }
  return parsed.data;
}

export async function getAdminDashboard(
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<AdminDashboardResponse> {
  const apiUrl = resolveAdminApiUrl(options);
  if (!apiUrl) {
    throw new AdminApiError("A API administrativa não está configurada.", "unavailable");
  }

  const token = getToken();
  if (!token) {
    throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  }

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${apiUrl}/admin/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: options.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AdminApiError("Não foi possível acessar o serviço administrativo.", "unavailable");
  }

  if (response.status === 401) {
    throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  }
  if (response.status === 403) {
    throw new AdminApiError("Esta conta não tem acesso ao painel.", "forbidden", 403);
  }
  if (!response.ok) {
    throw new AdminApiError("O serviço administrativo está indisponível.", "unavailable", response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminApiError("O serviço retornou uma resposta inválida.", "invalid-response");
  }

  const parsed = AdminDashboardResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AdminApiError("O serviço retornou dados inválidos para o painel.", "invalid-response");
  }
  return parsed.data;
}

export async function getAdminWhatsappThread(
  invitationCode: string,
  getToken: AdminTokenAccessor,
  cursor?: string,
  options: AdminApiOptions = {}
): Promise<WhatsappRsvpStatusResponse> {
  const apiUrl = resolveAdminApiUrl(options);
  if (!apiUrl) throw new AdminApiError("A API administrativa não está configurada.", "unavailable");
  const token = getToken();
  if (!token) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  const query = new URLSearchParams({ limit: "50", order: "desc" });
  if (cursor) query.set("cursor", cursor);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `${apiUrl}/admin/whatsapp/invitations/${encodeURIComponent(invitationCode)}?${query}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: options.signal }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AdminApiError("Não foi possível carregar a conversa.", "unavailable");
  }
  if (response.status === 401) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  if (response.status === 403) throw new AdminApiError("Esta conta não tem acesso ao painel.", "forbidden", 403);
  if (!response.ok) throw new AdminApiError("Não foi possível carregar a conversa.", "unavailable", response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminApiError("O serviço retornou uma conversa inválida.", "invalid-response");
  }
  const parsed = WhatsappRsvpStatusResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.invitationCode !== invitationCode) {
    throw new AdminApiError("O serviço retornou uma conversa inválida.", "invalid-response");
  }
  return parsed.data;
}

export async function sendAdminWhatsappRsvp(
  invitationCode: string,
  mode: WhatsappRsvpSendMode,
  idempotencyKey: string,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<WhatsappRsvpSendResponse> {
  const apiUrl = resolveAdminApiUrl(options);
  if (!apiUrl) throw new AdminApiError("A API administrativa não está configurada.", "unavailable");
  const token = getToken();
  if (!token) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  const request = WhatsappRsvpAutoSendRequestSchema.parse({ mode });

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `${apiUrl}/admin/whatsapp/invitations/${encodeURIComponent(invitationCode)}/send-rsvp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(request),
        signal: options.signal
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AdminApiError("Não foi possível acessar o serviço de WhatsApp.", "unavailable");
  }

  if (response.status === 401) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  if (response.status === 403) throw new AdminApiError("Esta conta não tem acesso ao painel.", "forbidden", 403);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminApiError("O serviço retornou uma resposta de envio inválida.", "invalid-response", response.status);
  }

  if (!response.ok) {
    const parsedError = WhatsappRsvpErrorResponseSchema.safeParse(body);
    if (!parsedError.success) {
      throw new AdminApiError("O serviço recusou o envio com uma resposta inválida.", "invalid-response", response.status);
    }
    const code = parsedError.data.code;
    throw new AdminApiError(
      SEND_ERROR_MESSAGES[code] ?? "Não foi possível solicitar o envio pelo WhatsApp.",
      response.status >= 500 ? "unavailable" : "rejected",
      response.status,
      code
    );
  }

  const parsed = WhatsappRsvpSendResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.invitationCode !== invitationCode) {
    throw new AdminApiError("O serviço retornou uma confirmação de envio inválida.", "invalid-response", response.status);
  }
  return parsed.data;
}

/**
 * Sends an operator-composed free-text message. Mirrors `sendAdminWhatsappRsvp`'s transport
 * contract — bearer token, idempotency header, error payload parsing — but posts a body rather
 * than a template mode, and is accepted (202) rather than delivered synchronously.
 */
export async function sendAdminWhatsappText(
  invitationCode: string,
  body: string,
  idempotencyKey: string,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<WhatsappOperatorTextSendResponse> {
  const apiUrl = resolveAdminApiUrl(options);
  if (!apiUrl) throw new AdminApiError("A API administrativa não está configurada.", "unavailable");
  const token = getToken();
  if (!token) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  const request = WhatsappOperatorTextSendRequestSchema.parse({ body });

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `${apiUrl}/admin/whatsapp/invitations/${encodeURIComponent(invitationCode)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(request),
        signal: options.signal
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AdminApiError("Não foi possível acessar o serviço de WhatsApp.", "unavailable");
  }

  if (response.status === 401) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  if (response.status === 403) throw new AdminApiError("Esta conta não tem acesso ao painel.", "forbidden", 403);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AdminApiError("O serviço retornou uma resposta de envio inválida.", "invalid-response", response.status);
  }

  if (!response.ok) {
    const parsedError = WhatsappRsvpErrorResponseSchema.safeParse(payload);
    if (!parsedError.success) {
      throw new AdminApiError("O serviço recusou o envio com uma resposta inválida.", "invalid-response", response.status);
    }
    const code = parsedError.data.code;
    throw new AdminApiError(
      SEND_ERROR_MESSAGES[code] ?? "Não foi possível enviar a mensagem pelo WhatsApp.",
      response.status >= 500 ? "unavailable" : "rejected",
      response.status,
      code
    );
  }

  const parsed = WhatsappOperatorTextSendResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.invitationCode !== invitationCode) {
    throw new AdminApiError("O serviço retornou uma confirmação de envio inválida.", "invalid-response", response.status);
  }
  return parsed.data;
}
