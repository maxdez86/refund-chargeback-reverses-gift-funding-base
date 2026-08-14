# brimax-life — Agent guide

AWS-first pnpm monorepo for the Brimax wedding platform. Target date: 2026-12-06.

## Node runtime

Node 24 LTS is required for repository commands, tests, builds, typechecking, and coding-agent sessions. Node 26 may remain installed on the machine, but it is only an optional compatibility runtime.

The root [.nvmrc](.nvmrc) and [package.json](package.json) are the local runtime sources of truth. The `engines.node` value of `24.x` is intentional and defines the supported project runtime. Node 26 checks in later migration steps are out-of-contract compatibility checks, not an additional supported runtime.

## Workspaces

| Path | Role |
|---|---|
| [apps/web](apps/web/) | Guest-facing React/Vite site (S3 + CloudFront) |
| [apps/api](apps/api/) | Lambda handlers and domain logic (HTTP API + webhooks) |
| [packages/contracts](packages/contracts/src/) | Shared Zod schemas |
| [packages/config](packages/config/src/) | Stage helpers |
| [infra/cdk](infra/cdk/) | AWS CDK stacks |
| [infra/opentofu](infra/opentofu/) | Cloudflare DNS |
| [tests/e2e](tests/e2e/) | End-to-end coverage (planned) |

## Command cheatsheet

```bash
pnpm install
pnpm dev:all-web
pnpm dev:web
pnpm build:web
pnpm build
pnpm lint
pnpm lint:fix
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm precommit:check
pnpm synth
pnpm cdk:bootstrap
pnpm deploy:platform
pnpm deploy:backend
pnpm deploy:landing:cert
pnpm wait:landing:cert
pnpm deploy:landing:edge
# All six OpenTofu modules take {init,plan,apply}; only sentry also takes validate.
pnpm opentofu:cert:{init,plan,apply}
pnpm opentofu:dns:{init,plan,apply}
pnpm opentofu:api-dns:{init,plan,apply}
pnpm opentofu:ses-dns:{init,plan,apply}
pnpm opentofu:zone-settings:{init,plan,apply}
pnpm opentofu:sentry:{init,plan,apply,validate}
pnpm test:payments:pix
pnpm test:payments:webhook
pnpm test:payments:negative
pnpm graphify:doctor
pnpm graphify:build
pnpm graphify:query -- "<seed>" [--mode bfs|dfs] [--budget 1..32000]
```

This list is curated, not exhaustive. One-off operational scripts (`seed:*`, `reset:*`, `import:*`, `smoke:prod`, `media:convert`, `asaas:webhook:sync`, `deploy:github-oidc:*`) are deliberately omitted — read `package.json` for the full set rather than assuming a command does not exist.

## Conventions that matter

**Testing.** Every new function ships with a Vitest unit test in the same workspace — mirror the existing style (`apps/api/tests/*.test.ts`, `apps/web/tests/`). CI's `dev-pr-validation` baseline job runs `pnpm test` and `pnpm test:coverage` on every PR. **Do not** write or modify the prod-promotion integration suite (`pnpm test:integration:prod-promotion` / `pnpm prepare:integration:prod-promotion`, driven by [.github/workflows/prod-promotion-validation.yml](.github/workflows/prod-promotion-validation.yml)) as part of a feature — that integration coverage is authored in a separate, dedicated prompt. Implement the feature and its unit tests only.

**Git.** Never run `git push`, and never open or publish a branch or PR — pushing is always the user's action. Staging and committing are allowed only when the user explicitly asks; otherwise leave changes in the working tree.

**GitHub CLI.** Before running any `gh` command, source `.env` (`set -a; source .env; set +a`) so `GITHUB_TOKEN` is exported, then run `gh` in the same shell invocation — `gh` picks up `GITHUB_TOKEN` from the environment automatically. Never print or echo the token value; it must not appear in command output, logs, or committed files.

**Local guides.** This guide applies repository-wide. The closest nested guide supplements it with path-specific conventions: [apps/api/AGENTS.md](apps/api/AGENTS.md), [apps/web/AGENTS.md](apps/web/AGENTS.md), [infra/cdk/AGENTS.md](infra/cdk/AGENTS.md), [infra/opentofu/AGENTS.md](infra/opentofu/AGENTS.md).

**Stages.** `prod` is the default; `STAGE=dev` or CDK `-c stage=dev` adds `dev-`. Always use `resolveStage()` and `resourceName()` from `@brimax/config`. The shell wrappers (every `deploy:*`, `opentofu:*`, `dev:*`, and `cdk:bootstrap` command above) resolve their stage from the env file that [scripts/landing-env.sh](scripts/landing-env.sh) loads, which defaults to `.env` — that is, **prod**. Prefix dev-stage invocations with `BRIMAX_ENV_FILE=.env.dev`, exactly as the dev workflows do; `STAGE=dev` alone does not redirect them.

**Boundaries.** CDK owns AWS resources; OpenTofu owns Cloudflare DNS. Shared request/response schemas belong in `packages/contracts` first. DynamoDB remains a single-table design with keys built by the API key-builder.

**AWS CLI.** To confirm deployed cloud resources match the code, or to read CloudWatch Logs while diagnosing behavior, query AWS directly with `AWS_PROFILE=personal-stg aws <command>` — the same profile every `deploy:*`/`opentofu:*`/`cdk:bootstrap` wrapper already uses, authorized against account `183286346090` in `us-east-1`. Both `prod` and `dev` stages live in this one account; use the `dev-` resource-name prefix (or its absence) to target the right log group, table, or stack. Stick to read-only calls (`aws logs tail`, `aws logs filter-log-events`, `aws cloudformation describe-stacks`, `aws dynamodb describe-table`, etc.) — never run a mutating AWS CLI command outside the repo's existing deploy or reset scripts without explicit user confirmation.

**Secrets.** Never echo `.env`. Runtime secrets use `getAppSecret(key)` from the per-stage JSON bucket secret. Vendor credentials, Turnstile behavior, and lookup-proof rotation follow the existing CDK/Secrets Manager design documented in the repository.

**Code style.** TypeScript strict, Zod at boundaries, Vitest tests, functional React, `@/` imports in web, and relative imports in API.

**Pre-commit.** `pnpm precommit:check` runs lint fixes, lint, typecheck, and tests; CI remains check-only.

**Dev logs.** `pnpm dev:all-web` writes to `.tmp/dev-all-web-apps/`; tail those files instead of restarting the server.

## Context acquisition

1. Use native `rg`, `rg --files`, and focused file reads by default. Start from exact literals, symbols, routes, resources, or imports; broaden only when evidence requires it.
2. Read complete files when initialization order, module-level behavior, configuration, or non-symbol content matters. Verify conclusions against source and tests before editing.
3. Graphify CLI is optional and experimental. Invoke it only through the repository's `pnpm graphify:*` wrappers, and only as a fast hypothesis generator for unfamiliar relationships that span multiple layers of supported code.
4. A graph is never evidence. Confirm every graph-derived file, symbol, edge, caller, consumer, owner, and behavior in exact native source before relying on it or reporting it.
5. Native search is authoritative for completeness and enumeration, exact ownership, security-sensitive flows, configuration values, contract consumers, reference and rename plans, documentation, and generated, unsupported, or code-only-excluded formats. Use native search and focused reads for Markdown, YAML, HTML, CSS, images and media references, and every other input absent from the graph.
6. Fall back to native search when the graph is stale, a rebuild fails, or expected results are missing. Missing output can mean an unextracted relationship or excluded format, not absence. Treat truncation and every `INFERRED` or `AMBIGUOUS` relationship as a useful partial hypothesis that requires native confirmation. Never increase the budget merely to avoid verification.
7. `pnpm graphify:query` defaults to BFS and an empirically calibrated 12,000-token budget. Build or rebuild on demand through the wrappers only. Extraction is local and code-only, uses `--code-only --no-cluster`, and has no LLM backend; do not register an MCP server or run an upstream assistant-skill installer for this workflow.

## Where to read more

- [docs/architecture/overview.md](docs/architecture/overview.md)
- [docs/runbooks/bootstrapping.md](docs/runbooks/bootstrapping.md)
- [docs/runbooks/bootstrapping-dev.md](docs/runbooks/bootstrapping-dev.md)
- [docs/runbooks/bootstrap-github-oidc.md](docs/runbooks/bootstrap-github-oidc.md)
- [docs/runbooks/deploy.md](docs/runbooks/deploy.md)
- [docs/runbooks/deploy-dev.md](docs/runbooks/deploy-dev.md)
- [docs/runbooks/payments-api-testing.md](docs/runbooks/payments-api-testing.md)
- [docs/vendors/](docs/vendors/)

## Don't read / don't touch

Avoid [docs/experimentation/](docs/experimentation/), [install-opentofu.sh](install-opentofu.sh), `pnpm-lock.yaml`, and generated/state paths including `cdk.out/`, `.terraform/`, `.opentofu/`, `*.tfstate*`, `dist/`, and `node_modules/`.
