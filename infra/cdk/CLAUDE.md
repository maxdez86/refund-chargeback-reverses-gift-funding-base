# infra/cdk — Claude Code guide

AWS CDK app (TypeScript). Entry point: [bin/app.ts](bin/app.ts). All construct IDs flow through `resourceName(name, stage)` from `@brimax/config`.

## Stacks

Six stacks, instantiated in [bin/app.ts](bin/app.ts):

| Stack | Inputs | Exports / role |
|---|---|---|
| `PlatformStack` | `stage` | Account-wide platform setup |
| `CertificateStack` | `apiDomain`, `rootDomain`, `wwwDomain`, `stage` | `apiCertificate`, `certificate` (ACM) |
| `DataStack` | `stage` | `table` (DynamoDB single-table) |
| `AppStack` | `apiCertificate`, `apiDomain`, `asaasApiKey`, `asaasWebhookToken`, `stage`, `table` | `httpApi` (Lambda + HTTP API + Asaas webhooks + Secrets Manager entries) |
| `EdgeStack` | `certificate`, `rootDomain`, `siteAssetPath`, `stage`, `wwwDomain` | `distribution` (CloudFront over `apps/web/dist`) — explicitly `addDependency(certificateStack)` |
| `ObservabilityStack` | `stage`, `distribution`, `httpApi`, `table` | CloudWatch + X-Ray dashboards/alarms |

Source paths: [lib/stacks/](lib/stacks/). Reusable constructs in [lib/constructs/](lib/constructs/) — note that [lib/constructs/website/static-site-construct.ts](lib/constructs/website/static-site-construct.ts) is the only file under `lib/` checked into git (everything else under `lib/` is gitignored).

## Stage handling

```ts
const stage = resolveStage(app.node.tryGetContext("stage") ?? process.env.STAGE);
```

`prod` is the default; `dev` adds a `dev-` prefix to every stack name and resource name. **Always** wrap construct IDs in `resourceName("BrimaxThing", stage)` — never concatenate the prefix manually.

## Pre-deploy validation

`bin/app.ts` checks `process.argv` for stack names matching `BrimaxAppStack` or `BrimaxObservabilityStack`. If either is requested and `ASAAS_API_KEY` or `ASAAS_WEBHOOK_TOKEN` is missing in the environment, the synth fails before anything is deployed. Other stacks (Platform, Certificate, Data, Edge) deploy without those vars.

For changes scoped to a single non-payment stack (e.g. just `DataStack`), prefer the targeted form to skip the secrets check:

```bash
pnpm --filter @brimax/infra-cdk cdk deploy <ResolvedStackName> -c stage=<stage>
# e.g. dev DataStack:
pnpm --filter @brimax/infra-cdk cdk deploy dev-BrimaxDataStack -c stage=dev
```

`pnpm deploy:backend` synths the whole app and therefore always requires the Asaas vars, even if you're only touching `DataStack`.

## Cert dance (two-terminal flow)

The TLS cert can't be issued until Cloudflare validation records exist, but those records can only be written after CDK has emitted the validation requests. The full sequence (also in [docs/runbooks/bootstrapping.md](../../docs/runbooks/bootstrapping.md)):

1. `pnpm deploy:landing:cert` — CDK creates the ACM cert (status `PENDING_VALIDATION`).
2. `bash scripts/export-landing-certificate-validation-records.sh` — exports CNAME requirements to OpenTofu inputs.
3. `pnpm opentofu:cert:apply` — writes validation CNAMEs to Cloudflare.
4. `pnpm wait:landing:cert` — polls ACM until `ISSUED`.
5. `pnpm deploy:landing:edge` — `EdgeStack` attaches the now-validated cert to CloudFront.
6. `pnpm opentofu:dns:apply` / `pnpm opentofu:api-dns:apply` — point root/www and `api.` records at CloudFront / API Gateway.

## DNS / TLS rule

CDK manages **AWS** resources only (ACM, CloudFront, API Gateway, Lambda). Cloudflare records belong in [infra/opentofu/](../opentofu/). **Never** add Cloudflare provider code to CDK and **never** duplicate a record across both.

## Common commands

```bash
pnpm synth                    # build:web + cdk synth (validates the app)
pnpm deploy:platform          # PlatformStack
pnpm deploy:backend           # Data + App + Observability (needs Asaas env vars)
pnpm deploy:landing:cert      # CertificateStack
pnpm deploy:landing:edge      # EdgeStack
pnpm cdk:bootstrap            # one-time per account/region
```

Per-stack commands (rare): `pnpm --filter @brimax/infra-cdk cdk deploy <StackName> -c stage=<stage>`.

## Quirky `.gitignore` interaction

[/.gitignore](../../.gitignore) ignores `lib/` globally, then force-includes only `infra/cdk/lib/constructs/website/static-site-construct.ts`. New files under `lib/` won't be picked up by git unless an explicit unignore line is added. Watch for this when introducing constructs or stacks.

## Don't read

`cdk.out/`, `cdk.out.cert-check/`, `node_modules/` — already in `.claudeignore`.
