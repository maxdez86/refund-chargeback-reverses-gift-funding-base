import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { toGuestRows } from "@/lib/admin-dashboard-model";
import { fixtureDashboardSource, type AdminDashboardSource } from "@/lib/admin-dashboard-source";
import {
  adminDashboardReducer,
  createInitialState,
  unreadCount,
  type AdminDashboardAction,
  type AdminDashboardIntent,
  type AdminDashboardState
} from "@/lib/admin-dashboard-store";

const EMPTY_STATE: AdminDashboardState = createInitialState({
  invitations: [],
  guestMessages: [],
  gifts: [],
  threads: {}
});

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

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    source
      .load()
      .then((snapshot) => {
        if (cancelled) return;
        rawDispatch({ type: "replace-snapshot", snapshot });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

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
      ) as Record<string, number>,
    [state]
  );

  return { state, status, dispatch, guestRows, unreadByCode, demo: source.demo };
}

export type AdminDashboardController = ReturnType<typeof useAdminDashboard>;
