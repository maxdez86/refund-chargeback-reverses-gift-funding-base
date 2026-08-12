# Execution prompt 3: install and configure Graphify CLI

Work from the `brimax-life` repository root after Prompts 1 and 2 have completed. Complete this prompt in this session, then stop. Do not rewrite the agent guides; Prompt 4 owns that work.

## Objective and authorization

Install the newest stable `graphifyy` release available at execution time as a current-user `uv` tool, without MCP support, and add a tested repository wrapper that builds fresh local graphs outside Git immediately before experimental queries when needed.

You are authorized to install/update that user-level tool and make the targeted repository changes described below. Preserve unrelated work and settings. Leave changes unstaged. Do not commit, push, create or publish a branch or pull request, expose API keys/secrets, or modify production-promotion integration tests. Do not edit `docs/prompts/tooling/`.

## Current state to revalidate

- Prompt 2 should have left no configured or runnable Graphify MCP surface and no current-user Graphify installation that exposes it.
- The pilot archive should contain only `README.md`, `results.md`, and `pilot-audit.json` and is historical evidence, not executable tooling.
- This pnpm monorepo currently uses TypeScript, TSX, shell, Markdown, JSON/YAML, Terraform, SVG, CSS, and related web/infrastructure formats. Re-enumerate relevant tracked and untracked source extensions.
- Graphify package extras, command flags, graph formats, and entry points may have changed. Resolve them from current official [Graphify documentation](https://graphify.com/docs) and [PyPI package metadata](https://pypi.org/project/graphifyy/) at execution time.

## Preflight and decision rules

1. Record `git status --short`; preserve all pre-existing and preceding-prompt changes.
2. Resolve the newest stable PyPI version and inspect its official metadata, wheel entry points, supported parsers/extras, and CLI help before installing or designing command invocations. Record the selected version and source URLs.
3. Enumerate repository file types. Select only officially documented extras required for supported everyday source formats present here. The pilot installed `graphifyy[terraform,mcp]==0.9.39`, so `terraform` is the one extra known to have been needed for this repository's formats; re-derive the set from current metadata rather than copying it. Never select `mcp` or `all`. Note that all pilot evidence came from a build that *did* include the `mcp` extra, so the no-MCP install is not byte-for-byte the validated configuration — treat any behavioural difference as expected and report it.
4. Inspect existing package scripts and test conventions before adding files. Reuse installed TypeScript execution/test infrastructure where practical; do not introduce a new runtime framework unnecessarily.
5. Read the archived `benchmarks/graphify-context/results.md` for calibration context before choosing defaults. It describes a code-only Graphify 0.9.39 graph and is historical evidence, not a specification for this wrapper.
6. Stop before installation if the current package cannot provide the CLI without mandatory MCP dependencies or cannot be made to satisfy the no-runnable-MCP boundary. Report the incompatibility rather than weakening the boundary.

## Installation requirements

1. Install or upgrade the current-user tool with `uv tool install --upgrade` (use the supported force/reinstall option if needed) and an exact extras set derived above. Do not pin the repository to the discovered version and do not implement automatic future upgrades.
2. Never run `graphify install`; it registers assistant-specific skills outside the approved `AGENTS.md` routing design.
3. Because the shared upstream distribution may declare both console scripts, remove the `graphify-mcp` executable shim from the user tool environment and any user-visible bin directory after installation. Canonicalize and validate each target before removal. Do not alter unrelated shims. Note that this fights the package manager: `graphify-mcp` is a declared console script, so any future `uv tool upgrade`, `uv tool upgrade --all`, or reinstall recreates it silently. The wrapper's `doctor` invariant below is the compensating control — it detects recreation at next use rather than preventing it. Document this in the report as expected behaviour after an upgrade, not as an anomaly.
4. Verify `graphify` runs and reports the selected version, while `graphify-mcp` is not runnable from `PATH` and no other copy is exposed. Dormant MCP module code inside the installed distribution is acceptable; installed MCP extras/dependencies, registrations, skills, hooks, or runnable shims are not.

## Repository implementation

### Ignore policy

Add a tracked root `.graphifyignore`. It should allow ordinary supported project source and documentation to be graphed while excluding at least:

- dependencies, package-manager stores, virtual environments, caches, coverage, logs, and temporary files;
- generated/build outputs such as `dist/`, `build/`, `cdk.out/`, and generated metadata;
- Terraform/OpenTofu working directories, plans, state, and all `*.tfstate*` data;
- media/binary assets and lockfiles, including `pnpm-lock.yaml` and `pnpm-workspace.yaml`;
- benchmark directories and artifacts, `docs/prompts/tooling/`, and `docs/experimentation/`;
- `install-opentofu.sh` and other paths on the `AGENTS.md` "don't read / don't touch" list;
- agent/tool instruction and configuration surfaces such as `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.kimi*`, and `.mcp.json`.

Do not add a `.serena/` exclusion. Prompt 1 removed that directory; referencing it here would commit a dangling pointer to deleted tooling.

Use valid Graphify ignore syntax confirmed from current documentation. Do not accidentally exclude normal application, package, infrastructure source, or ordinary architecture/runbook/vendor documentation.

**Documentation is graphed. Do not pass `--code-only`.** This is a deliberate change from the pilot, which ran `extract --code-only` *and* excluded `docs/**` outright, producing a 266-file code-only corpus of 1,665 nodes and 3,849 edges. Passing `--code-only` here would silently make the documentation portion of this ignore policy inert, so the two must stay consistent: docs are in scope for both the flag set and the ignore file.

Two consequences follow and must be handled rather than discovered later. The graph will be larger than any graph the pilot measured, so its size, build time, and truncation behaviour are outside the validated envelope — record the actual node/edge counts in the report. And the pilot's accuracy, token, and cost figures no longer describe this configuration; do not cite them as expected behaviour for the shipped wrapper.

### Wrapper and public commands

Implement a small, testable TypeScript wrapper following repository conventions, with package scripts exposing exactly:

```bash
pnpm graphify:doctor
pnpm graphify:build
pnpm graphify:query -- "<seed>" --mode <bfs|dfs> --budget <tokens>
```

The wrapper must:

1. Resolve and validate the repository root rather than relying on an arbitrary current directory.
2. Store graph files, temporary build data, and metadata outside the repository under `${XDG_CACHE_HOME:-$HOME/.cache}/brimax-life-graphify/<stable-repository-id>/`. Define `<stable-repository-id>` as a hex digest of the canonicalized absolute repository root path — stable across sessions and shells, distinct for a second clone of the same remote, and not dependent on git remote configuration. State the chosen derivation in the report. Never write generated graphs to Git-tracked paths.
3. Record metadata containing at least a schema version, canonical repository identity, deterministic source digest, `.graphifyignore` digest, Graphify version, build status, graph hash, and build time. Do not record secrets or personal source content.
4. Compute the source digest deterministically over every included supported file, including relevant untracked files, with relative path, content, and missing/deleted-file state represented so additions, edits, deletions, and ignore-rule changes invalidate the graph. Do not hash generated/cache paths that are excluded from extraction.
5. Treat a graph as stale when it or metadata is absent, a prior build is not successful, the source digest changes, ignore digest changes, installed Graphify version changes, or graph hash validation fails.
6. Before every query, automatically perform a full local extraction when stale. Use current official CLI flags and disable clustering, but **do not pass `--code-only`** — documentation is in scope per the ignore policy above. Use no remote API, API key, MCP transport, or indexing/clustering model.
7. Build into a unique temporary external location. Mark the current graph unusable before rebuilding and atomically promote graph plus successful metadata only after Graphify exits successfully and the graph validates. On failure, retain diagnostic metadata but ensure neither the failed output nor a prior graph can be queried as current.
8. Refuse to operate if `graphify-mcp` is runnable or an active Graphify MCP registration is detected. `doctor` must explicitly check this invariant along with versions, cache writability, ignore rules, and required CLI capabilities.
9. Calibrate the default query budget rather than inheriting the pilot's. **Do not default to 2,000 tokens.** The pilot's frozen calibration recorded `perSymbolAt2000: 24/24 truncated` — every calibrated per-symbol query truncated at exactly that budget, and `queries.tsv` marked 24 of its 25 rows `truncated-at-2000`. Since this wrapper additionally graphs documentation, truncation at 2,000 would be worse still, and a default at which every query truncates makes the truncation warning in item 10 fire unconditionally and carry no information.

   Determine the default empirically: build the graph, run a representative spread of seeds across the layers this tool is meant to explore (an API flow, a contract consumer set, a CDK stack relationship, a web route), and choose the smallest round budget at which a clear majority complete without truncation. Record the seeds tried, the measured truncation rate per budget, and the selected value in the report and in the wrapper's own help text. If no reasonable budget achieves that, report the finding and the truncation curve rather than picking a number that hides it.

   Validate a positive bounded user value and accept only `bfs` or `dfs`. Do not automatically expand the budget or retry with an unbounded query.
10. Clearly label output as experimental discovery. Truncation, missing results, and every `INFERRED` or `AMBIGUOUS` relationship must produce a visible warning requiring native source verification; they must not trigger automatic budget expansion. Word the truncation warning so it reports a partial result that still needs native confirmation, not a failed query — a truncated graph walk can be a useful hypothesis, and the guidance must not push users to discard it reflexively.

Keep process invocation argument-safe and cross-platform within the repository's supported Unix-like environment. Separate pure digest/freshness/path logic from subprocess and filesystem effects so it can be unit-tested.

## Focused tests

### Where the tests live and how they run

Do not look for an existing precedent to imitate — by the time this prompt runs there is none. Prompt 2 deleted `scripts/graphify-context-results.test.ts`, which was the only Vitest test under root `scripts/`, and it was never wired into any package script; it ran only via the workaround `pnpm --filter @brimax/api exec vitest run --root ../..`. The four `vitest.config.ts` files cover `apps/api`, `apps/web`, `packages/config`, and `infra/cdk` — none covers `scripts/`. The two surviving root-level script tests, `scripts/convert-responsive-media.test.ts` and `scripts/prod-promotion-support.test.ts`, use **node:test**, not Vitest, and are enumerated by filename in the root `test` script.

Resolve this explicitly rather than improvising:

1. Place the wrapper and its tests under `scripts/`, consistent with every other repository-level tool. The root `lint` script already covers `scripts`, so no lint change is needed.
2. Match the surviving root-level precedent and write the tests for **node:test**, executed via `tsx --test`. This keeps root `scripts/` on one runner and needs no new Vitest project. If you instead judge Vitest necessary, you must add a Vitest project that actually covers `scripts/` and explain why in the report — do not leave tests that only run through a `--root ../..` workaround.
3. **Wire the new test file into the root `test` script in `package.json`**, alongside the two existing entries. This is required, not optional: `pnpm test` is what CI runs in the `baseline` job of the `dev-pr-validation` workflow, and a test file that is not named there never executes in CI. A `graphify-mcp`-rejection test that never runs is worse than no test, because it implies a guarantee that is not being checked.
4. Confirm after wiring that `pnpm test` actually executes the new tests and that a deliberately failing assertion would fail the command.

### Coverage

Add focused unit tests for at least:

- deterministic digest stability independent of traversal order;
- source addition, modification, deletion, and ignore-file changes;
- Graphify version changes and graph-hash mismatch;
- missing graph/metadata and query-before-build behavior;
- external cache paths with no repository graph writes;
- failed builds invalidating prior output and successful atomic promotion;
- exactly one automatic rebuild before a stale query;
- the calibrated default budget being applied when none is given, mode/budget validation, and no automatic expansion;
- rejection when a `graphify-mcp` shim or active registration is present.

Mock Graphify processes and temporary files in unit tests. A real local build may be used as a bounded smoke test only after unit coverage passes; do not commit its cache.

## Stop conditions and safeguards

- Do not guess changed Graphify flags, formats, extras, or entry-point behavior; stop and report if official metadata/help cannot establish them.
- Do not delete a shim until its canonical path is proven to belong to the Graphify `uv` tool environment.
- Do not silently query a stale graph after any extraction, validation, or metadata failure.
- Do not use `graphify install`, remote services, clustering, API keys, MCP, or model-backed indexing.
- Do not alter archived pilot values or perform Prompt 4's guide rewrite.

Stop and ask the user before proceeding if resolving an unexpected package, cache, configuration, or compatibility condition would require a design choice outside these locked requirements. Never broaden a deletion beyond a canonical Graphify-owned shim or disposable temporary build directory.

## Explicit boundaries

- Do not configure an MCP server, install the `mcp` or `all` extra, retain a runnable `graphify-mcp` shim, or register an assistant-specific skill.
- Do not use remote extraction, clustering, API keys, model-backed indexing, or automatic upgrades after this installation.
- Do not store generated graphs or cache metadata in the repository.
- Do not change application behavior, the archived pilot, user configuration unrelated to Graphify, or any agent guide/Claude shim.

## Verification

- Verify the installed version equals the newest stable version resolved from official sources at execution time and document the selected extras.
- Verify `graphify --help` and the wrapper's constructed flags match the installed release.
- Verify `command -v graphify-mcp` fails, user bins contain no exposed shim, selected dependency metadata contains no MCP extra, and agent configuration advertises no Graphify MCP server.
- Run the new focused unit tests, wrapper `doctor`, applicable shell syntax checks, `pnpm lint`, and `pnpm typecheck`. **Run `pnpm test` and confirm the new tests appear in its output** — this is mandatory, since it is the check that proves the CI wiring works. Never run `pnpm test:integration:prod-promotion` or its prepare command.
- Verify the built graph's node and edge counts and report them next to the pilot's 1,665 nodes / 3,849 edges, so the effect of graphing documentation is visible.
- Report the measured truncation rate at the selected default budget and at least one budget above and below it, as evidence that the default was calibrated rather than assumed.
- Run `git diff --check`, inspect `.gitignore` interaction with the external cache design, and confirm no graph/cache artifact entered the working tree. If the cache design can place any artifact inside the repository under any circumstance, add the necessary `.gitignore` entry rather than relying on the cache path alone.
- Review the final diff for unrelated changes and confirm nothing was staged.

## Required final report

Report these headings:

1. **Installed CLI** — official sources, latest stable version, selected extras, and exact installation result.
2. **MCP boundary** — shim/dependency/config checks proving no configured or runnable Graphify MCP.
3. **Repository interface** — files and commands added, wrapper and test locations, chosen test runner, `<stable-repository-id>` derivation, cache location, freshness/rebuild behavior, and query limits.
4. **Budget calibration** — seeds tried, truncation rate per budget tested, the selected default, and the resulting graph's node/edge counts against the pilot's code-only baseline.
5. **Test and verification evidence** — commands and outcomes, including confirmation that `pnpm test` runs the new tests, and any checks not run and why.
6. **Exceptions or blockers** — unmet requirements; write `None` only when all are satisfied.
7. **Working tree** — relevant unstaged paths and confirmation that nothing was staged, committed, pushed, or published.
