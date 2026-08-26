import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AdminApiError } from "@/lib/admin-api";
import type { WhatsappRsvpSendMode, WhatsappRsvpSendResponse } from "@brimax/contracts";
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
  /** Injectable idempotency-key factory so mutation tests remain deterministic. */
  createIdempotencyKey?: (mode: WhatsappRsvpSendMode) => string;
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

export type AdminWhatsappSendState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

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
  const [whatsappSendStates, setWhatsappSendStates] = useState<Record<string, AdminWhatsappSendState>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  const nowRef = useRef(nowOption);
  nowRef.current = nowOption;
  const sourceGenerationRef = useRef(0);
  const requestIdRef = useRef(0);
  const dashboardInFlightRef = useRef<DashboardRequest | null>(null);
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());
  const sendInFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<WhatsappRsvpSendResponse> }>());
  const sendKeyRef = useRef(new Map<string, { mode: WhatsappRsvpSendMode; key: string }>());
  const textSendInFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());
  const [whatsappTextSendStates, setWhatsappTextSendStates] = useState<Record<string, AdminWhatsappSendState>>({});

  useEffect(() => {
    const sourceGeneration = ++sourceGenerationRef.current;
    generationRef.current += 1;
    dashboardInFlightRef.current?.controller.abort();
    for (const request of inFlightRef.current.values()) request.controller.abort();
    inFlightRef.current.clear();
    for (const request of sendInFlightRef.current.values()) request.controller.abort();
    sendInFlightRef.current.clear();
    sendKeyRef.current.clear();
    for (const request of textSendInFlightRef.current.values()) request.controller.abort();
    textSendInFlightRef.current.clear();
    setWhatsappSendStates({});
    setWhatsappTextSendStates({});
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
      for (const request of sendInFlightRef.current.values()) request.controller.abort();
      sendInFlightRef.current.clear();
      sendKeyRef.current.clear();
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

  const requestThread = useCallback((invitationCode: string, loadMore: boolean, force = false) => {
    const existing = inFlightRef.current.get(invitationCode);
    if (existing) return existing.promise;
    const current = stateRef.current.threadLoads[invitationCode] ?? { status: "unloaded" as const };
    if (!loadMore && !force && current.status === "loaded") return Promise.resolve();
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

  const sendWhatsappRsvp = useCallback((invitationCode: string, mode: WhatsappRsvpSendMode) => {
    const existing = sendInFlightRef.current.get(invitationCode);
    if (existing) return existing.promise;

    const previousKey = sendKeyRef.current.get(invitationCode);
    const key = previousKey?.mode === mode
      ? previousKey.key
      : options.createIdempotencyKey?.(mode) ?? `admin-rsvp-${mode}-${crypto.randomUUID()}`;
    sendKeyRef.current.set(invitationCode, { mode, key });
    const controller = new AbortController();
    const generation = generationRef.current;
    setWhatsappSendStates((current) => ({ ...current, [invitationCode]: { status: "loading" } }));

    const sender = source.sendWhatsappRsvp;
    const promise = (sender
      ? sender(invitationCode, mode, key, controller.signal)
      : Promise.reject(new AdminApiError("O envio de WhatsApp não está disponível.", "unavailable")))
      .then((response) => {
        if (controller.signal.aborted || generation !== generationRef.current) return response;
        if (response.status !== "queued" && response.status !== "sending" && response.status !== "sent") {
          throw new AdminApiError("A tentativa anterior não está em um estado que confirme o envio.", "rejected", 409);
        }
        rawDispatch({
          type: "whatsapp-send-accepted",
          response,
          now: nowRef.current ? nowRef.current() : new Date().toISOString()
        });
        sendKeyRef.current.delete(invitationCode);
        setWhatsappSendStates((current) => ({ ...current, [invitationCode]: { status: "idle" } }));
        void requestThread(invitationCode, false, true).catch(() => undefined);
        return response;
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== generationRef.current) throw error;
        const ambiguous = error instanceof AdminApiError &&
          (error.kind === "invalid-response" || error.kind === "unavailable" && error.status === undefined);
        if (!ambiguous) sendKeyRef.current.delete(invitationCode);
        setWhatsappSendStates((current) => ({
          ...current,
          [invitationCode]: {
            status: "error",
            message: error instanceof Error ? error.message : "Não foi possível solicitar o envio."
          }
        }));
        if (error instanceof AdminApiError && error.status && [404, 409, 422, 503].includes(error.status)) {
          void requestThread(invitationCode, false, true).catch(() => undefined);
        }
        throw error;
      })
      .finally(() => {
        if (sendInFlightRef.current.get(invitationCode)?.promise === promise) {
          sendInFlightRef.current.delete(invitationCode);
        }
      });
    sendInFlightRef.current.set(invitationCode, { controller, promise });
    return promise;
  }, [options.createIdempotencyKey, requestThread, source]);

  /**
   * Sends an operator-composed free-text message.
   *
   * The optimistic bubble is appended immediately and settled by id when the request resolves:
   * cleared on acceptance (the forced thread refresh then replaces it with the persisted message
   * under its provider id), or marked failed so the operator keeps a visible record of what did
   * not send. One send per invitation is in flight at a time.
   */
  const sendWhatsappText = useCallback((invitationCode: string, text: string) => {
    const body = text.trim();
    if (!body) return Promise.resolve();
    const existing = textSendInFlightRef.current.get(invitationCode);
    if (existing) return existing.promise;

    const messageId = `local-${crypto.randomUUID()}`;
    // A fresh key per attempt: this is a new message, never a retry of an earlier one.
    const key = options.createIdempotencyKey?.("first") ?? `admin-text-${crypto.randomUUID()}`;
    const controller = new AbortController();
    const generation = generationRef.current;
    const now = nowRef.current ? nowRef.current() : new Date().toISOString();

    rawDispatch({ type: "send-chat", invitationCode, messageId, text: body, now });
    setWhatsappTextSendStates((current) => ({ ...current, [invitationCode]: { status: "loading" } }));

    const sender = source.sendWhatsappText;
    const promise = (sender
      ? sender(invitationCode, body, key, controller.signal)
      : Promise.reject(new AdminApiError("O envio de WhatsApp não está disponível.", "unavailable")))
      .then(() => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        rawDispatch({ type: "chat-send-succeeded", invitationCode, messageId });
        setWhatsappTextSendStates((current) => ({ ...current, [invitationCode]: { status: "idle" } }));
        void requestThread(invitationCode, false, true).catch(() => undefined);
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        rawDispatch({ type: "chat-send-failed", invitationCode, messageId });
        setWhatsappTextSendStates((current) => ({
          ...current,
          [invitationCode]: {
            status: "error",
            message: error instanceof Error ? error.message : "Não foi possível enviar a mensagem."
          }
        }));
        // A closed window or a changed invitation state is only visible after a refresh.
        if (error instanceof AdminApiError && error.status && [404, 409, 422].includes(error.status)) {
          void requestThread(invitationCode, false, true).catch(() => undefined);
        }
      })
      .finally(() => {
        if (textSendInFlightRef.current.get(invitationCode)?.promise === promise) {
          textSendInFlightRef.current.delete(invitationCode);
        }
      });
    textSendInFlightRef.current.set(invitationCode, { controller, promise });
    return promise;
  }, [options.createIdempotencyKey, requestThread, source]);

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
    sendWhatsappRsvp,
    sendWhatsappText,
    whatsappSendStates,
    whatsappTextSendStates,
    demo: source.demo
  };
}

export type AdminDashboardController = ReturnType<typeof useAdminDashboard>;
