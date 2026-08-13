import { createHash } from "node:crypto";
import path from "node:path";

export const GRAPHIFY_METADATA_SCHEMA_VERSION = 1;
export const MAX_QUERY_BUDGET = 32_000;
// 3/4 representative repository queries completed at this smallest calibrated budget.
export const DEFAULT_QUERY_BUDGET = 12_000;

const SUPPORTED_CODE_EXTENSIONS = new Set([
  ".bash",
  ".cjs",
  ".cts",
  ".hcl",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".rake",
  ".rb",
  ".sh",
  ".tf",
  ".tfvars",
  ".ts",
  ".tsx",
]);

export type SourceState = "present" | "missing";

export interface SourceDigestEntry {
  relativePath: string;
  state: SourceState;
  content?: Uint8Array;
}

export interface GraphSummary {
  nodeCount: number;
  edgeCount: number;
}

export interface GraphifyMetadata {
  schemaVersion: number;
  repositoryId: string;
  canonicalRepositoryRoot: string;
  sourceDigest: string;
  sourceFileCount: number;
  ignoreDigest: string;
  graphifyVersion: string;
  status: "building" | "success" | "failed";
  graphSha256?: string;
  nodeCount?: number;
  edgeCount?: number;
  startedAt: string;
  completedAt?: string;
  buildDurationMs?: number;
  failure?: string;
}

export interface FreshnessInput {
  metadata: GraphifyMetadata | null;
  repositoryId: string;
  canonicalRepositoryRoot: string;
  sourceDigest: string;
  ignoreDigest: string;
  graphifyVersion: string;
  graphExists: boolean;
  graphSha256: string | null;
}

export interface QueryOptions {
  seed: string;
  mode: "bfs" | "dfs";
  budget: number;
}

export interface QueryWarnings {
  truncated: boolean;
  missing: boolean;
  inferredCount: number;
  ambiguousCount: number;
}

function updateLengthPrefixed(hash: ReturnType<typeof createHash>, value: Uint8Array): void {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(value.byteLength));
  hash.update(length);
  hash.update(value);
}

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function deriveRepositoryId(canonicalRepositoryRoot: string): string {
  return sha256(canonicalRepositoryRoot);
}

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll(path.sep, "/").replace(/^\.\//, "");
}

export function isSupportedCodePath(relativePath: string): boolean {
  return SUPPORTED_CODE_EXTENSIONS.has(path.posix.extname(normalizeRelativePath(relativePath)));
}

export function computeSourceDigest(entries: readonly SourceDigestEntry[]): string {
  const hash = createHash("sha256");
  hash.update("brimax-life-graphify-source-v1\0");

  const sortedEntries = [...entries].sort((left, right) =>
    normalizeRelativePath(left.relativePath).localeCompare(normalizeRelativePath(right.relativePath)),
  );

  for (const entry of sortedEntries) {
    const normalizedPath = Buffer.from(normalizeRelativePath(entry.relativePath), "utf8");
    updateLengthPrefixed(hash, normalizedPath);
    hash.update(entry.state === "present" ? "P" : "M");
    updateLengthPrefixed(hash, entry.state === "present" ? (entry.content ?? new Uint8Array()) : new Uint8Array());
  }

  return hash.digest("hex");
}

function globToRegex(pattern: string): string {
  let result = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        result += ".*";
        index += 1;
      } else {
        result += "[^/]*";
      }
    } else if (character === "?") {
      result += "[^/]";
    } else {
      result += character?.replace(/[|\\{}()[\]^$+?.]/g, "\\$&") ?? "";
    }
  }
  return result;
}

function patternMatches(relativePath: string, rawPattern: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath).replace(/^\//, "");
  const directoryOnly = rawPattern.endsWith("/");
  const anchored = rawPattern.startsWith("/");
  const pattern = rawPattern.replace(/^\//, "").replace(/\/$/, "");
  const hasSlash = pattern.includes("/");
  const body = globToRegex(pattern);
  const prefix = anchored || hasSlash ? "^" : "(?:^|/)";
  const suffix = directoryOnly ? "(?:/.*)?$" : "$";
  return new RegExp(`${prefix}${body}${suffix}`).test(normalizedPath);
}

export function isGraphifyIgnored(relativePath: string, ignoreFile: string): boolean {
  let ignored = false;
  for (const rawLine of ignoreFile.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const negated = line.startsWith("!");
    const pattern = negated ? line.slice(1) : line;
    if (pattern && patternMatches(relativePath, pattern)) {
      ignored = !negated;
    }
  }
  return ignored;
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function parseGraphSummary(graphText: string): GraphSummary {
  const parsed: unknown = JSON.parse(graphText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Graph JSON must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  const nodes = record.nodes;
  const edges = record.links ?? record.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new Error("Graph JSON must contain node and edge arrays.");
  }
  return { nodeCount: nodes.length, edgeCount: edges.length };
}

export function staleReasons(input: FreshnessInput): string[] {
  const reasons: string[] = [];
  const metadata = input.metadata;
  if (!metadata) {
    return ["metadata is missing or invalid"];
  }
  if (metadata.schemaVersion !== GRAPHIFY_METADATA_SCHEMA_VERSION) reasons.push("metadata schema changed");
  if (metadata.status !== "success") reasons.push("previous build was not successful");
  if (metadata.repositoryId !== input.repositoryId) reasons.push("repository identity changed");
  if (metadata.canonicalRepositoryRoot !== input.canonicalRepositoryRoot) reasons.push("repository root changed");
  if (metadata.sourceDigest !== input.sourceDigest) reasons.push("supported source changed");
  if (metadata.ignoreDigest !== input.ignoreDigest) reasons.push(".graphifyignore changed");
  if (metadata.graphifyVersion !== input.graphifyVersion) reasons.push("Graphify version changed");
  if (!input.graphExists) reasons.push("graph is missing");
  if (!metadata.graphSha256 || !input.graphSha256 || metadata.graphSha256 !== input.graphSha256) {
    reasons.push("graph hash validation failed");
  }
  return reasons;
}

export function buildExtractArguments(repositoryRoot: string, outputRoot: string): string[] {
  return ["extract", repositoryRoot, "--force", "--no-cluster", "--code-only", "--out", outputRoot];
}

export function buildQueryArguments(options: QueryOptions, graphPath: string): string[] {
  const args = ["query", options.seed];
  if (options.mode === "dfs") args.push("--dfs");
  args.push("--budget", String(options.budget), "--graph", graphPath);
  return args;
}

export function parseQueryArguments(rawArguments: readonly string[]): QueryOptions {
  const args = rawArguments[0] === "--" ? rawArguments.slice(1) : [...rawArguments];
  const seed = args.shift();
  if (!seed || seed.startsWith("--")) {
    throw new Error("A non-empty query seed is required.");
  }

  let mode: QueryOptions["mode"] = "bfs";
  let budget = DEFAULT_QUERY_BUDGET;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--mode" && argument !== "--budget") {
      throw new Error(`Unknown query argument: ${argument}`);
    }
    if (seen.has(argument)) throw new Error(`Duplicate query argument: ${argument}`);
    seen.add(argument);
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}.`);
    index += 1;
    if (argument === "--mode") {
      if (value !== "bfs" && value !== "dfs") throw new Error("--mode must be bfs or dfs.");
      mode = value;
    } else {
      if (!/^\d+$/u.test(value)) throw new Error("--budget must be a positive integer.");
      budget = Number(value);
      if (budget < 1 || budget > MAX_QUERY_BUDGET) {
        throw new Error(`--budget must be between 1 and ${MAX_QUERY_BUDGET}.`);
      }
    }
  }

  return { seed, mode, budget };
}

export function analyzeQueryOutput(output: string): QueryWarnings {
  return {
    truncated: /\bTRUNCATED\b|\.\.\. \(truncated\b/iu.test(output),
    missing: /No matching nodes found\./iu.test(output),
    inferredCount: (output.match(/\bINFERRED\b/gu) ?? []).length,
    ambiguousCount: (output.match(/\bAMBIGUOUS\b/gu) ?? []).length,
  };
}
