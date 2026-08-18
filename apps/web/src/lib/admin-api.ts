import {
  AdminSessionResponseSchema,
  type AdminSessionResponse
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

export async function getAdminSession(
  idToken: string,
  expectedStage: AppStage,
  options: { apiUrl?: string; fetcher?: typeof fetch } = {}
): Promise<AdminSessionResponse> {
  const apiUrl = options.apiUrl ?? (import.meta.env.DEV ? "/api" : import.meta.env.VITE_API_URL);
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
