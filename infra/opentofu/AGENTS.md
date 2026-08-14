# infra/opentofu — Agent guide

Node runtime requirements are defined in root [AGENTS.md](../../AGENTS.md).

## Conventions

- `infra/opentofu` owns Cloudflare DNS and zone settings plus the Sentry project configuration. AWS resources stay in [../cdk/](../cdk/).
- Each subdirectory is an independent module. Keep changes scoped to the owning module unless a cross-module DNS change is actually required.
- Use the root `pnpm opentofu:*` wrappers, which route through [../../scripts/landing-opentofu.sh](../../scripts/landing-opentofu.sh), instead of inventing new invocation patterns. All six modules (`cert`, `dns`, `api-dns`, `ses-dns`, `sentry`, `zone-settings`) take `{init,plan,apply}`; only `sentry` also has a `validate` script. Prefix dev-stage runs with `BRIMAX_ENV_FILE=.env.dev` — the wrappers default to `.env`, which is prod.
- Preserve the certificate-validation boundary: CDK emits ACM validation requirements, OpenTofu writes the Cloudflare validation records.
- Verification here is plan and validate based, not Vitest based.

## Context acquisition

Follow the root native-search policy. Graphify is optional only for exploratory mapping among Cloudflare DNS, certificate or API endpoints, CDK outputs, and scripts. Verify every hypothesis in native source. Exact resource ownership, provider, state and configuration behavior, dependencies, and plan effects require native source plus plan evidence.
