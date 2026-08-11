# Serena context benchmark

This benchmark compares native Codex retrieval, minimal Serena semantic retrieval, and the same semantic toolset with curated memories loaded on demand through `serena memories read`. Memory MCP tools remain disabled so the memory arm does not pay for extra tool schemas. Raw output is written under `.tmp/serena-context-benchmark/` and is not committed.

Run the complete counterbalanced experiment:

```bash
RUNS=3 MODEL=gpt-5.6-luna REASONING=low bash scripts/serena-context-benchmark.sh
```

Run a smoke test or one task:

```bash
RUNS=1 TASK_FILTER=tool-overhead bash scripts/serena-context-benchmark.sh
RUNS=1 TASK_FILTER=api-flow bash scripts/serena-context-benchmark.sh
```

Before comparing results, confirm every run used the same Git revision, model, reasoning effort, sandbox, and prompt. Score answers independently against the evidence requirements in `tasks.tsv` before looking at arm names.

Adopt semantic Serena by default only when accuracy is not worse, median uncached input falls at least 20%, median total tokens rise no more than 5%, estimated token cost falls, and median wall time does not regress more than 10%. Enable memories by default only when they improve cost or total tokens over semantic-only Serena without reducing accuracy.

The tool-overhead task measures fixed context cost. Report cached and uncached input separately; cached input is cheaper but still consumes context. Record retries because they can dominate time and token comparisons.

TypeScript is indexed semantically. OpenTofu remains native-search-first because Serena's Terraform language server requires the HashiCorp Terraform executable, which this repository intentionally does not install.
