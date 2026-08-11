import { describe, expect, it } from "vitest";
import {
  amortizeBuildSeconds,
  calculateCost,
  evaluateAcceptance,
  isWholeFileRead,
  median,
  needsAdjudication,
  normalizeChecklistScore,
  pairedBootstrapLowerBound,
  parseEvents,
  selectGraphifyInterface,
  shouldStopEarly,
  stableDigest,
  summarizeEvents,
  validateGraphJson,
  type Pricing,
} from "./graphify-context-results";

const pricing: Pricing = {
  unitTokens: 1_000_000,
  input: 0.2,
  cachedInput: 0.02,
  cacheWriteInput: 0.25,
  output: 1.2,
  longContextThreshold: 272_000,
  longContextInputMultiplier: 2,
  longContextOutputMultiplier: 1.5,
};

describe("Graphify context benchmark results", () => {
  it("separates ordinary, cached, and cache-write input cost", () => {
    const result = calculateCost(
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        cacheWriteInputTokens: 100_000,
        outputTokens: 100_000,
        reasoningOutputTokens: 20_000,
      },
      pricing,
    );
    expect(result).toMatchObject({
      ordinaryUncachedInputTokens: 700_000,
      conservativeLongContextUsd: 0.518,
      longContextSensitivityApplied: true,
    });
    expect(result.baseUsd).toBeCloseTo(0.289);
  });

  it("parses JSONL while retaining malformed-line evidence", () => {
    const parsed = parseEvents('{"type":"turn.started"}\nnot-json\n');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.malformedLines).toBe(1);
  });

  it("summarizes usage, tools, source verification, and invalidity", () => {
    const parsed = parseEvents([
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution", command: "rg -n PaymentService apps/api/src" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "mcp_tool_call", server: "graphify", tool: "query_graph" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Evidence" },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 1_000,
          cached_input_tokens: 200,
          cache_write_input_tokens: 100,
          output_tokens: 50,
          reasoning_output_tokens: 10,
        },
      }),
    ].join("\n"));
    const result = summarizeEvents(
      parsed,
      { arm: "graphify-mcp", task: "api-flow", repeat: 1, elapsedSeconds: 2, exitStatus: 0 },
      pricing,
    );
    expect(result).toMatchObject({
      valid: true,
      totalTokens: 1_050,
      ordinaryUncachedInputTokens: 700,
      mcpCalls: 1,
      graphifyCalls: 1,
      commandCalls: 1,
      sourceVerificationCalls: 1,
      finalAnswer: "Evidence",
    });
  });

  it("invalidates mismatched manifests and forbidden reads", () => {
    const parsed = parseEvents([
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution", command: "cat benchmarks/graphify-context/gold.json" },
      }),
      JSON.stringify({ type: "turn.completed", usage: {} }),
    ].join("\n"));
    const result = summarizeEvents(
      parsed,
      {
        arm: "control",
        task: "tool-overhead",
        repeat: 1,
        elapsedSeconds: 1,
        exitStatus: 0,
        expected: { corpus: "one" },
        actual: { corpus: "two" },
        forbiddenPaths: ["benchmarks/"],
      },
      pricing,
    );
    expect(result.valid).toBe(false);
    expect(result.invalidReasons).toContain("mismatch:corpus");
    expect(result.invalidReasons).toContain("forbidden-read:benchmarks/");
    expect(result.invalidReasons).toContain("missing-final-answer");
  });

  it("classifies obvious whole-file reads conservatively", () => {
    expect(isWholeFileRead("cat apps/api/src/domain/payment-service.ts")).toBe(true);
    expect(isWholeFileRead("sed -n '1,9999p' apps/api/src/domain/payment-service.ts")).toBe(true);
    expect(isWholeFileRead("sed -n '120,180p' apps/api/src/domain/payment-service.ts")).toBe(false);
    expect(isWholeFileRead("rg -n PaymentService apps/api/src")).toBe(false);
  });

  it("computes medians", () => {
    expect(median([8, 2, 4, 6])).toBe(5);
    expect(median([5, 1, 3])).toBe(3);
  });

  it("computes a deterministic paired bootstrap lower bound", () => {
    expect(pairedBootstrapLowerBound([1, 1, 1, 1, 1, 1])).toBe(1);
    expect(pairedBootstrapLowerBound([2, 1, 0, 2, 1, 0], 1_000, 42)).toBeCloseTo(1 / 3);
  });

  it("normalizes checklist scores and applies unsupported-claim penalties", () => {
    expect(
      normalizeChecklistScore(
        [
          { id: "one", score: 2, critical: true },
          { id: "two", score: 1, critical: false },
        ],
        1,
      ),
    ).toBe(73);
  });

  it("requests adjudication for material or critical disagreement", () => {
    const base = {
      totalScore: 90,
      criticalFailure: false,
      items: [{ id: "critical", score: 2 as const, critical: true }],
    };
    expect(needsAdjudication(base, { ...base, totalScore: 84 })).toBe(true);
    expect(
      needsAdjudication(base, {
        ...base,
        items: [{ id: "critical", score: 1, critical: true }],
      }),
    ).toBe(true);
  });

  it("amortizes build time over the required horizons", () => {
    expect(amortizeBuildSeconds(360)).toEqual({ "6": 60, "36": 10, "100": 3.6 });
  });

  it("selects the pilot winner lexicographically and favors CLI on ties", () => {
    const common = {
      accuracy: 95,
      criticalMisses: 0,
      totalTokens: 90,
      controlTotalTokens: 100,
      estimatedCostUsd: 0.1,
      controlEstimatedCostUsd: 0.2,
      uncachedInputTokens: 80,
      wallSeconds: 10,
      fixedOverheadTokens: 40,
      serenaFixedOverheadTokens: 100,
    };
    expect(
      selectGraphifyInterface([
        { arm: "graphify-mcp", ...common },
        { arm: "graphify-cli", ...common },
      ]),
    ).toBe("graphify-cli");
  });

  it("rejects disqualified pilot interfaces", () => {
    expect(
      selectGraphifyInterface([
        {
          arm: "graphify-cli",
          accuracy: 90,
          criticalMisses: 2,
          totalTokens: 100,
          controlTotalTokens: 100,
          estimatedCostUsd: 0.1,
          controlEstimatedCostUsd: 0.2,
          uncachedInputTokens: 80,
          wallSeconds: 10,
          fixedOverheadTokens: 40,
          serenaFixedOverheadTokens: 100,
        },
      ]),
    ).toBe("none");
  });

  it("implements the early-stop thresholds", () => {
    expect(
      shouldStopEarly({
        graphifyAccuracy: 89,
        controlAccuracy: 95,
        criticalFailures: 0,
        graphifyTotalTokens: 100,
        controlTotalTokens: 100,
        graphifyCostUsd: 0.1,
        controlCostUsd: 0.2,
      }),
    ).toBe(true);
  });

  it("adopts only when every default threshold passes", () => {
    const tasks = Array.from({ length: 6 }, (_, index) => ({
      task: `task-${index}`,
      controlAccuracy: 95,
      graphifyAccuracy: 96,
      controlUncachedInput: 100,
      graphifyUncachedInput: 75,
      controlTotalTokens: 100,
      graphifyTotalTokens: 100,
      controlCostUsd: 1,
      graphifyCostUsd: 0.8,
      controlWallSeconds: 10,
      graphifyWallSeconds: 10,
      criticalFailure: false,
    }));
    expect(
      evaluateAcceptance({
        tasks,
        pairedAccuracyLowerBound: -1,
        graphifyFixedOverheadTokens: 60,
        serenaFixedOverheadTokens: 100,
        graphifyFixedOverheadCostUsd: 0.06,
        serenaFixedOverheadCostUsd: 0.1,
      }).decision,
    ).toBe("adopt-default");
  });

  it("validates required and forbidden graph content", () => {
    const graph = JSON.stringify({
      nodes: [
        { id: "PaymentService" },
        { id: "package.json" },
        { id: "MissingSource", source_file: "missing.ts" },
      ],
      links: [
        { source: "PaymentService", target: "ExternalImport", relation: "imports_from" },
        { source: "PaymentService", target: "MissingNode", relation: "calls" },
      ],
    });
    expect(validateGraphJson(graph, "/tmp/source", ["package.json"], ["PaymentService", "AppStack"]))
      .toEqual([
        "forbidden-graph-fragment:package.json",
        "missing-graph-anchor:AppStack",
        "dangling-path-node:MissingSource:missing.ts",
        "dangling-edge-target:MissingNode",
      ]);
  });

  it("creates stable SHA-256 digests", () => {
    expect(stableDigest("brimax")).toHaveLength(64);
    expect(stableDigest("brimax")).toBe(stableDigest("brimax"));
  });
});
