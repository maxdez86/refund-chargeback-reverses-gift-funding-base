# API data flow

1. API Gateway or webhook events enter `apps/api/src/functions/<name>/handler.ts`.
2. Handlers validate request bodies and queries with schemas from `@brimax/contracts`.
3. Pure business decisions live in `apps/api/src/domain`; handlers compose them with infrastructure adapters.
4. DynamoDB, Asaas, email, and Secrets Manager calls live under `apps/api/src/services`.
5. DynamoDB keys are centralized in `services/dynamodb/key-builder.ts`.
6. Responses and errors pass through `src/lib/http.ts` and `AppError` handling.
7. Unit tests under `apps/api/tests` mirror domain, service, handler, and key-building behavior.

Use mem:repository_map for workspace ownership. Follow `apps/api/AGENTS.md` for rules.
