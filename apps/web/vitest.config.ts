import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Node 25 and 26 enable the Web Storage API by default. Their `localStorage` getter on
// globalThis shadows the jsdom implementation Vitest installs (vitest-dev/vitest#8757).
const workerExecArgv = process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
  ? ["--no-experimental-webstorage"]
  : [];

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./tests/setup.ts",
      testTimeout: 10_000,
      poolOptions: {
        forks: { execArgv: workerExecArgv },
        threads: { execArgv: workerExecArgv },
      },
      coverage: {
        provider: "v8",
        reporter: ["text", "json-summary", "lcov"],
        include: [
          "src/App.tsx",
          "src/components/PaymentConfirmationDialog.tsx",
          "src/components/ResponsivePhoto.tsx",
          "src/components/dashboard/**/*.tsx",
          "src/components/sections/**/*.tsx",
          "src/hooks/use-admin-dashboard.ts",
          "src/hooks/use-admin-session.ts",
          "src/hooks/use-dashboard-fonts.ts",
          "src/hooks/use-dashboard-route.ts",
          "src/lib/admin-api.ts",
          "src/lib/admin-auth.ts",
          "src/lib/admin-dashboard-format.ts",
          "src/lib/admin-dashboard-model.ts",
          "src/lib/admin-dashboard-route.ts",
          "src/lib/admin-dashboard-source.ts",
          "src/lib/admin-dashboard-store.ts",
          "src/lib/admin-fixtures.ts",
          "src/lib/gifts-api.ts",
          "src/lib/google-identity.ts",
          "src/lib/media-policy.ts",
          "src/lib/media.ts",
          "src/lib/payment-flow.ts",
          "src/lib/presentes-return.ts",
          "src/lib/rsvp-api.ts",
          "src/lib/scroll-to-anchor.ts",
          "src/pages/Dashboard.tsx"
        ],
        exclude: [
          "tests/**",
          "dist/**",
          "coverage/**",
          "node_modules/**"
        ],
        thresholds: {
          lines: 70,
          statements: 70,
          functions: 70,
          branches: 60
        }
      }
    },
  })
);
