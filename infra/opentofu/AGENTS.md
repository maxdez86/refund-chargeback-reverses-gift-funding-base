# infra/opentofu — Agent guide

## Conventions

- `infra/opentofu` owns Cloudflare DNS and edge-related records only. AWS resources stay in [../cdk/](../cdk/).
- Each subdirectory is an independent module. Keep changes scoped to the owning module unless a cross-module DNS change is actually required.
- Use the root `pnpm opentofu:*:{init,plan,apply}` wrappers, which route through [../../scripts/landing-opentofu.sh](../../scripts/landing-opentofu.sh), instead of inventing new invocation patterns.
- Preserve the certificate-validation boundary: CDK emits ACM validation requirements, OpenTofu writes the Cloudflare validation records.
- Verification here is plan and validate based, not Vitest based.
