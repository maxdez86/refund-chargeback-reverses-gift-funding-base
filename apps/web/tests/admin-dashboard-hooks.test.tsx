import { useState } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResponse } from "@brimax/contracts";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { useAdminDashboard } from "@/hooks/use-admin-dashboard";
import { useDashboardFonts } from "@/hooks/use-dashboard-fonts";
import { useDashboardRoute } from "@/hooks/use-dashboard-route";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import { fixtureDashboardSource, type AdminDashboardSource } from "@/lib/admin-dashboard-source";
import { AdminApiError } from "@/lib/admin-api";
import type { AdminDashboardSnapshot, AdminWhatsappFlowSnapshot } from "@/lib/admin-dashboard-types";

type InvitationPage = Awaited<ReturnType<AdminDashboardSource["loadWhatsappInvitation"]>>;

const defaultFlow = (_invitationCode: string): AdminWhatsappFlowSnapshot => ({
  whatsappFreeTextWindow: { open: false },
  phoneNumber: "5511999999999",
  phoneNumberSource: "guest",
  phoneNumberUpdatedAt: null,
  whatsappFlowStatus: "message_sent",
  whatsappFlowStage: "pending",
  whatsappFlowUpdatedAt: null,
  whatsappFlowCompletedAt: null,
  whatsappFallbackSentAt: null,
  whatsappLastInboundMessageId: null,
  whatsappLastOutboundMessageId: null,
  whatsappFailureReason: null,
  whatsappSendAvailability: { firstAllowed: false, resendAllowed: false },
  reconciliationStatus: "none"
});

/** The live-mode shape: summaries for every conversation, no history and no commands. */
const unloadedSnapshot = () => {
  const snapshot = createFixtureDashboardSnapshot();
  snapshot.threads = {};
  snapshot.invitations = snapshot.invitations.map((invitation) => ({ ...invitation, commands: [] }));
  return snapshot;
};

const threadPage = (
  invitationCode: string,
  messages: InvitationPage["page"]["messages"],
  nextCursor: string | null = null,
  flowOverrides?: Partial<AdminWhatsappFlowSnapshot>
): InvitationPage => ({
  flow: { ...defaultFlow(invitationCode), ...flowOverrides },
  page: { invitationCode, messages, commands: [], nextCursor }
});

const inboundMessage = (messageId: string, sentAt: string): InvitationPage["page"]["messages"][number] => ({
  messageId,
  direction: "inbound",
  sentAt,
  text: messageId
});

/**
 * A source that counts every conversation read. Request counts are asserted on this spy, so the
 * tests below prove "one request" rather than "some messages rendered".
 */
const spySource = (
  snapshot: AdminDashboardSnapshot,
  invitationFn: (
    invitationCode: string,
    cursor?: string,
    signal?: AbortSignal
  ) => Promise<InvitationPage> = (invitationCode) => Promise.resolve(threadPage(invitationCode, []))
) => {
  const load = vi.fn(async () => snapshot);
  const loadWhatsappInvitation = vi.fn(invitationFn);
  const source: AdminDashboardSource = { demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load, loadWhatsappInvitation };
  return { source, load, loadWhatsappInvitation };
};

describe("useDashboardRoute", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/dashboard");
  });

  it("reads the current hash and writes navigation back into the URL", () => {
    window.history.replaceState({}, "", "/dashboard#convites/SW2748");
    const { result } = renderHook(() => useDashboardRoute());
    expect(result.current.route).toEqual({ section: "convites", invitationCode: "SW2748" });

    act(() => result.current.navigate({ section: "recados" }));

    expect(result.current.route).toEqual({ section: "recados" });
    expect(window.location.hash).toBe("#recados");
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("follows browser-driven hash changes", async () => {
    const { result } = renderHook(() => useDashboardRoute());
    expect(result.current.route).toEqual({ section: "visao-geral" });

    act(() => {
      window.history.replaceState({}, "", "/dashboard#presentes/g-sofa");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() =>
      expect(result.current.route).toEqual({ section: "presentes", giftId: "g-sofa" })
    );
  });
});

describe("useAdminDashboard", () => {
  it("loads a snapshot with summary unread counts, then derives one thread on demand", async () => {
    const { result } = renderHook(() => useAdminDashboard());
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.demo).toBe(true);
    expect(result.current.state.invitations).toHaveLength(8);
    expect(result.current.guestRows).toHaveLength(15);
    // Known before any history request, straight off the dashboard summary.
    expect(result.current.state.threadLoads.QP8814).toEqual({ status: "unloaded" });
    expect(result.current.unreadByCode.QP8814).toBe(2);
    expect(result.current.unreadByCode.SW2748).toBe(0);
    // LB6640 owns no message, so it has no summary and stays unknown.
    expect(result.current.unreadByCode.LB6640).toBeNull();

    await act(() => result.current.refreshWhatsappInvitation("QP8814"));
    expect(result.current.unreadByCode.QP8814).toBe(2);
    expect(result.current.state.threadLoads.QP8814).toMatchObject({ status: "loaded" });
  });

  it("stamps mutations with the injected clock", async () => {
    const now = () => "2026-08-20T12:00:00Z";
    const { result } = renderHook(() => useAdminDashboard({ now }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() =>
      result.current.dispatch({
        type: "update-phone",
        invitationCode: "SW2748",
        phoneNumber: "5521988776655"
      })
    );

    const invitation = result.current.state.invitations.find(
      (candidate) => candidate.invitationCode === "SW2748"
    );
    expect(invitation).toMatchObject({
      phoneNumber: "5521988776655",
      phoneNumberUpdatedAt: "2026-08-20T12:00:00Z"
    });
  });

  it("reports an error when the source cannot load", async () => {
    const failing: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: () => Promise.reject(new Error("offline")),
      loadWhatsappInvitation: vi.fn()
    };
    const { result } = renderHook(() => useAdminDashboard({ source: failing }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.state.invitations).toEqual([]);
  });

  it("accepts an alternative source, which is the seam for the real endpoints", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    const single: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => ({ ...snapshot, invitations: snapshot.invitations.slice(0, 1) }),
      loadWhatsappInvitation: vi.fn()
    };
    const { result } = renderHook(() => useAdminDashboard({ source: single }));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.demo).toBe(false);
    expect(result.current.state.invitations).toHaveLength(1);
  });

  it("coalesces refreshes, replaces the snapshot, and timestamps only successful loads", async () => {
    const initial = createFixtureDashboardSnapshot();
    initial.threads = {};
    initial.invitations = initial.invitations.slice(0, 1);
    const refreshed = createFixtureDashboardSnapshot();
    refreshed.threads = {};
    refreshed.invitations = refreshed.invitations.slice(0, 2);
    let resolveRefresh!: (snapshot: typeof refreshed) => void;
    const pendingRefresh = new Promise<typeof refreshed>((resolve) => {
      resolveRefresh = resolve;
    });
    const load = vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(pendingRefresh);
    const loadWhatsappInvitation = vi.fn();
    const source: AdminDashboardSource = { demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load, loadWhatsappInvitation };
    const timestamps = ["2026-08-20T10:00:00Z", "2026-08-20T11:00:00Z"];
    const { result } = renderHook(() =>
      useAdminDashboard({ source, now: () => timestamps.shift()! })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.lastSuccessfulLoadAt).toBe("2026-08-20T10:00:00Z");

    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = result.current.refresh();
      duplicate = result.current.refresh();
    });
    expect(first).toBe(duplicate);
    expect(result.current.refreshState.status).toBe("loading");
    expect(load).toHaveBeenCalledTimes(2);
    expect(loadWhatsappInvitation).not.toHaveBeenCalled();
    expect(result.current.lastSuccessfulLoadAt).toBe("2026-08-20T10:00:00Z");

    resolveRefresh(refreshed);
    await act(() => first);

    expect(result.current.state.invitations).toHaveLength(2);
    expect(result.current.refreshState.status).toBe("idle");
    expect(result.current.lastSuccessfulLoadAt).toBe("2026-08-20T11:00:00Z");
  });

  it("retains the current snapshot, local state, histories, cursor, and timestamp on refresh failure", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((invitation) => ({ ...invitation, commands: [] }));
    const load = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error("offline"));
    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load,
      loadWhatsappInvitation: vi.fn().mockResolvedValue({
        flow: defaultFlow("SW2748"),
        page: {
          invitationCode: "SW2748",
          messages: [{ messageId: "loaded", direction: "inbound", sentAt: "2026-08-20T09:00:00Z", text: "Oi" }],
          commands: [],
          nextCursor: "older"
        }
      })
    };
    const { result } = renderHook(() =>
      useAdminDashboard({ source, now: () => "2026-08-20T10:00:00Z" })
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => result.current.refreshWhatsappInvitation("SW2748"));
    act(() => {
      result.current.dispatch({
        type: "update-phone",
        invitationCode: "SW2748",
        phoneNumber: "5511999999999"
      });
    });

    await act(() => result.current.refresh().catch(() => undefined));

    expect(result.current.status).toBe("ready");
    expect(result.current.refreshState).toMatchObject({ status: "error" });
    expect(result.current.lastSuccessfulLoadAt).toBe("2026-08-20T10:00:00Z");
    expect(result.current.state.threads.SW2748[0].messageId).toBe("loaded");
    expect(result.current.state.threadLoads.SW2748).toEqual({ status: "loaded", nextCursor: "older" });
    expect(
      result.current.state.invitations.find((invitation) => invitation.invitationCode === "SW2748")
        ?.phoneNumber
    ).toBe("5511999999999");
  });

  it("resets local and lazy state and aborts an in-flight history after refresh succeeds", async () => {
    const initial = createFixtureDashboardSnapshot();
    initial.threads = {};
    initial.invitations = initial.invitations.map((invitation) => ({ ...invitation, commands: [] }));
    const refreshed = structuredClone(initial);
    let pendingHistorySignal: AbortSignal | undefined;
    const load = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
    const loadWhatsappInvitation = vi.fn((invitationCode: string, _cursor?: string, signal?: AbortSignal) => {
      if (invitationCode === "SW2748") {
        return Promise.resolve({
          flow: defaultFlow(invitationCode),
          page: {
            invitationCode,
            messages: [{ messageId: "loaded", direction: "inbound" as const, sentAt: "2026-08-20T09:00:00Z", text: "Oi" }],
            commands: [{
              commandId: "command", createdAt: "2026-08-20T09:00:00Z", templateId: "wedding_invitation",
              stage: "pending" as const, status: "sent" as const, retryCount: 0, reconciliationStatus: "none" as const
            }],
            nextCursor: "older"
          }
        });
      }
      pendingHistorySignal = signal;
      return new Promise<never>(() => undefined);
    });
    const source: AdminDashboardSource = { demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load, loadWhatsappInvitation };
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => result.current.refreshWhatsappInvitation("SW2748"));
    act(() => {
      result.current.dispatch({ type: "remove-message", messageId: initial.guestMessages[0].messageId });
      void result.current.refreshWhatsappInvitation("TX6935");
    });

    await act(() => result.current.refresh());

    expect(pendingHistorySignal?.aborted).toBe(true);
    expect(result.current.state.threads).toEqual({});
    expect(result.current.state.invitations.every((invitation) => invitation.commands.length === 0)).toBe(true);
    expect(Object.values(result.current.state.threadLoads).every((loadState) => loadState.status === "unloaded")).toBe(true);
    expect(result.current.state.guestMessages).toHaveLength(initial.guestMessages.length);
  });

  it("aborts and ignores a stale refresh when the source is replaced", async () => {
    const initial = createFixtureDashboardSnapshot();
    initial.invitations = initial.invitations.slice(0, 1);
    let resolveRefresh!: (snapshot: typeof initial) => void;
    let refreshSignal: AbortSignal | undefined;
    const first: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockImplementationOnce((signal?: AbortSignal) => {
          refreshSignal = signal;
          return new Promise<typeof initial>((resolve) => { resolveRefresh = resolve; });
        }),
      loadWhatsappInvitation: vi.fn()
    };
    const replacementSnapshot = createFixtureDashboardSnapshot();
    replacementSnapshot.invitations = replacementSnapshot.invitations.slice(0, 2);
    const replacement: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => replacementSnapshot,
      loadWhatsappInvitation: vi.fn()
    };
    const { result, rerender } = renderHook(({ source }) => useAdminDashboard({ source }), {
      initialProps: { source: first }
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => { void result.current.refresh().catch(() => undefined); });

    rerender({ source: replacement });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(refreshSignal?.aborted).toBe(true);
    expect(result.current.state.invitations).toHaveLength(2);

    resolveRefresh(initial);
    await act(async () => Promise.resolve());
    expect(result.current.state.invitations).toHaveLength(2);
  });

  it("ignores and aborts a stale load when the session source is replaced", async () => {
    let resolveFirst!: (snapshot: ReturnType<typeof createFixtureDashboardSnapshot>) => void;
    const firstLoad = new Promise<ReturnType<typeof createFixtureDashboardSnapshot>>(
      (resolve) => {
        resolveFirst = resolve;
      }
    );
    let firstSignal: AbortSignal | undefined;
    const first: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: (signal) => {
        firstSignal = signal;
        return firstLoad;
      },
      loadWhatsappInvitation: vi.fn()
    };
    const replacementSnapshot = createFixtureDashboardSnapshot();
    replacementSnapshot.invitations = replacementSnapshot.invitations.slice(0, 2);
    const replacement: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => replacementSnapshot,
      loadWhatsappInvitation: vi.fn()
    };
    const { result, rerender } = renderHook(
      ({ source }) => useAdminDashboard({ source }),
      { initialProps: { source: first } }
    );

    rerender({ source: replacement });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(firstSignal?.aborted).toBe(true);
    expect(result.current.state.invitations).toHaveLength(2);

    resolveFirst(createFixtureDashboardSnapshot());
    await act(async () => Promise.resolve());
    expect(result.current.state.invitations).toHaveLength(2);
  });

  it("clears a previous snapshot when its replacement source fails", async () => {
    const fixture = createFixtureDashboardSnapshot();
    const loaded: AdminDashboardSource = {
      demo: true,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => fixture,
      loadWhatsappInvitation: vi.fn()
    };
    const failing: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => Promise.reject(new Error("offline")),
      loadWhatsappInvitation: vi.fn()
    };
    const { result, rerender } = renderHook(
      ({ source }) => useAdminDashboard({ source }),
      { initialProps: { source: loaded } }
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.state.invitations).not.toHaveLength(0);

    rerender({ source: failing });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.state.invitations).toEqual([]);
    expect(result.current.state.gifts).toEqual([]);
    expect(result.current.state.guestMessages).toEqual([]);
  });

  it("coalesces concurrent loads and does not refetch an already loaded thread", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    let resolvePage!: (page: InvitationPage) => void;
    const pending = new Promise<InvitationPage>((resolve) => {
      resolvePage = resolve;
    });
    const loadWhatsappInvitation = vi.fn(() => pending);
    const source: AdminDashboardSource = { demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation };
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.refreshWhatsappInvitation("SW2748");
      second = result.current.refreshWhatsappInvitation("SW2748");
    });
    expect(first).toBe(second);
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);

    resolvePage({
      flow: defaultFlow("SW2748"),
      page: { invitationCode: "SW2748", messages: [], commands: [], nextCursor: null }
    });
    await act(() => first);
    await act(() => result.current.refreshWhatsappInvitation("SW2748"));
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
  });

  it("keeps simultaneous invitation results isolated", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    const resolvers = new Map<string, (page: InvitationPage) => void>();
    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: vi.fn((invitationCode) =>
        new Promise<InvitationPage>((resolve) =>
          resolvers.set(invitationCode, resolve)
        )
      )
    };
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.refreshWhatsappInvitation("SW2748");
      second = result.current.refreshWhatsappInvitation("TX6935");
    });
    // Both are genuinely in flight: opening the second conversation neither cancels nor
    // coalesces onto the first, and each carries its own load state.
    expect(source.loadWhatsappInvitation).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
    expect(result.current.state.threadLoads.SW2748).toMatchObject({ status: "loading", hasLoaded: false });
    expect(result.current.state.threadLoads.TX6935).toMatchObject({ status: "loading", hasLoaded: false });
    resolvers.get("TX6935")!({
      flow: defaultFlow("TX6935"),
      page: {
        invitationCode: "TX6935",
        messages: [{ messageId: "tx", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "TX" }],
        commands: [], nextCursor: null
      }
    });
    resolvers.get("SW2748")!({
      flow: defaultFlow("SW2748"),
      page: {
        invitationCode: "SW2748",
        messages: [{ messageId: "sw", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "SW" }],
        commands: [], nextCursor: null
      }
    });
    await act(() => Promise.all([first, second]));

    expect(result.current.state.threads.SW2748[0].messageId).toBe("sw");
    expect(result.current.state.threads.TX6935[0].messageId).toBe("tx");
  });

  it("ignores an in-flight thread after source replacement and retries a failed first load", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    let resolveStale!: (page: InvitationPage) => void;
    const staleSource: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: vi.fn(() =>
        new Promise<InvitationPage>((resolve) => {
          resolveStale = resolve;
        })
      )
    };
    const replacementLoad = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        flow: defaultFlow("SW2748"),
        page: { invitationCode: "SW2748", messages: [], commands: [], nextCursor: null }
      });
    const replacement: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: replacementLoad
    };
    const { result, rerender } = renderHook(({ source }) => useAdminDashboard({ source }), {
      initialProps: { source: staleSource }
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => { void result.current.refreshWhatsappInvitation("SW2748"); });

    rerender({ source: replacement });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    resolveStale({
      flow: defaultFlow("SW2748"),
      page: {
        invitationCode: "SW2748",
        messages: [{ messageId: "stale", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "stale" }],
        commands: [], nextCursor: null
      }
    });
    await act(async () => Promise.resolve());
    expect(result.current.state.threads.SW2748).toBeUndefined();

    await act(() => result.current.refreshWhatsappInvitation("SW2748").catch(() => undefined));
    expect(result.current.state.threadLoads.SW2748).toMatchObject({ status: "error", hasLoaded: false });
    await act(() => result.current.retryWhatsappThread("SW2748"));
    expect(result.current.state.threadLoads.SW2748).toEqual({ status: "loaded", nextCursor: null });
    expect(replacementLoad).toHaveBeenCalledTimes(2);
  });

  it("retains a loaded page and retries load-more with the same cursor", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    const loadWhatsappInvitation = vi.fn()
      .mockResolvedValueOnce({
        flow: defaultFlow("SW2748"),
        page: {
          invitationCode: "SW2748",
          messages: [{ messageId: "new", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "Nova" }],
          commands: [], nextCursor: "older"
        }
      })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        flow: defaultFlow("SW2748"),
        page: {
          invitationCode: "SW2748",
          messages: [{ messageId: "old", direction: "outbound", sentAt: "2026-08-19T12:00:00Z", text: "Antiga" }],
          commands: [], nextCursor: null
        }
      });
    const source: AdminDashboardSource = { demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation };
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => result.current.refreshWhatsappInvitation("SW2748"));
    await act(() => result.current.loadMoreWhatsappThread("SW2748").catch(() => undefined));

    expect(result.current.state.threads.SW2748.map((message) => message.messageId)).toEqual(["new"]);
    expect(result.current.state.threadLoads.SW2748).toEqual({
      status: "error", hasLoaded: true, nextCursor: "older"
    });

    await act(() => result.current.retryWhatsappThread("SW2748"));
    expect(result.current.state.threads.SW2748.map((message) => message.messageId)).toEqual(["old", "new"]);
    expect(loadWhatsappInvitation).toHaveBeenNthCalledWith(2, "SW2748", "older", expect.any(AbortSignal));
    expect(loadWhatsappInvitation).toHaveBeenNthCalledWith(3, "SW2748", "older", expect.any(AbortSignal));
  });

  it("rejects a page answering for another invitation instead of merging it anywhere", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot(), () =>
      Promise.resolve(threadPage("QP8814", [inboundMessage("crossed", "2026-08-20T12:00:00Z")]))
    );
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(() => result.current.refreshWhatsappInvitation("SW2748").catch(() => undefined));

    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
    expect(result.current.state.threads.SW2748).toBeUndefined();
    expect(result.current.state.threads.QP8814).toBeUndefined();
    expect(result.current.state.threadLoads.SW2748).toMatchObject({ status: "error", hasLoaded: false });
    expect(result.current.state.threadLoads.QP8814).toEqual({ status: "unloaded" });
  });

  it("coalesces two load-more presses into one request carrying the stored cursor", async () => {
    let resolveOlder!: (page: InvitationPage) => void;
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot(), (invitationCode, cursor) =>
      cursor
        ? new Promise<InvitationPage>((resolve) => { resolveOlder = resolve; })
        : Promise.resolve(
            threadPage(invitationCode, [inboundMessage("new", "2026-08-20T12:00:00Z")], "older")
          )
    );
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => result.current.refreshWhatsappInvitation("SW2748"));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.loadMoreWhatsappThread("SW2748");
      second = result.current.loadMoreWhatsappThread("SW2748");
    });

    expect(first).toBe(second);
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2);
    expect(loadWhatsappInvitation).toHaveBeenNthCalledWith(2, "SW2748", "older", expect.any(AbortSignal));

    resolveOlder(threadPage("SW2748", [inboundMessage("old", "2026-08-19T12:00:00Z")]));
    await act(() => first);
    expect(result.current.state.threads.SW2748.map((message) => message.messageId)).toEqual(["old", "new"]);
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2);
  });

  it("reopens a conversation whose first load failed with a fresh request", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot());
    loadWhatsappInvitation
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(threadPage("SW2748", [inboundMessage("new", "2026-08-20T12:00:00Z")]));
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(() => result.current.refreshWhatsappInvitation("SW2748").catch(() => undefined));
    expect(result.current.state.threadLoads.SW2748).toMatchObject({ status: "error", hasLoaded: false });

    await act(() => result.current.refreshWhatsappInvitation("SW2748"));

    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2);
    expect(result.current.state.threadLoads.SW2748).toEqual({ status: "loaded", nextCursor: null });
  });

  it("reopens a conversation whose load-more failed by retiring the alert, with no request", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot());
    loadWhatsappInvitation
      .mockResolvedValueOnce(
        threadPage("SW2748", [inboundMessage("new", "2026-08-20T12:00:00Z")], "older")
      )
      .mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => result.current.refreshWhatsappInvitation("SW2748"));
    await act(() => result.current.loadMoreWhatsappThread("SW2748").catch(() => undefined));
    expect(result.current.state.threadLoads.SW2748).toEqual({
      status: "error", hasLoaded: true, nextCursor: "older"
    });

    await act(() => result.current.refreshWhatsappInvitation("SW2748"));

    // The newest page is loaded and valid; only the failed older page is forgotten, and its
    // cursor stays so the operator can ask for it again from the restored control.
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2);
    expect(result.current.state.threadLoads.SW2748).toEqual({ status: "loaded", nextCursor: "older" });
    expect(result.current.state.threads.SW2748.map((message) => message.messageId)).toEqual(["new"]);
  });

  it("aborts an in-flight conversation on unmount and installs no late response", async () => {
    let resolveLate!: (page: InvitationPage) => void;
    let signal: AbortSignal | undefined;
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot(), (_code, _cursor, requestSignal) => {
      signal = requestSignal;
      return new Promise<InvitationPage>((resolve) => { resolveLate = resolve; });
    });
    const { result, unmount } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => { void result.current.refreshWhatsappInvitation("SW2748"); });

    unmount();
    expect(signal?.aborted).toBe(true);

    resolveLate(threadPage("SW2748", [inboundMessage("late", "2026-08-20T12:00:00Z")]));
    await act(async () => Promise.resolve());
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
    expect(result.current.state.threads.SW2748).toBeUndefined();
  });

  it("deduplicates an in-flight send, records backend facts, and force-refreshes the invitation", async () => {
    let resolveSend!: (value: {
      commandId: string; invitationCode: "SW2748"; templateId: "wedding_rsvp_pending_reminder_group";
      templateVersion: number; status: "queued"; replayed: false;
    }) => void;
    const sendWhatsappRsvp = vi.fn(() => new Promise<Parameters<typeof resolveSend>[0]>((resolve) => {
      resolveSend = resolve;
    }));
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot());
    source.sendWhatsappRsvp = sendWhatsappRsvp;
    const { result } = renderHook(() => useAdminDashboard({
      source,
      now: () => "2026-08-20T16:00:00.000Z",
      createIdempotencyKey: () => "admin-rsvp-first-fixedkey"
    }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.sendWhatsappRsvp("SW2748", "first");
      second = result.current.sendWhatsappRsvp("SW2748", "first");
    });
    expect(first).toBe(second);
    expect(sendWhatsappRsvp).toHaveBeenCalledTimes(1);
    expect(result.current.whatsappSendStates.SW2748).toEqual({ status: "loading" });

    resolveSend({
      commandId: "command-from-api",
      invitationCode: "SW2748",
      templateId: "wedding_rsvp_pending_reminder_group",
      templateVersion: 2,
      status: "queued",
      replayed: false
    });
    await act(() => first);

    expect(result.current.whatsappSendStates.SW2748).toEqual({ status: "idle" });
    expect(result.current.state.invitations.find((item) => item.invitationCode === "SW2748")?.commands[0])
      .toMatchObject({ commandId: "command-from-api", status: "queued" });
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
  });

  it("keeps state unchanged on rejection and rotates only definitive idempotency keys", async () => {
    const sendWhatsappRsvp = vi.fn()
      .mockRejectedValueOnce(new AdminApiError("offline", "unavailable"))
      .mockRejectedValueOnce(new AdminApiError("offline", "unavailable"))
      .mockRejectedValueOnce(new AdminApiError("stale", "rejected", 409, "INVALID_FLOW_TRANSITION"))
      .mockRejectedValueOnce(new AdminApiError("stale", "rejected", 409, "INVALID_FLOW_TRANSITION"));
    const { source } = spySource(unloadedSnapshot());
    source.sendWhatsappRsvp = sendWhatsappRsvp;
    const keys = vi.fn()
      .mockReturnValueOnce("admin-rsvp-first-ambiguous")
      .mockReturnValueOnce("admin-rsvp-first-definitive")
      .mockReturnValueOnce("admin-rsvp-first-rotated");
    const { result } = renderHook(() => useAdminDashboard({ source, createIdempotencyKey: keys }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const before = result.current.state.invitations.find((item) => item.invitationCode === "SW2748")?.commands.length;

    await act(() => result.current.sendWhatsappRsvp("SW2748", "first").catch(() => undefined));
    await act(() => result.current.sendWhatsappRsvp("SW2748", "first").catch(() => undefined));
    expect(sendWhatsappRsvp.mock.calls[0][2]).toBe("admin-rsvp-first-ambiguous");
    expect(sendWhatsappRsvp.mock.calls[1][2]).toBe("admin-rsvp-first-ambiguous");

    await act(() => result.current.sendWhatsappRsvp("SW2748", "first").catch(() => undefined));
    await act(() => result.current.sendWhatsappRsvp("SW2748", "first").catch(() => undefined));
    expect(sendWhatsappRsvp.mock.calls[2][2]).toBe("admin-rsvp-first-ambiguous");
    expect(sendWhatsappRsvp.mock.calls[3][2]).toBe("admin-rsvp-first-definitive");
    expect(result.current.state.invitations.find((item) => item.invitationCode === "SW2748")?.commands.length).toBe(before);
    expect(result.current.whatsappSendStates.SW2748).toMatchObject({ status: "error" });
  });

  it("shows a pending composer bubble, settles it, and force-refreshes the thread", async () => {
    let resolveSend!: (value: {
      commandId: string; invitationCode: string; status: "queued"; replayed: false;
    }) => void;
    const sendWhatsappText = vi.fn((
      _invitationCode: string,
      _body: string,
      _idempotencyKey: string
    ) => new Promise<Parameters<typeof resolveSend>[0]>((resolve) => {
      resolveSend = resolve;
    }));
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot());
    source.sendWhatsappText = sendWhatsappText;
    const { result } = renderHook(() => useAdminDashboard({
      source,
      now: () => "2026-08-20T16:00:00.000Z"
    }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.sendWhatsappText("SW2748", "  Oi Helena!  ");
      second = result.current.sendWhatsappText("SW2748", "Segunda tentativa");
    });
    // One send per invitation at a time; the second call joins the first rather than racing it.
    expect(first).toBe(second);
    expect(sendWhatsappText).toHaveBeenCalledTimes(1);
    expect(sendWhatsappText.mock.calls[0][1]).toBe("Oi Helena!");
    expect(result.current.whatsappTextSendStates.SW2748).toEqual({ status: "loading" });
    expect(result.current.state.threads.SW2748?.at(-1)).toMatchObject({
      direction: "outbound", text: "Oi Helena!", pending: true
    });

    resolveSend({
      commandId: "idempotency-admin-text-1", invitationCode: "SW2748", status: "queued", replayed: false
    });
    await act(() => first);

    expect(result.current.whatsappTextSendStates.SW2748).toEqual({ status: "idle" });
    expect(result.current.state.threads.SW2748?.at(-1)).toMatchObject({ pending: false });
    expect(result.current.state.threads.SW2748?.at(-1)).not.toMatchObject({ failed: true });
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
  });

  it("marks the bubble failed on rejection and never sends an empty draft", async () => {
    const sendWhatsappText = vi.fn().mockRejectedValue(
      new AdminApiError("A janela de 24 horas do WhatsApp expirou.", "rejected", 409, "FREE_TEXT_WINDOW_CLOSED")
    );
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot());
    source.sendWhatsappText = sendWhatsappText;
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(() => result.current.sendWhatsappText("SW2748", "   "));
    expect(sendWhatsappText).not.toHaveBeenCalled();

    await act(() => result.current.sendWhatsappText("SW2748", "Oi!"));

    expect(result.current.whatsappTextSendStates.SW2748).toMatchObject({ status: "error" });
    expect(result.current.state.threads.SW2748?.at(-1)).toMatchObject({
      text: "Oi!", pending: false, failed: true
    });
    // A 409 means the invitation state the composer was working from is stale.
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
  });

  it("rejects a free-text send when the source cannot perform one", async () => {
    const { source } = spySource(unloadedSnapshot());
    delete source.sendWhatsappText;
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(() => result.current.sendWhatsappText("SW2748", "Oi!"));
    expect(result.current.whatsappTextSendStates.SW2748).toMatchObject({ status: "error" });
    expect(result.current.state.threads.SW2748?.at(-1)).toMatchObject({ failed: true });
  });
});

describe("WhatsApp tab history requests", () => {
  const session: AdminSessionResponse = {
    authenticated: true,
    stage: "dev",
    admin: {
      subject: "subject",
      email: "casamento@brimax.life",
      hostedDomain: "brimax.life",
      name: "Casamento Brimax"
    }
  };

  const shell = (source: AdminDashboardSource) => (
    <DashboardShell session={session} preview={false} onSignOut={vi.fn()} source={source} />
  );
  const renderShell = async (source: AdminDashboardSource) => {
    const utils = render(shell(source));
    await screen.findByRole("heading", { name: "Visão geral" });
    return utils;
  };
  const goTo = (label: RegExp | string) => {
    const nav = screen.getAllByRole("navigation", { name: "Navegação administrativa" })[0];
    fireEvent.click(within(nav).getByRole("link", { name: label }));
  };
  /** Clicks a conversation row and lets whatever request it triggers settle inside `act`. */
  const openConversation = async (name: RegExp | string) => {
    const row = await screen.findByRole("button", { name });
    await act(async () => {
      fireEvent.click(row);
    });
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/dashboard");
  });

  it("issues no history request while signing in and loading the dashboard, at any list size", async () => {
    const snapshot = unloadedSnapshot();
    const template = snapshot.invitations.find((invitation) => invitation.whatsappConversation)!;
    snapshot.invitations = Array.from({ length: 200 }, (_, index) => ({
      ...structuredClone(template),
      invitationCode: `BK${String(index).padStart(4, "0")}`
    }));
    const { source, load, loadWhatsappInvitation } = spySource(snapshot);

    await renderShell(source);

    expect(load).toHaveBeenCalledTimes(1);
    expect(loadWhatsappInvitation).not.toHaveBeenCalled();
  });

  it("renders the whole conversation list without issuing a single history request", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot());
    await renderShell(source);

    goTo(/WhatsApp/);
    await screen.findByRole("heading", { name: "WhatsApp" });

    // Every listed row is rendered from the dashboard summary alone.
    expect(within(screen.getByRole("list", { name: "Conversas" })).getAllByRole("button")).toHaveLength(7);
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(0);
  });

  it("issues no history request while searching, filtering, or re-rendering the list", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot());
    const { rerender } = await renderShell(source);
    goTo(/WhatsApp/);
    await screen.findByRole("list", { name: "Conversas" });

    const search = screen.getByRole("searchbox", { name: "Buscar conversa" });
    fireEvent.change(search, { target: { value: "helena" } });
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Não lidas" }));
    fireEvent.click(screen.getByRole("button", { name: "Pendentes" }));
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    rerender(shell(source));
    rerender(shell(source));

    expect(within(screen.getByRole("list", { name: "Conversas" })).getAllByRole("button")).toHaveLength(7);
    expect(loadWhatsappInvitation).not.toHaveBeenCalled();
  });

  it("issues exactly one request for the conversation the operator opens, and none for the rest", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot(), (invitationCode) =>
      Promise.resolve(threadPage(invitationCode, [inboundMessage("aberta", "2026-08-20T12:00:00Z")]))
    );
    await renderShell(source);
    goTo(/WhatsApp/);

    await openConversation(/Conversa com Eugênia Ribeiro/);

    expect(await screen.findByRole("heading", { name: "Eugênia Ribeiro" })).toBeInTheDocument();
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1));
    expect(loadWhatsappInvitation.mock.calls.map((call) => call[0])).toEqual(["SW2748"]);
    expect(loadWhatsappInvitation.mock.calls[0][1]).toBeUndefined();
  });

  it("does not request a conversation again once its first page is loaded", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot(), (invitationCode) =>
      Promise.resolve(threadPage(invitationCode, [inboundMessage(invitationCode, "2026-08-20T12:00:00Z")]))
    );
    await renderShell(source);
    goTo(/WhatsApp/);

    await openConversation(/Conversa com Eugênia Ribeiro/);
    await screen.findByRole("heading", { name: "Eugênia Ribeiro" });
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1));
    await openConversation(/Conversa com Helena Prado Ribeiro/);
    await screen.findByRole("heading", { name: "Helena Prado Ribeiro" });
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2));
    await openConversation(/Conversa com Eugênia Ribeiro/);
    await screen.findByRole("heading", { name: "Eugênia Ribeiro" });

    expect(loadWhatsappInvitation.mock.calls.map((call) => call[0])).toEqual(["SW2748", "QP8814"]);
  });

  it("issues nothing more and aborts the open request once the tree unmounts", async () => {
    let signal: AbortSignal | undefined;
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot(), (_code, _cursor, requestSignal) => {
      signal = requestSignal;
      return new Promise<InvitationPage>(() => undefined);
    });
    const { unmount } = await renderShell(source);
    goTo(/WhatsApp/);
    await openConversation(/Conversa com Eugênia Ribeiro/);
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1));

    unmount();

    expect(signal?.aborted).toBe(true);
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
  });

  it("aborts the open conversation request when the operator signs out", async () => {
    let signal: AbortSignal | undefined;
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot(), (_code, _cursor, requestSignal) => {
      signal = requestSignal;
      return new Promise<InvitationPage>(() => undefined);
    });
    const Harness = () => {
      const [signedIn, setSignedIn] = useState(true);
      return signedIn ? (
        <DashboardShell
          session={session}
          preview={false}
          onSignOut={() => setSignedIn(false)}
          source={source}
        />
      ) : (
        <p>Sessão encerrada</p>
      );
    };
    render(<Harness />);
    await screen.findByRole("heading", { name: "Visão geral" });
    goTo(/WhatsApp/);
    await openConversation(/Conversa com Eugênia Ribeiro/);
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getAllByRole("button", { name: "Sair" })[0]);

    expect(await screen.findByText("Sessão encerrada")).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
  });
});

describe("invite-detail flow refresh", () => {
  const session: AdminSessionResponse = {
    authenticated: true,
    stage: "dev",
    admin: {
      subject: "subject",
      email: "casamento@brimax.life",
      hostedDomain: "brimax.life",
      name: "Casamento Brimax"
    }
  };

  const shell = (source: AdminDashboardSource) => (
    <DashboardShell session={session} preview={false} onSignOut={vi.fn()} source={source} />
  );
  const renderShell = async (source: AdminDashboardSource) => {
    const utils = render(shell(source));
    await screen.findByRole("heading", { name: "Visão geral" });
    return utils;
  };
  const goTo = (label: RegExp | string) => {
    const nav = screen.getAllByRole("navigation", { name: "Navegação administrativa" })[0];
    fireEvent.click(within(nav).getByRole("link", { name: label }));
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/dashboard");
  });

  it("opening an invitation issues exactly one request and merges refreshed flow fields", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot(), (code) =>
      Promise.resolve({
        flow: {
          ...defaultFlow(code),
          whatsappFlowStatus: "attendance_confirmed_whatsapp",
          whatsappFlowUpdatedAt: "2026-08-20T14:00:00Z"
        },
        page: {
          invitationCode: code,
          messages: [],
          commands: [
            {
              commandId: "cmd-1",
              createdAt: "2026-08-20T14:00:00Z",
              templateId: "wedding_invitation",
              stage: "pending",
              status: "sent",
              retryCount: 0,
              reconciliationStatus: "none"
            }
          ],
          nextCursor: null
        }
      })
    );

    await renderShell(source);
    goTo(/Convites/);
    await screen.findByRole("heading", { name: "Convites" });

    expect(loadWhatsappInvitation).not.toHaveBeenCalled();

    const openButton = await screen.findByRole("button", { name: /Abrir convite SW2748/ });
    await act(async () => {
      fireEvent.click(openButton);
    });

    await screen.findByRole("heading", { name: "Eugênia Ribeiro" });
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1));
    expect(loadWhatsappInvitation).toHaveBeenCalledWith("SW2748", undefined, expect.any(AbortSignal));

    // Refreshed status rendered
    expect(screen.getAllByText("Confirmado no WhatsApp").length).toBeGreaterThanOrEqual(1);
  });

  it("opening the invitation then its chat coalesces into a single request", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot(), (code) =>
      Promise.resolve({
        flow: defaultFlow(code),
        page: {
          invitationCode: code,
          messages: [inboundMessage("m1", "2026-08-20T14:00:00Z")],
          commands: [],
          nextCursor: null
        }
      })
    );

    await renderShell(source);
    goTo(/Convites/);
    const openButton = await screen.findByRole("button", { name: /Abrir convite SW2748/ });
    await act(async () => {
      fireEvent.click(openButton);
    });
    await screen.findByRole("heading", { name: "Eugênia Ribeiro" });
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1));

    // Now go to WhatsApp tab and open the same conversation
    goTo(/WhatsApp/);
    await screen.findByRole("heading", { name: "WhatsApp" });
    const chatButton = await screen.findByRole("button", { name: /Conversa com Eugênia Ribeiro/ });
    await act(async () => {
      fireEvent.click(chatButton);
    });

    // Still exactly 1 request because SW2748 was already loaded!
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
  });

  it("re-rendering an open invite detail screen issues no extra request", async () => {
    const { source, loadWhatsappInvitation } = spySource(unloadedSnapshot());
    const { rerender } = await renderShell(source);
    goTo(/Convites/);
    const openButton = await screen.findByRole("button", { name: /Abrir convite SW2748/ });
    await act(async () => {
      fireEvent.click(openButton);
    });
    await screen.findByRole("heading", { name: "Eugênia Ribeiro" });
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1));

    rerender(shell(source));
    rerender(shell(source));

    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
  });
});

describe("fixture source", () => {
  it("hands out an independent copy each time so mutations never leak", async () => {
    const first = await fixtureDashboardSource.load();
    first.invitations[0].householdName = "Mutado";
    const second = await fixtureDashboardSource.load();
    expect(second.invitations[0].householdName).not.toBe("Mutado");
  });
});

describe("useDashboardFonts", () => {
  it("adds the dashboard typefaces once, and not on the landing page", () => {
    document.getElementById("brimax-admin-fonts")?.remove();
    const spy = vi.spyOn(document.head, "append");

    const { rerender } = renderHook(() => useDashboardFonts());
    rerender();
    renderHook(() => useDashboardFonts());

    const links = document.querySelectorAll("#brimax-admin-fonts");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toMatch(/EB\+Garamond/);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("useAdminDashboard invitation phone updates", () => {
  const sourceFor = (updateInvitationPhone: AdminDashboardSource["updateInvitationPhone"]): AdminDashboardSource => ({
    demo: false,
    load: async () => createFixtureDashboardSnapshot(),
    loadWhatsappInvitation: vi.fn(),
    deleteGuestMessage: vi.fn(),
    updateGuest: vi.fn(),
    confirmGuests: vi.fn(),
    createInvitation: vi.fn(),
    deleteInvitation: vi.fn(),
    addGuests: vi.fn(),
    removeGuest: vi.fn(),
    updateInvitationPhone
  });

  it("applies only the normalized phone and server timestamp after success", async () => {
    const updateInvitationPhone = vi.fn().mockResolvedValue({
      invitationCode: "SW2748",
      phoneNumber: "5511912345678",
      updatedAt: "2026-08-28T12:00:00.000Z"
    });
    const source = sourceFor(updateInvitationPhone);
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.updateInvitationPhone("SW2748", "+55 (11) 91234-5678");
    });
    expect(updateInvitationPhone).toHaveBeenCalledTimes(1);
    expect(result.current.state.invitations.find((item) => item.invitationCode === "SW2748")).toMatchObject({
      phoneNumber: "5511912345678",
      phoneNumberUpdatedAt: "2026-08-28T12:00:00.000Z",
      phoneNumberSource: "operator"
    });
  });

  it("deduplicates an in-flight update and exposes failures", async () => {
    let reject!: (error: Error) => void;
    const updateInvitationPhone = vi.fn(() => new Promise<never>((_, nextReject) => { reject = nextReject; }));
    const source = sourceFor(updateInvitationPhone);
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.updateInvitationPhone("SW2748", "5511912345678");
      second = result.current.updateInvitationPhone("SW2748", "5511912345678");
    });
    expect(first).toBe(second);
    expect(updateInvitationPhone).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new Error("offline"));
      await first.catch(() => undefined);
    });
    await expect(first).rejects.toThrow("offline");
    await waitFor(() => expect(result.current.phoneWriteStates.SW2748).toEqual({ status: "error", message: "offline" }));
  });
});

describe("useAdminDashboard guest message deletion", () => {
  const snapshotWithMessages = () => createFixtureDashboardSnapshot();

  const sourceFor = (
    deleteGuestMessage: AdminDashboardSource["deleteGuestMessage"]
  ): AdminDashboardSource => ({
    demo: false,
    load: async () => snapshotWithMessages(),
    loadWhatsappInvitation: vi.fn(),
    deleteGuestMessage,
    updateGuest: vi.fn(),
    confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn()
  });

  const ready = async (source: AdminDashboardSource) => {
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    return result;
  };

  it("removes the recado only after the source confirms", async () => {
    let settle: (() => void) | undefined;
    const deleteGuestMessage = vi.fn(
      (messageId: string) =>
        new Promise<{ ok: true; messageId: string; deletedAt: string }>((resolve) => {
          settle = () => resolve({ ok: true, messageId, deletedAt: "2026-08-27T12:00:00.000Z" });
        })
    );
    const result = await ready(sourceFor(deleteGuestMessage));
    const id = result.current.state.guestMessages[0].messageId;
    const before = result.current.state.guestMessages.length;

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.deleteGuestMessage(id);
    });
    // Still listed while the request is in flight — nothing optimistic.
    expect(result.current.state.guestMessages).toHaveLength(before);
    expect(result.current.messageDeleteStates[id]).toEqual({ status: "loading" });

    await act(async () => {
      settle?.();
      await pending;
    });

    expect(result.current.state.guestMessages).toHaveLength(before - 1);
    expect(result.current.state.guestMessages.some((m) => m.messageId === id)).toBe(false);
    expect(result.current.messageDeleteStates[id]).toEqual({ status: "idle" });
  });

  it("shares one in-flight request per message and runs different ids independently", async () => {
    const deleteGuestMessage = vi.fn(async (messageId: string) => ({
      ok: true as const,
      messageId,
      deletedAt: "2026-08-27T12:00:00.000Z"
    }));
    const result = await ready(sourceFor(deleteGuestMessage));
    const [first, second] = result.current.state.guestMessages;

    await act(async () => {
      const a = result.current.deleteGuestMessage(first.messageId);
      const b = result.current.deleteGuestMessage(first.messageId);
      expect(a).toBe(b);
      await Promise.all([a, b, result.current.deleteGuestMessage(second.messageId)]);
    });

    expect(deleteGuestMessage).toHaveBeenCalledTimes(2);
    expect(
      result.current.state.guestMessages.some(
        (m) => m.messageId === first.messageId || m.messageId === second.messageId
      )
    ).toBe(false);
  });

  it("keeps the recado, records the reason and rethrows when the delete fails", async () => {
    const deleteGuestMessage = vi.fn(async () => {
      throw new AdminApiError("O serviço administrativo está indisponível.", "unavailable", 503);
    });
    const result = await ready(sourceFor(deleteGuestMessage));
    const id = result.current.state.guestMessages[0].messageId;
    const before = result.current.state.guestMessages.length;

    await act(async () => {
      await expect(result.current.deleteGuestMessage(id)).rejects.toMatchObject({ status: 503 });
    });

    expect(result.current.state.guestMessages).toHaveLength(before);
    expect(result.current.messageDeleteStates[id]).toEqual({
      status: "error",
      message: "O serviço administrativo está indisponível."
    });
  });

  it("treats a 404 as success — the recado is already gone", async () => {
    const deleteGuestMessage = vi.fn(async () => {
      throw new AdminApiError("Este recado não existe mais.", "rejected", 404);
    });
    const result = await ready(sourceFor(deleteGuestMessage));
    const id = result.current.state.guestMessages[0].messageId;
    const before = result.current.state.guestMessages.length;

    await act(async () => {
      await expect(result.current.deleteGuestMessage(id)).resolves.toBeUndefined();
    });

    expect(result.current.state.guestMessages).toHaveLength(before - 1);
    expect(result.current.messageDeleteStates[id]).toEqual({ status: "idle" });
  });

  it("clears delete state when the source is replaced", async () => {
    const failing = sourceFor(async () => {
      throw new AdminApiError("O serviço administrativo está indisponível.", "unavailable", 503);
    });
    const replacement = sourceFor(async (messageId: string) => ({
      ok: true as const,
      messageId,
      deletedAt: "2026-08-27T12:00:00.000Z"
    }));

    const { result, rerender } = renderHook(
      ({ source }: { source: AdminDashboardSource }) => useAdminDashboard({ source }),
      { initialProps: { source: failing } }
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const id = result.current.state.guestMessages[0].messageId;
    await act(async () => {
      await expect(result.current.deleteGuestMessage(id)).rejects.toBeInstanceOf(AdminApiError);
    });
    expect(result.current.messageDeleteStates[id]?.status).toBe("error");

    rerender({ source: replacement });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.messageDeleteStates).toEqual({});
  });
});

describe("useAdminDashboard guest RSVP writes", () => {
  const snapshot = () => createFixtureDashboardSnapshot();
  const target = () => {
    const invitation = snapshot().invitations.find((item) => item.guests.length > 1)!;
    return { invitation, guest: invitation.guests[0]! };
  };

  const writeResponse = (
    invitationCode: string,
    guests: { guestId: string; guestName: string; allowedPlusOnes: number }[],
    attending: string[]
  ) => ({
    ok: true as const,
    invitationCode,
    guests: guests.map((guest) => ({
      guestId: guest.guestId,
      guestName: guest.guestName,
      allowedPlusOnes: guest.allowedPlusOnes,
      rsvpStatus: attending.includes(guest.guestId) ? ("attending" as const) : ("pending" as const)
    })),
    rsvp: {
      status: "attending" as const,
      updatedAt: "2026-08-27T12:00:00.000Z",
      submittedBy: guests[0]!.guestId,
      attending: attending.length,
      paid: attending.length,
      childrenSixOrYounger: 0
    },
    updatedAt: "2026-08-27T12:00:00.000Z"
  });

  const sourceFor = (
    overrides: Partial<
      Pick<
        AdminDashboardSource,
        | "updateGuest"
        | "confirmGuests"
        | "addGuests"
        | "removeGuest"
        | "createInvitation"
        | "deleteInvitation"
      >
    >
  ): AdminDashboardSource => ({
    demo: false,
    load: async () => snapshot(),
    loadWhatsappInvitation: vi.fn(),
    deleteGuestMessage: vi.fn(),
    updateGuest: vi.fn(),
    confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
    ...overrides
  });

  const ready = async (source: AdminDashboardSource) => {
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    return result;
  };

  it("applies the API's guests and aggregate only after the request resolves", async () => {
    const { invitation, guest } = target();
    let settle: (() => void) | undefined;
    const updateGuest = vi.fn(
      () =>
        new Promise<ReturnType<typeof writeResponse>>((resolve) => {
          settle = () =>
            resolve(writeResponse(invitation.invitationCode, invitation.guests, [guest.guestId]));
        })
    );
    const result = await ready(sourceFor({ updateGuest }));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.updateGuest(invitation.invitationCode, guest.guestId, {
        rsvpStatus: "attending"
      });
    });

    // No optimistic write: the row is untouched while the request is in flight.
    expect(result.current.guestWriteStates[guest.guestId]).toEqual({ status: "loading" });
    expect(
      result.current.state.invitations.find(
        (item) => item.invitationCode === invitation.invitationCode
      )!.guests[0]!.rsvpStatus
    ).toBe(guest.rsvpStatus);

    await act(async () => {
      settle?.();
      await pending;
    });

    const updated = result.current.state.invitations.find(
      (item) => item.invitationCode === invitation.invitationCode
    )!;
    expect(updated.guests[0]!.rsvpStatus).toBe("attending");
    expect(updated.rsvp.attending).toBe(1);
    expect(result.current.guestWriteStates[guest.guestId]).toEqual({ status: "idle" });
  });

  it("dedupes by guest and by invitation while a write is in flight", async () => {
    const { invitation, guest } = target();
    const other = invitation.guests[1]!;
    const updateGuest = vi.fn(async (invitationCode: string, guestId: string) =>
      writeResponse(invitationCode, invitation.guests, [guestId])
    );
    const confirmGuests = vi.fn(async (invitationCode: string, guestIds: string[]) =>
      writeResponse(invitationCode, invitation.guests, guestIds)
    );
    const result = await ready(sourceFor({ updateGuest, confirmGuests }));

    await act(async () => {
      await Promise.all([
        result.current.updateGuest(invitation.invitationCode, guest.guestId, { isChild: true }),
        result.current.updateGuest(invitation.invitationCode, guest.guestId, { isChild: true }),
        result.current.updateGuest(invitation.invitationCode, other.guestId, { isChild: true }),
        result.current.confirmGuests(invitation.invitationCode, [guest.guestId]),
        result.current.confirmGuests(invitation.invitationCode, [guest.guestId])
      ]);
    });

    expect(updateGuest).toHaveBeenCalledTimes(2);
    expect(confirmGuests).toHaveBeenCalledTimes(1);
  });

  it("records a localized failure and rethrows so the modal stays open", async () => {
    const { invitation, guest } = target();
    const updateGuest = vi.fn(async () => {
      throw new AdminApiError("Este convidado não está mais disponível. Atualize os dados do painel.", "rejected", 404);
    });
    const result = await ready(sourceFor({ updateGuest }));

    await act(async () => {
      await expect(
        result.current.updateGuest(invitation.invitationCode, guest.guestId, {
          rsvpStatus: "declined"
        })
      ).rejects.toBeInstanceOf(AdminApiError);
    });

    expect(result.current.guestWriteStates[guest.guestId]).toEqual({
      status: "error",
      message: "Este convidado não está mais disponível. Atualize os dados do painel."
    });
    // The failed write changed nothing.
    expect(
      result.current.state.invitations.find(
        (item) => item.invitationCode === invitation.invitationCode
      )!.guests[0]!.rsvpStatus
    ).toBe(guest.rsvpStatus);
  });

  it("keeps confirm-all failures on their own invitation key", async () => {
    const { invitation } = target();
    const confirmGuests = vi.fn(async () => {
      throw new AdminApiError("Os dados do convite mudaram. Atualize o painel e tente novamente.", "rejected", 409);
    });
    const result = await ready(sourceFor({ confirmGuests }));

    await act(async () => {
      await result.current
        .confirmGuests(invitation.invitationCode, [invitation.guests[0]!.guestId])
        .catch(() => undefined);
    });

    expect(result.current.confirmGuestsStates[invitation.invitationCode]).toMatchObject({
      status: "error"
    });
    expect(result.current.guestWriteStates).toEqual({});
  });

  it("reconciles an added guest from the response and never optimistically", async () => {
    const { invitation } = target();
    const added = [
      ...invitation.guests,
      { guestId: "X--guest-09", guestName: "Duda", allowedPlusOnes: 0, rsvpStatus: "pending" as const }
    ];
    let settle: (() => void) | undefined;
    const addGuests = vi.fn(
      () =>
        new Promise<ReturnType<typeof writeResponse>>((resolve) => {
          settle = () => resolve(writeResponse(invitation.invitationCode, added, []));
        })
    );
    const result = await ready(sourceFor({ addGuests }));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.addGuests(invitation.invitationCode, [{ guestName: "Duda" }]);
    });

    expect(result.current.addGuestsStates[invitation.invitationCode]).toEqual({ status: "loading" });
    const before = result.current.state.invitations.find(
      (item) => item.invitationCode === invitation.invitationCode
    )!;
    expect(before.guests).toHaveLength(invitation.guests.length);

    await act(async () => {
      settle?.();
      await pending;
    });

    const after = result.current.state.invitations.find(
      (item) => item.invitationCode === invitation.invitationCode
    )!;
    expect(after.guests.map((guest) => guest.guestId)).toContain("X--guest-09");
    expect(result.current.addGuestsStates[invitation.invitationCode]).toEqual({ status: "idle" });
  });

  it("dedupes a removal by guest id, in the same map an edit uses", async () => {
    const { invitation, guest } = target();
    const other = invitation.guests[1]!;
    const remaining = invitation.guests.filter((row) => row.guestId !== guest.guestId);
    const removeGuest = vi.fn(
      async () => writeResponse(invitation.invitationCode, remaining, [])
    );
    const result = await ready(sourceFor({ removeGuest }));

    await act(async () => {
      await Promise.all([
        result.current.removeGuest(invitation.invitationCode, guest.guestId),
        result.current.removeGuest(invitation.invitationCode, guest.guestId),
        result.current.removeGuest(invitation.invitationCode, other.guestId)
      ]);
    });

    // Two calls for the same guest collapse to one request; a different guest gets its own.
    expect(removeGuest).toHaveBeenCalledTimes(2);
    expect(
      result.current.state.invitations.find(
        (item) => item.invitationCode === invitation.invitationCode
      )!.guests.map((row) => row.guestId)
    ).not.toContain(guest.guestId);
  });

  it("records a removal failure per guest and rethrows so the modal stays open", async () => {
    const { invitation, guest } = target();
    const removeGuest = vi.fn().mockRejectedValue(
      new AdminApiError(
        "Este é o último convidado do convite. Exclua o convite em vez de remover o convidado.",
        "rejected",
        409
      )
    );
    const result = await ready(sourceFor({ removeGuest }));

    await act(async () => {
      await expect(
        result.current.removeGuest(invitation.invitationCode, guest.guestId)
      ).rejects.toMatchObject({ status: 409 });
    });

    expect(result.current.guestWriteStates[guest.guestId]).toEqual({
      message: "Este é o último convidado do convite. Exclua o convite em vez de remover o convidado.",
      status: "error"
    });
  });

  it("inserts the created invitation and dedupes concurrent submissions", async () => {
    const created = {
      ok: true as const,
      invitation: {
        invitationCode: "KP3456",
        householdName: "Família Moretti",
        whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
        whatsappFreeTextWindow: { open: false },
        guests: [
          {
            guestId: "KP3456--guest-01",
            guestName: "Ana Moretti",
            allowedPlusOnes: 0,
            rsvpStatus: "pending" as const
          }
        ],
        rsvp: {
          status: "pending" as const,
          updatedAt: null,
          submittedBy: null,
          attending: 0,
          paid: 0,
          childrenSixOrYounger: 0
        }
      },
      createdAt: "2026-08-27T12:00:00.000Z"
    };
    const createInvitation = vi.fn(async () => created);
    const result = await ready(sourceFor({ createInvitation }));
    const draft = {
      invitationCode: "KP3456",
      householdName: "Família Moretti",
      guests: [{ guestName: "Ana Moretti" }]
    };

    await act(async () => {
      await Promise.all([
        result.current.createInvitation(draft),
        result.current.createInvitation(draft)
      ]);
    });

    // A double submit cannot race itself into a 409 from its own first request.
    expect(createInvitation).toHaveBeenCalledTimes(1);
    expect(result.current.state.invitations[0]!.invitationCode).toBe("KP3456");
    // Mapped by the same rules a snapshot goes through: no phone becomes "", not undefined.
    expect(result.current.state.invitations[0]!.phoneNumber).toBe("");
    expect(result.current.state.invitations[0]!.commands).toEqual([]);
  });

  it("drops the invitation row only after the delete resolves", async () => {
    const { invitation } = target();
    let settle: (() => void) | undefined;
    const deleteInvitation = vi.fn(
      () =>
        new Promise<{
          ok: true;
          invitationCode: string;
          deletedAt: string;
          deleted: { guests: number; rsvp: 0 | 1; whatsappItems: number; phoneLookups: 0 | 1 };
        }>((resolve) => {
          settle = () =>
            resolve({
              ok: true,
              invitationCode: invitation.invitationCode,
              deletedAt: "2026-08-27T12:00:00.000Z",
              deleted: { guests: 2, rsvp: 1, whatsappItems: 0, phoneLookups: 1 }
            });
        })
    );
    const result = await ready(sourceFor({ deleteInvitation }));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.deleteInvitation(invitation.invitationCode);
    });

    expect(result.current.invitationWriteStates[invitation.invitationCode]).toEqual({
      status: "loading"
    });
    expect(
      result.current.state.invitations.some(
        (item) => item.invitationCode === invitation.invitationCode
      )
    ).toBe(true);

    await act(async () => {
      settle?.();
      await pending;
    });

    expect(
      result.current.state.invitations.some(
        (item) => item.invitationCode === invitation.invitationCode
      )
    ).toBe(false);
  });
});
