# Execution prompt 4: rewrite the cross-tool agent guides

Work from the `brimax-life` repository root after Prompts 1 through 3 have completed. Complete the final documentation migration in this session.

## Objective and authorization

Review and rewrite all five existing `AGENTS.md` files as one coherent instruction system for Codex, Claude Code, and Kimi Code. Native `rg` plus focused source reads must be the default. The repository Graphify CLI wrapper must be optional and experimental, reserved for unfamiliar cross-layer discovery, with every result verified in native source.

You are authorized to edit only the five agent guides and the Claude import shims described below. Preserve unrelated work and settings. Leave changes unstaged. Do not commit, push, create or publish a branch or pull request, modify production-promotion integration tests, or edit `docs/prompts/tooling/`.

## Current state to revalidate

- The five guides should be `AGENTS.md`, `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `infra/cdk/AGENTS.md`, and `infra/opentofu/AGENTS.md`.
- Root, API, web, and CDK `CLAUDE.md` files should import their colocated guide with `@AGENTS.md`; OpenTofu previously lacked its shim.
- Claude Code supports imports in `CLAUDE.md`; confirm the current syntax against the [official Claude Code memory documentation](https://code.claude.com/docs/en/memory).
- Kimi Code natively consumes hierarchical project `AGENTS.md` files; confirm current behavior against the [official Kimi Code documentation](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents). Do not create Kimi-specific duplicates.
- Prompt 3 should have added working `graphify:doctor`, `graphify:build`, and `graphify:query` commands. Revalidate their exact interface from `package.json`, implementation, tests, and `--help` before documenting them.
- Serena and configured/runnable Graphify MCP should already be absent. Archived pilot reports may retain historical names.

## Preflight and safeguards

1. Record `git status --short` and preserve all preceding unstaged changes.
2. Read every existing guide and its relevant nearby package/configuration files before rewriting it. Inventory architectural boundaries, commands, tests, secrets rules, stages, ownership, and path-specific conventions that must survive.
3. Check every local link and command rather than copying stale prose. Do not add undocumented Graphify flags or bypass the repository wrapper.
4. If Prompt 3's wrapper or commands are missing/broken, stop the Graphify-guidance rewrite and report that Prompt 3 must be completed; do not invent a future interface.

## Required guide design

### Root guide

Keep the root guide concise and repository-wide. Preserve accurate existing guidance for:

- workspace roles and architecture boundaries;
- pnpm command cheatsheet;
- test and production-promotion-suite separation;
- Git restrictions and leaving user-controlled publication alone;
- stage/resource naming;
- CDK versus OpenTofu ownership;
- contracts, DynamoDB, secrets, code style, pre-commit behavior, and development logs;
- closest-guide inheritance, reference documentation, and generated/state paths that must not be touched.

Replace obsolete context acquisition guidance with this policy:

1. Use native `rg`, `rg --files`, and focused file reads by default. Start from exact literals, symbols, routes, resources, or imports; broaden only when evidence requires it.
2. Read complete files when initialization order, module-level behavior, configuration, or non-symbol content matters. Verify conclusions against source and tests before editing.
3. Graphify CLI is optional and experimental. Invoke it only through the repository's `pnpm graphify:*` wrapper commands, and only as a fast hypothesis generator for unfamiliar relationships spanning multiple layers.
4. A graph is never evidence. Confirm every graph-derived file, symbol, edge, caller, consumer, owner, and behavior in exact native source before relying on or reporting it.
5. Use native search—not Graphify—as the authoritative method for completeness/enumeration, exact ownership, security-sensitive flows, configuration values, contract consumers, reference/rename plans, and generated or unsupported formats.
6. Immediately fall back to native search when a graph is stale, rebuilt unsuccessfully, truncated, missing expected results, or reports an `INFERRED` or `AMBIGUOUS` relationship. Never increase the budget merely to avoid verification.
7. The normal experimental query budget is 2,000 tokens. Building/rebuilding is on demand through the wrapper and uses local extraction; do not register MCP or run upstream assistant-skill installers.

Remove all active Serena guidance, Serena memory/profile commands, Graphify MCP guidance, obsolete benchmark commands, and stale direct Graphify configuration. Do not remove historical names from the archived pilot reports, which are outside this prompt's edit scope.

### Path-specific guides

Preserve each guide's true local conventions and add Graphify guidance only where useful:

- **API:** optional for unfamiliar flows crossing handlers, domain services, persistence, vendors, contracts, or frontend boundaries. Exact webhook/security behavior, configuration, consumers, and completeness remain native-source tasks.
- **Web:** optional for unfamiliar flows crossing routes/components, hooks/services, contracts, API handlers, or deployment boundaries. Exact UI behavior, accessibility, configuration, consumers, and completeness remain native-source tasks.
- **CDK:** optional for exploratory mapping across stacks, constructs, Lambda/application references, and deployment layers. Exact AWS resource ownership, IAM/security, stage configuration, dependencies, and deployment order require native source and synthesized evidence.
- **OpenTofu:** optional for exploratory mapping between Cloudflare DNS, certificate/API endpoints, CDK outputs, and scripts. Exact resource ownership, provider/state/configuration, dependencies, and plan effects require native source and plan evidence.

Avoid repeating the entire root policy in every nested guide. State only the local use case and stricter local verification, relying on normal nearest-guide inheritance.

### Cross-tool instruction loading

Preserve the existing root, API, web, and CDK `CLAUDE.md` import shims as minimal `@AGENTS.md` files unless current official Claude syntax requires an equivalent correction. Add `infra/opentofu/CLAUDE.md` with the same colocated import. Do not create or duplicate Kimi-specific instruction files because Kimi consumes the hierarchical `AGENTS.md` guides directly.

## Explicit boundaries

- Edit exactly the five `AGENTS.md` files and, only as needed, the five colocated `CLAUDE.md` shims. Do not change application code, package scripts, wrapper logic, archived pilot reports, or tool/user configuration.
- Preserve rules that remain accurate; this is a tooling/routing rewrite, not permission to relax architecture, testing, secrets, or Git controls.
- Do not document Graphify as authoritative, mandatory, or appropriate for every task.
- Do not restore Serena, Graphify MCP, assistant-specific Graphify skills, or direct upstream commands that bypass repository safety checks.

## Stop conditions and destructive-action safeguards

Do not delete an existing guide or import shim. Create only the missing OpenTofu shim and make surgical rewrites to the authorized files. Stop and ask the user if official tool behavior contradicts the approved loading design, if a local convention conflicts with the root policy and cannot be reconciled without changing behavior, or if the Graphify wrapper does not provide the documented safety contract. Do not mask a missing prerequisite with speculative instructions.

## Verification

- Confirm all five guides exist and normal directory inheritance yields root plus the closest nested guide for each workspace.
- Confirm all five `CLAUDE.md` shims resolve to their colocated `AGENTS.md`, including the new OpenTofu shim.
- Confirm no Kimi-specific duplicate guide was created.
- Validate every relative Markdown link from the directory containing each guide and every documented package command against current files/scripts.
- Search active guides and shims for Serena, Graphify MCP, obsolete benchmark commands, stale profile/configuration guidance, and contradictions. There should be no active occurrences.
- Review Graphify wording for all required native-verification categories and fallback conditions: completeness, ownership, security, configuration, consumers, rename/reference tasks, stale, failure, truncation, missing output, `INFERRED`, and `AMBIGUOUS`.
- Compare before/after guides to ensure architecture, test, secrets, stage, ownership, code-style, pre-commit, development-log, and Git restrictions remain intact and consistent.
- Run documentation/link checks available in the repository and `git diff --check`. Do not run the production-promotion integration suite or its preparation command.
- Review the final diff for unrelated changes and confirm nothing was staged.

## Required final report

Report these headings:

1. **Instruction design** — native-search default, experimental Graphify boundary, and source-verification policy.
2. **Guides updated** — concise path-by-path summary of preserved and added guidance.
3. **Cross-tool loading** — Claude shims and Kimi inheritance validation.
4. **Verification evidence** — link, command, contradiction, inheritance, and diff checks with outcomes.
5. **Exceptions or blockers** — any requirement not met; write `None` only if complete.
6. **Working tree** — relevant unstaged paths and confirmation that nothing was staged, committed, pushed, or published.
