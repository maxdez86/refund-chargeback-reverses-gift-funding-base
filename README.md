# Brimax Life

AWS-first monorepo for the Brimax wedding platform on **December 6, 2026**.

## Workspaces

- `apps/web`: guest-facing React/Vite site
- `apps/api`: Lambda handlers and domain logic
- `packages/contracts`: shared schemas and DTOs
- `packages/config`: shared runtime conventions
- `infra/cdk`: AWS infrastructure as code
- `tests/e2e`: end-to-end flow coverage

## Architecture

- Static frontend on S3 + CloudFront
- Lambda-based API and webhooks
- DynamoDB single-table design
- Shared contracts between frontend and backend
- AWS CDK in TypeScript

## Getting Started

```bash
corepack enable
pnpm install
pnpm build:web
pnpm lint
pnpm typecheck
pnpm test
pnpm synth
```

## Pre-Commit Validation

Run the full local validation suite before creating any commit:

```bash
pnpm precommit:check
```

`pnpm precommit:check` is a local convenience workflow. It auto-fixes ESLint issues first, then immediately re-runs the lint check to confirm no lint errors remain before continuing.

That command runs these local checks in sequence:

```bash
pnpm lint:fix
pnpm lint
pnpm typecheck
pnpm test
```

Only the local `pnpm precommit:check` flow attempts auto-fixes. GitHub Actions runs `pnpm lint` as a check-only step and fails on lint violations without modifying files.

If you want to inspect failures one step at a time, run the commands individually in that order.

Coverage is intentionally separate because it is slower than the default pre-commit checks:

```bash
pnpm test:coverage
```

Run the frontend locally and open it in your browser:

```bash
cp .env.dev.example .env.dev
```
```bash
pnpm dev:web
```

This starts `apps/web` on `http://127.0.0.1:5173`.
By default it loads `.env.dev` and targets the isolated `dev` domains.
To debug against production intentionally, run `BRIMAX_ENV_FILE=.env BRIMAX_LOCAL_ALLOW_PROD=true pnpm dev:web`.

Logs are written to `.tmp/dev-all-web-apps/`. Keep the command running; use `Ctrl+C` to stop every app.

`pnpm build:web` assembles the production landing bundle for `apps/web` in `apps/web/dist`.

## Payment API Testing

Backend payment deployment and production API validation are documented in [docs/runbooks/payments-api-testing.md](docs/runbooks/payments-api-testing.md).
Useful entrypoints:

```bash
pnpm deploy:backend
pnpm test:payments:pix
pnpm test:payments:webhook
pnpm test:payments:negative
```

## Deployment Bootstrap

- production bootstrap: [docs/runbooks/bootstrapping.md](docs/runbooks/bootstrapping.md)
- dev bootstrap: [docs/runbooks/bootstrapping-dev.md](docs/runbooks/bootstrapping-dev.md)
- GitHub Actions OIDC bootstrap: [docs/runbooks/bootstrap-github-oidc.md](docs/runbooks/bootstrap-github-oidc.md)

## Stages

- Default stage: `prod`
- Optional non-production stage: `dev`

Stage behavior is centralized in `packages/config`.
Production names stay bare, and `dev` resources receive a `dev-` prefix only when `STAGE=dev` or CDK context explicitly selects `dev`.
