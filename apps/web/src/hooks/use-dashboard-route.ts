import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ROUTE,
  formatDashboardHash,
  parseDashboardHash,
  type DashboardRoute
} from "@/lib/admin-dashboard-route";

/** Keeps the active dashboard screen in the URL hash, so every view is deep-linkable. */
export function useDashboardRoute() {
  const [route, setRoute] = useState<DashboardRoute>(() =>
    typeof window === "undefined" ? DEFAULT_ROUTE : parseDashboardHash(window.location.hash)
  );

  useEffect(() => {
    const sync = () => setRoute(parseDashboardHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = useCallback((next: DashboardRoute) => {
    const hash = formatDashboardHash(next);
    if (window.location.hash !== hash) {
      window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
    setRoute(next);
  }, []);

  return { route, navigate };
}
