import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
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
