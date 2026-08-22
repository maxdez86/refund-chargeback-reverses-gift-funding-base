import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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

/**
 * Loads one dashboard snapshot and exposes it alongside the mutations the panel performs.
 * The data itself comes from `AdminDashboardSource` — fixtures today, admin endpoints later.
 */
export function useAdminDashboard(options: UseAdminDashboardOptions = {}) {
  const source = options.source ?? fixtureDashboardSource;
  const nowOption = options.now;
  const [state, rawDispatch] = useReducer(adminDashboardReducer, EMPTY_STATE);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());

  useEffect(() => {
    const generation = ++generationRef.current;
    for (const request of inFlightRef.current.values()) request.controller.abort();
    inFlightRef.current.clear();
    let cancelled = false;
    const controller = new AbortController();
    rawDispatch({ type: "replace-snapshot", snapshot: EMPTY_SNAPSHOT });
    setStatus("loading");
    source
      .load(controller.signal)
      .then((snapshot) => {
        if (cancelled || generation !== generationRef.current) return;
        rawDispatch({ type: "replace-snapshot", snapshot });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      controller.abort();
      for (const request of inFlightRef.current.values()) request.controller.abort();
      inFlightRef.current.clear();
    };
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
      .loadWhatsappThread(invitationCode, cursor ?? undefined, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        if (page.invitationCode !== invitationCode) throw new Error("Conversation invitation mismatch.");
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

  const loadWhatsappThread = useCallback((invitationCode: string) => {
    const current = stateRef.current.threadLoads[invitationCode];
    if (current?.status === "error" && current.hasLoaded) return Promise.resolve();
    return requestThread(invitationCode, false);
  }, [requestThread]);
  const retryWhatsappThread = useCallback((invitationCode: string) => {
    const current = stateRef.current.threadLoads[invitationCode];
    return requestThread(invitationCode, current?.status === "error" && current.hasLoaded);
  }, [requestThread]);
  const loadMoreWhatsappThread = useCallback(
    (invitationCode: string) => requestThread(invitationCode, true),
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
    dispatch,
    guestRows,
    unreadByCode,
    loadWhatsappThread,
    retryWhatsappThread,
    loadMoreWhatsappThread,
    demo: source.demo
  };
}

export type AdminDashboardController = ReturnType<typeof useAdminDashboard>;
