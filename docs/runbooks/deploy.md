# Deploy Runbook

Use this runbook for repeatable production deploys after the environment has already been bootstrapped.

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
- Dependencies must already be installed locally.

Notes:
- The deploy scripts auto-load `.env`, so manual `source .env` is optional.
- `prod` is the default stage, so you do not need to pass `stage=prod`.
- Use `STAGE=dev` or `--context stage=dev` only when you intentionally want prefixed development resources.
- For future `dev` Sentry rollout, first apply `infra/opentofu/sentry` with `STAGE=dev`, then deploy the dev backend so it picks up the dev DSN.
- Keep production resources on retain policies unless there is a deliberate teardown plan.

## Recommended Validation

Run these checks before a production deploy when you want extra confidence:

```bash
pnpm build:web
pnpm typecheck
pnpm test
pnpm --filter @brimax/infra-cdk cdk synth
pnpm opentofu:ses-dns:plan
```

## Full Deployment Sequence

This is the standard post-bootstrap production sequence. It assumes the platform resources, certificates, and initial DNS/certificate validation are already in place.

1. Build the landing page bundle:

   ```bash
   pnpm build:web
   pnpm dev:all-web
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
- OpenTofu keeps Cloudflare `ssl`, `always_use_https`, and `min_tls_version` aligned.
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

## First-Time Setup

For first production setup, certificate issuance, or first DNS wiring, use [bootstrapping.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrapping.md:1).
