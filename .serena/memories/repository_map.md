# Repository map

- `apps/web`: guest-facing React/Vite SPA. UI code is under `src/components`; API adapters are under `src/lib`.
- `apps/api`: Lambda entry points under `src/functions`, pure business rules under `src/domain`, and AWS/vendor adapters under `src/services`.
- `packages/contracts`: canonical Zod request and response schemas shared by both applications.
- `packages/config`: canonical stage and resource-name helpers.
- `infra/cdk`: AWS resources and stack composition. See mem:infrastructure_map.
- `infra/opentofu`: Cloudflare DNS modules and certificate-validation records. See mem:infrastructure_map.
- Root scripts wrap workspace development, validation, deployment, and smoke-test commands.

Load the closest `AGENTS.md` for normative rules. This memory is descriptive only.
