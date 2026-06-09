# infra/cdk — Agent guide

## Conventions

- Resolve stage with `resolveStage()` and wrap construct IDs in `resourceName(name, stage)`. Never hand-build a `dev-` prefix.
- CDK manages AWS resources only. Cloudflare DNS stays in [../opentofu/](../opentofu/).
- `bin/app.ts` fails synth early for `BrimaxAppStack` and `BrimaxObservabilityStack` when required secrets are missing. Respect that gate when validating changes.
- For isolated non-payment changes, prefer targeted per-stack deploy commands instead of whole-app deploy flows.
- [../../.gitignore](../../.gitignore) ignores `lib/` globally and only force-includes specific checked-in files under `infra/cdk/lib/`. New files there may need an explicit unignore rule.

## Tests

```bash
pnpm --filter @brimax/infra-cdk test
```
