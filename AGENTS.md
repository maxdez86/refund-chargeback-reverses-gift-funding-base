# brimax-life — Agent guide

AWS-first pnpm monorepo for the Brimax wedding platform. Target date: 2026-12-06.

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
pnpm synth
pnpm deploy:platform
pnpm deploy:backend
pnpm deploy:landing:cert
pnpm wait:landing:cert
pnpm deploy:landing:edge
pnpm opentofu:cert:{init,plan,apply}
pnpm opentofu:dns:{init,plan,apply}
pnpm opentofu:api-dns:{init,plan,apply}
pnpm test:payments:pix
pnpm test:payments:webhook
pnpm test:payments:negative
```

## Conventions that matter

**Testing.** Every new function ships with a Vitest unit test in the same workspace — mirror the existing style (`apps/api/tests/*.test.ts`, `apps/web/tests/`). CI's `dev-pr-validation` baseline job runs `pnpm test` and `pnpm test:coverage` on every PR. **Do not** write or modify the prod-promotion integration suite (`pnpm test:integration:prod-promotion` / `pnpm prepare:integration:prod-promotion`, driven by [.github/workflows/prod-promotion-validation.yml](.github/workflows/prod-promotion-validation.yml)) as part of a feature — that integration coverage is authored in a separate, dedicated prompt. Implement the feature and its unit tests only.

**Git.** Never run `git push`, and never open or publish a branch or PR — pushing is always the user's action. Staging and committing are allowed only when the user explicitly asks; otherwise leave changes in the working tree.

**Local guides.** Use the closest guide for path-specific conventions: [apps/api/AGENTS.md](apps/api/AGENTS.md), [apps/web/AGENTS.md](apps/web/AGENTS.md), [infra/cdk/AGENTS.md](infra/cdk/AGENTS.md), [infra/opentofu/AGENTS.md](infra/opentofu/AGENTS.md).

**Stages.** `prod` is the default; `STAGE=dev` or CDK `-c stage=dev` adds `dev-`. Always use `resolveStage()` and `resourceName()` from `@brimax/config`.

**Boundaries.** CDK owns AWS resources; OpenTofu owns Cloudflare DNS. Shared request/response schemas belong in `packages/contracts` first. DynamoDB remains a single-table design with keys built by the API key-builder.

**Secrets.** Never echo `.env`. Runtime secrets use `getAppSecret(key)` from the per-stage JSON bucket secret. Vendor credentials, Turnstile behavior, and lookup-proof rotation follow the existing CDK/Secrets Manager design documented in the repository.

**Code style.** TypeScript strict, Zod at boundaries, Vitest tests, functional React, `@/` imports in web, and relative imports in API.

**Pre-commit.** `pnpm precommit:check` runs lint fixes, lint, typecheck, and tests; CI remains check-only.

**Dev logs.** `pnpm dev:all-web` writes to `.tmp/dev-all-web-apps/`; tail those files instead of restarting the server.

## Context acquisition

- Use `rg` first for Markdown, JSON/YAML/TOML, shell scripts, Terraform attributes, generated metadata, and exact literals.
- Read a complete source file only when initialization order, module-level behavior, or non-symbol content matters.
- Verify semantic findings against source and tests before editing; fall back to native search when language-server coverage is incomplete.

## Where to read more

- [docs/architecture/overview.md](docs/architecture/overview.md)
- [docs/runbooks/bootstrapping.md](docs/runbooks/bootstrapping.md)
- [docs/runbooks/deploy.md](docs/runbooks/deploy.md)
- [docs/runbooks/payments-api-testing.md](docs/runbooks/payments-api-testing.md)
- [docs/vendors/](docs/vendors/)

## Don't read / don't touch

Avoid [docs/experimentation/](docs/experimentation/), [install-opentofu.sh](install-opentofu.sh), `pnpm-lock.yaml`, and generated/state paths including `cdk.out/`, `.terraform/`, `.opentofu/`, `*.tfstate*`, `dist/`, and `node_modules/`.
