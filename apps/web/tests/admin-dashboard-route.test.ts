import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTE,
  formatDashboardHash,
  parseDashboardHash,
  routeForSection,
  sectionHash,
  sectionOf
} from "@/lib/admin-dashboard-route";

describe("dashboard hash routing", () => {
  it("defaults to the overview for empty and unknown hashes", () => {
    expect(parseDashboardHash("")).toEqual(DEFAULT_ROUTE);
    expect(parseDashboardHash("#")).toEqual(DEFAULT_ROUTE);
    expect(parseDashboardHash("#nao-existe")).toEqual(DEFAULT_ROUTE);
    // A stray payment-style hash must not throw or resolve to a screen.
    expect(parseDashboardHash("#paymentId=abc&paymentStatus=success")).toEqual(DEFAULT_ROUTE);
  });

  it("reads the section and its detail selection", () => {
    expect(parseDashboardHash("#convites")).toEqual({ section: "convites", invitationCode: undefined });
    expect(parseDashboardHash("#convites/SW2748")).toEqual({
      section: "convites",
      invitationCode: "SW2748"
    });
    expect(parseDashboardHash("#convidados/HL4120--guest-03")).toEqual({
      section: "convidados",
      guestId: "HL4120--guest-03"
    });
    expect(parseDashboardHash("#presentes/g-sofa")).toEqual({
      section: "presentes",
      giftId: "g-sofa"
    });
    expect(parseDashboardHash("#whatsapp/QP8814")).toEqual({
      section: "whatsapp",
      invitationCode: "QP8814"
    });
    expect(parseDashboardHash("#recados")).toEqual({ section: "recados" });
  });

  it("tolerates a leading slash", () => {
    expect(parseDashboardHash("#/convites/SW2748")).toEqual({
      section: "convites",
      invitationCode: "SW2748"
    });
  });

  it("round-trips every route through the hash", () => {
    const routes = [
      { section: "visao-geral" as const },
      { section: "convites" as const, invitationCode: "SW2748" },
      { section: "convidados" as const, guestId: "HL4120--guest-03" },
      { section: "presentes" as const, giftId: "g-lua-de-mel" },
      { section: "whatsapp" as const, invitationCode: "QP8814" },
      { section: "recados" as const }
    ];
    for (const route of routes) {
      expect(parseDashboardHash(formatDashboardHash(route))).toMatchObject(route);
    }
  });

  it("escapes detail values that are not URL safe", () => {
    expect(formatDashboardHash({ section: "convites", invitationCode: "A B" })).toBe(
      "#convites/A%20B"
    );
    expect(parseDashboardHash("#convites/A%20B")).toEqual({
      section: "convites",
      invitationCode: "A B"
    });
  });

  it("builds list-level routes and hrefs for the sidebar", () => {
    expect(routeForSection("presentes")).toEqual({ section: "presentes" });
    expect(sectionHash("recados")).toBe("#recados");
    expect(sectionOf({ section: "convites", invitationCode: "SW2748" })).toBe("convites");
  });
});
