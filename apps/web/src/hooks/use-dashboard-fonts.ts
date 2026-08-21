import { useEffect } from "react";

const FONT_LINK_ID = "brimax-admin-fonts";
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Geist:wght@400;500;600&display=swap";

/**
 * Loads the dashboard's typefaces on demand.
 *
 * The panel uses EB Garamond and Geist, which the guest-facing site does not; injecting
 * them here keeps that request off every landing-page visit. The link is left in place
 * once added so navigating between dashboard views never re-fetches.
 */
export function useDashboardFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.append(link);
  }, []);
}
