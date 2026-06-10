import { normalizeInvitationCode } from "@/lib/rsvp-api";

export const INVITATION_CODE_PARAM = "code";

/**
 * Read and normalize the invitation code from a URL query string
 * (e.g. `?code=AB2345`). Returns `null` when the param is absent or empty
 * after normalization.
 */
export function readInvitationCodeFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(INVITATION_CODE_PARAM);
  if (!raw) return null;
  const normalized = normalizeInvitationCode(raw);
  return normalized.length > 0 ? normalized : null;
}

/**
 * Strip the `?code=…` param from the current address bar, preserving the path
 * and hash (so `#confirmar-presenca` survives). No-op when the param is absent
 * or when running outside the browser.
 */
export function clearInvitationCodeFromUrl(): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (!url.searchParams.has(INVITATION_CODE_PARAM)) return;

  url.searchParams.delete(INVITATION_CODE_PARAM);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}
