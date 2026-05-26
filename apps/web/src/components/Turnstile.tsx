import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "compact" | "invisible";
      callback?: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    }
  ) => string;
  reset: (widgetId: string) => void;
  getResponse: (widgetId: string) => string | undefined;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = {
  /** Returns the current token, or null if the widget hasn't issued one yet. */
  getToken: () => string | null;
  /** Resets the widget so it issues a fresh token. Tokens are single-use. */
  reset: () => void;
};

type Props = {
  siteKey: string;
  className?: string;
};

/**
 * Renders the Cloudflare Turnstile widget. The CDN script is loaded from
 * index.html; this component polls until window.turnstile is available, then
 * mounts a widget into its container and exposes getToken/reset via ref.
 *
 * If siteKey is empty (e.g. VITE_TURNSTILE_SITE_KEY unset in tests/local dev),
 * the widget renders nothing and getToken always returns null — the API client
 * will then omit the x-turnstile-token header, and the backend (which only
 * enforces when TURNSTILE_SECRET_ARN is set) treats the call as unprotected.
 */
export const Turnstile = forwardRef<TurnstileHandle, Props>(function Turnstile(
  { siteKey, className },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) {
      return;
    }

    let cancelled = false;
    let pollTimer: number | undefined;

    const tryRender = () => {
      if (cancelled) return;
      const api = window.turnstile;
      const container = containerRef.current;
      if (!api || !container) {
        pollTimer = window.setTimeout(tryRender, 150);
        return;
      }
      if (widgetIdRef.current) {
        return;
      }
      widgetIdRef.current = api.render(container, {
        sitekey: siteKey,
        theme: "auto",
        size: "normal",
      });
    };

    tryRender();

    return () => {
      cancelled = true;
      if (pollTimer) {
        window.clearTimeout(pollTimer);
      }
      const api = window.turnstile;
      if (api && widgetIdRef.current) {
        api.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  useImperativeHandle(
    ref,
    () => ({
      getToken: () => {
        const api = window.turnstile;
        const id = widgetIdRef.current;
        if (!api || !id) return null;
        return api.getResponse(id) ?? null;
      },
      reset: () => {
        const api = window.turnstile;
        const id = widgetIdRef.current;
        if (!api || !id) return;
        api.reset(id);
      },
    }),
    []
  );

  if (!siteKey) {
    return null;
  }

  return <div ref={containerRef} className={className} />;
});
