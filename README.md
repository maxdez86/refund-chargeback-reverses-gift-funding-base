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

Run the frontend locally and open it in your browser:

```bash
pnpm dev:all-web
```

This starts `apps/web` on `http://127.0.0.1:5173`.

Logs are written to `.tmp/dev-all-web-apps/`. Keep the command running; use `Ctrl+C` to stop every app.

`pnpm build:web` assembles the production landing bundle for `apps/web` in `apps/web/dist`.

## Stages

- Default stage: `prod`
- Optional non-production stage: `dev`

Stage behavior is centralized in `packages/config`.
Production names stay bare, and `dev` resources receive a `dev-` prefix only when `STAGE=dev` or CDK context explicitly selects `dev`.
