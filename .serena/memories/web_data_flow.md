# Web data flow

1. `apps/web/src/main.tsx` mounts `App.tsx`, which supplies routing and shared providers.
2. Page sections and components call focused adapters under `src/lib`, such as RSVP, gifts, payments, and guest messages.
3. TanStack Query owns server-state caching; mutations invalidate or update the corresponding query keys.
4. Request and response contracts come from `@brimax/contracts`.
5. Development-only `/api` and `/media` proxies support safe reads; local API writes remain blocked.
6. Vitest and Testing Library tests live under `apps/web/tests` with jsdom setup in `tests/setup.ts`.

Use mem:repository_map for workspace ownership. Follow `apps/web/AGENTS.md` for rules.
