# Brimax Life

AWS-first monorepo for the Brimax wedding platform on **December 6, 2026**.

## Workspaces

- `apps/web`: guest-facing React/Vite site
- `apps/web-v2`: static landing page served from `/v2`
- `apps/web-v3/artifacts/brimax`: static landing page served from `/v3`
- `apps/web-v4`: static landing page served from `/v4`
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

`pnpm build:web` assembles the production landing bundle in `apps/web/dist` with:

- `/` from `apps/web`
- `/v2` from `apps/web-v2`
- `/v3` from `apps/web-v3/artifacts/brimax`
- `/v4` from `apps/web-v4`

## Stages

- Default stage: `prod`
- Optional non-production stage: `dev`

Stage behavior is centralized in `packages/config`.
Production names stay bare, and `dev` resources receive a `dev-` prefix only when `STAGE=dev` or CDK context explicitly selects `dev`.
