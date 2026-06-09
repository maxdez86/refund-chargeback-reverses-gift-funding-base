# brimax-life — Agent guide

## Conventions that matter

**Testing.** Every new function ships with a Vitest unit test in the same workspace — mirror the existing style (`apps/api/tests/*.test.ts`, `apps/web/tests/`). CI's `dev-pr-validation` baseline job runs `pnpm test` and `pnpm test:coverage` on every PR. **Do not** write or modify the prod-promotion integration suite (`pnpm test:integration:prod-promotion` / `pnpm prepare:integration:prod-promotion`, driven by [.github/workflows/prod-promotion-validation.yml](.github/workflows/prod-promotion-validation.yml)) as part of a feature — that integration coverage is authored in a separate, dedicated prompt. Implement the feature and its unit tests only.

**Git.** Never run `git push`, and never open or publish a branch or PR — pushing is always the user's action. Staging and committing are allowed only when the user explicitly asks; otherwise leave changes in the working tree.

**Local guides.** Use the closest guide for path-specific conventions: [apps/api/AGENTS.md](apps/api/AGENTS.md), [apps/web/AGENTS.md](apps/web/AGENTS.md), [infra/cdk/AGENTS.md](infra/cdk/AGENTS.md), [infra/opentofu/AGENTS.md](infra/opentofu/AGENTS.md).
