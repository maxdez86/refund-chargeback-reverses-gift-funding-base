# apps/web — Agent guide

Guest-facing React/Vite SPA served from S3 and CloudFront. The app uses React, Vite, TypeScript, Tailwind, shadcn/ui, Wouter, TanStack Query, React Hook Form, Zod, Framer Motion, Embla, Sonner, Vitest, and Testing Library.

`src/` contains components, hooks, pages, assets, `index.css`, and `main.tsx`/`App.tsx`; generated shadcn primitives under `src/components/ui/` should not be hand-edited. Vitest uses jsdom and `tests/setup.ts`.

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

New functions and components ship with a Vitest unit test under `tests/`. **Don't** add prod-promotion integration tests as part of a feature — that's a separate, dedicated task (see root [AGENTS.md](../../AGENTS.md)).

The dev server loads `.env.dev`, honors `PORT`, `BASE_PATH`, and `BUILD_OUT_DIR`, and provides read-only development proxies for deployed media and API reads. Local writes are blocked; these proxies are dev-only. Build output is `apps/web/dist/`.
