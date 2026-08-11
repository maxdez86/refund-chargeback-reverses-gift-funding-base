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
3. Enumerate repository file types. Select only officially documented extras required for supported everyday source formats present here. Terraform and SVG were previously expected to require extras; include them only if current metadata still says so. Never select `mcp` or `all`.
4. Inspect existing package scripts and test conventions before adding files. Reuse installed TypeScript execution/test infrastructure where practical; do not introduce a new runtime framework unnecessarily.
5. Stop before installation if the current package cannot provide the CLI without mandatory MCP dependencies or cannot be made to satisfy the no-runnable-MCP boundary. Report the incompatibility rather than weakening the boundary.

## Installation requirements

1. Install or upgrade the current-user tool with `uv tool install --upgrade` (use the supported force/reinstall option if needed) and an exact extras set derived above. Do not pin the repository to the discovered version and do not implement automatic future upgrades.
2. Never run `graphify install`; it registers assistant-specific skills outside the approved `AGENTS.md` routing design.
3. Because the shared upstream distribution may declare both console scripts, remove the `graphify-mcp` executable shim from the user tool environment and any user-visible bin directory after installation. Canonicalize and validate each target before removal. Do not alter unrelated shims.
4. Verify `graphify` runs and reports the selected version, while `graphify-mcp` is not runnable from `PATH` and no other copy is exposed. Dormant MCP module code inside the installed distribution is acceptable; installed MCP extras/dependencies, registrations, skills, hooks, or runnable shims are not.

## Repository implementation

### Ignore policy

Add a tracked root `.graphifyignore`. It should allow ordinary supported project source and documentation to be graphed while excluding at least:

- dependencies, package-manager stores, virtual environments, caches, coverage, logs, and temporary files;
- generated/build outputs such as `dist/`, `build/`, `cdk.out/`, and generated metadata;
- Terraform/OpenTofu working directories, plans, state, and all `*.tfstate*` data;
- media/binary assets and lockfiles, including `pnpm-lock.yaml`;
- benchmark directories and artifacts, `docs/prompts/tooling/`, and `docs/experimentation/`;
- agent/tool instruction and configuration surfaces such as `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.kimi*`, `.mcp.json`, and `.serena/`.

Use valid Graphify ignore syntax confirmed from current documentation. Do not accidentally exclude normal application, package, infrastructure source, or ordinary architecture/runbook/vendor documentation.

### Wrapper and public commands

Implement a small, testable TypeScript wrapper following repository conventions, with package scripts exposing exactly:

```bash
pnpm graphify:doctor
pnpm graphify:build
pnpm graphify:query -- "<seed>" --mode <bfs|dfs> --budget <tokens>
```

The wrapper must:

1. Resolve and validate the repository root rather than relying on an arbitrary current directory.
2. Store graph files, temporary build data, and metadata outside the repository under `${XDG_CACHE_HOME:-$HOME/.cache}/brimax-life-graphify/<stable-repository-id>/`. Never write generated graphs to Git-tracked paths.
3. Record metadata containing at least a schema version, canonical repository identity, deterministic source digest, `.graphifyignore` digest, Graphify version, build status, graph hash, and build time. Do not record secrets or personal source content.
4. Compute the source digest deterministically over every included supported file, including relevant untracked files, with relative path, content, and missing/deleted-file state represented so additions, edits, deletions, and ignore-rule changes invalidate the graph. Do not hash generated/cache paths that are excluded from extraction.
5. Treat a graph as stale when it or metadata is absent, a prior build is not successful, the source digest changes, ignore digest changes, installed Graphify version changes, or graph hash validation fails.
6. Before every query, automatically perform a full local extraction when stale. Use current official CLI flags, disable clustering, and use no remote API, API key, MCP transport, or indexing/clustering model.
7. Build into a unique temporary external location. Mark the current graph unusable before rebuilding and atomically promote graph plus successful metadata only after Graphify exits successfully and the graph validates. On failure, retain diagnostic metadata but ensure neither the failed output nor a prior graph can be queried as current.
8. Refuse to operate if `graphify-mcp` is runnable or an active Graphify MCP registration is detected. `doctor` must explicitly check this invariant along with versions, cache writability, ignore rules, and required CLI capabilities.
9. Default query budget to 2,000 tokens, validate a positive bounded user value, and accept only `bfs` or `dfs`. Do not automatically expand the budget or retry with an unbounded query.
10. Clearly label output as experimental discovery. Truncation, missing results, and every `INFERRED` or `AMBIGUOUS` relationship must produce a visible warning requiring native source verification; they must not trigger automatic budget expansion.

Keep process invocation argument-safe and cross-platform within the repository's supported Unix-like environment. Separate pure digest/freshness/path logic from subprocess and filesystem effects so it can be unit-tested.

## Focused tests

Add focused Vitest unit tests in the appropriate existing test location for at least:

- deterministic digest stability independent of traversal order;
- source addition, modification, deletion, and ignore-file changes;
- Graphify version changes and graph-hash mismatch;
- missing graph/metadata and query-before-build behavior;
- external cache paths with no repository graph writes;
- failed builds invalidating prior output and successful atomic promotion;
- exactly one automatic rebuild before a stale query;
- default 2,000-token budget, mode/budget validation, and no automatic expansion;
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
- Run the new focused unit tests, wrapper `doctor`, applicable shell syntax checks, `pnpm lint`, `pnpm typecheck`, and relevant unit tests. Run `pnpm test` only if proportionate and feasible. Never run `pnpm test:integration:prod-promotion` or its prepare command.
- Run `git diff --check`, inspect `.gitignore` interaction with the external cache design, and confirm no graph/cache artifact entered the working tree.
- Review the final diff for unrelated changes and confirm nothing was staged.

## Required final report

Report these headings:

1. **Installed CLI** — official sources, latest stable version, selected extras, and exact installation result.
2. **MCP boundary** — shim/dependency/config checks proving no configured or runnable Graphify MCP.
3. **Repository interface** — files and commands added, cache location, freshness/rebuild behavior, and query limits.
4. **Test and verification evidence** — commands and outcomes, including any checks not run and why.
5. **Exceptions or blockers** — unmet requirements; write `None` only when all are satisfied.
6. **Working tree** — relevant unstaged paths and confirmation that nothing was staged, committed, pushed, or published.
