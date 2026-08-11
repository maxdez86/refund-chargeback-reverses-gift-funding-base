# Graphify context benchmark results

Status: the 32-session pilot, independent technical audit, blind scoring, and pilot-level local selection are complete. The main matrix and full adoption analysis have not run.

## Frozen preparation

On 2026-08-11 the harness installed the checksum-verified `graphifyy[terraform,mcp]==0.9.39` wheel in the external cache and completed a deterministic `--code-only --no-cluster --force` extraction. The valid TypeScript expression that Graphify previously rejected was rewritten through an erased local type alias, so the new extraction has no syntax-error or partial-extraction warning.

The corpus gate passed exactly: 266 code files consisting of 164 TypeScript, 37 TSX, 32 shell, 18 Terraform, 8 JSON, 5 MJS, and 2 MTS files. The raw graph has 1,665 nodes and 3,849 edges. The documented zero-node `cdk.json` warning remains; it is not a syntax or partial-extraction failure.

Graph validation distinguishes Graphify's unresolved `imports` and `imports_from` reference endpoints from path-backed nodes. Those import references are allowed because Graphify deliberately emits them without nodes. Missing source-file nodes, non-import dangling edges, external absolute paths, forbidden content, missing anchors, and source/graph drift still fail closed.

- Source SHA-256: `4c62881f98c216bff449ab8662a3124fc8eea097edec2e737c428da302d23ba9`
- Graph SHA-256: `277cb6a4920f50c4dafe1ce671cac960f6a34069d1770a67ea7c44cd563cae9b`
- Serena corpus SHA-256: `05a3186c055b8ae4491099c41f3224a1561a34b01bf9cb94c4a2c02306ed1206`
- Graph size: 1,861,896 bytes
- Build wall time: 5.31 seconds
- Build CPU: 7.85 seconds user, 1.90 seconds system, 183% utilization
- Build peak RSS: 106,908 KiB
- Indexing model tokens: zero

Raw workspaces, graph data, build logs, calibration output, and the experiment manifest remain outside the repository under the benchmark cache.

## Frozen query calibration

Every original 1,600-token multi-symbol query truncated. They were split into 25 per-symbol queries at 1,000 tokens as required by the methodology. Twenty-four still truncated and are frozen at the 2,000-token ceiling. `ApiCustomDomainRegionalTarget` completed at 1,000 tokens and remains at that budget.

The 24 remaining truncations are recorded in `queries.tsv` as expected tool failures. Measured agents are instructed not to raise budgets or retry them. No query was tuned using a measured answer.

## Validation

The shell syntax check, dry run, results-utility tests (16/16), lint, typecheck, and prepared-state `verify` gate pass. The API suite passes 201/201 tests, including all 21 webhook-processor tests.

This host runs Node 26.7.0, whose experimental global Web Storage conflicts with Vitest 3/jsdom. An unqualified `pnpm test` therefore fails 43 web tests before their assertions because `window.localStorage` is unavailable. With Node's experimental Web Storage disabled (`NODE_OPTIONS=--no-experimental-webstorage`), the web suite passes 112/112 tests. This is an audited host-runtime qualification, not a Graphify or source regression.

The host does not have Ruby installed, so the 10 existing `github-env-writer-validator.test.ts` cases cannot spawn `scripts/validate-github-env-writers.rb` (`ENOENT`). Every CDK test that does not require Ruby passes. Ruby is not used by benchmark preparation, verification, retrieval arms or scoring, so this host dependency does not block the pilot; it remains a qualification on the repository-wide `pnpm test` command.

These pre-pilot host qualifications remained unchanged during execution.

## Pilot execution status

The pilot was executed on 2026-08-11. Its external result root is `/home/maxreis86/.cache/brimax-life-graphify-benchmark/results/839932946081a7fadab2db4b67bee00aab3b6af8a5ef4e388b9e1b38663357ab-277cb6a4920f50c4dafe1ce671cac960f6a34069d1770a67ea7c44cd563cae9b`.

- Source SHA-256: `839932946081a7fadab2db4b67bee00aab3b6af8a5ef4e388b9e1b38663357ab`
- Graph SHA-256: `277cb6a4920f50c4dafe1ce671cac960f6a34069d1770a67ea7c44cd563cae9b`
- Serena corpus SHA-256: `00b32d7edc4191efe4b9227eb3789f02391a5ee9aa2b9314c2c967915b308aeb`
- Query-table SHA-256: `0285c8a1ffc4f512fef574c97ed37bfa90b488d4912160a5e2720e821f8d171e`

All 32 matrix coordinates have technically valid representatives. The run produced 32 primary attempts and one targeted technical retry. The invalid primary attempt, caused by transient Luna model capacity before completion, remains preserved; its first retry is valid. There are no unresolved case-level technical qualifications.

Fresh preparation exposed two harness-stability issues that were corrected before resuming: nested workspace dependencies are now excluded from sanitized copies, and Serena's runtime cache is excluded from the Serena corpus digest while source, configuration, and memories remain protected. The Node 26 Web Storage qualification and missing-Ruby repository-test qualification described above remain unchanged and do not affect pilot validity.

The scoring and pilot-level selection below use this frozen state. The main matrix and full adoption analysis remain unstarted.

## Pilot scoring and local selection

Scored on 2026-08-11. An independent raw-artifact revalidation confirmed that all 32 pilot coordinates have technically valid representatives. There are 33 preserved candidate attempts: the Serena repeat-1 `tool-overhead` primary is invalid because Luna was at capacity before completion, and its first targeted retry is valid. No other candidate attempt is invalid, and no coordinate has unresolved technical invalidity.

Blind scoring used two fresh `gpt-5.6-sol`/high judges for each of the 16 `api-flow` answers. One answer met the frozen total-score disagreement threshold and received the required third judge. All 33 judge attempts are technically valid and schema-conforming; there were no judge retries. Median item and total scores and majority critical-failure decisions were used.

### API-flow comparison

| Setup | Repeat scores | Median accuracy | Critical failures | Unsupported claims | Median uncached input | Median cached input | Median output | Median total tokens | Median base cost | Median conservative cost | Median wall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `control` | 91.67, 89.67, 91.67, 89.67 | **90.67** | 0 | 2 | 56,724.5 | 170,496 | 2,478.5 | 231,678 | $0.018125 | $0.018125 | 64.04 s |
| `serena` | 81.33, 83.33, 91.67, 91.67 | **87.50** | 0 | 1 | 51,823 | 227,200 | 2,424 | 296,247.5 | $0.018207 | $0.035029 | 71.35 s |
| `graphify-cli` | 91.67, 81.33, 91.67, 81.33 | **86.50** | 0 | 2 | 40,634.5 | 77,440 | 2,268 | 121,815 | $0.012203 | $0.012203 | 54.89 s |
| `graphify-mcp` | 83.33, 82.33, 83.33, 91.67 | **83.33** | 0 | 0.5 | 49,830 | 126,464 | 2,085.5 | 186,009.5 | $0.015386 | $0.015386 | 59.11 s |

The fractional unsupported-claim value is the frozen median of two judge counts for one answer. No `api-flow` checklist item is critical, so the zero critical-failure counts do not demonstrate critical-failure discrimination.

| Setup | Native commands | MCP calls | Graphify calls | Source-verification calls | Whole-file reads | Retry heuristic | Failed tool calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| `control` | 6.5 | 0 | 0 | 5 | 0 | 1 | 0 |
| `serena` | 4.5 | 16.5 | 0 | 4.5 | 0 | 1 | 0 |
| `graphify-cli` | 10.5 | 0 | 4 | 2.5 | 0 | 0 | 0 |
| `graphify-mcp` | 4 | 4 | 4 | 3 | 0 | 0.5 | 4 MCP calls |

Values are medians across four repeats. The Graphify CLI produced a median of four truncated query results. Graphify MCP's four required calls per run failed in the measured event streams, including valid post-start cancellations; those are performance outcomes rather than technical invalidity. Graphify-call and source-verification counts were independently recomputed from raw completed events because quoted shell commands can evade the older summary heuristic.

### Tool-overhead comparison

| Setup | Correct and compliant | Avoided inspection | Median fixed tokens | Median cost | Median wall | Commands | MCP calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| `control` | **4/4** | 4/4 | 10,720 | $0.002246 | 6.78 s | 0 | 0 |
| `serena` | 0/4 | 4/4 | 10,874 | $0.002307 | 12.16 s | 0 | 0 |
| `graphify-cli` | 0/4 | 4/4 | 10,733.5 | $0.002292 | 7.16 s | 0 | 0 |
| `graphify-mcp` | 0/4 | 4/4 | 10,898 | $0.002337 | 7.86 s | 0 | 0 |

Every run correctly avoided repository and graph inspection. Control reported its native navigation surface. Serena and both Graphify arms omitted or denied the retrieval surface configured for their arm, so they fail the frozen correctness/compliance check.

### Selection

The pilot-supported local default is **`control`**. The runner-up is **`serena`**. Control wins the first overall lexicographic criterion with 90.67 median blind accuracy versus Serena's 87.50; later cost, token, wall-time, and complexity criteria therefore do not overturn the result. No setup is disqualified from the overall comparison for unresolved invalidity or two critical failures.

The best Graphify interface is **`graphify-cli`**. It survives every frozen Graphify-interface disqualifier and has 86.50 median accuracy, $0.012203 median candidate cost, 40,634.5 median uncached input tokens, 121,815 median total tokens, and 54.89-second median wall time. `graphify-mcp` is interface-disqualified because its 10,898-token fixed overhead is not lower than Serena's 10,874 tokens. CLI also uses 52.58% of control's median total tokens and 67.33% of its median cost.

Only accuracy differences below 0.01 point are treated as a practical tie, to absorb floating-point storage noise. No setups tie at that threshold, so the fewer-moving-parts fallback was not needed.

Primary-only sensitivity, excluding the invalid Serena coordinate, and representative sensitivity, using its valid retry, both select `control`, `serena`, and `graphify-cli` in the same roles. The retry changes Serena's overhead sample count from three to four but leaves its 10,874-token median and failed compliance outcome unchanged.

Representative candidate retrieval cost is $0.295271 base and $0.350964 under the conservative long-context calculation across all 32 coordinates. Blind-judge cost is separate: $2.514773 across 33 valid attempts. Judge use totaled 423,421 input tokens, 47,616 cached input tokens, 20,398 output tokens, and 443,819 input-plus-output tokens.

This is a pilot-supported local-environment decision based only on `tool-overhead` and `api-flow`, with four repeated observations per setup and task. It is not evidence for full-repository adoption. The 126-session main matrix, six-useful-task acceptance analysis, production-promotion integration suite, and full adoption workflow have not run.
