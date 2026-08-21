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
  it("loads a snapshot and derives guest rows and unread counts", async () => {
    const { result } = renderHook(() => useAdminDashboard());
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.demo).toBe(true);
    expect(result.current.state.invitations).toHaveLength(8);
    expect(result.current.guestRows).toHaveLength(15);
    // QP8814's thread ends with two unanswered guest messages.
    expect(result.current.unreadByCode.QP8814).toBe(2);
    expect(result.current.unreadByCode.SW2748).toBe(0);
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
      load: () => Promise.reject(new Error("offline"))
    };
    const { result } = renderHook(() => useAdminDashboard({ source: failing }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.state.invitations).toEqual([]);
  });

  it("accepts an alternative source, which is the seam for the real endpoints", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    const single: AdminDashboardSource = {
      demo: false,
      load: async () => ({ ...snapshot, invitations: snapshot.invitations.slice(0, 1) })
    };
    const { result } = renderHook(() => useAdminDashboard({ source: single }));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.demo).toBe(false);
    expect(result.current.state.invitations).toHaveLength(1);
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
