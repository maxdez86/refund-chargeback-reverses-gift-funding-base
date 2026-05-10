# apps/web — Claude Code guide

Guest-facing landing site. SPA, statically built and served from S3 + CloudFront.

## Stack

React 19 · Vite 7 · TypeScript · Tailwind 4 · shadcn/ui (`new-york` style) · Wouter (routing) · TanStack Query (server state) · React Hook Form + Zod (forms) · Framer Motion · Embla Carousel · Sonner (toasts) · Vitest + Testing Library (jsdom).

## Layout

```
src/
  components/
    Navigation.tsx
    sections/        # page sections (Hero, Countdown, Story, PreWedding, Local, Padrinhos, FAQ, Presentes, Fornecedores, …)
    ui/              # shadcn primitives — generated via the shadcn CLI; don't hand-edit
  hooks/             # use-mobile.tsx, use-toast.ts (kebab-case)
  lib/utils.ts       # cn() — clsx + tailwind-merge
  pages/             # route-level components (currently NotFound.tsx)
  assets/            # imported static assets
  index.css          # Tailwind directives + CSS variables (theme tokens)
tests/               # vitest, jsdom env; setup in tests/setup.ts
```

Entry: [src/main.tsx](src/main.tsx) → [src/App.tsx](src/App.tsx) (wraps `QueryClientProvider`, `WouterRouter`, `TooltipProvider`).

## Conventions

- **Import alias** `@/*` → `./src/*`. Configured in both [vite.config.ts](vite.config.ts) and [tsconfig.json](tsconfig.json). Use it for any cross-folder import.
- **Naming.** Components: `PascalCase.tsx`. Hooks: `use-kebab-case.ts(x)`.
- **Styling.** Tailwind utilities + `cn()` from `@/lib/utils` for conditional classes. Theme tokens come from CSS variables in `index.css` — prefer those over raw hex.
- **Forms.** React Hook Form + Zod via `@hookform/resolvers/zod`.
- **Toasts.** `sonner` (top-right by default).
- **Shared types** come from `@brimax/contracts` — don't redefine request/response shapes locally.
- **Dev server.** `pnpm dev:web` (port 5173). [vite.config.ts](vite.config.ts) honors `PORT`, `BASE_PATH`, and `BUILD_OUT_DIR` env overrides.
- **Build output.** `apps/web/dist/` — produced by `pnpm build:web` from the repo root.

## Tests

```bash
pnpm --filter @brimax/web test
```

Vitest config: [vitest.config.ts](vitest.config.ts). Setup file: [tests/setup.ts](tests/setup.ts).

## Don't read

`dist/`, `node_modules/`, `node_modules/.vite/` — already in `.claudeignore`.
