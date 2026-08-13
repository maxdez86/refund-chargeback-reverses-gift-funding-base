# Execution prompt 2: remove Graphify MCP and archive the pilot

Work from the `brimax-life` repository root after Prompt 1 has completed. Complete this prompt in this session, then stop. Do not install Graphify CLI or rewrite the agent guides; later prompts own those tasks.

## Objective and authorization

Remove every configured or runnable Graphify MCP integration from Codex, Claude Code, Kimi Code, the repository, and the current user's tool environment. Retain the completed pilot only as a concise human-readable report and one compact machine-readable final audit, then retire its executable harness and raw external cache.

You are authorized to make targeted repository and current-user configuration/tool changes solely for this objective. Preserve unrelated work and settings. Leave changes unstaged. Do not commit, push, create or publish a branch or pull request, expose secrets, or modify production-promotion integration tests. Do not edit `docs/prompts/tooling/`.

## Known state to revalidate

- Prompt 1 should have removed Serena except for historical mentions inside the Graphify pilot reports.
- `benchmarks/graphify-context/` previously contained `README.md`, `results.md`, fixtures, task/query definitions, and scoring schema.
- `scripts/graphify-context-benchmark.sh`, `scripts/graphify-context-results.ts`, and its test formed the executable harness.
- The pilot's external state was previously rooted under the XDG cache, commonly `~/.cache/brimax-life-graphify-benchmark/`, and included a frozen Graphify 0.9.39 environment with `graphify` and `graphify-mcp` entry points. A `current-state.env` file may identify exact artifact paths and digests.
- **The result root named by `RESULTS_ROOT` contains two independently produced scoring directories, `pilot-scoring/` and `pilot-scoring-independent/`, which disagree materially.** Known divergences include serena median accuracy (87.50 vs 86.00), graphify-cli median accuracy (86.50 vs 82.83), graphify-cli tool-overhead correctness (0/4 vs 4/4), judge session count (33 vs 36), and judge cost ($2.514773 vs $2.7954). Both runs nonetheless reach the same conclusions: `control` recommended, `serena` runner-up, `graphify-cli` the best Graphify interface, `graphify-mcp` interface-disqualified. `benchmarks/graphify-context/results.md` currently records **only** the `pilot-scoring` numbers. Revalidate this divergence against the live artifacts; it may have changed.
- A separate current-user Graphify installation or Graphify MCP registration may have appeared since the pilot. Revalidate all of this before mutation.

The accepted boundary is: no configured or runnable Graphify MCP surface. Dormant `graphify.mcp`-style module code bundled inside a later upstream Graphify CLI distribution is acceptable only when no MCP dependency, server registration, executable shim, hook, skill, or command exposes it.

## Preflight and safeguards

1. **Self-modification gate. Run this first and stop if it fails.** Confirm your own session is not using any Graphify or Serena MCP surface this prompt removes: inspect your advertised tool list, not just configuration files. If it is, stop and report that the runner must be changed rather than dismantling your own live integration mid-session.
2. Record `git status --short` and preserve every pre-existing change, including Prompt 1's unstaged edits. Confirm that no path this prompt deletes appears as a staged addition (`A` in the first status column); if any does, stop and report that the operator must commit or unstage it first. Never run `git add`, `git rm`, `git rm --cached`, `git reset`, `git checkout`, `git restore`, or `git stash`, including for cleanup.
3. Inventory Graphify MCP references and executable surfaces in the repository, `PATH`, `uv tool list`, user executable directories, Codex profiles/configuration, Claude Code configuration/skills/hooks, and Kimi Code configuration/skills/hooks. Do not display secrets.
4. Back up any personal configuration that requires editing under `${XDG_CACHE_HOME:-$HOME/.cache}/brimax-life-tooling-removal-backups/graphify-mcp/`, using a timestamped directory and restrictive permissions.
5. Resolve external benchmark paths from trusted metadata where available, canonicalize them, and verify they are descendants of the dedicated Graphify benchmark cache before deletion. Never delete an entire general cache/configuration root or use an unresolved path/glob.
6. Required source artifacts missing, or a personal configuration that cannot be safely parsed, are stop conditions: halt the affected operation and report. Do not invent audit values. **The known disagreement between the two independent scoring runs is not itself a stop condition** — it is expected, and step 3 and step 4 specify how to record it. Stop only if the disagreement cannot be represented faithfully without picking a winner.

## Required implementation

1. Remove Graphify MCP server entries, MCP dependencies/extras, registrations, hooks, skills, commands, and executable shims from all discovered Codex, Claude Code, Kimi Code, repository, and current-user surfaces. Preserve unrelated configuration.
2. If a user-global `graphifyy` tool currently exposes `graphify-mcp`, uninstall that whole user-global distribution now so Prompt 3 starts from a clean boundary. Do not reinstall any Graphify package in this prompt.
3. **Rewrite** `benchmarks/graphify-context/results.md` as the human-readable final pilot report. This step is mandatory, not discretionary. Because the report currently presents only one of the two independent scoring runs as if it were the sole result, it must be updated so that:
   - both `pilot-scoring` and `pilot-scoring-independent` appear side by side wherever they disagree, each labelled with which run produced it;
   - the disagreement is stated explicitly in prose — including the graphify-cli tool-overhead classification, which differs in kind and not merely in magnitude — rather than being left for a reader to infer from two tables;
   - the conclusions both runs share are separated from the numbers they dispute, so the decision's robustness is legible;
   - the report is labelled as evidence for a **code-only Graphify 0.9.39 configuration**, not as a specification for the wrapper Prompt 3 installs. Note plainly that the shipped wrapper may differ in version, ignore policy, and query budget, so these numbers must not be read as its expected behaviour.

   It may retain historical references to Graphify MCP and Serena. Do not fabricate reconciled values, and do not silently drop either run.
4. Build `benchmarks/graphify-context/pilot-audit.json` from the existing frozen external scoring and validation artifacts before deleting them. It must be valid, compact JSON and include enough provenance to audit the final selection: schema/version marker, pilot date or run identity, arms/tasks measured, aggregate accuracy/quality results, token/cost/wall-time comparisons, MCP overhead/failure results, final decision, limitations, and hashes of source scoring artifacts when available. **Both independent scoring runs must be represented as separate, individually attributed records.** Preserve numbers exactly; never blend, average, or reconcile them, and never select one as authoritative. Omit raw model answers, secrets, and machine-specific personal paths.
5. Cross-check `results.md` and `pilot-audit.json` against each other before either is considered final. They must not disagree about any number, count, or classification. A number appearing in one and not the other is acceptable; the same quantity carrying different values in the two files is a blocker.
6. Replace `benchmarks/graphify-context/README.md` with a short historical archive notice explaining that only `results.md` and `pilot-audit.json` are retained, the executable pilot is retired, and these records are not current tooling instructions.
7. After validating both archived reports **and completing the cross-check in step 5**, delete the pilot fixtures and machinery: benchmark evidence/gold/query/task/schema files, every dedicated `scripts/graphify-context-*` harness/scoring file, and the exact dedicated external Graphify benchmark cache. Remove any other pilot-only executable artifact whose ownership is unambiguous. This deletion is irreversible and destroys the only record capable of resolving the two runs' disagreement — do not begin it while any discrepancy between the two archive files remains unexplained.
8. Remove stale Graphify MCP references outside the archived `README.md`, `results.md`, `pilot-audit.json`, and these prompt documents. Do not erase the historical names from the archive.

## Explicit boundaries

- Do not install Graphify CLI, add `.graphifyignore`, add package scripts, build graphs, or implement a wrapper. Prompt 3 owns those changes.
- Do not perform the full `AGENTS.md` rewrite. Prompt 4 owns it.
- Do not delete the human-readable pilot conclusion or fabricate a cleaner result than the source artifacts support.
- Do not treat dormant upstream MCP source code inside a future shared distribution as an active integration; configured/runnable surfaces are the removal target.

## Stop conditions

Stop the affected mutation and ask the user before proceeding if artifact provenance is insufficient, a path cannot be proven to belong to the dedicated benchmark, or a shared configuration cannot be edited without affecting unrelated tools. Do not delete raw evidence until both retained reports validate and agree, and do not declare success while a configured or runnable Graphify MCP surface remains.

Both independent scoring runs must be preserved in the archive. Choosing one as authoritative, dropping one, or blending them is a stop condition, not a resolution.

## Verification

- Parse `pilot-audit.json`, validate required fields/types, and cross-check every reported number and hash against the source artifacts before their deletion.
- Confirm both `pilot-scoring` and `pilot-scoring-independent` are represented in `pilot-audit.json` as separately attributed records, and that every value known to differ between them — accuracy medians, per-repeat scores, tool-overhead correctness, judge counts, judge cost — is carried at its exact source value under both attributions.
- Diff the quantities reported in `results.md` against those in `pilot-audit.json`. Any quantity present in both must match exactly. Treat a mismatch as a blocker and do not proceed to deletion.
- Confirm only the three intended archive files remain in `benchmarks/graphify-context/`.
- Confirm `command -v graphify-mcp` fails and no executable file named `graphify-mcp` remains in known user tool bins or the retired benchmark environment.
- Confirm the relevant package managers do not list an installation exposing Graphify MCP.
- Parse all modified structured configuration and confirm no agent client advertises a Graphify MCP server.
- Search repository and relevant user configurations for Graphify MCP names. Only the three archived pilot files and `docs/prompts/tooling/` may contain historical mentions.
- Confirm the dedicated external benchmark cache is absent while unrelated cache data remains.
- Run focused checks warranted by the edits and `git diff --check`. Never run the production-promotion integration suite or its preparation command.
- Review the final diff and confirm nothing was staged.

## Required final report

Report these headings:

1. **MCP surfaces removed** — registrations, packages, shims, hooks, and skills.
2. **Pilot archive** — retained files, key provenance, and validation of their values. State explicitly how the two independent scoring runs were represented, list the quantities on which they disagree, and confirm `results.md` and `pilot-audit.json` were diffed and agree.
3. **Retired artifacts** — repository harness/fixtures and exact external cache removed.
4. **Backups** — external backup directory and restoration scope, without secrets.
5. **Verification evidence** — commands/checks and outcomes, including `graphify-mcp` absence.
6. **Exceptions or blockers** — unresolved runnable/configured surfaces; write `None` only if none remain.
7. **Working tree** — relevant unstaged paths and confirmation that nothing was staged, committed, pushed, or published.
