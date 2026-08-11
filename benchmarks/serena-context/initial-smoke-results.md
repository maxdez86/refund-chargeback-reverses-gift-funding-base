# Initial Serena smoke results

These are single-run diagnostics, not a statistically powered conclusion. The full counterbalanced benchmark remains available through `scripts/serena-context-benchmark.sh`.

## Tool-overhead smoke

| Arm | Total tokens | Uncached input | Wall time |
|---|---:|---:|---:|
| Control | 13,344 | 1,140 | 6.566 s |
| Semantic Serena | 36,762 | 14,431 | 14.048 s |
| Serena + on-demand memory prompt | 36,884 | 14,525 | 13.255 s |

No repository files were inspected. The Serena arms demonstrate the fixed cost of making semantic tools discoverable.

## API-flow smoke

| Arm | Total tokens | Uncached input | Wall time | MCP calls | Native commands |
|---|---:|---:|---:|---:|---:|
| Control | 162,235 | 34,502 | 51.867 s | 0 | 10 |
| Semantic Serena | 249,031 | 30,270 | 53.721 s | 17 | 2 |
| Serena + on-demand memory prompt | 202,260 | 40,063 | 63.639 s | 0 | 7 |

Semantic Serena reduced uncached input by 12.3% and native command calls by 80%, but increased total tokens by 53.5%. The memory arm did not improve either token metric. Neither Serena arm meets the rollout thresholds from the benchmark README.

## Initial rollout decision

Keep Serena disabled in the default Codex profile and enable it explicitly with `codex -p serena` for tasks likely to benefit from semantic navigation. Curated memories remain available through `serena memories read <name>` without exposing memory MCP schemas.

The first API-flow smoke was discarded because broad exact-text searches discovered the committed benchmark task definitions and contaminated the answer. The runner now explicitly excludes benchmark definitions and Serena also ignores that directory.
