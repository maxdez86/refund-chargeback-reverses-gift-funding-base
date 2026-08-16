import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: [
        "src/domain/**/*.ts",
        "src/lib/env.ts",
        "src/lib/errors.ts",
        "src/lib/http.ts",
        "src/lib/lookup-proof.ts",
        "src/lib/sentry.ts",
        "src/lib/warmup.ts",
        "src/lib/xray.ts",
        "src/services/asaas/client.ts",
        "src/services/dynamodb/key-builder.ts",
        "src/services/dynamodb/mappers.ts",
        "src/services/email/**/*.ts",
        "src/services/secrets-manager/app-secrets.ts",
        "src/services/whatsapp/**/*.ts"
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
  }
});
