# Deploy Runbook

Use this runbook for repeatable production deploys after the environment has already been bootstrapped.

For the isolated public dev environment, use [deploy-dev.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/deploy-dev.md:1) for repeatable deploys, and [bootstrapping-dev.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrapping-dev.md:1) for the first dev bring-up.
For GitHub Actions OIDC IAM role bootstrap, use [bootstrap-github-oidc.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrap-github-oidc.md:1).

## Quick Commands

### Refresh Sentry Infrastructure

```bash
pnpm opentofu:sentry:init
pnpm opentofu:sentry:apply
```

Run this only when Sentry-managed resources change, for example:
- adding a new Sentry project
- onboarding a new stage like `dev`
- rotating the backend runtime key / DSN
- adding future Sentry alerting resources

### Deploy Backend

```bash
pnpm deploy:backend
```

Updates the backend application stack and API.

`pnpm deploy:backend` resolves the backend `SENTRY_DSN` from `infra/opentofu/sentry` automatically. Routine application deploys do not require rerunning the Sentry OpenTofu module unless the Sentry resources themselves changed.

If the deploy changes SES sender outputs or email deliverability configuration, also run:

```bash
pnpm opentofu:ses-dns:init
pnpm opentofu:ses-dns:apply
```

If the shared Cloudflare zone baseline changes, also run:

```bash
pnpm opentofu:zone-settings:init
pnpm opentofu:zone-settings:apply
```

### Deploy Frontend

```bash
pnpm build:web && pnpm deploy:landing:edge
```

Rebuilds and deploys the landing page edge stack.

## Before You Deploy

- AWS credentials must already be configured locally.
- `.env` must be present and contain the correct production values.
- `.env` must include a previously bootstrapped `SENTRY_AUTH_TOKEN` if you need to rerun the Sentry OpenTofu module.
- `.env` must include `OBSERVABILITY_ALERT_EMAIL` for production backend deploys.
- `.env` may include `XRAY_ENABLED=true` to keep backend X-Ray tracing on. Production defaults to enabled if omitted.
- Dependencies must already be installed locally.

Notes:
- The deploy scripts auto-load `.env`, so manual `source .env` is optional.
- To use a non-default env file, prefix commands with `BRIMAX_ENV_FILE=.env.dev`.
- `prod` is the default stage, so you do not need to pass `stage=prod`.
- Use `STAGE=dev` or `--context stage=dev` only when you intentionally want prefixed development resources.
- For future `dev` Sentry rollout, first apply `infra/opentofu/sentry` with `STAGE=dev`, then deploy the dev backend so it picks up the dev DSN.
- Keep production resources on retain policies unless there is a deliberate teardown plan.
- CDK deploy scripts now use dedicated output directories under `infra/cdk` instead of the shared default `cdk.out` to reduce cross-command collisions.

## Recommended Validation

Run these checks before a production deploy when you want extra confidence:

```bash
pnpm build:web
pnpm typecheck
pnpm test
pnpm --filter @brimax/infra-cdk cdk synth
pnpm opentofu:ses-dns:plan
```

Before any `dev` rollout, production OpenTofu must also be clean:

```bash
pnpm opentofu:zone-settings:init && pnpm opentofu:zone-settings:plan
pnpm opentofu:dns:init && pnpm opentofu:dns:plan
pnpm opentofu:api-dns:init && pnpm opentofu:api-dns:plan
pnpm opentofu:ses-dns:init && pnpm opentofu:ses-dns:plan
pnpm opentofu:sentry:init && pnpm opentofu:sentry:plan
pnpm opentofu:cert:init && pnpm opentofu:cert:plan
```

Treat `No changes` across the shared zone-settings module and all five production stage modules as the gate before you bootstrap or deploy `dev`.

## OpenTofu State Reconciliation

Production Cloudflare resources may already exist before OpenTofu starts managing them. In that case:

1. Fix the CDK/OpenTofu contract first.
   - CDK owns AWS resources and must expose any values OpenTofu needs, such as the landing CloudFront distribution domain name.
   - OpenTofu owns Cloudflare DNS records and Sentry resources.
2. Import the live Cloudflare resources into the correct OpenTofu module state instead of creating duplicates.
3. Re-run `plan` until each production module reports `No changes`.

For the DNS isolation split:
- import the live zone settings into `infra/opentofu/zone-settings`
- remove the old zone-setting ownership from `infra/opentofu/edge-dns` state
- keep the root and `www` records in `infra/opentofu/edge-dns`

Use imports for pre-existing production resources in these modules:
- `infra/opentofu/certificate-validation`: ACM validation CNAMEs for root, `www`, and `api`
- `infra/opentofu/api-dns`: `api.brimax.life`
- `infra/opentofu/edge-dns`: `brimax.life` and `www.brimax.life`
- `infra/opentofu/zone-settings`: the managed Cloudflare zone settings

Do not destroy and recreate working production DNS records just to satisfy state ownership.

## Full Deployment Sequence

This is the standard post-bootstrap production sequence. It assumes the platform resources, certificates, and initial DNS/certificate validation are already in place.

1. Build the landing page bundle:

   ```bash
   pnpm build:web
   ```

   Optional local check against the isolated dev environment:

   ```bash
   pnpm dev:web
   ```

2. Deploy the landing page edge stack:

   ```bash
   pnpm deploy:landing:edge
   ```

3. Deploy the backend application stack:

   ```bash
   pnpm deploy:backend
   ```

4. Initialize the website DNS OpenTofu module:

   ```bash
   pnpm opentofu:dns:init
   ```

5. Apply the website DNS OpenTofu module:

   ```bash
   pnpm opentofu:dns:apply
   ```

6. Initialize the API DNS OpenTofu module:

   ```bash
   pnpm opentofu:api-dns:init
   ```

7. Apply the API DNS OpenTofu module:

   ```bash
   pnpm opentofu:api-dns:apply
   ```

8. If backend email deliverability settings changed, initialize and apply the SES DNS OpenTofu module:

   ```bash
   pnpm opentofu:ses-dns:init
   pnpm opentofu:ses-dns:apply
   ```

The normal managed deploy keeps these production settings aligned:
- CloudFront adds the baseline security headers.
- CloudFront only serves the canonical hosts and rejects the default `cloudfront.net` hostname.
- OpenTofu `zone-settings` keeps Cloudflare `ssl`, `always_use_https`, and `min_tls_version` aligned.
- OpenTofu keeps SES DKIM, MAIL FROM, SPF, and DMARC DNS records aligned when the sender config changes.

## Outputs / What To Check

- `BrimaxAppStack` output `AsaasWebhookUrl` is the branded webhook URL.
- `BrimaxAppStack` output `ApiCustomDomainUrl` is the branded public API base URL.
- `BrimaxObservabilityStack` output `DashboardName` identifies the CloudWatch dashboard for backend health.
- `BrimaxObservabilityStack` output `AlarmTopicArn` identifies the SNS topic used for alarm notifications.
- The raw `execute-api` hostname remains available only for fallback or debugging and should not be used for normal production traffic.
- After email deliverability changes, verify SES identity health with `aws sesv2 get-email-identity --region us-east-1 --email-identity brimax.life` and send a real inbox test to confirm placement and headers.

## Observability Smoke Test

Run this after a production backend deploy:

1. Trigger a safe handled warning:

   ```bash
   curl -i https://api.brimax.life/payments/not-found
   ```

2. Confirm the request returns `404` and the warning appears in Sentry:
   - project: `brimax-api-prod`
   - environment: `prod`
   - search for `PAYMENT_LOOKUP_FAILED`

3. Confirm there is no unexpected new unresolved prod issue spike in Sentry:
   - saved issue view: `environment:prod is:unresolved`

4. Open the CloudWatch dashboard from `BrimaxObservabilityStack` and confirm the alarm state is OK.

5. Confirm the SNS email subscription is still confirmed and able to receive alarm notifications.

Operational defaults for Sentry:
- saved issue view: unresolved prod issues (`environment:prod is:unresolved`)
- saved log view: prod backend logs (`project:brimax-api-prod environment:prod`)

## CDK Deploy Failures

If backend deploy fails before or during CloudFormation, check these two cases first:

1. **CDK bootstrap too old**
   - Failure signature:
     - `Bootstrap toolkit stack version 30 or later is needed; current version: 25`
     - missing `cloudformation:DescribeEvents` on the CDK deploy role
   - Fix:

     ```bash
     pnpm cdk:bootstrap
     ```

   - This upgrades the existing `CDKToolkit` stack in account `183286346090`, region `us-east-1`. It is a normal remediation step when CDK version requirements rise.
   - After bootstrap finishes, rerun:

     ```bash
     pnpm deploy:backend
     ```

2. **Another CDK CLI is already using an output directory**
   - Failure signature:
     - `Another CLI ... is currently synthing to cdk.out`
   - Fix:
     - wait for the other CDK command to finish
     - avoid running multiple deploy/synth commands for the same workflow at the same time
     - if a previous process crashed, confirm there is no active CDK process before reusing or removing the output directory
   - Current script output directories:
     - backend: `infra/cdk/cdk.out.backend`
     - platform: `infra/cdk/cdk.out.platform`
     - certificate: `infra/cdk/cdk.out.certificate`
     - edge: `infra/cdk/cdk.out.edge`

## X-Ray Smoke Test

Run this after a production backend deploy when you want to validate event-chain tracing:

1. Trigger a payment read flow:

   ```bash
   curl -i https://api.brimax.life/payments/not-found
   ```

2. Trigger an email flow:

   ```bash
   curl -i -X POST https://api.brimax.life/guest-messages \
     -H 'content-type: application/json' \
     -d '{"authorName":"Observability Check","message":"Smoke test message"}'
   ```

3. Trigger or replay a webhook flow through the normal Asaas webhook path.

4. In the AWS console, open `CloudWatch -> X-Ray traces` for `us-east-1` and confirm sampled traces show:
   - Lambda segments for the invoked backend handlers
   - DynamoDB repository subsegments on payment and wedding table flows
   - SES send subsegments on email flows
   - SQS handoff plus linked consumer Lambda on the webhook async flow

5. Expect one limitation: the public API uses API Gateway HTTP API, so X-Ray starts at Lambda. The API Gateway edge itself does not appear as a REST-style X-Ray node.

## First-Time Setup

For first production setup, certificate issuance, or first DNS wiring, use [bootstrapping.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrapping.md:1).

For the first `dev` environment bring-up (two-terminal certificate dance), use [bootstrapping-dev.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrapping-dev.md:1).
