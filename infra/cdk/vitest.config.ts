import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file synthesises a stack, which bundles every NodejsFunction with esbuild. One
    // worker per core starves those bundles of memory on small hosts and they fail their timeouts
    // rather than running slowly. Cap the pool at the GitHub-hosted runner width, where this is a
    // no-op, so the suite is deterministic on developer machines too.
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["lib/**/*.ts"],
      exclude: [
        "lib/**/*.d.ts",
        "test/**",
        "bin/**",
        "cdk.out*/**",
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
