/**
 * Hash routing for the dashboard.
 *
 * The panel lives entirely under `/dashboard`, so screen and detail selection ride in
 * the hash. That keeps every view deep-linkable and back-button friendly without
 * asking CloudFront to rewrite nested SPA paths.
 */

export type DashboardSection =
  | "visao-geral"
  | "convites"
  | "convidados"
  | "presentes"
  | "whatsapp"
  | "recados";

export type DashboardRoute =
  | { section: "visao-geral" }
  | { section: "convites"; invitationCode?: string }
  | { section: "convidados"; guestId?: string }
  | { section: "presentes"; giftId?: string }
  | { section: "whatsapp"; invitationCode?: string }
  | { section: "recados" };

export const DEFAULT_ROUTE: DashboardRoute = { section: "visao-geral" };

const SECTIONS: DashboardSection[] = [
  "visao-geral",
  "convites",
  "convidados",
  "presentes",
  "whatsapp",
  "recados"
];

const isSection = (value: string): value is DashboardSection =>
  (SECTIONS as string[]).includes(value);

/** Parses `#convites/SW2748` into a route; unknown hashes fall back to the overview. */
export function parseDashboardHash(hash: string): DashboardRoute {
  const path = hash.replace(/^#\/?/, "");
  if (!path) return DEFAULT_ROUTE;
  const [rawSection, rawDetail] = path.split("/");
  const section = decodeURIComponent(rawSection);
  if (!isSection(section)) return DEFAULT_ROUTE;
  const detail = rawDetail ? decodeURIComponent(rawDetail) : undefined;
  switch (section) {
    case "convites":
      return { section, invitationCode: detail };
    case "convidados":
      return { section, guestId: detail };
    case "presentes":
      return { section, giftId: detail };
    case "whatsapp":
      return { section, invitationCode: detail };
    default:
      return { section };
  }
}

/** The inverse of `parseDashboardHash`, for `href`s and `history` writes. */
export function formatDashboardHash(route: DashboardRoute) {
  const detail =
    route.section === "convites" || route.section === "whatsapp"
      ? route.invitationCode
      : route.section === "convidados"
        ? route.guestId
        : route.section === "presentes"
          ? route.giftId
          : undefined;
  return detail ? `#${route.section}/${encodeURIComponent(detail)}` : `#${route.section}`;
}

/** Which sidebar entry is highlighted for a route. */
export function sectionOf(route: DashboardRoute): DashboardSection {
  return route.section;
}

/** The list-level route for a sidebar entry, with any detail selection cleared. */
export function routeForSection(section: DashboardSection): DashboardRoute {
  return { section } as DashboardRoute;
}

/** `href` for a sidebar entry. */
export function sectionHash(section: DashboardSection) {
  return `#${section}`;
}
