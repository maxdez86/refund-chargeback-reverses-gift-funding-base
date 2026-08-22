import {
  AdminDashboardResponseSchema,
  AdminSessionResponseSchema,
  type AdminDashboardResponse,
  type AdminSessionResponse,
  WhatsappRsvpStatusResponseSchema,
  type WhatsappRsvpStatusResponse
} from "@brimax/contracts";
import type { AppStage } from "@/lib/admin-auth";

export type AdminApiErrorKind = "forbidden" | "invalid-response" | "unauthorized" | "unavailable";

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly kind: AdminApiErrorKind,
    readonly status?: number
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

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
