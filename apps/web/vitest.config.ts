import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./tests/setup.ts",
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
