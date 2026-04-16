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
pnpm lint
pnpm typecheck
pnpm test
pnpm synth
```

## Stages

- Default stage: `prod`
- Optional non-production stage: `dev`

Stage behavior is centralized in `packages/config`.
Production names stay bare, and `dev` resources receive a `dev-` prefix only when `STAGE=dev` or CDK context explicitly selects `dev`.
