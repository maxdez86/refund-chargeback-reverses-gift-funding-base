# apps/api — Agent guide

Lambda handlers and domain logic use Node.js, TypeScript CommonJS output, AWS SDK v3, Zod, and Vitest. `src/functions/<name>/handler.ts` contains the Lambda entry points; `domain/` contains pure business rules; `services/` contains infrastructure adapters; `lib/` contains shared environment, error, HTTP, and security helpers.

## Conventions

- HTTP responses always go through [src/lib/http.ts](src/lib/http.ts). `jsonResponse(statusCode, body)` and `noContentResponse()` bake in CORS headers — never hand-roll an `APIGatewayProxyStructuredResultV2`.
- Throw [`AppError`](src/lib/errors.ts) with a `statusCode`; the handler wrapper translates it to a response. Don't `try/catch` purely to log-and-return — let the wrapper handle it.
- Read env vars via `getEnv()` in [src/lib/env.ts](src/lib/env.ts). Read secrets via `getAppSecret(key)` in [src/services/secrets-manager/app-secrets.ts](src/services/secrets-manager/app-secrets.ts).
- `domain/` is pure business logic — no `aws-sdk` imports. AWS calls live in `services/`. Handlers wire them together.
- DynamoDB key construction goes through [src/services/dynamodb/key-builder.ts](src/services/dynamodb/key-builder.ts), not ad-hoc string templates.
- Parse incoming bodies and queries with the Zod schemas from `@brimax/contracts`.
- Use relative imports inside this app.

## Tests

```bash
pnpm --filter @brimax/api test
```

Every new function gets a unit test here. Mirror existing tests such as key-builder, payment-service, payment-state, and RSVP-service tests. **Don't** add or edit prod-promotion integration tests as part of a feature — those live in a separate, dedicated task (see root [AGENTS.md](../../AGENTS.md)).

## Context acquisition

Follow the root native-search policy. Graphify is optional only for unfamiliar flows crossing handlers, domain services, persistence, vendors, contracts, or frontend boundaries. Verify every hypothesis in source and tests. Use native search for exact webhook and security behavior, configuration, consumers, completeness, YAML and documentation evidence, and all excluded or unsupported formats.
