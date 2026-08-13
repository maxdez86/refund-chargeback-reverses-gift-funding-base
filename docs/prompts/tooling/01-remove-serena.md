# Execution prompt 1: completely remove Serena

Work from the `brimax-life` repository root. Complete this prompt in this session, then stop. Do not perform any Graphify MCP removal, Graphify CLI installation, or broad `AGENTS.md` rewrite; later prompts own those tasks.

## Objective and authorization

Completely remove Serena's installed executables, active integrations, project data, memories, hooks, and dedicated legacy benchmark from this machine and repository. You are authorized to make targeted changes to this repository and to the current user's Codex, Claude Code, Kimi Code, and `uv` tool configuration solely for that objective. All four surfaces are in scope: Codex user configuration, repository-level Claude Code configuration, Kimi Code configuration, and user-level `~/.claude` settings.

Preserve all unrelated work and settings. Do not commit, push, create or publish a branch or pull request, expose secrets, or modify production-promotion integration tests. Do not edit any file under `docs/prompts/tooling/`.

**Git index rule.** Leave every change you make as an unstaged working-tree change. Never run `git add`, `git rm`, `git rm --cached`, `git reset`, `git checkout`, `git restore`, or `git stash` for any reason, including cleanup. If a path you must delete is a *staged addition* rather than a committed file, deleting it leaves it in the index as `AD` and you cannot clear it without a forbidden command — stop and report that as a blocker instead of improvising. See the preflight check below.

## Known state to revalidate

Do not assume this snapshot is still exact:

- `serena-agent` 1.7.0 was installed as a user-level `uv` tool providing **three** console scripts: `serena`, `serena-agent`, and `serena-hooks`. Verify the full entry-point set from the package manager rather than assuming this list.
- The user's Codex configuration had `[mcp_servers.serena]` in `~/.codex/config.toml` (with `enabled = false`), Serena `PreToolUse`/`SessionEnd` entries in `~/.codex/hooks.json`, and a Serena-dedicated profile at `~/.codex/serena.config.toml` that re-enables both. Codex profile files can also exist as `$CODEX_HOME/<profile-name>.config.toml`; see the [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). The `codex` executable may not be on `PATH` even when `$CODEX_HOME` is present and actively written; in that case edit the structured files directly rather than looking for a management command.
- Repository integration existed in `.mcp.json`, `.claude/settings.json`, `.serena/`, root `AGENTS.md`, `.gitignore`, `benchmarks/serena-context/`, and `scripts/serena-context-benchmark.sh`.
- Claude Code and Kimi Code may have user-, project-, or workspace-level MCP registrations or hooks not listed above. A `~/.kimi-code/` directory may exist with no Serena references at all; inspect it and treat "nothing found" as a valid outcome rather than searching harder for something to remove.
- The completed Graphify pilot under `benchmarks/graphify-context/` contains historical Serena comparisons and must remain intact for Prompt 2.

## Preflight and safeguards

1. **Self-modification gate. Run this first and stop if it fails.** This prompt uninstalls the `serena` executable, deletes the repository `.mcp.json` that registers the Serena MCP server, and deletes the `.claude/settings.json` that registers Serena `SessionEnd` hooks. Confirm that *your own session* is not using any of them: inspect your advertised tool list for live Serena MCP tools and check whether Serena hooks are registered for this client. If your session has a live Serena connection or active Serena hooks, **stop immediately and report that the runner must be changed** — do not disable your own integration mid-session and continue. Removing a running MCP server's executable and registration from inside that same session can leave a half-applied removal if the session terminates.
2. Record `git status --short` and identify pre-existing changes. Never revert or overwrite them. **Confirm that none of `.serena/`, `.mcp.json`, `.claude/settings.json`, `benchmarks/serena-context/`, or `scripts/serena-context-benchmark.sh` appears as a staged addition** (`A` in the first status column). If any does, stop and report that the operator must commit or unstage that work before this prompt can run; deleting a staged addition would strand it in the Git index and every command that could clear it is forbidden.
3. Inventory Serena references before mutation in the repository, `PATH`, `uv tool list`, shell-visible shims, and relevant user configuration directories for Codex, Claude Code, and Kimi Code. Inspect targeted files without printing tokens, environment variables, or secret values.
4. Before editing or deleting a personal configuration file, copy it to a timestamped directory under `${XDG_CACHE_HOME:-$HOME/.cache}/brimax-life-tooling-removal-backups/serena/`. Preserve restrictive permissions and report the backup directory, not file contents.
5. Resolve every deletion target to an explicit path and confirm it is the intended Serena path. Never recursively delete a home directory, configuration root, workspace root, or unresolved variable/glob.
6. If a configuration cannot be parsed, a target's ownership is ambiguous, or a targeted edit cannot preserve unrelated entries, stop before changing that target and report the blocker. Continue safe independent work when possible.

## Required implementation

1. Uninstall the `serena-agent` user-level `uv` tool using the package manager that owns it. Enumerate the tool's console scripts first and verify that **every** one of them — `serena`, `serena-agent`, `serena-hooks`, and anything else the package declares — no longer resolves from `PATH` or from known user tool bins. Remove only Serena-owned leftover executable shims.
2. Remove Serena MCP tables, profiles, and references from the current user's Codex configuration, including `[mcp_servers.serena]` wherever it occurs and any Serena entries in `$CODEX_HOME/hooks.json`. Delete `$CODEX_HOME/serena.config.toml` when it is Serena-dedicated. Inspect sibling Codex profile files, but preserve every unrelated profile and setting.
3. Remove Serena MCP registrations, hooks, skills, commands, and Serena-only settings from Claude Code and Kimi Code user/project/workspace configuration, including user-level `~/.claude` settings. Use their installed CLI management command when available and reliable; otherwise make a surgical structured-file edit. Do not delete a shared file merely because one entry was Serena-related, and do not invent a removal where inventory found no Serena reference.
4. In the repository, remove Serena from `.mcp.json` and `.claude/settings.json` while preserving unrelated entries. Both files are expected to be entirely Serena-owned: `.mcp.json` registering only the `serena` server, and `.claude/settings.json` containing only `serena-hooks` entries. When that holds, **delete the file outright** rather than leaving an empty `{}` or `{"mcpServers":{}}` scaffold. If either file turns out to carry unrelated configuration, edit surgically and keep the file.
5. Delete the repository's `.serena/` directory, `benchmarks/serena-context/`, and `scripts/serena-context-benchmark.sh` after confirming each exact target.
6. Remove the Serena-only entries from the repository `.gitignore` — the block covering `.serena/project.local.yml`, `.serena/cache/`, `.serena/logs/`, `.serena/language_servers/`, and `.serena/*.log`. Preserve every other ignore rule and the surrounding section structure.
7. Surgically remove Serena routing and Serena-memory guidance from the root `AGENTS.md`. Preserve every non-Serena architectural, testing, safety, Git, and context-acquisition instruction. Prompt 4 will perform the complete guide rewrite.
8. Remove other active Serena artifacts discovered during inventory only when ownership is clear and the removal is within this prompt's authorization.

## Explicit boundaries

- Preserve the completed Graphify pilot report and its supporting Graphify benchmark files temporarily, including historical Serena names. Prompt 2 owns their archival cleanup.
- Do not remove or configure Graphify MCP here.
- Do not install or configure Graphify CLI here.
- Do not rewrite nested `AGENTS.md` files or Claude import shims here.
- Historical Serena mentions are allowed only inside the preserved Graphify pilot materials and these sequential prompt documents.

## Stop conditions

Stop the affected mutation and ask the user before proceeding if an unexpected installation owner, shared configuration, or path ambiguity requires a choice not settled by this prompt. Do not declare success while an active Serena surface remains; report any surface that cannot be safely removed as a blocker. A failed optional validation may be reported with evidence, but it is not permission to broaden deletion scope.

## Verification

Use exact commands appropriate to the discovered installation and show summarized evidence in the final report. At minimum:

- Confirm the owning package manager no longer lists `serena-agent`.
- Confirm `command -v serena`, `command -v serena-agent`, and `command -v serena-hooks` all fail, and inspect known user executable directories for stale Serena shims of any name the package declared.
- Parse every modified JSON/TOML/YAML file with a suitable parser or owning application; do not rely only on visual inspection.
- Search repository and relevant user configuration for active `serena`, `serena-agent`, and `serena-hooks` references. Exclude `docs/prompts/tooling/` and the preserved `benchmarks/graphify-context/` pilot materials when evaluating allowed historical mentions. This search must come back clean for `.gitignore`, `AGENTS.md`, `.mcp.json`, `.claude/settings.json`, and `~/.codex/hooks.json` specifically.
- Confirm `.serena/`, the Serena benchmark directory, and its benchmark script are absent.
- Run focused checks warranted by edited repository files and `git diff --check`. Never run `pnpm test:integration:prod-promotion` or its prepare command.
- Review the final diff for unrelated modifications. Confirm every change is unstaged, that no path is left in the `AD` state, and that no Git command from the forbidden list was run.

## Required final report

Report these headings:

1. **Removed** — executables, user configuration, repository configuration, memories, and benchmark artifacts.
2. **Preserved** — unrelated configuration and the temporary Graphify pilot materials.
3. **Backups** — external backup directory and restoration scope, without contents or secrets.
4. **Verification evidence** — commands/checks and their outcomes.
5. **Exceptions or blockers** — anything not fully removed and why; write `None` only if the removal is complete.
6. **Working tree** — relevant unstaged paths and confirmation that nothing was staged, committed, pushed, or published.
