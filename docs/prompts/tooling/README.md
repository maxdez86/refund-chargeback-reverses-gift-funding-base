# Sequential tooling migration prompts

These prompts implement the approved tooling design: native search guided by `AGENTS.md` is the default, Graphify CLI is an optional experimental discovery aid, and Serena plus every configured or runnable Graphify MCP surface are removed.

## How to run them

Run the prompts in numeric order, one per fresh session, from the repository root:

1. [`01-remove-serena.md`](01-remove-serena.md)
2. [`02-remove-graphify-mcp.md`](02-remove-graphify-mcp.md)
3. [`03-install-configure-graphify-cli.md`](03-install-configure-graphify-cli.md)
4. [`04-rewrite-agent-guides.md`](04-rewrite-agent-guides.md)

Paste the complete contents of one prompt into a fresh session. Review that session's report and working-tree diff before starting the next. Do not discard, stage, or commit the preceding session's changes: each prompt treats the existing working tree, including the preceding prompt's completed edits, as its input.

Prompt 3 additionally requires network access and a working `uv` installation.

### Choosing the runner

Any of Codex, Claude Code, or Kimi Code may run these prompts, but Prompts 1 and 2 modify the user- and repository-level configuration of all three clients. A session must therefore never run a prompt that dismantles its own live integration.

Before starting Prompt 1 or Prompt 2, confirm for the session you intend to use:

- it has **no live Serena MCP connection** and no Serena hooks registered — check the session's advertised tool list, not just the configuration file;
- it is **not** loading the repository `.mcp.json` or `.claude/settings.json` that the prompt will delete;
- no other Codex, Claude Code, or Kimi Code process is concurrently modifying the configurations in scope.

The practical route is to disable the Serena MCP registration for that client, restart the session so the change takes effect, verify Serena tools are gone, and only then paste the prompt. A session that is itself connected to Serena must not run Prompt 1. If none of the installed clients can be started without a Serena connection, disable the registration manually first and treat that as a preliminary step outside these prompts.

### Git preconditions

Each prompt requires that its own deletions end up as ordinary unstaged changes. That is only possible when the paths it deletes are either committed or untracked — never staged additions.

Before starting Prompt 1, confirm `git status --porcelain` shows **no staged entries** for `.serena/`, `.mcp.json`, `.claude/settings.json`, `benchmarks/`, or `scripts/`. Deleting a staged addition leaves the path in the Git index as `AD`, and clearing it would require `git rm --cached` or `git add`, which every prompt forbids.

Commit or unstage that work yourself before starting. The sessions must never resolve this themselves: `git reset`, `git checkout`, `git restore`, and `git stash` can silently discard staged work that exists in no commit.

## Ownership and expected outputs

| Prompt | Owns | Deliberately leaves for later |
|---|---|---|
| 01 | Serena installation, active configuration, memories, hooks, dedicated Serena benchmark, and Serena-only `.gitignore` entries | Graphify MCP, Graphify pilot artifacts, CLI setup, full agent-guide rewrite |
| 02 | Graphify MCP surfaces and retirement of the executable pilot harness; archived human- and machine-readable reports covering both independent scoring runs | Graphify CLI installation and routing guidance |
| 03 | Current Graphify CLI installation, repository wrapper, freshness metadata, ignore rules, focused tests, and their wiring into the root `test` script | Final agent-guide wording |
| 04 | All five `AGENTS.md` guides and Claude import shims | Nothing in the approved migration |

The sessions may edit user-level configuration only where their prompt explicitly authorizes it. They must preserve unrelated settings and repository work. They must leave all changes unstaged and must never commit, push, create a branch or pull request, or modify the production-promotion integration suite.

These files are execution instructions, not migration state. A session running one of them must not rewrite the prompt documents themselves.
