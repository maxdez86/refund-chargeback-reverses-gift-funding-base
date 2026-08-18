import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminSessionResponse } from "@brimax/contracts";
import { AdminApiError, getAdminSession } from "@/lib/admin-api";
import {
  getAdminRuntimeConfig,
  validateGoogleCredential,
  type AdminRuntimeConfig
} from "@/lib/admin-auth";
import { createFixtureAdminSession } from "@/lib/admin-fixtures";
import { disableGoogleAutoSelect } from "@/lib/google-identity";

export type AdminSessionState =
  | { status: "access-denied"; message: string }
  | { status: "authenticated"; session: AdminSessionResponse; preview: boolean }
  | { status: "checking" }
  | { status: "configuration-error"; message: string }
  | { status: "unauthenticated"; message?: string }
  | { status: "unavailable"; message: string };

type UseAdminSessionOptions = {
  config?: AdminRuntimeConfig;
  fetchSession?: typeof getAdminSession;
  now?: () => number;
};

type RuntimeResult =
  | { config: AdminRuntimeConfig; error?: never }
  | { config?: never; error: string };

export function useAdminSession(options: UseAdminSessionOptions = {}) {
  const runtime = useMemo<RuntimeResult>(() => {
    try {
      const config = options.config
        ? getAdminRuntimeConfig({
            VITE_APP_STAGE: options.config.stage,
            VITE_ADMIN_SESSION_MODE: options.config.sessionMode,
            VITE_GOOGLE_WEB_CLIENT_ID: options.config.googleClientId,
            VITE_ADMIN_GOOGLE_HOSTED_DOMAIN: options.config.hostedDomain
          })
        : getAdminRuntimeConfig();
      return { config };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Configuração administrativa inválida."
      };
    }
  }, [options.config]);
  const [state, setState] = useState<AdminSessionState>(() =>
    runtime.error
      ? { status: "configuration-error", message: runtime.error }
      : { status: "unauthenticated" }
  );
  const tokenRef = useRef<string | null>(null);
  const expirationRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const now = options.now ?? Date.now;
  const fetchSession = options.fetchSession ?? getAdminSession;

  const authenticate = useCallback(
    async (credential: string) => {
      if (!runtime.config) return;
      const config = runtime.config;
      const validation = validateGoogleCredential(credential, config, now());
      if (!validation.ok) {
        tokenRef.current = null;
        expirationRef.current = null;
        setState(
          validation.reason === "access-denied"
            ? { status: "access-denied", message: validation.message }
            : { status: "unauthenticated", message: validation.message }
        );
        return;
      }

      const attempt = ++attemptRef.current;
      tokenRef.current = credential;
      expirationRef.current = validation.claims.expiresAtMs;
      setState({ status: "checking" });

      try {
        const session =
          config.sessionMode === "fixture"
            ? createFixtureAdminSession(validation.claims)
            : await fetchSession(credential, config.stage);
        if (attempt === attemptRef.current) {
          setState({
            status: "authenticated",
            session,
            preview: config.sessionMode === "fixture"
          });
        }
      } catch (error) {
        if (attempt !== attemptRef.current) return;
        if (error instanceof AdminApiError && error.kind === "unauthorized") {
          tokenRef.current = null;
          expirationRef.current = null;
          setState({ status: "unauthenticated", message: error.message });
        } else if (error instanceof AdminApiError && error.kind === "forbidden") {
          tokenRef.current = null;
          expirationRef.current = null;
          setState({ status: "access-denied", message: error.message });
        } else {
          setState({
            status: "unavailable",
            message: error instanceof Error ? error.message : "O serviço está indisponível."
          });
        }
      }
    },
    [fetchSession, now, runtime]
  );

  const signOut = useCallback(() => {
    attemptRef.current += 1;
    tokenRef.current = null;
    expirationRef.current = null;
    disableGoogleAutoSelect();
    setState({ status: "unauthenticated" });
  }, []);

  const retry = useCallback(() => {
    if (tokenRef.current) void authenticate(tokenRef.current);
  }, [authenticate]);

  useEffect(() => {
    if (state.status !== "authenticated" || expirationRef.current === null) return;
    const remaining = expirationRef.current - now();
    if (remaining <= 0) {
      signOut();
      return;
    }
    const timer = window.setTimeout(signOut, Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [now, signOut, state.status]);

  return {
    state,
    config: runtime.config ?? null,
    acceptCredential: authenticate,
    retry,
    signOut
  };
}
