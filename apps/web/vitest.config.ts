import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Node >= 25 enables the Web Storage API by default. Its `localStorage` global is a stub that
// returns undefined without --localstorage-file, and it shadows jsdom's real implementation
// (vitest-dev/vitest#8757). CI runs Node 20, which does not define the global or recognise the
// flag, so detect the global and only disable it where it actually exists.
const nodeWebStorageActive =
  Object.getOwnPropertyDescriptor(globalThis, "localStorage") !== undefined;
const workerExecArgv = nodeWebStorageActive ? ["--no-webstorage"] : [];

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./tests/setup.ts",
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
          "src/components/sections/**/*.tsx",
          "src/lib/gifts-api.ts",
          "src/lib/media-policy.ts",
          "src/lib/media.ts",
          "src/lib/payment-flow.ts",
          "src/lib/presentes-return.ts",
          "src/lib/rsvp-api.ts",
          "src/lib/scroll-to-anchor.ts"
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
