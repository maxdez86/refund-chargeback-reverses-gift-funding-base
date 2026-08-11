import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface Pricing {
  unitTokens: number;
  input: number;
  cachedInput: number;
  cacheWriteInput: number;
  output: number;
  longContextThreshold: number;
  longContextInputMultiplier: number;
  longContextOutputMultiplier: number;
}

export interface CostResult {
  ordinaryUncachedInputTokens: number;
  baseUsd: number;
  conservativeLongContextUsd: number;
  longContextSensitivityApplied: boolean;
}

export interface RunMetadata {
  arm: string;
  task: string;
  repeat: number;
  elapsedSeconds: number;
  exitStatus: number;
  expected?: Record<string, string>;
  actual?: Record<string, string>;
  sourceModified?: boolean;
  forbiddenPaths?: string[];
}

export interface RunSummary extends Usage, CostResult {
  arm: string;
  task: string;
  repeat: number;
  elapsedSeconds: number;
  totalTokens: number;
  mcpCalls: number;
  commandCalls: number;
  graphifyCalls: number;
  sourceVerificationCalls: number;
  wholeFileReads: number;
  retries: number;
  errors: number;
  malformedEventLines: number;
  finalAnswer: string;
  valid: boolean;
  invalidReasons: string[];
}

export interface ParsedEvents {
  events: Record<string, unknown>[];
  malformedLines: number;
}

export interface PilotArmResult {
  arm: "graphify-cli" | "graphify-mcp";
  accuracy: number;
  criticalMisses: number;
  totalTokens: number;
  controlTotalTokens: number;
  estimatedCostUsd: number;
  controlEstimatedCostUsd: number;
  uncachedInputTokens: number;
  wallSeconds: number;
  fixedOverheadTokens: number;
  serenaFixedOverheadTokens: number;
}

export interface AcceptanceTaskResult {
  task: string;
  controlAccuracy: number;
  graphifyAccuracy: number;
  controlUncachedInput: number;
  graphifyUncachedInput: number;
  controlTotalTokens: number;
  graphifyTotalTokens: number;
  controlCostUsd: number;
  graphifyCostUsd: number;
  controlWallSeconds: number;
  graphifyWallSeconds: number;
  criticalFailure: boolean;
}

export interface AcceptanceInput {
  tasks: AcceptanceTaskResult[];
  pairedAccuracyLowerBound: number;
  graphifyFixedOverheadTokens: number;
  serenaFixedOverheadTokens: number;
  graphifyFixedOverheadCostUsd: number;
  serenaFixedOverheadCostUsd: number;
}

export interface JudgeItemScore {
  id: string;
  score: 0 | 1 | 2;
  critical: boolean;
}

export interface JudgeScore {
  totalScore: number;
  criticalFailure: boolean;
  items: JudgeItemScore[];
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseEvents(text: string): ParsedEvents {
  const events: Record<string, unknown>[] = [];
  let malformedLines = 0;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const event = objectValue(parsed);
      if (event) events.push(event);
      else malformedLines += 1;
    } catch {
      malformedLines += 1;
    }
  }

  return { events, malformedLines };
}

export function calculateCost(usage: Usage, pricing: Pricing): CostResult {
  const ordinaryUncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens,
  );
  const units = pricing.unitTokens;
  const inputCost =
    (ordinaryUncachedInputTokens * pricing.input +
      usage.cachedInputTokens * pricing.cachedInput +
      usage.cacheWriteInputTokens * pricing.cacheWriteInput) /
    units;
  const outputCost = (usage.outputTokens * pricing.output) / units;
  const longContextSensitivityApplied = usage.inputTokens > pricing.longContextThreshold;

  return {
    ordinaryUncachedInputTokens,
    baseUsd: inputCost + outputCost,
    conservativeLongContextUsd: longContextSensitivityApplied
      ? inputCost * pricing.longContextInputMultiplier +
        outputCost * pricing.longContextOutputMultiplier
      : inputCost + outputCost,
    longContextSensitivityApplied,
  };
}

export function isWholeFileRead(command: string): boolean {
  const normalized = command.replace(/\s+/g, " ").trim();
  if (/(^|[;&|]\s*)(cat|bat)(\s+--?[^ ]+)*\s+[^|;&<>]+$/.test(normalized)) return true;
  if (/\bsed\s+-n\s+['"]?1,(\$|[0-9]{4,})p['"]?/.test(normalized)) return true;
  if (/\bawk\b[^;&|]*(NR\s*>=?\s*1|NR==1)[^;&|]*$/.test(normalized)) return true;
  return false;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

export function pairedBootstrapLowerBound(
  differences: number[],
  iterations = 10_000,
  seed = 20_261_206,
): number {
  if (differences.length === 0) return Number.NEGATIVE_INFINITY;
  let state = seed >>> 0;
  const random = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < differences.length; index += 1) {
      sum += differences[Math.floor(random() * differences.length)];
    }
    samples.push(sum / differences.length);
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.025)];
}

export function normalizeChecklistScore(
  items: JudgeItemScore[],
  unsupportedClaims: number,
  unsupportedClaimPenalty = 2,
): number {
  if (items.length === 0) return 0;
  const earned = items.reduce((sum, item) => sum + item.score, 0);
  const normalized = (earned / (items.length * 2)) * 100;
  return Math.max(0, normalized - unsupportedClaims * unsupportedClaimPenalty);
}

export function needsAdjudication(left: JudgeScore, right: JudgeScore): boolean {
  if (Math.abs(left.totalScore - right.totalScore) > 5) return true;
  if (left.criticalFailure !== right.criticalFailure) return true;
  const rightItems = new Map(right.items.map((item) => [item.id, item]));
  return left.items.some((item) => {
    const counterpart = rightItems.get(item.id);
    return item.critical && counterpart?.score !== item.score;
  });
}

export function amortizeBuildSeconds(buildSeconds: number): Record<"6" | "36" | "100", number> {
  return {
    "6": buildSeconds / 6,
    "36": buildSeconds / 36,
    "100": buildSeconds / 100,
  };
}

function itemFromEvent(event: Record<string, unknown>): Record<string, unknown> | undefined {
  return objectValue(event.item);
}

function commandFromItem(item: Record<string, unknown>): string {
  return typeof item.command === "string" ? item.command : "";
}

function finalAnswerFrom(events: Record<string, unknown>[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "item.completed") continue;
    const item = itemFromEvent(event);
    if (item?.type !== "agent_message") continue;
    if (typeof item.text === "string") return item.text;
  }
  return "";
}

export function summarizeEvents(
  parsed: ParsedEvents,
  metadata: RunMetadata,
  pricing: Pricing,
): RunSummary {
  const completed = [...parsed.events]
    .reverse()
    .find((event) => event.type === "turn.completed");
  const usageObject = objectValue(completed?.usage);
  const usage: Usage = {
    inputTokens: numberValue(usageObject?.input_tokens),
    cachedInputTokens: numberValue(usageObject?.cached_input_tokens),
    cacheWriteInputTokens: numberValue(usageObject?.cache_write_input_tokens),
    outputTokens: numberValue(usageObject?.output_tokens),
    reasoningOutputTokens: numberValue(usageObject?.reasoning_output_tokens),
  };
  const completedItems = parsed.events
    .filter((event) => event.type === "item.completed")
    .map(itemFromEvent)
    .filter((item): item is Record<string, unknown> => item !== undefined);
  const commandItems = completedItems.filter((item) => item.type === "command_execution");
  const mcpItems = completedItems.filter((item) => item.type === "mcp_tool_call");
  const commands = commandItems.map(commandFromItem);
  const serialized = parsed.events.map((event) => JSON.stringify(event).toLowerCase());
  const invalidReasons: string[] = [];

  if (!completed) invalidReasons.push("missing-turn-completed");
  if (metadata.exitStatus !== 0) invalidReasons.push(`nonzero-exit:${metadata.exitStatus}`);
  if (parsed.malformedLines > 0) invalidReasons.push("malformed-event-output");
  if (!finalAnswerFrom(parsed.events)) invalidReasons.push("missing-final-answer");
  if (metadata.sourceModified) invalidReasons.push("source-modified");

  for (const [key, expected] of Object.entries(metadata.expected ?? {})) {
    if (metadata.actual?.[key] !== expected) invalidReasons.push(`mismatch:${key}`);
  }

  for (const forbidden of metadata.forbiddenPaths ?? []) {
    if (commands.some((command) => command.includes(forbidden))) {
      invalidReasons.push(`forbidden-read:${forbidden}`);
    }
  }

  const graphifyMcpCalls = mcpItems.filter((item) => {
    const server = typeof item.server === "string" ? item.server : "";
    return server.toLowerCase().includes("graphify");
  }).length;
  const graphifyCliCalls = commands.filter((command) =>
    /(^|\s)graphify\s+(query|path|explain)(\s|$)/.test(command),
  ).length;
  const sourceVerificationCalls = commands.filter((command) =>
    /(^|\s)(rg|grep)(\s|$)/.test(command),
  ).length;
  const cost = calculateCost(usage, pricing);

  return {
    ...usage,
    ...cost,
    arm: metadata.arm,
    task: metadata.task,
    repeat: metadata.repeat,
    elapsedSeconds: metadata.elapsedSeconds,
    totalTokens: usage.inputTokens + usage.outputTokens,
    mcpCalls: mcpItems.length,
    commandCalls: commandItems.length,
    graphifyCalls: graphifyMcpCalls + graphifyCliCalls,
    sourceVerificationCalls,
    wholeFileReads: commands.filter(isWholeFileRead).length,
    retries: serialized.filter((value) => value.includes("retry")).length,
    errors: serialized.filter((value) => value.includes('"error"')).length,
    malformedEventLines: parsed.malformedLines,
    finalAnswer: finalAnswerFrom(parsed.events),
    valid: invalidReasons.length === 0,
    invalidReasons,
  };
}

function pilotDisqualified(result: PilotArmResult): boolean {
  const tokenRatio = result.controlTotalTokens === 0
    ? Number.POSITIVE_INFINITY
    : result.totalTokens / result.controlTotalTokens;
  const noCostBenefit = result.estimatedCostUsd >= result.controlEstimatedCostUsd;
  return (
    result.criticalMisses >= 2 ||
    (tokenRatio > 1.25 && noCostBenefit) ||
    result.fixedOverheadTokens >= result.serenaFixedOverheadTokens
  );
}

export function selectGraphifyInterface(results: PilotArmResult[]): "graphify-cli" | "graphify-mcp" | "none" {
  const eligible = results.filter((result) => !pilotDisqualified(result));
  if (eligible.length === 0) return "none";
  eligible.sort((left, right) =>
    right.accuracy - left.accuracy ||
    left.estimatedCostUsd - right.estimatedCostUsd ||
    left.uncachedInputTokens - right.uncachedInputTokens ||
    left.wallSeconds - right.wallSeconds ||
    (left.arm === "graphify-cli" ? -1 : 1),
  );
  return eligible[0].arm;
}

export function shouldStopEarly(input: {
  graphifyAccuracy: number;
  controlAccuracy: number;
  criticalFailures: number;
  graphifyTotalTokens: number;
  controlTotalTokens: number;
  graphifyCostUsd: number;
  controlCostUsd: number;
}): boolean {
  const accuracyFailure = input.controlAccuracy - input.graphifyAccuracy > 5;
  const criticalFailure = input.criticalFailures >= 2;
  const tokenFailure =
    input.controlTotalTokens > 0 &&
    input.graphifyTotalTokens / input.controlTotalTokens > 1.25 &&
    input.graphifyCostUsd >= input.controlCostUsd;
  return accuracyFailure || criticalFailure || tokenFailure;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? Number.POSITIVE_INFINITY : numerator / denominator;
}

export function evaluateAcceptance(input: AcceptanceInput): {
  decision: "adopt-default" | "selective" | "reject";
  qualifyingTasks: string[];
  reasons: string[];
} {
  const tasks = input.tasks;
  const qualifyingTasks = tasks
    .filter((task) =>
      !task.criticalFailure &&
      task.graphifyAccuracy >= task.controlAccuracy &&
      task.graphifyCostUsd < task.controlCostUsd,
    )
    .map((task) => task.task);
  const controlAccuracy = median(tasks.map((task) => task.controlAccuracy));
  const graphifyAccuracy = median(tasks.map((task) => task.graphifyAccuracy));
  const uncachedRatio = ratio(
    median(tasks.map((task) => task.graphifyUncachedInput)),
    median(tasks.map((task) => task.controlUncachedInput)),
  );
  const totalRatio = ratio(
    median(tasks.map((task) => task.graphifyTotalTokens)),
    median(tasks.map((task) => task.controlTotalTokens)),
  );
  const costRatio = ratio(
    median(tasks.map((task) => task.graphifyCostUsd)),
    median(tasks.map((task) => task.controlCostUsd)),
  );
  const wallRatio = ratio(
    median(tasks.map((task) => task.graphifyWallSeconds)),
    median(tasks.map((task) => task.controlWallSeconds)),
  );
  const tokenOverheadRatio = ratio(
    input.graphifyFixedOverheadTokens,
    input.serenaFixedOverheadTokens,
  );
  const costOverheadRatio = ratio(
    input.graphifyFixedOverheadCostUsd,
    input.serenaFixedOverheadCostUsd,
  );
  const reasons: string[] = [];

  if (graphifyAccuracy < controlAccuracy) reasons.push("median-accuracy-below-control");
  if (input.pairedAccuracyLowerBound < -2) reasons.push("accuracy-confidence-bound-below-minus-two");
  if (tasks.some((task) => task.criticalFailure)) reasons.push("critical-omission");
  if (qualifyingTasks.length < 5) reasons.push("fewer-than-five-qualifying-tasks");
  if (uncachedRatio > 0.8) reasons.push("uncached-input-reduction-below-twenty-percent");
  if (totalRatio > 1.05) reasons.push("total-token-regression-over-five-percent");
  if (costRatio >= 1) reasons.push("cost-not-lower-than-control");
  if (wallRatio > 1.1) reasons.push("wall-time-regression-over-ten-percent");
  if (tokenOverheadRatio > 0.7 || costOverheadRatio > 0.7) {
    reasons.push("fixed-overhead-not-thirty-percent-below-serena");
  }

  if (reasons.length === 0) {
    return { decision: "adopt-default", qualifyingTasks, reasons };
  }
  const accuracyNonInferior =
    graphifyAccuracy >= controlAccuracy &&
    input.pairedAccuracyLowerBound >= -2 &&
    !tasks.some((task) => task.criticalFailure);
  if (accuracyNonInferior && qualifyingTasks.length >= 3) {
    return { decision: "selective", qualifyingTasks, reasons };
  }
  return { decision: "reject", qualifyingTasks, reasons };
}

export function stableDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateGraphJson(
  graphText: string,
  sourceRoot: string,
  forbiddenFragments: string[],
  requiredAnchors: string[],
): string[] {
  const problems: string[] = [];
  let graph: unknown;
  try {
    graph = JSON.parse(graphText);
  } catch {
    return ["graph-json-invalid"];
  }
  const serialized = JSON.stringify(graph);
  for (const fragment of forbiddenFragments) {
    if (serialized.includes(fragment)) problems.push(`forbidden-graph-fragment:${fragment}`);
  }
  for (const anchor of requiredAnchors) {
    if (!serialized.includes(anchor)) problems.push(`missing-graph-anchor:${anchor}`);
  }

  const graphRecord = objectValue(graph);
  const nodeIds = new Set<string>();
  const sourceExtensions = new Set([".ts", ".tsx", ".sh", ".tf", ".json", ".mjs", ".mts"]);
  const nodes = graphRecord?.nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      const record = objectValue(node);
      const id = record?.id ?? record?.node_id ?? record?.name;
      if (typeof id === "string") nodeIds.add(id);
      const sourceFile = record?.source_file;
      if (
        typeof sourceFile === "string"
        && !isAbsolute(sourceFile)
        && sourceExtensions.has(extname(sourceFile))
        && !existsSync(resolve(sourceRoot, sourceFile))
      ) {
        problems.push(`dangling-path-node:${String(id ?? "<unknown>")}:${sourceFile}`);
      }
    }
  } else {
    const nodeMap = objectValue(nodes);
    if (nodeMap) Object.keys(nodeMap).forEach((id) => nodeIds.add(id));
  }
  const edges = graphRecord?.links ?? graphRecord?.edges;
  if (nodeIds.size > 0 && Array.isArray(edges)) {
    for (const edge of edges) {
      const record = objectValue(edge);
      const relation = record?.relation;
      for (const endpointName of ["source", "target"] as const) {
        const rawEndpoint = record?.[endpointName];
        const endpointRecord = objectValue(rawEndpoint);
        const endpoint = typeof rawEndpoint === "string" ? rawEndpoint : endpointRecord?.id;
        const unresolvedImportReference = relation === "imports" || relation === "imports_from";
        if (typeof endpoint === "string" && !nodeIds.has(endpoint) && !unresolvedImportReference) {
          problems.push(`dangling-edge-${endpointName}:${endpoint}`);
        }
      }
    }
  }

  const visit = (value: unknown): void => {
    if (typeof value === "string" && isAbsolute(value)) {
      const outside = relative(resolve(sourceRoot), resolve(value)).startsWith("..");
      if (outside) problems.push(`outside-source-path:${value}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = objectValue(value);
    if (record) Object.values(record).forEach(visit);
  };
  visit(graph);
  return [...new Set(problems)];
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function readUnknownJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function main(args: string[]): void {
  const [command, ...rest] = args;
  if (command === "parse-run") {
    const [eventsPath, metadataPath, evidencePath, outputPath] = rest;
    if (!eventsPath || !metadataPath || !evidencePath || !outputPath) {
      throw new Error("parse-run requires events, metadata, evidence, and output paths");
    }
    const metadata = readJson(metadataPath) as unknown as RunMetadata;
    const evidence = readJson(evidencePath);
    const pricing = objectValue(evidence.pricing) as unknown as Pricing;
    const summary = summarizeEvents(parseEvents(readFileSync(eventsPath, "utf8")), metadata, pricing);
    writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (command === "validate-fixtures") {
    const [benchmarkDirectory] = rest;
    if (!benchmarkDirectory) throw new Error("validate-fixtures requires a benchmark directory");
    const tasks = readFileSync(resolve(benchmarkDirectory, "tasks.tsv"), "utf8").trim().split("\n");
    const queries = readFileSync(resolve(benchmarkDirectory, "queries.tsv"), "utf8").trim().split("\n");
    const gold = readJson(resolve(benchmarkDirectory, "gold.json"));
    const goldTasks = Object.keys(objectValue(gold.tasks) ?? {});
    const queryRows = queries.slice(1).map((line) => line.split("\t"));
    const queryTasks = new Set(queryRows.map(([taskId]) => taskId));
    if (tasks.length !== 7) throw new Error(`expected 7 tasks, found ${tasks.length}`);
    if (queryTasks.size !== 6) throw new Error(`expected queries for 6 tasks, found ${queryTasks.size}`);
    if (queryRows.some((row) => row.length !== 7 || !["1000", "2000"].includes(row[3] ?? ""))) {
      throw new Error("query table contains a malformed or uncalibrated row");
    }
    if (goldTasks.length !== 6) throw new Error(`expected 6 gold tasks, found ${goldTasks.length}`);
    return;
  }
  if (command === "validate-graph") {
    const [graphPath, sourceRoot] = rest;
    if (!graphPath || !sourceRoot) throw new Error("validate-graph requires graph path and source root");
    const problems = validateGraphJson(
      readFileSync(graphPath, "utf8"),
      sourceRoot,
      ["benchmarks/", ".serena/", "package.json", "graphify-out"],
      ["PaymentService", "Presentes", "AppStack", "cloudflare_dns_record", "resourceName"],
    );
    if (problems.length > 0) throw new Error(problems.join("\n"));
    return;
  }
  if (command === "select-pilot") {
    const [inputPath, outputPath] = rest;
    if (!inputPath || !outputPath) throw new Error("select-pilot requires input and output paths");
    const results = readUnknownJson(inputPath) as PilotArmResult[];
    writeFileSync(outputPath, `${selectGraphifyInterface(results)}\n`);
    return;
  }
  if (command === "acceptance") {
    const [inputPath, outputPath] = rest;
    if (!inputPath || !outputPath) throw new Error("acceptance requires input and output paths");
    const input = readUnknownJson(inputPath) as AcceptanceInput;
    writeFileSync(outputPath, `${JSON.stringify(evaluateAcceptance(input), null, 2)}\n`);
    return;
  }
  throw new Error(`unknown command: ${command ?? "<missing>"}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
