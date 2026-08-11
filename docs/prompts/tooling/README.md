# Sequential tooling migration prompts

These prompts implement the approved tooling design: native search guided by `AGENTS.md` is the default, Graphify CLI is an optional experimental discovery aid, and Serena plus every configured or runnable Graphify MCP surface are removed.

## How to run them

Run the prompts in numeric order, one per fresh Codex session, from the repository root:

1. [`01-remove-serena.md`](01-remove-serena.md)
2. [`02-remove-graphify-mcp.md`](02-remove-graphify-mcp.md)
3. [`03-install-configure-graphify-cli.md`](03-install-configure-graphify-cli.md)
4. [`04-rewrite-agent-guides.md`](04-rewrite-agent-guides.md)

Paste the complete contents of one prompt into a fresh session. Review that session's report and working-tree diff before starting the next. Do not discard, stage, or commit the preceding session's changes: each prompt treats the existing working tree, including the preceding prompt's completed edits, as its input.

Before each session, make sure no other Codex, Claude Code, or Kimi Code process is concurrently modifying the configurations in scope. Prompt 3 additionally requires network access and a working `uv` installation.

## Ownership and expected outputs

| Prompt | Owns | Deliberately leaves for later |
|---|---|---|
| 01 | Serena installation, active configuration, memories, hooks, and dedicated Serena benchmark | Graphify MCP, Graphify pilot artifacts, CLI setup, full agent-guide rewrite |
| 02 | Graphify MCP surfaces and retirement of the executable pilot harness; archived human- and machine-readable reports | Graphify CLI installation and routing guidance |
| 03 | Current Graphify CLI installation, repository wrapper, freshness metadata, ignore rules, and focused tests | Final agent-guide wording |
| 04 | All five `AGENTS.md` guides and Claude import shims | Nothing in the approved migration |

The sessions may edit user-level configuration only where their prompt explicitly authorizes it. They must preserve unrelated settings and repository work. They must leave all changes unstaged and must never commit, push, create a branch or pull request, or modify the production-promotion integration suite.

These files are execution instructions, not migration state. A session running one of them must not rewrite the prompt documents themselves.
