# infra/cdk — Agent guide

The CDK app starts at `bin/app.ts`. It defines Platform, Certificate, Data, App, Edge, and Observability stacks; source is under `lib/stacks/` and reusable constructs under `lib/constructs/`.

## Conventions

- Resolve stage with `resolveStage()` and wrap construct IDs in `resourceName(name, stage)`. Never hand-build a `dev-` prefix.
- CDK manages AWS resources only. Cloudflare DNS stays in [../opentofu/](../opentofu/).
- `bin/app.ts` fails synth early for `BrimaxAppStack` and `BrimaxObservabilityStack` when required secrets are missing. Respect that gate when validating changes.
- For isolated non-payment changes, prefer targeted per-stack deploy commands instead of whole-app deploy flows.
- [../../.gitignore](../../.gitignore) ignores `lib/` globally and only force-includes specific checked-in files under `infra/cdk/lib/`. New files there may need an explicit unignore rule.

The certificate workflow is: deploy the landing certificate, export validation records, apply OpenTofu certificate DNS, wait for ACM issuance, deploy Edge, then apply edge and API DNS. `bin/app.ts` requires Asaas secrets for App/Observability synth and additionally requires Turnstile secrets for production. Target isolated non-payment stacks when possible.

Common commands are `pnpm synth`, `pnpm deploy:platform`, `pnpm deploy:backend`, `pnpm deploy:landing:cert`, `pnpm deploy:landing:edge`, and `pnpm cdk:bootstrap`; per-stack deployment uses the workspace CDK command with `-c stage=<stage>`. Do not read `cdk.out/`, `cdk.out.cert-check/`, or `node_modules/`.

## Tests

```bash
pnpm --filter @brimax/infra-cdk test
```

## Context acquisition

Follow the root native-search policy. Graphify is optional only for exploratory mapping across stacks, constructs, Lambda or application references, and deployment layers. Verify every hypothesis in native source. Exact AWS resource ownership, IAM and security, stage configuration, dependencies, and deployment order require native source plus synthesized evidence.
