import {
  AdminAddGuestsRequestSchema,
  AdminConfirmGuestsRequestSchema,
  AdminCreateInvitationRequestSchema,
  AdminCreateInvitationResponseSchema,
  AdminDashboardResponseSchema,
  AdminDeleteInvitationResponseSchema,
  AdminGuestUpdateRequestSchema,
  AdminInvitationRsvpWriteResponseSchema,
  AdminNextInvitationCodeResponseSchema,
  AdminSessionResponseSchema,
  type AdminAddGuestsRequest,
  type AdminCreateInvitationRequest,
  type AdminCreateInvitationResponse,
  type AdminDashboardResponse,
  type AdminDeleteInvitationResponse,
  type AdminGuestUpdateRequest,
  type AdminInvitationRsvpWriteResponse,
  type AdminNextInvitationCodeResponse,
  type AdminSessionResponse,
  DeleteGuestMessageResponseSchema,
  type DeleteGuestMessageResponse,
  WhatsappOperatorTextSendRequestSchema,
  WhatsappOperatorTextSendResponseSchema,
  type WhatsappOperatorTextSendResponse,
  WhatsappRsvpAutoSendRequestSchema,
  WhatsappRsvpErrorResponseSchema,
  WhatsappRsvpSendResponseSchema,
  type WhatsappRsvpErrorCode,
  type WhatsappRsvpSendMode,
  type WhatsappRsvpSendResponse,
  WhatsappPhoneUpdateRequestSchema,
  WhatsappPhoneUpdateResponseSchema,
  type WhatsappPhoneUpdateResponse,
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

/**
 * `DELETE /admin/guest-messages/{messageId}` answers failures with the plain `{ message }`
 * envelope, so there is no error code to key on — the map is keyed by HTTP status instead.
 */
const DELETE_MESSAGE_ERROR_MESSAGES: Record<number, string> = {
  400: "Este recado não pôde ser identificado. Atualize os dados e tente novamente.",
  404: "Este recado não existe mais."
};

/**
 * The two guest writes answer failures with the plain `{ message }` envelope, like the recado
 * delete and unlike the coded WhatsApp sends, so the map is keyed by HTTP status.
 */
const GUEST_WRITE_ERROR_MESSAGES: Record<number, string> = {
  400: "Esta alteração não pôde ser interpretada. Atualize os dados e tente novamente.",
  404: "Este convidado não está mais disponível. Atualize os dados do painel.",
  409: "Os dados do convite mudaram. Atualize o painel e tente novamente."
};

/**
 * Creating an invitation fails differently from editing one: the 409 is a code someone else already
 * used, which the operator fixes by typing another one rather than by refreshing the panel.
 */
const CREATE_INVITATION_ERROR_MESSAGES: Record<number, string> = {
  400: "Confira o código, o telefone e os nomes antes de criar o convite.",
  409: "Já existe um convite com este código. Escolha outro código."
};

const NEXT_CODE_ERROR_MESSAGES: Record<number, string> = {
  503: "Não foi possível sugerir um código de convite agora."
};

const DELETE_INVITATION_ERROR_MESSAGES: Record<number, string> = {
  400: "Este convite não pôde ser identificado. Atualize os dados e tente novamente.",
  404: "Este convite não existe mais."
};

/**
 * A 409 on the removal route means the guest is the last one on the invitation — the server refuses
 * to leave an invitation with nobody on it, and the remedy is to delete the invitation instead.
 */
const REMOVE_GUEST_ERROR_MESSAGES: Record<number, string> = {
  ...GUEST_WRITE_ERROR_MESSAGES,
  409: "Este é o último convidado do convite. Exclua o convite em vez de remover o convidado."
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

/**
 * Hard-deletes one guest message (recado) from the public wall.
 *
 * Unlike the WhatsApp sends this route answers with the plain `{ message }` error envelope
 * rather than a coded one, so the pt-BR map is keyed by HTTP status. It also takes no
 * `Idempotency-Key`: DELETE is naturally idempotent here and a repeat call is simply a 404.
 */
export async function deleteAdminGuestMessage(
  messageId: string,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<DeleteGuestMessageResponse> {
  const apiUrl = resolveAdminApiUrl(options);
  if (!apiUrl) throw new AdminApiError("A API administrativa não está configurada.", "unavailable");
  const token = getToken();
  if (!token) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `${apiUrl}/admin/guest-messages/${encodeURIComponent(messageId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: options.signal
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AdminApiError("Não foi possível acessar o serviço administrativo.", "unavailable");
  }

  if (response.status === 401) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  if (response.status === 403) throw new AdminApiError("Esta conta não tem acesso ao painel.", "forbidden", 403);

  if (!response.ok) {
    throw new AdminApiError(
      DELETE_MESSAGE_ERROR_MESSAGES[response.status] ?? "Não foi possível excluir o recado.",
      response.status >= 500 ? "unavailable" : "rejected",
      response.status
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminApiError("O serviço retornou uma resposta inválida.", "invalid-response", response.status);
  }

  const parsed = DeleteGuestMessageResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.messageId !== messageId) {
    throw new AdminApiError(
      "O serviço retornou uma confirmação de exclusão inválida.",
      "invalid-response",
      response.status
    );
  }
  return parsed.data;
}

/** Updates the WhatsApp phone assigned to one invitation. */
export async function updateAdminInvitationPhone(
  invitationCode: string,
  phoneNumber: string,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<WhatsappPhoneUpdateResponse> {
  const apiUrl = resolveAdminApiUrl(options);
  if (!apiUrl) throw new AdminApiError("A API administrativa não está configurada.", "unavailable");
  const token = getToken();
  if (!token) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  const request = WhatsappPhoneUpdateRequestSchema.parse({ phoneNumber });

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `${apiUrl}/admin/whatsapp/invitations/${encodeURIComponent(invitationCode)}/phone`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: options.signal
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AdminApiError("Não foi possível salvar o telefone do convite.", "unavailable");
  }

  if (response.status === 401) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  if (response.status === 403) throw new AdminApiError("Esta conta não tem acesso ao painel.", "forbidden", 403);
  if (!response.ok) {
    throw new AdminApiError(
      response.status === 404
        ? "Este convite não está mais disponível."
        : "Não foi possível salvar o telefone do convite.",
      response.status >= 500 ? "unavailable" : "rejected",
      response.status
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminApiError("O serviço retornou uma confirmação inválida.", "invalid-response", response.status);
  }
  const parsed = WhatsappPhoneUpdateResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.invitationCode !== invitationCode) {
    throw new AdminApiError("O serviço retornou uma confirmação inválida para este convite.", "invalid-response", response.status);
  }
  return parsed.data;
}

/**
 * Shared transport for the two admin RSVP writes.
 *
 * Both answer with the same reconciliation payload, so the caller can install the invitation's
 * guests and aggregate without a dashboard refetch. Neither sends an `Idempotency-Key`: each write
 * sets an absolute state, which makes a repeat call a no-op rather than a duplicate.
 */
async function writeAdminInvitationRsvp(
  path: string,
  method: "DELETE" | "PATCH" | "POST",
  invitationCode: string,
  payload: unknown,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions,
  errorMessages: Record<number, string> = GUEST_WRITE_ERROR_MESSAGES
): Promise<AdminInvitationRsvpWriteResponse> {
  const apiUrl = resolveAdminApiUrl(options);
  if (!apiUrl) throw new AdminApiError("A API administrativa não está configurada.", "unavailable");
  const token = getToken();
  if (!token) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${apiUrl}${path}`, {
      method,
      // The removal route identifies the guest entirely by its path, so it sends no body at all
      // rather than an empty JSON object the server would have to ignore.
      ...(payload === undefined
        ? { headers: { Authorization: `Bearer ${token}` } }
        : {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }),
      signal: options.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AdminApiError("Não foi possível acessar o serviço administrativo.", "unavailable");
  }

  if (response.status === 401) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  if (response.status === 403) throw new AdminApiError("Esta conta não tem acesso ao painel.", "forbidden", 403);

  // Checked before the body is read, so a non-JSON gateway error stays `unavailable`.
  if (!response.ok) {
    throw new AdminApiError(
      errorMessages[response.status] ?? "Não foi possível salvar a alteração.",
      response.status >= 500 ? "unavailable" : "rejected",
      response.status
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminApiError("O serviço retornou uma resposta inválida.", "invalid-response", response.status);
  }

  const parsed = AdminInvitationRsvpWriteResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.invitationCode !== invitationCode) {
    throw new AdminApiError(
      "O serviço retornou uma confirmação inválida para este convite.",
      "invalid-response",
      response.status
    );
  }
  return parsed.data;
}

/** Corrects one guest's RSVP status, seed child flag, and/or confirmed age band. */
export async function updateAdminGuest(
  invitationCode: string,
  guestId: string,
  patch: AdminGuestUpdateRequest,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<AdminInvitationRsvpWriteResponse> {
  const request = AdminGuestUpdateRequestSchema.parse(patch);
  return writeAdminInvitationRsvp(
    `/admin/invitations/${encodeURIComponent(invitationCode)}/guests/${encodeURIComponent(guestId)}`,
    "PATCH",
    invitationCode,
    request,
    getToken,
    options
  );
}

/** Confirms the selected guests of one invitation; unselected guests keep their current status. */
export async function confirmAdminInvitationGuests(
  invitationCode: string,
  guestIds: string[],
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<AdminInvitationRsvpWriteResponse> {
  const request = AdminConfirmGuestsRequestSchema.parse({ guestIds });
  return writeAdminInvitationRsvp(
    `/admin/invitations/${encodeURIComponent(invitationCode)}/confirm-all`,
    "POST",
    invitationCode,
    request,
    getToken,
    options
  );
}

/** Adds guests to an existing invitation; the server assigns each new slot and guest id. */
export async function addAdminInvitationGuests(
  invitationCode: string,
  guests: AdminAddGuestsRequest["guests"],
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<AdminInvitationRsvpWriteResponse> {
  const request = AdminAddGuestsRequestSchema.parse({ guests });
  return writeAdminInvitationRsvp(
    `/admin/invitations/${encodeURIComponent(invitationCode)}/guests`,
    "POST",
    invitationCode,
    request,
    getToken,
    options
  );
}

/** Removes one guest from an invitation and prunes the answer they left. */
export async function removeAdminInvitationGuest(
  invitationCode: string,
  guestId: string,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<AdminInvitationRsvpWriteResponse> {
  return writeAdminInvitationRsvp(
    `/admin/invitations/${encodeURIComponent(invitationCode)}/guests/${encodeURIComponent(guestId)}`,
    "DELETE",
    invitationCode,
    undefined,
    getToken,
    options,
    REMOVE_GUEST_ERROR_MESSAGES
  );
}

/**
 * Creates one invitation from an operator-supplied code.
 *
 * The request is validated against the contract before the call, so a code in the wrong format is
 * a local error rather than a round trip. Uniqueness is only knowable server-side and comes back
 * as the 409.
 */
export async function createAdminInvitation(
  draft: AdminCreateInvitationRequest,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<AdminCreateInvitationResponse> {
  const request = AdminCreateInvitationRequestSchema.parse(draft);
  const response = await sendAdminInvitationRequest(
    "/admin/invitations",
    "POST",
    request,
    getToken,
    options,
    CREATE_INVITATION_ERROR_MESSAGES
  );

  const parsed = AdminCreateInvitationResponseSchema.safeParse(response.body);
  if (!parsed.success || parsed.data.invitation.invitationCode !== request.invitationCode) {
    throw new AdminApiError(
      "O serviço retornou uma confirmação inválida para este convite.",
      "invalid-response",
      response.status
    );
  }
  return parsed.data;
}

/** Gets the lowest available invitation code suggestion. */
export async function getNextAdminInvitationCode(
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<AdminNextInvitationCodeResponse> {
  const response = await sendAdminInvitationRequest(
    "/admin/invitations/next-code",
    "GET",
    undefined,
    getToken,
    options,
    NEXT_CODE_ERROR_MESSAGES
  );
  const parsed = AdminNextInvitationCodeResponseSchema.safeParse(response.body);
  if (!parsed.success) {
    throw new AdminApiError("O serviço retornou uma sugestão de código inválida.", "invalid-response", response.status);
  }
  return parsed.data;
}

/** Hard-deletes one invitation and everything keyed to its code. */
export async function deleteAdminInvitation(
  invitationCode: string,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions = {}
): Promise<AdminDeleteInvitationResponse> {
  const response = await sendAdminInvitationRequest(
    `/admin/invitations/${encodeURIComponent(invitationCode)}`,
    "DELETE",
    undefined,
    getToken,
    options,
    DELETE_INVITATION_ERROR_MESSAGES
  );

  const parsed = AdminDeleteInvitationResponseSchema.safeParse(response.body);
  if (!parsed.success || parsed.data.invitationCode !== invitationCode) {
    throw new AdminApiError(
      "O serviço retornou uma confirmação de exclusão inválida.",
      "invalid-response",
      response.status
    );
  }
  return parsed.data;
}

/**
 * Transport for the two structural writes that do not answer with the RSVP reconciliation payload.
 *
 * Same ladder as `writeAdminInvitationRsvp` — auth before status, status before body — but it hands
 * the parsed body back so each caller can validate against its own response schema.
 */
async function sendAdminInvitationRequest(
  path: string,
  method: "DELETE" | "POST" | "GET",
  payload: unknown,
  getToken: AdminTokenAccessor,
  options: AdminApiOptions,
  errorMessages: Record<number, string>
): Promise<{ body: unknown; status: number }> {
  const apiUrl = resolveAdminApiUrl(options);
  if (!apiUrl) throw new AdminApiError("A API administrativa não está configurada.", "unavailable");
  const token = getToken();
  if (!token) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${apiUrl}${path}`, {
      method,
      ...(payload === undefined
        ? { headers: { Authorization: `Bearer ${token}` } }
        : {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }),
      signal: options.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AdminApiError("Não foi possível acessar o serviço administrativo.", "unavailable");
  }

  if (response.status === 401) throw new AdminApiError("Sua sessão não é mais válida.", "unauthorized", 401);
  if (response.status === 403) throw new AdminApiError("Esta conta não tem acesso ao painel.", "forbidden", 403);

  // Checked before the body is read, so a non-JSON gateway error stays `unavailable`.
  if (!response.ok) {
    throw new AdminApiError(
      errorMessages[response.status] ?? "Não foi possível salvar a alteração.",
      response.status >= 500 ? "unavailable" : "rejected",
      response.status
    );
  }

  try {
    return { body: await response.json(), status: response.status };
  } catch {
    throw new AdminApiError("O serviço retornou uma resposta inválida.", "invalid-response", response.status);
  }
}
