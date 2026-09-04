import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AdminInvitationRsvpWriteResponse } from "@brimax/contracts";
import { AdminApiError } from "@/lib/admin-api";
import type {
  AdminAddGuestsRequest,
  AdminCreateInvitationRequest,
  AdminGuestUpdateRequest,
  WhatsappRsvpSendMode,
  WhatsappRsvpSendResponse
} from "@brimax/contracts";
import { toGuestRows } from "@/lib/admin-dashboard-model";
import {
  fixtureDashboardSource,
  mapAdminDashboardInvitation,
  type AdminDashboardSource
} from "@/lib/admin-dashboard-source";
import type { AdminDashboardSnapshot } from "@/lib/admin-dashboard-types";
import {
  adminDashboardReducer,
  createInitialState,
  unreadCount,
  type AdminDashboardAction,
  type AdminDashboardIntent,
  type AdminDashboardState
} from "@/lib/admin-dashboard-store";

/**
 * The single in-flight key for creating an invitation. Deletes key on their invitation code; a
 * create has none yet when the form opens, and only one create form exists at a time.
 */
export const ADMIN_CREATE_INVITATION_KEY = "new-invitation";

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

/** Per-message state of a recado deletion, so the confirmation modal can show progress. */
export type AdminMessageDeleteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

/**
 * Per-subject state of an RSVP write — keyed by `guestId` for a guest edit and by
 * `invitationCode` for confirm-all, so two modals can never read each other's progress.
 */
export type AdminGuestWriteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

export type AdminInvitationCodeSuggestionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; invitationCode: string }
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
  const messageDeleteInFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());
  const [messageDeleteStates, setMessageDeleteStates] = useState<Record<string, AdminMessageDeleteState>>({});
  const guestWriteInFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());
  const [guestWriteStates, setGuestWriteStates] = useState<Record<string, AdminGuestWriteState>>({});
  const confirmGuestsInFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());
  const [confirmGuestsStates, setConfirmGuestsStates] = useState<Record<string, AdminGuestWriteState>>({});
  const addGuestsInFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());
  const [addGuestsStates, setAddGuestsStates] = useState<Record<string, AdminGuestWriteState>>({});
  const invitationWriteInFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());
  const [invitationWriteStates, setInvitationWriteStates] = useState<Record<string, AdminGuestWriteState>>({});
  const phoneWriteInFlightRef = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());
  const [phoneWriteStates, setPhoneWriteStates] = useState<Record<string, AdminGuestWriteState>>({});
  const nextCodeInFlightRef = useRef<{ controller: AbortController; promise: Promise<string> } | null>(null);
  const [nextCodeState, setNextCodeState] = useState<AdminInvitationCodeSuggestionState>({ status: "idle" });

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
    for (const request of messageDeleteInFlightRef.current.values()) request.controller.abort();
    messageDeleteInFlightRef.current.clear();
    for (const request of guestWriteInFlightRef.current.values()) request.controller.abort();
    guestWriteInFlightRef.current.clear();
    for (const request of confirmGuestsInFlightRef.current.values()) request.controller.abort();
    confirmGuestsInFlightRef.current.clear();
    for (const request of addGuestsInFlightRef.current.values()) request.controller.abort();
    addGuestsInFlightRef.current.clear();
    for (const request of invitationWriteInFlightRef.current.values()) request.controller.abort();
    invitationWriteInFlightRef.current.clear();
    for (const request of phoneWriteInFlightRef.current.values()) request.controller.abort();
    phoneWriteInFlightRef.current.clear();
    nextCodeInFlightRef.current?.controller.abort();
    nextCodeInFlightRef.current = null;
    setWhatsappSendStates({});
    setWhatsappTextSendStates({});
    setMessageDeleteStates({});
    setGuestWriteStates({});
    setConfirmGuestsStates({});
    setAddGuestsStates({});
    setInvitationWriteStates({});
    setPhoneWriteStates({});
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
      for (const request of messageDeleteInFlightRef.current.values()) request.controller.abort();
      messageDeleteInFlightRef.current.clear();
      for (const request of guestWriteInFlightRef.current.values()) request.controller.abort();
      guestWriteInFlightRef.current.clear();
      for (const request of confirmGuestsInFlightRef.current.values()) request.controller.abort();
      confirmGuestsInFlightRef.current.clear();
      for (const request of addGuestsInFlightRef.current.values()) request.controller.abort();
      addGuestsInFlightRef.current.clear();
      for (const request of invitationWriteInFlightRef.current.values()) request.controller.abort();
      invitationWriteInFlightRef.current.clear();
      for (const request of phoneWriteInFlightRef.current.values()) request.controller.abort();
      phoneWriteInFlightRef.current.clear();
      nextCodeInFlightRef.current?.controller.abort();
      nextCodeInFlightRef.current = null;
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

  /**
   * Hard-deletes one recado, then drops it from the snapshot.
   *
   * The row leaves only once the API confirms — no optimistic removal, so the list never shows a
   * state the server never reached. A 404 resolves as success: the recado is already gone, and
   * reporting "não existe mais" while leaving a stale row on screen would be the worse outcome.
   * Anything else rethrows so the confirmation modal stays open with the localized reason.
   */
  const deleteGuestMessage = useCallback((messageId: string) => {
    const existing = messageDeleteInFlightRef.current.get(messageId);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const generation = generationRef.current;
    setMessageDeleteStates((current) => ({ ...current, [messageId]: { status: "loading" } }));

    const promise = source
      .deleteGuestMessage(messageId, controller.signal)
      .then(() => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        rawDispatch({ type: "remove-message", messageId });
        setMessageDeleteStates((current) => ({ ...current, [messageId]: { status: "idle" } }));
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== generationRef.current) throw error;
        if (error instanceof AdminApiError && error.status === 404) {
          rawDispatch({ type: "remove-message", messageId });
          setMessageDeleteStates((current) => ({ ...current, [messageId]: { status: "idle" } }));
          return;
        }
        setMessageDeleteStates((current) => ({
          ...current,
          [messageId]: {
            status: "error",
            message: error instanceof Error ? error.message : "Não foi possível excluir o recado."
          }
        }));
        throw error;
      })
      .finally(() => {
        if (messageDeleteInFlightRef.current.get(messageId)?.promise === promise) {
          messageDeleteInFlightRef.current.delete(messageId);
        }
      });
    messageDeleteInFlightRef.current.set(messageId, { controller, promise });
    return promise;
  }, [source]);

  /**
   * Runs one RSVP write and installs the invitation the API returns.
   *
   * There is no optimistic update: the reducer only ever sees the server's recomputed guests and
   * aggregate, so the panel cannot show counts a refetch would contradict. Failures are recorded
   * per subject and rethrown, which is what keeps the modal open on top of the error.
   */
  const runRsvpWrite = useCallback((
    key: string,
    inFlight: React.RefObject<Map<string, { controller: AbortController; promise: Promise<void> }>>,
    setStates: React.Dispatch<React.SetStateAction<Record<string, AdminGuestWriteState>>>,
    request: (signal: AbortSignal) => Promise<AdminInvitationRsvpWriteResponse>,
    fallbackMessage: string
  ) => {
    const existing = inFlight.current.get(key);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const generation = generationRef.current;
    setStates((current) => ({ ...current, [key]: { status: "loading" } }));

    const promise = request(controller.signal)
      .then((response) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        rawDispatch({ type: "apply-invitation-rsvp", response });
        setStates((current) => ({ ...current, [key]: { status: "idle" } }));
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== generationRef.current) throw error;
        setStates((current) => ({
          ...current,
          [key]: {
            status: "error",
            message: error instanceof Error ? error.message : fallbackMessage
          }
        }));
        throw error;
      })
      .finally(() => {
        if (inFlight.current.get(key)?.promise === promise) inFlight.current.delete(key);
      });
    inFlight.current.set(key, { controller, promise });
    return promise;
  }, []);

  const updateGuest = useCallback(
    (invitationCode: string, guestId: string, patch: AdminGuestUpdateRequest) =>
      runRsvpWrite(
        guestId,
        guestWriteInFlightRef,
        setGuestWriteStates,
        (signal) => source.updateGuest(invitationCode, guestId, patch, signal),
        "Não foi possível salvar a alteração."
      ),
    [runRsvpWrite, source]
  );

  const confirmGuests = useCallback(
    (invitationCode: string, guestIds: string[]) =>
      runRsvpWrite(
        invitationCode,
        confirmGuestsInFlightRef,
        setConfirmGuestsStates,
        (signal) => source.confirmGuests(invitationCode, guestIds, signal),
        "Não foi possível confirmar a presença."
      ),
    [runRsvpWrite, source]
  );

  /** Adds guests to an invitation; the server assigns their slots and ids. */
  const addGuests = useCallback(
    (invitationCode: string, guests: AdminAddGuestsRequest["guests"]) =>
      runRsvpWrite(
        invitationCode,
        addGuestsInFlightRef,
        setAddGuestsStates,
        (signal) => source.addGuests(invitationCode, guests, signal),
        "Não foi possível adicionar o convidado."
      ),
    [runRsvpWrite, source]
  );

  /**
   * Removes one guest from an invitation.
   *
   * Keyed by `guestId` in the same map `updateGuest` uses, so one guest can never have an edit and
   * a removal in flight at the same time — the two would reconcile from contradicting guest lists.
   */
  const removeGuest = useCallback(
    (invitationCode: string, guestId: string) =>
      runRsvpWrite(
        guestId,
        guestWriteInFlightRef,
        setGuestWriteStates,
        (signal) => source.removeGuest(invitationCode, guestId, signal),
        "Não foi possível remover o convidado."
      ),
    [runRsvpWrite, source]
  );

  /**
   * Runs one structural invitation write and applies the reducer action it implies.
   *
   * Separate from `runRsvpWrite` because neither create nor delete answers with the RSVP
   * reconciliation payload: one inserts a whole row, the other removes one.
   */
  const runInvitationWrite = useCallback(<T,>(
    key: string,
    request: (signal: AbortSignal) => Promise<T>,
    apply: (response: T) => void,
    fallbackMessage: string,
    inFlight = invitationWriteInFlightRef,
    setStates = setInvitationWriteStates
  ) => {
    const existing = inFlight.current.get(key);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const generation = generationRef.current;
    setStates((current) => ({ ...current, [key]: { status: "loading" } }));

    const promise = request(controller.signal)
      .then((response) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        apply(response);
        setStates((current) => ({ ...current, [key]: { status: "idle" } }));
      })
      .catch((error) => {
        if (controller.signal.aborted || generation !== generationRef.current) throw error;
        setStates((current) => ({
          ...current,
          [key]: {
            status: "error",
            message: error instanceof Error ? error.message : fallbackMessage
          }
        }));
        throw error;
      })
      .finally(() => {
        if (inFlight.current.get(key)?.promise === promise) {
          inFlight.current.delete(key);
        }
      });
    inFlight.current.set(key, { controller, promise });
    return promise;
  }, []);

  /**
   * Creates one invitation and inserts the row the API returned.
   *
   * Keyed by a constant rather than by the code: only one new-invitation form is ever open, so this
   * is the strictest possible dedupe, and it gives the form a state key it can read before it knows
   * which code the operator will type.
   */
  const createInvitation = useCallback(
    (draft: AdminCreateInvitationRequest) =>
      runInvitationWrite(
        ADMIN_CREATE_INVITATION_KEY,
        (signal) => source.createInvitation(draft, signal),
        (response) =>
          rawDispatch({
            type: "create-invitation",
            invitation: mapAdminDashboardInvitation(response.invitation)
          }),
        "Não foi possível criar o convite."
      ),
    [runInvitationWrite, source]
  );

  const getNextInvitationCode = useCallback(() => {
    if (!source.getNextInvitationCode) {
      const error = new AdminApiError("A sugestão de código não está disponível.", "unavailable");
      setNextCodeState({ status: "error", message: error.message });
      return Promise.reject(error);
    }
    if (nextCodeInFlightRef.current) return nextCodeInFlightRef.current.promise;

    const controller = new AbortController();
    setNextCodeState({ status: "loading" });
    const promise = source.getNextInvitationCode(controller.signal)
      .then((invitationCode) => {
        if (!controller.signal.aborted) setNextCodeState({ status: "ready", invitationCode });
        return invitationCode;
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setNextCodeState({
            status: "error",
            message: error instanceof Error ? error.message : "Não foi possível sugerir um código."
          });
        }
        throw error;
      })
      .finally(() => {
        if (nextCodeInFlightRef.current?.promise === promise) nextCodeInFlightRef.current = null;
      });
    nextCodeInFlightRef.current = { controller, promise };
    return promise;
  }, [source]);

  /** Hard-deletes one invitation and drops its row, thread and thread state. */
  const deleteInvitation = useCallback(
    (invitationCode: string) =>
      runInvitationWrite(
        invitationCode,
        (signal) => source.deleteInvitation(invitationCode, signal),
        () => rawDispatch({ type: "delete-invitation", invitationCode }),
        "Não foi possível excluir o convite."
      ),
    [runInvitationWrite, source]
  );

  /** Updates an invitation phone and applies only the normalized server response. */
  const updateInvitationPhone = useCallback(
    (invitationCode: string, phoneNumber: string) =>
      runInvitationWrite(
        invitationCode,
        (signal) => source.updateInvitationPhone
          ? source.updateInvitationPhone(invitationCode, phoneNumber, signal)
          : Promise.reject(new AdminApiError("A alteração de telefone não está disponível.", "unavailable")),
        (response) =>
          rawDispatch({
            type: "update-phone",
            invitationCode: response.invitationCode,
            phoneNumber: response.phoneNumber,
            now: response.updatedAt
          }),
        "Não foi possível salvar o telefone do convite.",
        phoneWriteInFlightRef,
        setPhoneWriteStates
      ),
    [runInvitationWrite, source]
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
    sendWhatsappRsvp,
    sendWhatsappText,
    deleteGuestMessage,
    updateGuest,
    confirmGuests,
    addGuests,
    removeGuest,
    createInvitation,
    getNextInvitationCode,
    deleteInvitation,
    updateInvitationPhone,
    guestWriteStates,
    confirmGuestsStates,
    addGuestsStates,
    invitationWriteStates,
    phoneWriteStates,
    nextCodeState,
    whatsappSendStates,
    whatsappTextSendStates,
    messageDeleteStates,
    demo: source.demo
  };
}

export type AdminDashboardController = ReturnType<typeof useAdminDashboard>;
