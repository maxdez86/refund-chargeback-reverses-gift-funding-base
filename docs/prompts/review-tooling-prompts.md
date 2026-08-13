# Review prompt: audit the four tooling-migration prompts before execution

Paste the entire contents of this file into a fresh Claude Code session started from `/home/maxreis86/consulting/brimax-life`.

---

You are a read-only reviewer. Four execution prompts have been written to migrate this repository's agent tooling. They have **not** been run yet. Your job is to find everything that is wrong, unsafe, contradictory, unverifiable, or under-specified in them **before** they are executed, and to report it.

Your deliverable is a report. You are not implementing the migration and you are not fixing the prompts.

## The decision is settled — do not reopen it

The owner has decided, on the basis of a completed retrieval benchmark, that:

- Native `rg` plus focused source reads guided by `AGENTS.md` is the **default** retrieval method.
- **Serena is removed** entirely (executables, MCP registrations, memories, hooks, dedicated benchmark).
- **The benchmarked dependency-graph MCP interface is removed** entirely (no configured or runnable MCP surface).
- **Its CLI interface is retained** as an optional, experimental discovery aid for unfamiliar cross-layer relationships, invoked only through a repository wrapper, with every result verified in native source.
- The graph is rebuilt after project changes.

Do not argue against this decision, propose keeping Serena or the retired dependency-graph MCP interface, re-run or re-score the benchmark, or relitigate the trade-off. Critique only whether the four prompts **correctly and safely implement** that decision. If you believe a piece of evidence contradicts the decision itself, note it in one short paragraph under "Observations outside scope" and move on.

## Absolute constraints for this session

1. **Do not modify anything.** No file creation, edit, deletion, move, or rename anywhere on this machine or in the repository. No `git add`, `git commit`, `git push`, `git checkout`, `git restore`, `git stash`, branch creation, or PR.
2. **Do not execute any of the four prompts**, in whole or in part, and do not perform any migration step "just to check."
3. **Do not install, uninstall, upgrade, or reconfigure any tool.** No `uv tool install/uninstall`, no package installs, no MCP registration changes, no writes to `~/.codex/`, `~/.claude/`, `~/.kimi*`, or any other user configuration.
4. Read-only shell inspection is expected and encouraged: `git status`, `git log`, `rg`, `ls`, `command -v`, `uv tool list`, `--version`, `--help`, reading files. Anything that writes, deletes, or changes state is forbidden.
5. **Never print secrets.** Do not display `.env` contents, tokens, API keys, or credential values. Refer to their location instead.
6. Never run `pnpm test:integration:prod-promotion` or its prepare command. Read [AGENTS.md](../../AGENTS.md) and obey it.
7. Preserve the user's staged, unstaged, and untracked work exactly as found.

## What to review

The four execution prompts and their index:

- [docs/prompts/tooling/README.md](tooling/README.md)
- [docs/prompts/tooling/01-remove-serena.md](tooling/01-remove-serena.md)
- Prompt 2: remove the benchmarked MCP interface and archive the pilot.
- Prompt 3: install and configure the retained CLI interface.
- [docs/prompts/tooling/04-rewrite-agent-guides.md](tooling/04-rewrite-agent-guides.md)

Read all five in full before forming any conclusion.

## Environment facts you should verify rather than assume

These were true when this review prompt was written. Confirm each against the live machine and repository; a changed fact is itself a finding.

- Repository root `/home/maxreis86/consulting/brimax-life`, branch `improve-agents`, HEAD `a92536f93ee368527525b2cd00abf759d69b9f00`.
- The working tree has substantial **staged and unstaged** work, including staged additions under `.serena/`, `.mcp.json`, `.claude/settings.json`, `benchmarks/`, and `scripts/`, plus modified `AGENTS.md` and `.gitignore`.
- A Serena MCP server is currently **running and connected** to at least one live agent session on this machine.
- A completed dependency-graph pilot lives under its benchmark archive path with a dedicated external cache, including trusted state metadata, frozen workspaces, a graph, and the result root.
- That external result root contains **two separate, independently produced scoring directories** that disagree on several reported numbers, judge counts, and one tool-overhead classification. The human-readable results file currently records only one of the two.
- Host qualifications: Node 26.7.0 requires `NODE_OPTIONS=--no-experimental-webstorage` for the full web suite; Ruby is absent, so ten CDK environment-writer tests cannot spawn their validator.

## Correctness dimensions to examine

For each prompt, and for the set as a whole, look for:

1. **Factual errors.** Paths, filenames, command names, package names, tool names, version claims, or described current state that do not match reality. Verify every concrete path and command the prompts assert.
2. **Internal contradictions.** A prompt instructing two incompatible things, or a safeguard that forbids what a required step demands.
3. **Cross-prompt contradictions and ordering hazards.** Prompt N destroying something prompt N+1 needs; ownership boundaries in the README table not matching what each prompt actually does; a later prompt depending on an interface an earlier prompt was never told to create.
4. **Irreversible or destructive steps whose preconditions are not guaranteed.** Anything deleted before the thing that replaces it is proven valid. Anything deleted that also exists as staged or untracked user work.
5. **Unverifiable or unresolvable instructions.** Requirements that depend on external documentation, package metadata, or tool behavior that may not exist or may not say what the prompt assumes. Check the cited URLs actually resolve and support the claim being made.
6. **Under-specification at a decision point.** Places where a reasonable executing agent must invent a policy, and where two competent agents would plausibly choose differently.
7. **Safety and blast radius.** Deletion targets that could resolve to a home directory, a shared configuration root, an unrelated tool's shim, or an unresolved variable or glob. Self-modification hazards where a session edits the configuration of the agent client it is currently running inside.
8. **Verification adequacy.** Whether each prompt's stated verification would actually detect its own failure modes, and whether any success criterion is unfalsifiable.
9. **Consistency with repository conventions.** Testing, workspace layout, `@/` versus relative imports, stage helpers, secrets handling, Git restrictions, and the "don't touch" list in `AGENTS.md`.
10. **Omissions.** Work the decision requires that no prompt owns, or cleanup no prompt performs.

## Specific leads worth checking

These are **suspicions to verify, not established findings**. Confirm or refute each with evidence, and do not assume a lead is real merely because it is listed here. Add anything else you find.

- Prompt 1 requires deleting `.serena/` while also forbidding the reversal or overwriting of pre-existing changes; those files appear to be staged additions. Determine what actually happens to the Git index and whether the two instructions can both be satisfied.
- Prompt 1 and Prompt 2 both authorize editing Codex, Claude Code, and Kimi Code user configuration. Verify which of those clients are actually installed here, and whether a session executing these prompts inside one of those clients would be mutating its own live configuration or a running MCP connection.
- Prompt 2 deletes the dedicated external benchmark cache. Determine exactly what lives under that cache today, whether both independent scoring directories are captured into `pilot-audit.json` before deletion, and whether `results.md` and `pilot-audit.json` would end up telling different stories.
- Prompt 2 retires the pilot results script and its test. Prompt 3 then asks for new wrapper tests "in the appropriate existing test location." Check whether the precedent Prompt 3 would imitate still exists at that point, and where a root-level `scripts/` test is supposed to live given this repository's workspace-scoped testing convention.
- Prompt 3 installs "the newest stable release at execution time" with no version or hash pinning, whereas the pilot pinned an exact wheel by SHA-256. Assess what this means for reproducibility, for the graph-staleness rule keyed on installed version, and for supply-chain posture.
- Prompt 3's ignore policy would graph documentation, while the validated pilot configuration was code-only with documentation excluded. Determine whether this is an intentional change and what it does to graph size, query truncation, and the meaning of the pilot evidence.
- Prompt 3 sets a default query budget and requires truncation warnings. Check the pilot's frozen calibration to see how often queries truncated at that budget, and whether the default is coherent with the documented behavior.
- Prompt 3 deletes the retired MCP shim after installation. Determine whether any ordinary future action would silently recreate it, and whether the stated `doctor` invariant is sufficient to catch that.
- Prompt 4 asserts which `AGENTS.md` and `CLAUDE.md` files exist. Verify each one, including the claim that the OpenTofu shim is missing.
- The README says to run each prompt in a fresh **Codex** session, while the prompts themselves target Claude Code and Kimi Code as well. Determine whether the intended runner is consistent and whether it matters.
- Check whether `.gitignore`, `package.json`, `.claude/settings.json`, `.mcp.json`, or any `AGENTS.md` would be left with stale entries pointing at files the prompts delete.

## Ask before you conclude

You are expected to ask the user questions. Use the question tool for anything where the correct answer depends on the owner's intent rather than on evidence you can gather yourself, including:

- which of two disagreeing scoring records should be treated as authoritative in the retained archive, or whether both must be preserved;
- whether pinning the dependency-graph CLI version is wanted, given the reproducibility trade-off;
- whether documentation should be graphed at all;
- which agent clients are actually in use and must be cleaned;
- whether staged work should be committed, unstaged, or left alone before any deletion runs;
- any deletion whose blast radius you cannot bound from evidence.

Batch related questions rather than asking one at a time, and ask them **before** writing your final verdict, not after. If a question is genuinely blocking, say so explicitly. Do not guess at the owner's intent and present the guess as a finding.

## Required final report

Produce a single report with these sections:

1. **Verdict per prompt.** For each of the four, one of: safe to run as written; safe after listed corrections; not safe to run as written. One sentence of justification each.
2. **Blocking findings.** Anything that could cause data loss, deletion of user work, an unrecoverable state, or a silently wrong result. Each with: which prompt and which section, what is wrong, the evidence you gathered, the concrete failure it would cause, and what a correction would need to achieve. Rank most severe first.
3. **Correctness findings.** Factual errors, contradictions, and ordering hazards that are not blocking. Same structure, more briefly.
4. **Under-specified decision points.** Where an executing agent must invent policy, and what the plausible divergent choices are.
5. **Omissions.** Required work no prompt owns.
6. **Verified-correct.** A short list of the significant things you checked that are actually right, so the owner knows what you covered and can trust the negative space.
7. **Recommended execution order and preconditions.** If the prompts are run after corrections, what must be true before each one starts.
8. **Questions asked and answers received.** Record what you asked the owner and what they said.
9. **Observations outside scope.** At most one short paragraph, only if something genuinely warrants it.

Cite every finding with a clickable `path:line` reference. Distinguish "I verified this against the machine or repository" from "this is my reading of the prompt text." Do not pad the report; a short report with real findings is better than a long one with restated prompt content.

State plainly in your final message whether you changed anything (you should not have) and confirm the working tree is exactly as you found it.
