import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionState } from "@/hooks/use-admin-session";
import type { AdminRuntimeConfig } from "@/lib/admin-auth";
import type { AdminDashboardSource } from "@/lib/admin-dashboard-source";
import { createLiveDashboardSource } from "@/lib/admin-dashboard-source";

type MockAdminSession = {
  state: AdminSessionState;
  config: AdminRuntimeConfig | null;
  acceptCredential: (credential: string) => void;
  retry: () => void;
  signOut: () => void;
  dashboardSource?: AdminDashboardSource;
};

const useAdminSessionMock = vi.fn<() => MockAdminSession>();

vi.mock("@/hooks/use-admin-session", () => ({
  useAdminSession: () => useAdminSessionMock()
}));

vi.mock("@/components/dashboard/GoogleSignInButton", () => ({
  GoogleSignInButton: ({ onCredential }: { onCredential: (credential: string) => void }) => (
    <button onClick={() => onCredential("credential")}>Continuar com Google</button>
  )
}));

import Dashboard from "@/pages/Dashboard";
import { getAdminInitials } from "@/components/dashboard/AdminSidebar";

const config = {
  stage: "dev" as const,
  sessionMode: "fixture" as const,
  googleClientId: "dev-client",
  hostedDomain: "brimax.life"
};
const baseActions = {
  acceptCredential: vi.fn(),
  retry: vi.fn(),
  signOut: vi.fn()
};

const authenticatedSession: AdminSessionState = {
  status: "authenticated",
  preview: true,
  session: {
    authenticated: true,
    stage: "dev",
    admin: {
      subject: "subject",
      email: "casamento@brimax.life",
      hostedDomain: "brimax.life",
      name: "Casamento Brimax"
    }
  }
};

describe("administrative dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/dashboard");
  });

  it("renders the unauthenticated Google Workspace state", () => {
    useAdminSessionMock.mockReturnValue({ ...baseActions, config, state: { status: "unauthenticated" } });
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: "Administração Brimax" })).toBeInTheDocument();
    expect(screen.getByText(/conta verificada do Google Workspace brimax.life/i)).toBeInTheDocument();
    expect(screen.getByText(/serviço administrativo valida esta credencial/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continuar com Google" }));
    expect(baseActions.acceptCredential).toHaveBeenCalledWith("credential");
  });

  it("lands on the overview with the demonstration banner and live counters", async () => {
    useAdminSessionMock.mockReturnValue({ ...baseActions, config, state: authenticatedSession });
    render(<Dashboard />);

    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(screen.getByText(/Dados de demonstração/i)).toBeInTheDocument();
    // Eight fixture invitations covering fourteen people.
    expect(screen.getByRole("button", { name: /CONVITES\s*8/ })).toBeInTheDocument();
    expect(screen.getAllByRole("navigation", { name: "Navegação administrativa" })).not.toHaveLength(0);
  });

  it("loads a live dashboard once without requesting WhatsApp history", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, invitations: [], gifts: [], guestMessages: [] }), {
        status: 200
      })
    );
    const dashboardSource = createLiveDashboardSource({
      getToken: () => "test-token",
      apiUrl: "/api",
      fetcher
    });
    useAdminSessionMock.mockReturnValue({
      ...baseActions,
      config: { ...config, sessionMode: "live" },
      dashboardSource,
      state: { ...authenticatedSession, preview: false }
    });

    render(<Dashboard />);

    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/admin/dashboard");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("whatsapp"))).toBe(false);
    expect(screen.queryByText(/Dados de demonstração/i)).not.toBeInTheDocument();
  });

  it("refreshes live data with one additional dashboard request and no re-authentication", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, invitations: [], gifts: [], guestMessages: [] }), {
        status: 200
      })
    );
    const dashboardSource = createLiveDashboardSource({
      getToken: () => "test-token",
      apiUrl: "/api",
      fetcher
    });
    useAdminSessionMock.mockReturnValue({
      ...baseActions,
      config: { ...config, sessionMode: "live" },
      dashboardSource,
      state: { ...authenticatedSession, preview: false }
    });
    render(<Dashboard />);
    await screen.findByRole("heading", { name: "Visão geral" });

    fireEvent.click(screen.getByRole("button", { name: "Atualizar dados" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.every(([url]) => url === "/api/admin/dashboard")).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("whatsapp"))).toBe(false);
    expect(baseActions.acceptCredential).not.toHaveBeenCalled();
  });

  it("opens the mobile navigation drawer and closes it on selection", async () => {
    useAdminSessionMock.mockReturnValue({ ...baseActions, config, state: authenticatedSession });
    render(<Dashboard />);
    await screen.findByRole("heading", { name: "Visão geral" });

    fireEvent.click(screen.getByRole("button", { name: "Abrir navegação" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("link", { name: /WhatsApp/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "WhatsApp" })).toBeInTheDocument();
  });

  it.each([
    [{ status: "checking" as const }, "Verificando seu acesso"],
    [{ status: "access-denied" as const, message: "Conta sem acesso." }, "Acesso não autorizado"],
    [{ status: "unavailable" as const, message: "Serviço offline." }, "Painel temporariamente indisponível"],
    [{ status: "configuration-error" as const, message: "Cliente ausente." }, "Configuração pendente"]
  ])("renders the important auth and service states", (state, heading) => {
    useAdminSessionMock.mockReturnValue({ ...baseActions, config, state });
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("creates private initials without loading a profile image", () => {
    expect(getAdminInitials("Casamento Brimax")).toBe("CB");
    expect(getAdminInitials("casamento@brimax.life")).toBe("C");
  });
});
