# apps/api — Claude Code guide

Lambda handlers + domain logic behind the HTTP API and webhooks.

## Stack

Node.js Lambda · TypeScript (CommonJS output) · AWS SDK v3 (DynamoDB DocumentClient, SQS, Secrets Manager) · Zod · Vitest. Workspace deps: `@brimax/contracts`, `@brimax/config`.

## Layered layout

```
src/
  functions/<name>/handler.ts   # Lambda entry points (also listed in package.json `exports`)
  domain/                       # business rules — no AWS imports allowed here
    invitation-service.ts
    payment-service.ts
    payment-state.ts
    rsvp-service.ts
    webhook-processor.ts
  services/                     # infrastructure adapters
    asaas/  dynamodb/  email/  secrets-manager/  stripe/  whatsapp/
  lib/
    env.ts        # getEnv() — cached env var reader
    errors.ts     # AppError (carries statusCode)
    http.ts       # jsonResponse / noContentResponse (CORS baked in)
    security.ts
tests/                          # vitest
```

The 9 Lambda handlers (each `src/functions/<name>/handler.ts`):

`admin-export` · `asaas-webhook` · `asaas-webhook-processor` · `invitation-get` · `payments-create` · `payments-get` · `rsvp` · `stripe-webhook` · `whatsapp-webhook`.

## Conventions

- **HTTP responses always go through [src/lib/http.ts](src/lib/http.ts).** `jsonResponse(statusCode, body)` and `noContentResponse()` bake in CORS headers — never hand-roll an `APIGatewayProxyStructuredResultV2`.
- **Errors.** Throw [`AppError`](src/lib/errors.ts) with a `statusCode`; the handler wrapper translates it to a response. Don't `try/catch` purely to log-and-return — let the wrapper handle it.
- **Env vars.** Read via `getEnv()` in [src/lib/env.ts](src/lib/env.ts) (cached per cold start). Common keys: `WEDDING_TABLE_NAME`, `ASAAS_API_SECRET_ARN`, `ASAAS_WEBHOOK_TOKEN_ARN`.
- **Domain vs services.** `domain/` is pure business logic — no `aws-sdk` imports. AWS calls live in `services/`. Handlers wire them together.
- **DynamoDB.** Single-table design; key construction goes through [src/services/dynamodb/key-builder.ts](src/services/dynamodb/key-builder.ts), not ad-hoc string templates.
- **Validation.** Parse incoming bodies/queries with the Zod schemas from `@brimax/contracts`.
- **Imports.** Relative paths inside this app (no `@/` alias). Workspace deps via `@brimax/contracts` / `@brimax/config`.

## Tests

```bash
pnpm --filter @brimax/api test
```

Existing examples: `tests/key-builder.test.ts`, `tests/payment-service.test.ts`, `tests/payment-state.test.ts`, `tests/rsvp-service.test.ts`. Mirror this style for new tests.

## Don't read

`dist/`, `node_modules/` — already in `.claudeignore`.
