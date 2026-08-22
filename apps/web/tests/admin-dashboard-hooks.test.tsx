import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminDashboard } from "@/hooks/use-admin-dashboard";
import { useDashboardFonts } from "@/hooks/use-dashboard-fonts";
import { useDashboardRoute } from "@/hooks/use-dashboard-route";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import { fixtureDashboardSource, type AdminDashboardSource } from "@/lib/admin-dashboard-source";

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
  it("loads a snapshot with unknown unread counts, then derives one thread on demand", async () => {
    const { result } = renderHook(() => useAdminDashboard());
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.demo).toBe(true);
    expect(result.current.state.invitations).toHaveLength(8);
    expect(result.current.guestRows).toHaveLength(15);
    expect(result.current.unreadByCode.QP8814).toBeNull();
    expect(result.current.unreadByCode.SW2748).toBeNull();

    await act(() => result.current.loadWhatsappThread("QP8814"));
    expect(result.current.unreadByCode.QP8814).toBe(2);
    expect(result.current.unreadByCode.SW2748).toBeNull();
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
      load: () => Promise.reject(new Error("offline")),
      loadWhatsappThread: vi.fn()
    };
    const { result } = renderHook(() => useAdminDashboard({ source: failing }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.state.invitations).toEqual([]);
  });

  it("accepts an alternative source, which is the seam for the real endpoints", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    const single: AdminDashboardSource = {
      demo: false,
      load: async () => ({ ...snapshot, invitations: snapshot.invitations.slice(0, 1) }),
      loadWhatsappThread: vi.fn()
    };
    const { result } = renderHook(() => useAdminDashboard({ source: single }));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.demo).toBe(false);
    expect(result.current.state.invitations).toHaveLength(1);
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
      load: (signal) => {
        firstSignal = signal;
        return firstLoad;
      },
      loadWhatsappThread: vi.fn()
    };
    const replacementSnapshot = createFixtureDashboardSnapshot();
    replacementSnapshot.invitations = replacementSnapshot.invitations.slice(0, 2);
    const replacement: AdminDashboardSource = {
      demo: false,
      load: async () => replacementSnapshot,
      loadWhatsappThread: vi.fn()
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
      load: async () => fixture,
      loadWhatsappThread: vi.fn()
    };
    const failing: AdminDashboardSource = {
      demo: false,
      load: async () => Promise.reject(new Error("offline")),
      loadWhatsappThread: vi.fn()
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
    let resolvePage!: (page: Awaited<ReturnType<AdminDashboardSource["loadWhatsappThread"]>>) => void;
    const pending = new Promise<Awaited<ReturnType<AdminDashboardSource["loadWhatsappThread"]>>>((resolve) => {
      resolvePage = resolve;
    });
    const loadWhatsappThread = vi.fn(() => pending);
    const source: AdminDashboardSource = { demo: false, load: async () => snapshot, loadWhatsappThread };
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.loadWhatsappThread("SW2748");
      second = result.current.loadWhatsappThread("SW2748");
    });
    expect(first).toBe(second);
    expect(loadWhatsappThread).toHaveBeenCalledTimes(1);

    resolvePage({ invitationCode: "SW2748", messages: [], commands: [], nextCursor: null });
    await act(() => first);
    await act(() => result.current.loadWhatsappThread("SW2748"));
    expect(loadWhatsappThread).toHaveBeenCalledTimes(1);
  });

  it("keeps simultaneous invitation results isolated", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    const resolvers = new Map<string, (page: Awaited<ReturnType<AdminDashboardSource["loadWhatsappThread"]>>) => void>();
    const source: AdminDashboardSource = {
      demo: false,
      load: async () => snapshot,
      loadWhatsappThread: vi.fn((invitationCode) =>
        new Promise<Awaited<ReturnType<AdminDashboardSource["loadWhatsappThread"]>>>((resolve) =>
          resolvers.set(invitationCode, resolve)
        )
      )
    };
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.loadWhatsappThread("SW2748");
      second = result.current.loadWhatsappThread("TX6935");
    });
    resolvers.get("TX6935")!({
      invitationCode: "TX6935",
      messages: [{ messageId: "tx", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "TX" }],
      commands: [], nextCursor: null
    });
    resolvers.get("SW2748")!({
      invitationCode: "SW2748",
      messages: [{ messageId: "sw", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "SW" }],
      commands: [], nextCursor: null
    });
    await act(() => Promise.all([first, second]));

    expect(result.current.state.threads.SW2748[0].messageId).toBe("sw");
    expect(result.current.state.threads.TX6935[0].messageId).toBe("tx");
  });

  it("ignores an in-flight thread after source replacement and retries a failed first load", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    let resolveStale!: (page: Awaited<ReturnType<AdminDashboardSource["loadWhatsappThread"]>>) => void;
    const staleSource: AdminDashboardSource = {
      demo: false,
      load: async () => snapshot,
      loadWhatsappThread: vi.fn(() =>
        new Promise<Awaited<ReturnType<AdminDashboardSource["loadWhatsappThread"]>>>((resolve) => {
          resolveStale = resolve;
        })
      )
    };
    const replacementLoad = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ invitationCode: "SW2748", messages: [], commands: [], nextCursor: null });
    const replacement: AdminDashboardSource = {
      demo: false,
      load: async () => snapshot,
      loadWhatsappThread: replacementLoad
    };
    const { result, rerender } = renderHook(({ source }) => useAdminDashboard({ source }), {
      initialProps: { source: staleSource }
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => { void result.current.loadWhatsappThread("SW2748"); });

    rerender({ source: replacement });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    resolveStale({
      invitationCode: "SW2748",
      messages: [{ messageId: "stale", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "stale" }],
      commands: [], nextCursor: null
    });
    await act(async () => Promise.resolve());
    expect(result.current.state.threads.SW2748).toBeUndefined();

    await act(() => result.current.loadWhatsappThread("SW2748").catch(() => undefined));
    expect(result.current.state.threadLoads.SW2748).toMatchObject({ status: "error", hasLoaded: false });
    await act(() => result.current.retryWhatsappThread("SW2748"));
    expect(result.current.state.threadLoads.SW2748).toEqual({ status: "loaded", nextCursor: null });
    expect(replacementLoad).toHaveBeenCalledTimes(2);
  });

  it("retains a loaded page and retries load-more with the same cursor", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    const loadWhatsappThread = vi.fn()
      .mockResolvedValueOnce({
        invitationCode: "SW2748",
        messages: [{ messageId: "new", direction: "inbound", sentAt: "2026-08-20T12:00:00Z", text: "Nova" }],
        commands: [], nextCursor: "older"
      })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        invitationCode: "SW2748",
        messages: [{ messageId: "old", direction: "outbound", sentAt: "2026-08-19T12:00:00Z", text: "Antiga" }],
        commands: [], nextCursor: null
      });
    const source: AdminDashboardSource = { demo: false, load: async () => snapshot, loadWhatsappThread };
    const { result } = renderHook(() => useAdminDashboard({ source }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => result.current.loadWhatsappThread("SW2748"));
    await act(() => result.current.loadMoreWhatsappThread("SW2748").catch(() => undefined));

    expect(result.current.state.threads.SW2748.map((message) => message.messageId)).toEqual(["new"]);
    expect(result.current.state.threadLoads.SW2748).toEqual({
      status: "error", hasLoaded: true, nextCursor: "older"
    });

    await act(() => result.current.retryWhatsappThread("SW2748"));
    expect(result.current.state.threads.SW2748.map((message) => message.messageId)).toEqual(["old", "new"]);
    expect(loadWhatsappThread).toHaveBeenNthCalledWith(2, "SW2748", "older", expect.any(AbortSignal));
    expect(loadWhatsappThread).toHaveBeenNthCalledWith(3, "SW2748", "older", expect.any(AbortSignal));
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
