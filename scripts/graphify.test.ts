import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_QUERY_BUDGET,
  MAX_QUERY_BUDGET,
  analyzeQueryOutput,
  buildExtractArguments,
  computeSourceDigest,
  deriveRepositoryId,
  isGraphifyIgnored,
  parseQueryArguments,
  sha256,
  staleReasons,
  type GraphifyMetadata,
  type SourceDigestEntry,
} from "./lib/graphify-context.ts";
import {
  GraphifyRuntime,
  resolveGraphifyPaths,
  type ProcessResult,
  type ProcessRunner,
} from "./lib/graphify-runtime.ts";

const REQUIRED_HELP = ["--code-only", "--no-cluster", "--out DIR", "--budget N", "--graph <path>", "--dfs"].join(
  "\n",
);

interface Fixture {
  root: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}

class MockRunner implements ProcessRunner {
  readonly calls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
  version = "0.9.40";
  extractStatus = 0;
  queryOutput = "Traversal: BFS depth=2 | 1 nodes found\n\nNODE example [src=src/example.ts loc=L1 community=]";

  run(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ProcessResult {
    this.calls.push({ command, args: [...args], env: { ...options.env } });
    if (command === "git") return { status: 0, stdout: "src/example.ts\0", stderr: "" };
    if (args[0] === "--version") return { status: 0, stdout: `graphify ${this.version}\n`, stderr: "" };
    if (args[0] === "--help") return { status: 0, stdout: REQUIRED_HELP, stderr: "" };
    if (args[0] === "extract") {
      if (this.extractStatus !== 0) return { status: this.extractStatus, stdout: "", stderr: "mock extraction failed" };
      const outputRoot = args.at(-1);
      assert.ok(outputRoot);
      const graphDirectory = path.join(outputRoot, "graphify-out");
      mkdirSync(graphDirectory, { recursive: true });
      writeFileSync(
        path.join(graphDirectory, "graph.json"),
        JSON.stringify({ nodes: [{ id: "example", label: "example" }], links: [] }),
      );
      return { status: 0, stdout: "mock extraction complete\n", stderr: "" };
    }
    if (args[0] === "query") return { status: 0, stdout: `${this.queryOutput}\n`, stderr: "" };
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  }
}

function withFixture(run: (fixture: Fixture) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), "brimax-graphify-test-"));
  const repositoryRoot = path.join(root, "repository");
  mkdirSync(path.join(repositoryRoot, "src"), { recursive: true });
  writeFileSync(path.join(repositoryRoot, "package.json"), JSON.stringify({ name: "brimax-life" }));
  writeFileSync(path.join(repositoryRoot, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(path.join(repositoryRoot, ".graphifyignore"), "node_modules/\ndist/\n");
  writeFileSync(path.join(repositoryRoot, "src", "example.ts"), "export const example = true;\n");
  const environment: NodeJS.ProcessEnv = {
    HOME: path.join(root, "home"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    PATH: path.join(root, "bin"),
    OPENAI_API_KEY: "must-not-reach-child",
    AWS_PROFILE: "must-not-reach-child",
  };
  mkdirSync(environment.HOME!, { recursive: true });
  mkdirSync(environment.PATH!, { recursive: true });
  return Promise.resolve()
    .then(() => run({ root, repositoryRoot, environment }))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}

function entry(relativePath: string, content: string, state: SourceDigestEntry["state"] = "present"): SourceDigestEntry {
  return { relativePath, state, content: state === "present" ? Buffer.from(content) : undefined };
}

function successfulMetadata(overrides: Partial<GraphifyMetadata> = {}): GraphifyMetadata {
  return {
    schemaVersion: 1,
    repositoryId: "repo-id",
    canonicalRepositoryRoot: "/repo",
    sourceDigest: "source",
    sourceFileCount: 1,
    ignoreDigest: "ignore",
    graphifyVersion: "0.9.40",
    status: "success",
    graphSha256: "graph",
    nodeCount: 1,
    edgeCount: 0,
    startedAt: "2026-08-11T00:00:00.000Z",
    completedAt: "2026-08-11T00:00:01.000Z",
    buildDurationMs: 1_000,
    ...overrides,
  };
}

test("source digest is deterministic regardless of traversal order", () => {
  const first = [entry("b.ts", "b"), entry("a.ts", "a")];
  const second = [...first].reverse();
  assert.equal(computeSourceDigest(first), computeSourceDigest(second));
});

test("source additions, modifications, and deletions change the digest", () => {
  const baseline = computeSourceDigest([entry("a.ts", "a")]);
  assert.notEqual(computeSourceDigest([entry("a.ts", "a"), entry("b.ts", "b")]), baseline);
  assert.notEqual(computeSourceDigest([entry("a.ts", "changed")]), baseline);
  assert.notEqual(computeSourceDigest([entry("a.ts", "", "missing")]), baseline);
  assert.notEqual(computeSourceDigest([]), baseline);
});

test("ignore content changes have a distinct digest and expected matching semantics", () => {
  assert.notEqual(sha256("dist/\n"), sha256("dist/\ncoverage/\n"));
  assert.equal(isGraphifyIgnored("packages/x/dist/file.ts", "dist/\n"), true);
  assert.equal(isGraphifyIgnored("docs/architecture/overview.md", "docs/experimentation/\n"), false);
});

test("freshness rejects missing state, version changes, and graph hash mismatch", () => {
  const baseline = {
    metadata: successfulMetadata(),
    repositoryId: "repo-id",
    canonicalRepositoryRoot: "/repo",
    sourceDigest: "source",
    ignoreDigest: "ignore",
    graphifyVersion: "0.9.40",
    graphExists: true,
    graphSha256: "graph",
  };
  assert.deepEqual(staleReasons(baseline), []);
  assert.match(staleReasons({ ...baseline, metadata: null }).join(" "), /metadata/u);
  assert.match(staleReasons({ ...baseline, graphifyVersion: "0.9.41" }).join(" "), /version/u);
  assert.match(staleReasons({ ...baseline, ignoreDigest: "changed-ignore" }).join(" "), /graphifyignore/u);
  assert.match(staleReasons({ ...baseline, graphSha256: "tampered" }).join(" "), /hash/u);
  assert.match(staleReasons({ ...baseline, graphExists: false, graphSha256: null }).join(" "), /missing/u);
});

test("repository identity and cache paths are stable, clone-specific, and external", () =>
  withFixture(({ repositoryRoot, environment }) => {
    const paths = resolveGraphifyPaths(repositoryRoot, environment);
    assert.equal(paths.repositoryId, deriveRepositoryId(paths.repositoryRoot));
    assert.equal(paths.repositoryId, resolveGraphifyPaths(repositoryRoot, environment).repositoryId);
    assert.equal(paths.cacheRoot.startsWith(repositoryRoot), false);
    assert.equal(paths.graphPath.startsWith(repositoryRoot), false);
    assert.throws(
      () => resolveGraphifyPaths(repositoryRoot, { ...environment, XDG_CACHE_HOME: path.join(repositoryRoot, ".cache") }),
      /outside the repository/u,
    );
  }));

test("extract arguments are local code-only and contain no model or clustering request", () => {
  const args = buildExtractArguments("/repo", "/cache/build");
  assert.deepEqual(args, ["extract", "/repo", "--force", "--no-cluster", "--code-only", "--out", "/cache/build"]);
  assert.equal(args.some((argument) => /backend|model|cluster-only|dedup/u.test(argument)), false);
});

test("successful builds atomically promote graph and metadata outside the repository", () =>
  withFixture(({ repositoryRoot, environment }) => {
    const runner = new MockRunner();
    const runtime = new GraphifyRuntime({ repositoryRoot, environment, runner });
    const metadata = runtime.build();
    assert.equal(metadata.status, "success");
    assert.equal(metadata.nodeCount, 1);
    assert.equal(existsSync(runtime.paths.graphPath), true);
    assert.equal(existsSync(runtime.paths.currentMetadataPath), true);
    assert.equal(existsSync(path.join(repositoryRoot, "graphify-out")), false);
    assert.equal(
      readdirSync(runtime.paths.cacheRoot).some((name) => /^(build-|promote-|current\.invalid-)/u.test(name)),
      false,
    );
    const extractCall = runner.calls.find((call) => call.args[0] === "extract");
    assert.ok(extractCall);
    assert.equal(extractCall.env.OPENAI_API_KEY, undefined);
    assert.equal(extractCall.env.AWS_PROFILE, undefined);
  }));

test("failed builds invalidate a prior graph and retain only failed diagnostic metadata", () =>
  withFixture(({ repositoryRoot, environment }) => {
    const runner = new MockRunner();
    const runtime = new GraphifyRuntime({ repositoryRoot, environment, runner });
    runtime.build();
    assert.equal(existsSync(runtime.paths.graphPath), true);
    runner.extractStatus = 1;
    assert.throws(() => runtime.build(), /mock extraction failed/u);
    assert.equal(existsSync(runtime.paths.graphPath), false);
    assert.equal(existsSync(runtime.paths.currentDirectory), false);
    const diagnostic = JSON.parse(readFileSync(runtime.paths.stateMetadataPath, "utf8")) as GraphifyMetadata;
    assert.equal(diagnostic.status, "failed");
  }));

test("query-before-build performs exactly one rebuild and does not expand its budget", () =>
  withFixture(({ repositoryRoot, environment }) => {
    const runner = new MockRunner();
    const runtime = new GraphifyRuntime({ repositoryRoot, environment, runner });
    const result = runtime.query({ seed: "example", mode: "bfs", budget: 4_000 });
    assert.equal(result.rebuilt, true);
    assert.match(result.output, /EXPERIMENTAL DISCOVERY/u);
    assert.equal(runner.calls.filter((call) => call.args[0] === "extract").length, 1);
    const queryCalls = runner.calls.filter((call) => call.args[0] === "query");
    assert.equal(queryCalls.length, 1);
    assert.equal(queryCalls[0]?.args.filter((argument) => argument === "--budget").length, 1);
    assert.ok(queryCalls[0]?.args.includes("4000"));
  }));

test("query defaults and validation enforce BFS, calibrated budget, and 32k maximum", () => {
  assert.deepEqual(parseQueryArguments(["seed"]), { seed: "seed", mode: "bfs", budget: DEFAULT_QUERY_BUDGET });
  assert.deepEqual(parseQueryArguments(["seed", "--mode", "dfs", "--budget", "32000"]), {
    seed: "seed",
    mode: "dfs",
    budget: MAX_QUERY_BUDGET,
  });
  assert.throws(() => parseQueryArguments(["seed", "--mode", "wide"]), /bfs or dfs/u);
  assert.throws(() => parseQueryArguments(["seed", "--budget", "0"]), /between/u);
  assert.throws(() => parseQueryArguments(["seed", "--budget", "32001"]), /between/u);
  assert.throws(() => parseQueryArguments(["seed", "--budget", "unbounded"]), /positive integer/u);
});

test("query warning analysis detects truncation, missing, inferred, and ambiguous results", () => {
  assert.deepEqual(analyzeQueryOutput("[!] TRUNCATED\nEDGE a [INFERRED]\nEDGE b [AMBIGUOUS]"), {
    truncated: true,
    missing: false,
    inferredCount: 1,
    ambiguousCount: 1,
  });
  assert.equal(analyzeQueryOutput("No matching nodes found.").missing, true);
});

test("doctor rejects a runnable graphify-mcp shim", () =>
  withFixture(({ root, repositoryRoot, environment }) => {
    const shim = path.join(root, "bin", "graphify-mcp");
    writeFileSync(shim, "#!/bin/sh\nexit 0\n");
    chmodSync(shim, 0o755);
    const runtime = new GraphifyRuntime({ repositoryRoot, environment, runner: new MockRunner() });
    assert.throws(() => runtime.doctor(), /graphify-mcp is executable/u);
  }));

test("doctor rejects an active Graphify MCP registration", () =>
  withFixture(({ repositoryRoot, environment }) => {
    const configDirectory = path.join(environment.HOME!, ".codex");
    mkdirSync(configDirectory, { recursive: true });
    writeFileSync(path.join(configDirectory, "config.toml"), "[mcp_servers.graphify]\ncommand = 'graphify-mcp'\n");
    const runtime = new GraphifyRuntime({ repositoryRoot, environment, runner: new MockRunner() });
    assert.throws(() => runtime.doctor(), /active Graphify MCP registration/u);
  }));
