import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      appearance?: "always" | "execute" | "interaction-only";
      callback?: (token: string) => void;
      "error-callback"?: (errorCode?: string) => void;
      "expired-callback"?: () => void;
      execution?: "render" | "execute";
      sitekey: string;
      size?: "normal" | "compact" | "flexible";
      theme?: "light" | "dark" | "auto";
    }
  ) => string;
  execute: (widgetId: string) => void;
  getResponse: (widgetId: string) => string | undefined;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = {
  execute: () => Promise<string | null>;
  reset: () => void;
};

type Props = {
  appearance?: "always" | "execute" | "interaction-only";
  className?: string;
  execution?: "render" | "execute";
  onError?: (errorCode?: string) => void;
  onExpire?: () => void;
  siteKey: string;
};

/**
 * Renders the Cloudflare Turnstile widget with explicit control over when the
 * challenge executes. This keeps the widget hidden until the caller asks for a
 * token, while still allowing Cloudflare to show an interactive prompt if the
 * visitor looks suspicious.
 */
export const Turnstile = forwardRef<TurnstileHandle, Props>(function Turnstile(
  {
    appearance = "always",
    className,
    execution = "render",
    onError,
    onExpire,
    siteKey,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const widgetReadyRef = useRef<Promise<string> | null>(null);
  const executeResolverRef = useRef<{
    reject: (error: Error) => void;
    resolve: (token: string | null) => void;
  } | null>(null);

  useEffect(() => {
    if (!siteKey) {
      return;
    }

    let cancelled = false;
    let pollTimer: number | undefined;

    widgetReadyRef.current = new Promise<string>((resolve, reject) => {
      const tryRender = () => {
        if (cancelled) {
          reject(new Error("Turnstile initialization cancelled."));
          return;
        }

        const api = window.turnstile;
        const container = containerRef.current;
        if (!api || !container) {
          pollTimer = window.setTimeout(tryRender, 150);
          return;
        }

        if (widgetIdRef.current) {
          resolve(widgetIdRef.current);
          return;
        }

        widgetIdRef.current = api.render(container, {
          appearance,
          callback: (token) => {
            executeResolverRef.current?.resolve(token);
            executeResolverRef.current = null;
          },
          "error-callback": (errorCode) => {
            onError?.(errorCode);
            executeResolverRef.current?.reject(
              new Error(errorCode || "Turnstile validation failed.")
            );
            executeResolverRef.current = null;
          },
          "expired-callback": () => {
            onExpire?.();
            executeResolverRef.current?.reject(
              new Error("Turnstile validation expired.")
            );
            executeResolverRef.current = null;
          },
          execution,
          sitekey: siteKey,
          size: "normal",
          theme: "auto",
        });

        resolve(widgetIdRef.current);
      };

      tryRender();
    });

    return () => {
      cancelled = true;
      if (pollTimer) {
        window.clearTimeout(pollTimer);
      }
      executeResolverRef.current?.reject(
        new Error("Turnstile removed before verification completed.")
      );
      executeResolverRef.current = null;
      const api = window.turnstile;
      if (api && widgetIdRef.current) {
        api.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
      widgetReadyRef.current = null;
    };
  }, [appearance, execution, onError, onExpire, siteKey]);

  useImperativeHandle(
    ref,
    () => ({
      execute: async () => {
        if (!siteKey) {
          return null;
        }

        const ready = widgetReadyRef.current;
        if (!ready) {
          throw new Error("Turnstile indisponível.");
        }

        const widgetId = await ready;
        const api = window.turnstile;
        if (!api) {
          throw new Error("Turnstile indisponível.");
        }

        const currentToken = api.getResponse(widgetId) ?? null;
        if (currentToken) {
          return currentToken;
        }

        return await new Promise<string | null>((resolve, reject) => {
          executeResolverRef.current = { resolve, reject };
          api.execute(widgetId);
        });
      },
      reset: () => {
        const api = window.turnstile;
        const id = widgetIdRef.current;
        if (!api || !id) return;
        executeResolverRef.current = null;
        api.reset(id);
      },
    }),
    [siteKey]
  );

  if (!siteKey) {
    return null;
  }

  return <div ref={containerRef} className={className} />;
});
