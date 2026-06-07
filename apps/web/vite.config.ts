import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

process.env.VITE_CONTACT_EMAIL ??= process.env.CONTACT_EMAIL ?? "casamento@brimax.life";

const rawPort = process.env.PORT ?? "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const buildOutDir = process.env.BUILD_OUT_DIR ?? "dist/public";

const isDev = process.env.NODE_ENV !== "production";

// Dev-only: CloudFront isn't in front of the Vite dev server, so /media/* has
// no origin locally. Proxy it to the deployed CDN (read-only GET/HEAD) so
// images/video resolve in `pnpm dev:web` / `pnpm dev:all-web`. Intentionally
// NOT VITE_-prefixed so it is never inlined into the client bundle; the whole
// `server` block (and this proxy) is ignored by `vite build`, so production
// builds are unaffected and keep reading /media/* from S3 via CloudFront.
const mediaProxyTarget =
  process.env.MEDIA_PROXY_TARGET ?? `https://${process.env.ROOT_DOMAIN ?? "brimax.life"}`;

// Dev-only: the prod HTTP API only allows the production origins in its CORS
// allowlist, so a browser at localhost can't read it directly. Proxy /api/* to
// the deployed API server-side, keeping the browser request same-origin (no
// CORS). READ-ONLY: only GET/HEAD are forwarded — writes are blocked so local
// dev can never mutate production. Same as the media proxy, this is ignored by
// `vite build`, so production is unaffected.
const apiProxyTarget =
  process.env.API_PROXY_TARGET ?? `https://${process.env.API_DOMAIN ?? "api.brimax.life"}`;
const READ_ONLY_PROXY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    ...(isDev ? [runtimeErrorOverlay()] : []),
    ...(isDev && process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, buildOutDir),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split large, stable vendor code out of the app bundle. Keeps every
        // chunk under Vite's 500 kB warning threshold and lets returning
        // visitors reuse cached vendor chunks across app-only deploys (their
        // hashes don't change when only app code does).
        //
        // React itself stays in `vendor`: isolating it creates a vendor<->react
        // circular chunk (the libs below depend on React). The peeled-off chunks
        // are all leaves — they import React but nothing imports them back — so
        // there is no cycle.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("framer-motion") ||
            id.includes("/motion-dom/") ||
            id.includes("/motion-utils/")
          ) {
            return "motion";
          }
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("@tanstack")) return "query";
          return "vendor";
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    ...(isDev
      ? {
          proxy: {
            "/media": { target: mediaProxyTarget, changeOrigin: true },
            "/api": {
              target: apiProxyTarget,
              changeOrigin: true,
              rewrite: (p) => p.replace(/^\/api/, ""),
              // Block non-GET so local dev cannot write to production.
              // Returning false makes the dev server answer 404 without forwarding.
              bypass: (req) =>
                req.method && !READ_ONLY_PROXY_METHODS.has(req.method) ? false : undefined,
            },
          },
        }
      : {}),
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
