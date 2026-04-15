# Architecture Overview

Brimax uses an AWS-first topology:

- `apps/web` ships static assets to S3 behind CloudFront.
- `apps/api` contains Lambda handlers for public API traffic and webhook ingestion.
- `packages/config` centralizes stage and resource naming conventions.
- `packages/contracts` centralizes shared request and response contracts.
- `infra/cdk` defines the edge, app, data, and observability stacks.
- DynamoDB stores wedding entities in a single table using explicit repository-level key builders.

The frontend consumes only typed API contracts. CDK resolves Lambda entrypoints through `@brimax/api` package exports instead of cross-workspace relative paths. DynamoDB item structure is intentionally private to the backend.
