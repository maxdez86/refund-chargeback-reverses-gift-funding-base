# Graphify context benchmark

This benchmark compares native Codex retrieval, the repository's current Serena semantic setup, Graphify CLI retrieval, and a minimal Graphify MCP surface. It extends the earlier Serena smoke methodology with frozen sanitized workspaces, a deterministic code-only graph, balanced repetitions, hidden checklist scoring, explicit validity rules, and API-equivalent cost accounting.

No raw graph, sanitized workspace, task event stream, judge event stream, or cache belongs in Git. The harness stores them under `${XDG_CACHE_HOME:-$HOME/.cache}/brimax-life-graphify-benchmark` unless `BENCHMARK_CACHE_DIR` selects another external location.

## Frozen configuration

- Graphify distribution: `graphifyy[terraform,mcp]==0.9.39`.
- PyPI wheel SHA-256: `2e1d602677d90ba2e94472828a7ffbea288421bd809d8feb55bff827a21c32f7`.
- Build: `extract --code-only --no-cluster --force`; no API keys, incremental updates, watchers, clustering, reports, HTML, partial extraction, query log, or Codex installer.
- Benchmark model: `gpt-5.6-luna`, low reasoning.
- Blind judges: `gpt-5.6-sol`, high reasoning.
- MCP allowlist: `query_graph`, `get_node`, `get_neighbors`, and `shortest_path` only.
- Initial query budget: 1,600 tokens at depth 3. `queries.tsv` is the frozen measured table.

The official Luna page changed after the draft plan was written. `evidence.json` records the live 2026-08-10 prices of $0.20/M ordinary input, $0.02/M cached input, $0.25/M cache-write input, and $1.20/M output. Do not silently substitute the superseded draft figures; update the dated evidence and report the pricing snapshot if the official source changes again.

## Isolation and contamination controls

`prepare` makes two external sanitized copies from the current working tree:

1. The task workspace contains application code, tests, IaC, scripts, package manifests, workspace configuration, and normative `AGENTS.md` files. It excludes this benchmark, the old Serena benchmark runner, Graphify utilities, Serena/Codex/Claude configuration, memories, locks, generated files, state, and experimental docs.
2. The Serena workspace is a byte-identical source copy plus `.serena/project.yml`. Agents remain in the task workspace, so Serena configuration and memories are not discoverable through ordinary repository navigation.

A temporary `.graphifyignore` excludes all `package.json` files from graph ingestion while leaving them on disk for TypeScript workspace resolution. It also excludes documentation, locks, generated/state paths, the repository's Ruby-only GitHub environment validator, and all benchmark/configuration material. The ignore file is removed before task execution.

The current graphable corpus is fail-closed at 266 files: 164 `.ts`, 37 `.tsx`, 32 `.sh`, 18 `.tf`, 8 `.json`, 5 `.mjs`, and 2 `.mts`. Any difference requires a deliberate evidence/query/gold rebaseline. Source, Serena-copy, graph, Git-status, and tool-version digests are recorded and rechecked before every run.

## Commands

Install repository dependencies first so the TypeScript validator and unit tests are available. This does not install Graphify:

```bash
pnpm install --frozen-lockfile
bash -n scripts/graphify-context-benchmark.sh
scripts/graphify-context-benchmark.sh dry-run
scripts/graphify-context-benchmark.sh verify --no-install
```

`dry-run` and `verify --no-install` do not write files or install tools. After those checks pass, prepare the external snapshot and graph:

```bash
scripts/graphify-context-benchmark.sh prepare
scripts/graphify-context-benchmark.sh verify
```

`prepare` downloads the exact wheel selected by the pinned PyPI digest into an isolated venv, creates new external snapshot directories, builds a full raw graph, validates required/forbidden anchors, and captures `/usr/bin/time -v` installation/build evidence. It never invokes `graphify install --platform codex`.

Run the balanced pilot:

```bash
scripts/graphify-context-benchmark.sh pilot
```

The pilot runs 32 sessions: four arms, `tool-overhead` plus `api-flow`, four repetitions, and the Williams order frozen in the script. Score it before selecting an interface. Disqualify an interface for two critical misses, more than 25% token growth without lower cost, or fixed overhead no lower than Serena. Among survivors select by accuracy, cost, uncached input, and wall time; an exact tie selects CLI.

Run the full matrix only after writing the selected pilot arm explicitly:

```bash
GRAPHIFY_ARM=graphify-cli scripts/graphify-context-benchmark.sh run
# or, when the blind pilot selects it:
GRAPHIFY_ARM=graphify-mcp scripts/graphify-context-benchmark.sh run
```

The main experiment runs 126 fresh sessions: three arms, seven tasks, six repetitions, and two balanced Latin cycles. Diagnostic filters are available, but filtered results are not interchangeable with the complete matrix:

```bash
TASK_FILTER=tool-overhead REPEAT_FILTER=1 scripts/graphify-context-benchmark.sh pilot
```

## Query calibration

Calibration was frozen on 2026-08-11 using only local Graphify output. Every useful-task multi-symbol seed truncated at 1,600 tokens, so the table contains 25 per-symbol queries. `ApiCustomDomainRegionalTarget` completed at 1,000 tokens; the other 24 identifiers remained truncated and are frozen at the 2,000-token ceiling. The `calibration` column records that result.

Do not raise these budgets, merge the symbols, retry a truncated result, pass Graphify context filters or add natural-language trigger words during measured runs. A remaining truncation is a valid tool failure. Never tune a query after inspecting a measured answer.

Graphify is a discovery index. Every `INFERRED` or `AMBIGUOUS` edge used in an answer requires exact source confirmation. Contract-consumer, OpenTofu ownership, and rename tasks require exact native search even when the graph reports complete results.

## Blind scoring

Freeze `gold.json` before any run. Copy each valid useful-task answer into an opaque, seeded/shuffled scoring bundle outside the task workspace; keep the answer-ID-to-run mapping separate. Judges receive only the task prompt, the matching checklist, the candidate answer, and `score.schema.json`—never the arm, order, metrics, source workspace, or mapping.

Run two fresh Sol/high judge sessions per answer in an otherwise empty read-only directory with `--ignore-user-config`, `--strict-config`, disabled hooks/web search, and `--output-schema score.schema.json`. Run a third judge only when total scores differ by more than five points, critical-failure status differs, or judges disagree on a critical checklist item. Use the median item/total score and majority critical-failure decision. Preserve judge JSONL and report judge tokens/cost separately from retrieval costs.

Checklist items score 0 (missing), 1 (partial), or 2 (correct), normalized to 100 after subtracting two points per unsupported material claim. A graph-only `INFERRED` or `AMBIGUOUS` assertion gets zero credit. `tool-overhead` is checked programmatically for a correct tool report and zero repository/graph reads rather than judged against `gold.json`.

## Metrics and validity

Each run directory contains its prompt, raw JSONL, stderr, last answer, metadata, exit status, and parsed `summary.json`. `scripts/graphify-context-results.ts` records:

- ordinary/cached/cache-write input, output, reasoning, and total tokens;
- base and conservative long-context API-equivalent cost;
- wall time, MCP/command/Graphify/source-verification calls, whole-file-read heuristics, retries, and errors;
- final answer, validity, and exact invalidation reasons.

Reasoning tokens remain a subset of output and are not added twice. Internal retries keep all tokens and time. Externally repeated failures receive new run IDs and remain in the audit. A tool miss or non-adherence is a valid performance failure; wrong versions/hashes/configuration, missing completion/final answer, malformed JSONL, nonzero exit, forbidden reads, source mutation, or graph drift invalidates a run.

After the first main Latin cycle, stop Graphify when it trails control by over five accuracy points, has at least two critical failures on a completeness task, or uses over 125% of control tokens without lower cost. Never stop on one ordinary retry.

## Acceptance and reporting

Use equal-weight per-task medians over the six useful tasks. Default adoption requires all of:

- accuracy at least control, paired-bootstrap lower bound at least −2 points, and no systematic critical omission;
- at least five of six tasks no less accurate and cheaper than control;
- uncached input ratio at most 0.80;
- total-token ratio at most 1.05;
- cost ratio below 1.00;
- wall-time ratio at most 1.10;
- control-adjusted Graphify fixed overhead at most 70% of Serena's in tokens and cost.

If accuracy is non-inferior and at least three tasks qualify but the default thresholds fail, report selective routing. Otherwise reject adoption. Report installation/build wall time, CPU, peak RSS, disk/graph size, and zero indexing-model-token cost separately; amortize build wall time over 6, 36, and 100 assisted answers.

Do not compare the old one-run smoke numbers inferentially. Rerun control and Serena in this frozen matrix, then preserve old results only as descriptive historical context. Replace `results.md` only after the pilot, full run or documented early stop, blind scoring, retry sensitivity, invalid-run audit, and acceptance calculation are complete.

## Validation

Run the focused benchmark test with the API workspace's pinned Vitest binary, followed by repository checks:

```bash
pnpm --filter @brimax/api exec vitest run --root ../.. scripts/graphify-context-results.test.ts
pnpm lint
pnpm typecheck
pnpm test
```

On Node 26, run the test command as `NODE_OPTIONS=--no-experimental-webstorage pnpm test`; Node's experimental global Web Storage otherwise shadows jsdom's `window.localStorage` under Vitest 3.

Do not run or modify the prod-promotion integration suite for this benchmark work.
