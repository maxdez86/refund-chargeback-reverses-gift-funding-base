# apps/web — Agent guide

## Conventions

- Use the `@/*` import alias for cross-folder imports.
- Components use `PascalCase.tsx`. Hooks use `use-kebab-case.ts(x)`.
- Use Tailwind utilities plus `cn()` from `@/lib/utils` for conditional classes, and prefer CSS variables in `index.css` over raw colors.
- Forms use React Hook Form + Zod via `@hookform/resolvers/zod`.
- Shared request and response types come from `@brimax/contracts`.
- In dev, `/api/*` reads proxy to the deployed HTTP API and writes are blocked locally. Do not add local write-through behavior to deployed environments.
- Build output is `apps/web/dist/`.

## Tests

```bash
pnpm --filter @brimax/web test
```

New functions and components ship with a Vitest unit test under `tests/`. **Don't** add prod-promotion integration tests as part of a feature — that's a separate, dedicated task (see root [CLAUDE.md](../../CLAUDE.md)).
