# Graphify context pilot: final archive report

## Scope and provenance

This is historical evidence from the code-only Graphify 0.9.39 pilot run on 2026-08-11. The pilot compared `control`, `serena`, `graphify-cli`, and `graphify-mcp` on `tool-overhead` and `api-flow`, with four repeats per arm and task. Graphify used the checksum-verified `graphifyy[terraform,mcp]==0.9.39` wheel, a deterministic `--code-only --no-cluster --force` extraction, source digest `839932946081a7fadab2db4b67bee00aab3b6af8a5ef4e388b9e1b38663357ab`, graph digest `277cb6a4920f50c4dafe1ce671cac960f6a34069d1770a67ea7c44cd563cae9b`, and wheel SHA-256 `2e1d602677d90ba2e94472828a7ffbea288421bd809d8feb55bff827a21c32f7`.

Two independent scoring directories were preserved: `pilot-scoring` and `pilot-scoring-independent`. Both passed their final validation and found 32/32 technically valid representatives among 33 candidate attempts. Both preserve the invalid Serena repeat-1 `tool-overhead` primary, which failed before completion because Luna was at capacity, and use its first valid targeted retry. Neither scoring run is designated authoritative, and their values are not blended or reconciled.

This report does not specify the wrapper installed by a later prompt. That wrapper may use a different Graphify version, ignore policy, and query budget, so these pilot measurements must not be read as its expected behaviour.

## Independent scoring results

The scoring runs disagree materially. The exact stored aggregate values are shown side by side below; recurring decimals and binary floating-point representations are retained where they appear in the source JSON.

### API-flow accuracy and quality

| Arm | `pilot-scoring` repeat accuracy | `pilot-scoring` median | `pilot-scoring-independent` repeat accuracy | `pilot-scoring-independent` median | Critical failures (both) |
|---|---|---:|---|---:|---:|
| `control` | 91.66666666666667, 89.66666666666667, 91.66666666666667, 89.66666666666667 | 90.66666666666667 | 91.67, 89.67, 91.67, 89.67 | 90.67 | 0 |
| `serena` | 81.33333333333333, 83.33333333333334, 91.66666666666667, 91.66666666666667 | 87.5 | 81.33, 79.33, 90.67, 91.67 | 86 | 0 |
| `graphify-cli` | 91.66666666666667, 81.33333333333334, 91.66666666666667, 81.33333333333333 | 86.5 | 83.33, 81.33, 82.33, 89.67 | 82.83 | 0 |
| `graphify-mcp` | 83.33333333333334, 82.33333333333334, 83.33333333333334, 91.66666666666667 | 83.33333333333334 | 83.33, 81.33, 83.33, 89.67 | 83.33 | 0 |

The first run records total unsupported material claims of `2`, `1`, `2`, and `0.5` for control, Serena, Graphify CLI, and Graphify MCP. The independent run instead records median unsupported claims of `0.5`, `0.75`, `0.75`, and `0.5`; these differently aggregated quality fields are retained under their original labels and are not treated as the same statistic.

### API-flow resource and retrieval metrics

Each cell is `pilot-scoring / pilot-scoring-independent`.

| Arm | Median uncached input tokens | Median total tokens | Median base USD | Median conservative USD | Median wall seconds | Median MCP calls | Median Graphify calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| `control` | 56724.5 / 56724.5 | 231678 / 231678 | 0.01812482 / 0.018125 | 0.01812482 / 0.018125 | 64.0415 / 64.0415 | 0 / 0 | 0 / 0 |
| `serena` | 51823 / 51823 | 296247.5 / 296247.5 | 0.01820736 / 0.018207 | 0.03502902 / 0.035029 | 71.3515 / 71.3515 | 16.5 / 16.5 | 0 / 0 |
| `graphify-cli` | 40634.5 / 40634.5 | 121815 / 121815 | 0.01220274 / 0.012203 | 0.01220274 / 0.012203 | 54.892 / 54.892 | 0 / 0 | 4 / 0 |
| `graphify-mcp` | 49830 / 49830 | 186009.5 / 186009.5 | 0.01538576 / 0.015386 | 0.01538576 / 0.015386 | 59.108000000000004 / 59.108000000000004 | 4 / 4 | 4 / 4 |

The Graphify CLI call-count disagreement is explicit: `pilot-scoring` independently recomputed a median of `4` Graphify CLI calls from completed events, while `pilot-scoring-independent` stored `0`. Both runs record four truncated CLI query results per repeat in their underlying observations. Both record all 16 measured Graphify MCP `query_graph` calls as cancelled after required startup, a valid performance outcome rather than technical invalidity; the MCP arm therefore relied on native fallback for its answers.

### Tool-overhead results

| Arm | Correct report (`pilot-scoring`) | Correct report (`pilot-scoring-independent`) | Avoided inspection (both) | Median tokens (both) | Median USD: first / independent | Median wall seconds (both) |
|---|---:|---:|---:|---:|---:|---:|
| `control` | 4/4 | 4/4 | 4/4 | 10720 | 0.0022456999999999998 / 0.0022456999999999998 | 6.779999999999999 |
| `serena` | 0/4 | 0/4 | 4/4 | 10874 | 0.0023072 / 0.0023071999999999997 | 12.155000000000001 |
| `graphify-cli` | 0/4 | 4/4 | 4/4 | 10733.5 | 0.002292 / 0.002292 | 7.164 |
| `graphify-mcp` | 0/4 | 0/4 | 4/4 | 10898 | 0.0023366000000000003 / 0.0023366 | 7.857 |

The Graphify CLI tool-overhead disagreement differs in kind, not merely magnitude: `pilot-scoring` classifies all four answers as incorrect/noncompliant (`0/4`), while `pilot-scoring-independent` classifies all four as correct (`4/4`). Both agree that every arm avoided repository and graph inspection. Both classify Serena and Graphify MCP as `0/4`, and both classify control as `4/4`.

The fixed token overheads over control are identical in both records: control `0`, Serena `154`, Graphify CLI `13.5`, and Graphify MCP `178`. On that frozen rule, both runs interface-disqualify Graphify MCP because its `178`-token overhead is not below Serena's `154`.

### Session and cost accounting

| Quantity | `pilot-scoring` | `pilot-scoring-independent` |
|---|---:|---:|
| Candidate representatives | 32 | 32 |
| Candidate attempts preserved | 33 | 33 |
| Invalid candidate attempts | 1 | 1 |
| Judge sessions/attempts | 33 | 36 |
| Judge retries | 0 | 0 |
| Judge cost USD | 2.514773 | 2.7954 |
| Judge input tokens | 423421 | 457937 |
| Judge output tokens | 20398 | 39474 |
| Candidate retrieval base USD | 0.29527144000000005 | 0.2953 |

`pilot-scoring` used 32 required judges plus one rule-triggered adjudicator. `pilot-scoring-independent` used 32 initial judges plus four adjudicators. Candidate retrieval and judge costs are separate in both records.

## Conclusions shared by both runs

The decision is robust to the disputed scores and classifications:

- `control` is the recommended local default.
- `serena` is the runner-up.
- `graphify-cli` is the best Graphify interface.
- `graphify-mcp` is interface-disqualified because its fixed overhead is not lower than Serena's.
- Retry sensitivity changes neither the overall selection nor the best Graphify interface.
- No arm has unresolved technical invalidity or two critical API-flow failures.

These conclusions are intentionally separate from the disputed measurements. `pilot-scoring-independent` ranks Graphify MCP above Graphify CLI on blind accuracy, but still chooses Graphify CLI as the best Graphify interface under the frozen interface rule.

## Limitations

This was a local pilot with only two tasks and four repeats. The 126-session main matrix, the remaining useful tasks, the six-task adoption gates, and the full-repository adoption analysis did not run. Blind judging could not conceal arm-identifying phrases already present in candidate answers. Graphify MCP accuracy mostly measures native fallback because all measured graph calls were cancelled. Retry and error counts depend on frozen string-match heuristics. The two scoring operators produced materially different accuracy judgments, one tool-overhead classification, judge counts and costs, and retrieval-call accounting; the archive preserves that uncertainty instead of resolving it after the fact.

The companion `pilot-audit.json` stores each run as a separately attributed record, retains exact source values and source-artifact hashes, and contains no raw model answers or machine-specific personal paths.
