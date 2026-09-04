# apps/web — Agent guide

Guest-facing React/Vite SPA served from S3 and CloudFront. The app uses React, Vite, TypeScript, Tailwind, shadcn/ui, Wouter, TanStack Query, React Hook Form, Zod, Framer Motion, Embla, Sonner, Vitest, and Testing Library.

`src/` contains components, hooks, pages, assets, `index.css`, and `main.tsx`/`App.tsx`; generated shadcn primitives under `src/components/ui/` should not be hand-edited. Vitest uses jsdom and `tests/setup.ts`.

Node runtime requirements are defined in root [AGENTS.md](../../AGENTS.md).

## Conventions

- Use the `@/*` import alias for cross-folder imports.
- Components use `PascalCase.tsx`. Hooks use `use-kebab-case.ts(x)`.
- Use Tailwind utilities plus `cn()` from `@/lib/utils` for conditional classes, and prefer CSS variables in `index.css` over raw colors.
- Forms use React Hook Form + Zod via `@hookform/resolvers/zod`.
- Shared request and response types come from `@brimax/contracts`.
- In dev, `/api/*` reads proxy to the deployed HTTP API and writes are blocked locally. Do not add local write-through behavior to deployed environments, and never unblock write methods against the production target.
- Build output is `apps/web/dist/`.

## Admin writes

The dev proxy (`vite.config.ts`, `READ_ONLY_PROXY_METHODS`) forwards `GET`/`HEAD`/`OPTIONS` only and its default target is the **production** API. This is deliberate and stays that way, which has one consequence worth stating plainly: **admin mutations cannot be exercised through `pnpm dev`** — a write is answered with a dev-server 404 and never reaches the API. Correctness for admin writes is established by Vitest unit tests across all four layers; end-to-end verification happens against a deployed dev stage (`BRIMAX_ENV_FILE=.env.dev`).

Every admin write follows the same four-layer path. `deleteAdminGuestMessage` (`src/lib/admin-api.ts`) and its consumers are the reference implementation:

1. **Client** — one exported function per route in `src/lib/admin-api.ts`, throwing `AdminApiError` with a pt-BR message and a typed `kind`. Check `!response.ok` **before** reading the body, so a non-JSON gateway error stays `unavailable`. Routes that answer with the plain `{ message }` envelope get a message map keyed by **HTTP status**; the coded `SEND_ERROR_MESSAGES` map applies only to WhatsApp routes that ship `WhatsappRsvpErrorResponseSchema`. Validate the success payload with its `@brimax/contracts` schema and confirm the response identifies the same subject that was requested. Send an `Idempotency-Key` only where the route actually deduplicates — never on a naturally idempotent one.
2. **Source** — a **required** method on `AdminDashboardSource`, implemented by both `createLiveDashboardSource` (which reports `unauthorized`/`forbidden` through `onAuthError`) and `fixtureDashboardSource` (which validates against the fixture snapshot and throws a realistic error, so the failure path stays demoable). The fixture source is a stateless singleton — never give it mutable module state.
3. **Hook** — an action in `use-admin-dashboard.ts` that dedupes in flight by its subject id, exposes a per-subject `{ status, error? }` record, dispatches the reducer action **after** the request resolves (no optimistic writes), and rethrows on failure so the modal stays open. Abort and clear its in-flight map when the source changes.
4. **UI** — destructive actions open a confirmation modal from `src/components/dashboard/modals/`, driven by `DashboardShell`'s single `ModalState` union, disabled and undismissable while submitting, with the failure rendered in place (`role="alert"`) and success confirmed by a `toast`.

## Tests

```bash
pnpm --filter @brimax/web test
```

New functions and components ship with a Vitest unit test under `tests/`. **Don't** add prod-promotion integration tests as part of a feature — that's a separate, dedicated task (see root [AGENTS.md](../../AGENTS.md)).

The dev server loads `.env.dev`, honors `PORT`, `BASE_PATH`, and `BUILD_OUT_DIR`, and provides read-only development proxies for deployed media and API reads. Local writes are blocked; these proxies are dev-only. Build output is `apps/web/dist/`.

## Context acquisition

Follow the root native-search policy. Graphify is optional only for unfamiliar flows crossing routes or components, hooks or services, contracts, API handlers, or deployment boundaries. Verify every hypothesis in source and tests. Use native search for exact UI behavior, accessibility, configuration, consumers, completeness, CSS, HTML and documentation, media references, and all excluded or unsupported formats.
