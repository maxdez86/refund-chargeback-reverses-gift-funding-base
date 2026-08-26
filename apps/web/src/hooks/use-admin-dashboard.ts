import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AdminApiError } from "@/lib/admin-api";
import { toGuestRows } from "@/lib/admin-dashboard-model";
import { fixtureDashboardSource, type AdminDashboardSource } from "@/lib/admin-dashboard-source";
import type { AdminDashboardSnapshot } from "@/lib/admin-dashboard-types";
import {
  adminDashboardReducer,
  createInitialState,
  unreadCount,
  type AdminDashboardAction,
  type AdminDashboardIntent,
  type AdminDashboardState
} from "@/lib/admin-dashboard-store";

const EMPTY_SNAPSHOT = {
  invitations: [],
  guestMessages: [],
  gifts: [],
  threads: {}
} satisfies AdminDashboardSnapshot;

const EMPTY_STATE: AdminDashboardState = createInitialState(EMPTY_SNAPSHOT);

type UseAdminDashboardOptions = {
  source?: AdminDashboardSource;
  /** Injectable clock so mutations are deterministic under test. */
  now?: () => string;
};

type AdminDashboardRefreshState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

type DashboardRequest = {
  controller: AbortController;
  promise: Promise<void>;
  requestId: number;
  sourceGeneration: number;
};

/**
 * Loads one dashboard snapshot and exposes it alongside the mutations the panel performs.
 * The data itself comes from `AdminDashboardSource` — fixtures today, admin endpoints later.
 */
export function useAdminDashboard(options: UseAdminDashboardOptions = {}) {
  const source = options.source ?? fixtureDashboardSource;
  const nowOption = options.now;
  const [state, rawDispatch] = useReducer(adminDashboardReducer, EMPTY_STATE);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshState, setRefreshState] = useState<AdminDashboardRefreshState>({ status: "idle" });
  const [lastSuccessfulLoadAt, setLastSuccessfulLoadAt] = useState<string | null>(null);
  /**
   * Monotonic counter of installed snapshots. Every successful load or refresh replaces the whole
   * state — including `threadLoads`, which returns to `unloaded` — so a consumer that has one
   * conversation open needs a signal that the thread it was showing is gone. A counter rather than
   * `lastSuccessfulLoadAt` because two loads can land in the same millisecond.
   */
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const nowRef = useRef(nowOption);
  nowRef.current = nowOption;
  const sourceGenerationRef = useRef(0);
  const requestIdRef = useRef(0);
  const dashboardInFlightRef = useRef<DashboardRequest | null>(null);
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());

  useEffect(() => {
    const sourceGeneration = ++sourceGenerationRef.current;
    generationRef.current += 1;
    dashboardInFlightRef.current?.controller.abort();
    for (const request of inFlightRef.current.values()) request.controller.abort();
    inFlightRef.current.clear();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    rawDispatch({ type: "replace-snapshot", snapshot: EMPTY_SNAPSHOT });
    setStatus("loading");
    setRefreshState({ status: "idle" });
    setLastSuccessfulLoadAt(null);
    const promise = source
      .load(controller.signal)
      .then((snapshot) => {
        if (
          controller.signal.aborted ||
          sourceGeneration !== sourceGenerationRef.current ||
          requestId !== requestIdRef.current
        ) return;
        rawDispatch({ type: "replace-snapshot", snapshot });
        setLastSuccessfulLoadAt(nowRef.current ? nowRef.current() : new Date().toISOString());
        setSnapshotVersion((version) => version + 1);
        setStatus("ready");
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          sourceGeneration === sourceGenerationRef.current &&
          requestId === requestIdRef.current
        ) setStatus("error");
      })
      .finally(() => {
        if (dashboardInFlightRef.current?.promise === promise) {
          dashboardInFlightRef.current = null;
        }
      });
    dashboardInFlightRef.current = { controller, promise, requestId, sourceGeneration };
    return () => {
      sourceGenerationRef.current += 1;
      dashboardInFlightRef.current?.controller.abort();
      dashboardInFlightRef.current = null;
      controller.abort();
      for (const request of inFlightRef.current.values()) request.controller.abort();
      inFlightRef.current.clear();
    };
  }, [source]);

  const refresh = useCallback(() => {
    const existing = dashboardInFlightRef.current;
    if (existing) return existing.promise;

    const controller = new AbortController();
    const sourceGeneration = sourceGenerationRef.current;
    const requestId = ++requestIdRef.current;
    setRefreshState({ status: "loading" });
    const promise = source
      .load(controller.signal)
      .then((snapshot) => {
        if (
          controller.signal.aborted ||
          sourceGeneration !== sourceGenerationRef.current ||
          requestId !== requestIdRef.current
        ) throw new DOMException("The dashboard refresh was superseded.", "AbortError");
        generationRef.current += 1;
        for (const request of inFlightRef.current.values()) request.controller.abort();
        inFlightRef.current.clear();
        rawDispatch({ type: "replace-snapshot", snapshot });
        setLastSuccessfulLoadAt(nowRef.current ? nowRef.current() : new Date().toISOString());
        setSnapshotVersion((version) => version + 1);
        setRefreshState({ status: "idle" });
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          sourceGeneration !== sourceGenerationRef.current ||
          requestId !== requestIdRef.current
        ) throw error;
        if (
          !(error instanceof AdminApiError) ||
          (error.kind !== "unauthorized" && error.kind !== "forbidden")
        ) {
          setRefreshState({
            status: "error",
            message: "Não foi possível atualizar os dados. Use “Atualizar dados” para tentar novamente."
          });
        }
        throw error;
      })
      .finally(() => {
        if (dashboardInFlightRef.current?.promise === promise) {
          dashboardInFlightRef.current = null;
        }
      });
    dashboardInFlightRef.current = { controller, promise, requestId, sourceGeneration };
    return promise;
  }, [source]);

  const requestThread = useCallback((invitationCode: string, loadMore: boolean) => {
    const existing = inFlightRef.current.get(invitationCode);
    if (existing) return existing.promise;
    const current = stateRef.current.threadLoads[invitationCode] ?? { status: "unloaded" as const };
    if (!loadMore && current.status === "loaded") return Promise.resolve();
    const cursor = loadMore && "nextCursor" in current ? current.nextCursor : null;
    if (loadMore && !cursor) return Promise.resolve();

    const controller = new AbortController();
    const generation = generationRef.current;
    rawDispatch({ type: "thread-load-started", invitationCode, loadMore });
    const promise = source
      .loadWhatsappInvitation(invitationCode, cursor ?? undefined, controller.signal)
      .then(({ flow, page }) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        if (page.invitationCode !== invitationCode) throw new Error("Conversation invitation mismatch.");
        rawDispatch({ type: "whatsapp-invitation-refreshed", invitationCode, flow });
        rawDispatch({ type: "thread-load-succeeded", page, loadMore });
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        rawDispatch({ type: "thread-load-failed", invitationCode, loadMore });
        throw error;
      })
      .finally(() => {
        if (inFlightRef.current.get(invitationCode)?.promise === promise) {
          inFlightRef.current.delete(invitationCode);
        }
      });
    inFlightRef.current.set(invitationCode, { controller, promise });
    return promise;
  }, [source]);

  const retryWhatsappThread = useCallback((invitationCode: string) => {
    const current = stateRef.current.threadLoads[invitationCode];
    return requestThread(invitationCode, current?.status === "error" && current.hasLoaded);
  }, [requestThread]);
  const loadMoreWhatsappThread = useCallback(
    (invitationCode: string) => requestThread(invitationCode, true),
    [requestThread]
  );
  /**
   * The "operator opened a conversation or invite detail" trigger. Everything it can do is bounded:
   *
   * - already loaded → nothing, the newest page is what opening asks for (`requestThread`);
   * - a failed *load-more* → the alert is retired and the newest page is shown again, still with
   *   no request: reopening must not restart a conversation whose first page is loaded and valid,
   *   and leaving the alert up would otherwise greet the operator on every reopen forever;
   * - a failed *first* load → a fresh request, because there is nothing to show without one.
   */
  const refreshWhatsappInvitation = useCallback((invitationCode: string) => {
    const current = stateRef.current.threadLoads[invitationCode];
    if (current?.status === "error" && current.hasLoaded) {
      rawDispatch({ type: "thread-error-cleared", invitationCode });
      return Promise.resolve();
    }
    return requestThread(invitationCode, false);
  }, [requestThread]);
  const retryWhatsappInvitation = useCallback(
    (invitationCode: string) => requestThread(invitationCode, false),
    [requestThread]
  );

  /** Stamps the timestamp so no call site has to thread a clock through the UI. */
  const dispatch = useCallback(
    (intent: AdminDashboardIntent) => {
      const now = nowOption ? nowOption() : new Date().toISOString();
      rawDispatch({ now, ...intent } as AdminDashboardAction);
    },
    [nowOption]
  );

  const guestRows = useMemo(() => toGuestRows(state.invitations), [state.invitations]);
  const unreadByCode = useMemo(
    () =>
      Object.fromEntries(
        state.invitations.map((invitation) => [
          invitation.invitationCode,
          unreadCount(state, invitation.invitationCode)
        ])
      ) as Record<string, number | null>,
    [state]
  );

  return {
    state,
    status,
    refresh,
    refreshState,
    lastSuccessfulLoadAt,
    snapshotVersion,
    dispatch,
    guestRows,
    unreadByCode,
    retryWhatsappThread,
    loadMoreWhatsappThread,
    refreshWhatsappInvitation,
    retryWhatsappInvitation,
    demo: source.demo
  };
}

export type AdminDashboardController = ReturnType<typeof useAdminDashboard>;
