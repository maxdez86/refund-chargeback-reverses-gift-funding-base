import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin-api";
import type { AdminRuntimeConfig } from "@/lib/admin-auth";
import { useAdminSession } from "@/hooks/use-admin-session";

function token(overrides: Record<string, unknown> = {}) {
  const payload = {
    aud: "dev-client",
    exp: 2_000,
    sub: "subject",
    email: "casamento@brimax.life",
    email_verified: true,
    hd: "brimax.life",
    name: "Casamento Brimax",
    ...overrides
  };
  return `header.${btoa(JSON.stringify(payload)).replace(/=/g, "")}.signature`;
}

const fixtureConfig: AdminRuntimeConfig = {
  stage: "dev",
  sessionMode: "fixture",
  googleClientId: "dev-client",
  hostedDomain: "brimax.life"
};

const liveConfig: AdminRuntimeConfig = { ...fixtureConfig, sessionMode: "live" };

describe("useAdminSession", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a clearly marked preview session only in fixture mode", async () => {
    const { result } = renderHook(() => useAdminSession({ config: fixtureConfig, now: () => 1_000_000 }));
    await act(async () => result.current.acceptCredential(token()));
    expect(result.current.state).toMatchObject({
      status: "authenticated",
      preview: true,
      session: { admin: { email: "casamento@brimax.life" } }
    });
  });

  it("shows access denied before contacting the backend for the wrong domain", async () => {
    const fetchSession = vi.fn();
    const { result } = renderHook(() => useAdminSession({ config: liveConfig, fetchSession, now: () => 1_000_000 }));
    await act(async () => result.current.acceptCredential(token({ hd: "example.com" })));
    expect(result.current.state.status).toBe("access-denied");
    expect(fetchSession).not.toHaveBeenCalled();
  });

  it.each([
    [new AdminApiError("expired", "unauthorized", 401), "unauthenticated"],
    [new AdminApiError("denied", "forbidden", 403), "access-denied"],
    [new AdminApiError("offline", "unavailable", 503), "unavailable"]
  ])("maps backend session failures", async (failure, expectedStatus) => {
    const fetchSession = vi.fn().mockRejectedValue(failure);
    const { result } = renderHook(() => useAdminSession({ config: liveConfig, fetchSession, now: () => 1_000_000 }));
    await act(async () => result.current.acceptCredential(token()));
    expect(result.current.state.status).toBe(expectedStatus);
  });

  it("retries an unavailable session with the in-memory credential", async () => {
    const session = {
      authenticated: true as const,
      stage: "dev" as const,
      admin: { subject: "subject", email: "casamento@brimax.life", hostedDomain: "brimax.life" as const }
    };
    const fetchSession = vi.fn()
      .mockRejectedValueOnce(new AdminApiError("offline", "unavailable"))
      .mockResolvedValueOnce(session);
    const { result } = renderHook(() => useAdminSession({ config: liveConfig, fetchSession, now: () => 1_000_000 }));
    await act(async () => result.current.acceptCredential(token()));
    expect(result.current.state.status).toBe("unavailable");
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe("authenticated"));
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("clears an authenticated session when the in-memory token expires", async () => {
    vi.useFakeTimers();
    let currentTime = 1_000_000;
    const fetchSession = vi.fn().mockResolvedValue({
      authenticated: true as const,
      stage: "dev" as const,
      admin: {
        subject: "subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life" as const
      }
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useAdminSession({ config: liveConfig, fetchSession, now: () => currentTime })
    );
    await act(async () => result.current.acceptCredential(token({ exp: 1_001 })));
    expect(result.current.state.status).toBe("authenticated");
    currentTime = 1_001_000;
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.state.status).toBe("unauthenticated");
    await act(async () => {
      await expect(result.current.dashboardSource.load()).rejects.toMatchObject({
        kind: "unauthorized"
      });
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the dashboard source stable across authenticated rerenders", async () => {
    const fetchSession = vi.fn().mockResolvedValue({
      authenticated: true as const,
      stage: "dev" as const,
      admin: {
        subject: "subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life" as const
      }
    });
    const { result, rerender } = renderHook(() =>
      useAdminSession({ config: liveConfig, fetchSession, now: () => 1_000_000 })
    );
    const initialSource = result.current.dashboardSource;

    await act(async () => result.current.acceptCredential(token()));
    rerender();

    expect(result.current.dashboardSource).toBe(initialSource);
    expect(result.current.dashboardSource.demo).toBe(false);
  });

  it("never persists the credential while authenticating and loading live data", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const fetchSession = vi.fn().mockResolvedValue({
      authenticated: true as const,
      stage: "dev" as const,
      admin: {
        subject: "subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life" as const
      }
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, invitations: [], gifts: [], guestMessages: [] }), {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useAdminSession({ config: liveConfig, fetchSession, now: () => 1_000_000 })
    );

    await act(async () => result.current.acceptCredential(token()));
    await act(async () => {
      await result.current.dashboardSource.load();
    });

    expect(storageWrite).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthenticated"],
    [403, "access-denied"]
  ])("invalidates dashboard access after HTTP %s", async (status, expectedState) => {
    const fetchSession = vi.fn().mockResolvedValue({
      authenticated: true as const,
      stage: "dev" as const,
      admin: {
        subject: "subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life" as const
      }
    });
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useAdminSession({ config: liveConfig, fetchSession, now: () => 1_000_000 })
    );
    await act(async () => result.current.acceptCredential(token()));

    await act(async () => {
      await result.current.dashboardSource.load().catch(() => undefined);
    });

    expect(result.current.state.status).toBe(expectedState);
    fetcher.mockClear();
    await act(async () => {
      await expect(result.current.dashboardSource.load()).rejects.toMatchObject({
        kind: "unauthorized"
      });
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps an unavailable dashboard load in the dashboard error boundary", async () => {
    const fetchSession = vi.fn().mockResolvedValue({
      authenticated: true as const,
      stage: "dev" as const,
      admin: {
        subject: "subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life" as const
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() =>
      useAdminSession({ config: liveConfig, fetchSession, now: () => 1_000_000 })
    );
    await act(async () => result.current.acceptCredential(token()));

    await expect(result.current.dashboardSource.load()).rejects.toMatchObject({
      kind: "unavailable"
    });
    expect(result.current.state.status).toBe("authenticated");
  });

  it("prevents source use after sign-out", async () => {
    const fetchSession = vi.fn().mockResolvedValue({
      authenticated: true as const,
      stage: "dev" as const,
      admin: {
        subject: "subject",
        email: "casamento@brimax.life",
        hostedDomain: "brimax.life" as const
      }
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useAdminSession({ config: liveConfig, fetchSession, now: () => 1_000_000 })
    );
    await act(async () => result.current.acceptCredential(token()));

    act(() => result.current.signOut());

    await act(async () => {
      await expect(result.current.dashboardSource.load()).rejects.toMatchObject({
        kind: "unauthorized"
      });
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports unsafe production fixture configuration", () => {
    const { result } = renderHook(() =>
      useAdminSession({ config: { ...fixtureConfig, stage: "prod" } })
    );
    expect(result.current.config).toBeNull();
    expect(result.current.state).toMatchObject({ status: "configuration-error" });
  });
});
