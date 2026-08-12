import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  GRAPHIFY_METADATA_SCHEMA_VERSION,
  analyzeQueryOutput,
  buildExtractArguments,
  buildQueryArguments,
  computeSourceDigest,
  deriveRepositoryId,
  isGraphifyIgnored,
  isPathInside,
  isSupportedCodePath,
  parseGraphSummary,
  sha256,
  staleReasons,
  type GraphifyMetadata,
  type QueryOptions,
  type SourceDigestEntry,
} from "./graphify-context.ts";

const GRAPHIFY_IGNORE = ".graphifyignore";
const GRAPHIFY_COMMAND = "graphify";
const MODEL_ENVIRONMENT_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MOONSHOT_API_KEY",
  "OLLAMA_BASE_URL",
  "OLLAMA_HOST",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
] as const;

const REQUIRED_IGNORED_PATHS = [
  "node_modules/a.ts",
  "dist/a.ts",
  "cdk.out/a.json",
  "infra/opentofu/x/.terraform/state",
  "infra/opentofu/x/terraform.tfstate.backup",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "benchmarks/graphify-context/pilot-audit.json",
  "docs/prompts/tooling/prompt.md",
  "docs/experimentation/note.md",
  "install-opentofu.sh",
  "apps/api/AGENTS.md",
  ".codex/config.toml",
  ".mcp.json",
] as const;

export interface ProcessResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ProcessResult;
}

export interface GraphifyPaths {
  repositoryRoot: string;
  repositoryId: string;
  cacheRoot: string;
  stateMetadataPath: string;
  currentDirectory: string;
  graphPath: string;
  currentMetadataPath: string;
  ignorePath: string;
}

export interface GraphifyRuntimeOptions {
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  now?: () => Date;
}

interface SourceSnapshot {
  entries: SourceDigestEntry[];
  digest: string;
  ignoreDigest: string;
  sourceFileCount: number;
}

interface CurrentState {
  snapshot: SourceSnapshot;
  version: string;
  metadata: GraphifyMetadata | null;
  graphSha256: string | null;
  reasons: string[];
}

const defaultRunner: ProcessRunner = {
  run(command, args, options) {
    const result = spawnSync(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  },
};

function canonicalizeExistingDirectory(directory: string): string {
  const canonical = realpathSync(directory);
  if (!statSync(canonical).isDirectory()) throw new Error(`Not a directory: ${directory}`);
  return canonical;
}

function canonicalizeProspectivePath(targetPath: string): string {
  let existingAncestor = path.resolve(targetPath);
  const missingSegments: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error(`Unable to resolve cache path: ${targetPath}`);
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  return path.join(realpathSync(existingAncestor), ...missingSegments);
}

export function resolveGraphifyPaths(repositoryRoot: string, environment: NodeJS.ProcessEnv): GraphifyPaths {
  const canonicalRoot = canonicalizeExistingDirectory(repositoryRoot);
  const packageJsonPath = path.join(canonicalRoot, "package.json");
  const workspacePath = path.join(canonicalRoot, "pnpm-workspace.yaml");
  if (!existsSync(packageJsonPath) || !existsSync(workspacePath)) {
    throw new Error("Unable to validate the brimax-life pnpm workspace root.");
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
  if (packageJson.name !== "brimax-life") throw new Error("Repository package identity is not brimax-life.");

  const baseCache = environment.XDG_CACHE_HOME || (environment.HOME ? path.join(environment.HOME, ".cache") : "");
  if (!baseCache || !path.isAbsolute(baseCache)) {
    throw new Error("XDG_CACHE_HOME or HOME must resolve to an absolute cache location.");
  }
  const repositoryId = deriveRepositoryId(canonicalRoot);
  const cacheRoot = canonicalizeProspectivePath(path.join(baseCache, "brimax-life-graphify", repositoryId));
  if (isPathInside(canonicalRoot, cacheRoot)) {
    throw new Error("Graphify cache must be outside the repository.");
  }
  const currentDirectory = path.join(cacheRoot, "current");
  return {
    repositoryRoot: canonicalRoot,
    repositoryId,
    cacheRoot,
    stateMetadataPath: path.join(cacheRoot, "metadata.json"),
    currentDirectory,
    graphPath: path.join(currentDirectory, "graph.json"),
    currentMetadataPath: path.join(currentDirectory, "metadata.json"),
    ignorePath: path.join(canonicalRoot, GRAPHIFY_IGNORE),
  };
}

function sanitizedEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...environment };
  for (const name of MODEL_ENVIRONMENT_VARIABLES) delete result[name];
  delete result.AWS_ACCESS_KEY_ID;
  delete result.AWS_SECRET_ACCESS_KEY;
  delete result.AWS_SESSION_TOKEN;
  delete result.AWS_PROFILE;
  return result;
}

function parseVersion(output: string): string {
  const match = output.match(/\bgraphify\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/iu);
  if (!match?.[1]) throw new Error("Unable to parse Graphify version.");
  return match[1];
}

function readMetadata(metadataPath: string): GraphifyMetadata | null {
  if (!existsSync(metadataPath)) return null;
  try {
    return JSON.parse(readFileSync(metadataPath, "utf8")) as GraphifyMetadata;
  } catch {
    return null;
  }
}

function writeJsonAtomically(targetPath: string, value: unknown): void {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, targetPath);
}

function sanitizeFailure(message: string, paths: GraphifyPaths, environment: NodeJS.ProcessEnv): string {
  let sanitized = message.replaceAll(paths.repositoryRoot, "<repository>");
  if (environment.HOME) sanitized = sanitized.replaceAll(environment.HOME, "<home>");
  return sanitized.slice(0, 2_000);
}

function graphifyVersion(paths: GraphifyPaths, environment: NodeJS.ProcessEnv, runner: ProcessRunner): string {
  const result = runner.run(GRAPHIFY_COMMAND, ["--version"], {
    cwd: paths.repositoryRoot,
    env: sanitizedEnvironment(environment),
  });
  if (result.status !== 0) throw new Error(`graphify --version failed: ${result.stderr.trim()}`);
  return parseVersion(result.stdout || result.stderr);
}

function collectSnapshot(paths: GraphifyPaths, environment: NodeJS.ProcessEnv, runner: ProcessRunner): SourceSnapshot {
  const ignoreFile = readFileSync(paths.ignorePath, "utf8");
  const listResult = runner.run("git", ["-C", paths.repositoryRoot, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: paths.repositoryRoot,
    env: environment,
  });
  if (listResult.status !== 0) throw new Error(`Unable to enumerate repository sources: ${listResult.stderr.trim()}`);
  const relativePaths = [...new Set(listResult.stdout.split("\0").filter(Boolean))]
    .filter((relativePath) => isSupportedCodePath(relativePath))
    .filter((relativePath) => !isGraphifyIgnored(relativePath, ignoreFile));
  const entries = relativePaths.map<SourceDigestEntry>((relativePath) => {
    const absolutePath = path.resolve(paths.repositoryRoot, relativePath);
    if (!isPathInside(paths.repositoryRoot, absolutePath)) throw new Error(`Unsafe repository path: ${relativePath}`);
    try {
      return { relativePath, state: "present", content: readFileSync(absolutePath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { relativePath, state: "missing" };
      throw error;
    }
  });
  return {
    entries,
    digest: computeSourceDigest(entries),
    ignoreDigest: sha256(ignoreFile),
    sourceFileCount: entries.length,
  };
}

function readCurrentState(paths: GraphifyPaths, environment: NodeJS.ProcessEnv, runner: ProcessRunner): CurrentState {
  const snapshot = collectSnapshot(paths, environment, runner);
  const version = graphifyVersion(paths, environment, runner);
  const metadata = readMetadata(paths.currentMetadataPath);
  const graphSha256 = existsSync(paths.graphPath) ? sha256(readFileSync(paths.graphPath)) : null;
  const reasons = staleReasons({
    metadata,
    repositoryId: paths.repositoryId,
    canonicalRepositoryRoot: paths.repositoryRoot,
    sourceDigest: snapshot.digest,
    ignoreDigest: snapshot.ignoreDigest,
    graphifyVersion: version,
    graphExists: existsSync(paths.graphPath),
    graphSha256,
  });
  return { snapshot, version, metadata, graphSha256, reasons };
}

function executableCandidates(name: string, paths: GraphifyPaths, environment: NodeJS.ProcessEnv): string[] {
  const directories = new Set((environment.PATH ?? "").split(path.delimiter).filter(Boolean));
  if (environment.HOME) {
    directories.add(path.join(environment.HOME, ".local", "bin"));
    directories.add(path.join(environment.HOME, "bin"));
  }
  try {
    const graphifyPath = [...directories]
      .map((directory) => path.join(directory, GRAPHIFY_COMMAND))
      .find((candidate) => existsSync(candidate));
    if (graphifyPath) directories.add(path.dirname(realpathSync(graphifyPath)));
  } catch {
    // The explicit version check reports an unusable Graphify executable.
  }
  return [...directories].map((directory) => path.join(directory, name)).filter((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function registrationCandidates(paths: GraphifyPaths, environment: NodeJS.ProcessEnv): string[] {
  const candidates = [
    path.join(paths.repositoryRoot, ".mcp.json"),
    path.join(paths.repositoryRoot, ".codex", "config.toml"),
    path.join(paths.repositoryRoot, ".cursor", "mcp.json"),
  ];
  if (environment.HOME) {
    candidates.push(
      path.join(environment.HOME, ".codex", "config.toml"),
      path.join(environment.HOME, ".claude.json"),
      path.join(environment.HOME, ".cursor", "mcp.json"),
      path.join(environment.HOME, ".config", "Claude", "claude_desktop_config.json"),
      path.join(environment.HOME, ".config", "claude", "claude_desktop_config.json"),
      path.join(environment.HOME, ".config", "opencode", "opencode.json"),
    );
  }
  return candidates;
}

export function findActiveGraphifyMcpRegistrations(paths: GraphifyPaths, environment: NodeJS.ProcessEnv): string[] {
  return registrationCandidates(paths, environment).filter((candidate) => {
    if (!existsSync(candidate)) return false;
    const content = readFileSync(candidate, "utf8");
    return /graphify-mcp|graphifyy\s*\[\s*mcp\s*\]|(?:mcpServers|mcp_servers)[\s\S]*graphify/iu.test(content);
  });
}

function assertMcpBoundary(paths: GraphifyPaths, environment: NodeJS.ProcessEnv): void {
  const shims = executableCandidates("graphify-mcp", paths, environment);
  if (shims.length > 0) throw new Error(`Refusing to run while graphify-mcp is executable: ${shims.join(", ")}`);
  const registrations = findActiveGraphifyMcpRegistrations(paths, environment);
  if (registrations.length > 0) throw new Error(`Refusing to run with an active Graphify MCP registration: ${registrations.join(", ")}`);
}

export class GraphifyRuntime {
  readonly paths: GraphifyPaths;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly runner: ProcessRunner;
  private readonly now: () => Date;

  constructor(options: GraphifyRuntimeOptions) {
    this.environment = options.environment ?? process.env;
    this.paths = resolveGraphifyPaths(options.repositoryRoot, this.environment);
    this.runner = options.runner ?? defaultRunner;
    this.now = options.now ?? (() => new Date());
  }

  doctor(): string[] {
    assertMcpBoundary(this.paths, this.environment);
    const version = graphifyVersion(this.paths, this.environment, this.runner);
    const helpResult = this.runner.run(GRAPHIFY_COMMAND, ["--help"], {
      cwd: this.paths.repositoryRoot,
      env: sanitizedEnvironment(this.environment),
    });
    if (helpResult.status !== 0) throw new Error("graphify --help failed.");
    for (const capability of ["--code-only", "--no-cluster", "--out DIR", "--budget N", "--graph <path>", "--dfs"]) {
      if (!helpResult.stdout.includes(capability)) throw new Error(`Installed Graphify lacks required capability: ${capability}`);
    }
    const ignoreFile = readFileSync(this.paths.ignorePath, "utf8");
    for (const requiredPath of REQUIRED_IGNORED_PATHS) {
      if (!isGraphifyIgnored(requiredPath, ignoreFile)) throw new Error(`.graphifyignore does not exclude ${requiredPath}`);
    }
    if (ignoreFile.includes(".serena")) throw new Error(".graphifyignore must not reference removed Serena tooling.");
    if (isGraphifyIgnored("docs/architecture/overview.md", ignoreFile)) {
      throw new Error(".graphifyignore must not exclude ordinary documentation.");
    }
    mkdirSync(this.paths.cacheRoot, { recursive: true });
    const probe = path.join(this.paths.cacheRoot, `.doctor-${randomUUID()}`);
    writeFileSync(probe, "ok", { encoding: "utf8", mode: 0o600 });
    unlinkSync(probe);
    return [
      `Graphify ${version}`,
      `Repository ${this.paths.repositoryId}`,
      `External cache ${this.paths.cacheRoot}`,
      "MCP boundary satisfied",
      "Code-only extraction capabilities satisfied",
    ];
  }

  build(): GraphifyMetadata {
    assertMcpBoundary(this.paths, this.environment);
    mkdirSync(this.paths.cacheRoot, { recursive: true });
    const snapshot = collectSnapshot(this.paths, this.environment, this.runner);
    const version = graphifyVersion(this.paths, this.environment, this.runner);
    const startedAt = this.now();
    const baseMetadata: GraphifyMetadata = {
      schemaVersion: GRAPHIFY_METADATA_SCHEMA_VERSION,
      repositoryId: this.paths.repositoryId,
      canonicalRepositoryRoot: this.paths.repositoryRoot,
      sourceDigest: snapshot.digest,
      sourceFileCount: snapshot.sourceFileCount,
      ignoreDigest: snapshot.ignoreDigest,
      graphifyVersion: version,
      status: "building",
      startedAt: startedAt.toISOString(),
    };
    writeJsonAtomically(this.paths.stateMetadataPath, baseMetadata);

    const invalidatedDirectory = `${this.paths.currentDirectory}.invalid-${randomUUID()}`;
    const promotionDirectory = path.join(this.paths.cacheRoot, `promote-${randomUUID()}`);
    let temporaryRoot: string | null = null;

    try {
      if (existsSync(this.paths.currentDirectory)) renameSync(this.paths.currentDirectory, invalidatedDirectory);
      temporaryRoot = mkdtempSync(path.join(this.paths.cacheRoot, "build-"));
      const result = this.runner.run(GRAPHIFY_COMMAND, buildExtractArguments(this.paths.repositoryRoot, temporaryRoot), {
        cwd: this.paths.repositoryRoot,
        env: sanitizedEnvironment(this.environment),
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.status !== 0) throw new Error(`Graphify extraction exited ${result.status}: ${result.stderr.trim()}`);

      const producedGraph = path.join(temporaryRoot, "graphify-out", "graph.json");
      if (!existsSync(producedGraph)) throw new Error("Graphify completed without producing graph.json.");
      const graphBytes = readFileSync(producedGraph);
      const summary = parseGraphSummary(graphBytes.toString("utf8"));
      const completedAt = this.now();
      const successfulMetadata: GraphifyMetadata = {
        ...baseMetadata,
        status: "success",
        graphSha256: sha256(graphBytes),
        nodeCount: summary.nodeCount,
        edgeCount: summary.edgeCount,
        completedAt: completedAt.toISOString(),
        buildDurationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      };
      mkdirSync(promotionDirectory, { recursive: false, mode: 0o700 });
      writeFileSync(path.join(promotionDirectory, "graph.json"), graphBytes, { mode: 0o600 });
      writeFileSync(path.join(promotionDirectory, "metadata.json"), `${JSON.stringify(successfulMetadata, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(promotionDirectory, this.paths.currentDirectory);
      writeJsonAtomically(this.paths.stateMetadataPath, successfulMetadata);
      rmSync(invalidatedDirectory, { recursive: true, force: true });
      rmSync(temporaryRoot, { recursive: true, force: true });
      return successfulMetadata;
    } catch (error) {
      rmSync(this.paths.currentDirectory, { recursive: true, force: true });
      rmSync(promotionDirectory, { recursive: true, force: true });
      if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
      rmSync(invalidatedDirectory, { recursive: true, force: true });
      const failedAt = this.now();
      const failure = sanitizeFailure(error instanceof Error ? error.message : String(error), this.paths, this.environment);
      const failedMetadata: GraphifyMetadata = {
        ...baseMetadata,
        status: "failed",
        completedAt: failedAt.toISOString(),
        buildDurationMs: Math.max(0, failedAt.getTime() - startedAt.getTime()),
        failure,
      };
      writeJsonAtomically(this.paths.stateMetadataPath, failedMetadata);
      throw new Error(failure);
    }
  }

  freshness(): CurrentState {
    assertMcpBoundary(this.paths, this.environment);
    return readCurrentState(this.paths, this.environment, this.runner);
  }

  query(options: QueryOptions): { output: string; rebuilt: boolean } {
    assertMcpBoundary(this.paths, this.environment);
    const state = readCurrentState(this.paths, this.environment, this.runner);
    const rebuilt = state.reasons.length > 0;
    if (rebuilt) {
      process.stderr.write(`Graphify graph is stale (${state.reasons.join("; ")}); rebuilding once.\n`);
      this.build();
    }
    if (!existsSync(this.paths.graphPath)) throw new Error("No current graph is available after the build.");

    const result = this.runner.run(GRAPHIFY_COMMAND, buildQueryArguments(options, this.paths.graphPath), {
      cwd: this.paths.repositoryRoot,
      env: sanitizedEnvironment(this.environment),
    });
    if (result.status !== 0) throw new Error(`Graphify query exited ${result.status}: ${result.stderr.trim()}`);
    const output = result.stdout.trimEnd();
    const warnings = analyzeQueryOutput(output);
    const warningLines = ["EXPERIMENTAL DISCOVERY: verify every result against native source before acting."];
    if (warnings.truncated) {
      warningLines.push("WARNING: This is a useful partial graph walk, but truncation means it still requires native confirmation.");
    }
    if (warnings.missing) warningLines.push("WARNING: No graph match is not proof of absence; verify with native source search.");
    if (warnings.inferredCount > 0) {
      warningLines.push(`WARNING: ${warnings.inferredCount} INFERRED relationship(s) require native source verification.`);
    }
    if (warnings.ambiguousCount > 0) {
      warningLines.push(`WARNING: ${warnings.ambiguousCount} AMBIGUOUS relationship(s) require native source verification.`);
    }
    return { output: `${warningLines.join("\n")}\n\n${output}`, rebuilt };
  }
}

export function defaultRepositoryRoot(moduleUrl: string): string {
  const modulePath = fileURLToPath(moduleUrl);
  return path.resolve(path.dirname(modulePath), "..");
}
