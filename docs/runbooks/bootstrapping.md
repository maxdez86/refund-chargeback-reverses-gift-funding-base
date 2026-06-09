# Bootstrap Runbook

Use this only for first-time environment setup and initial production bring-up.

This runbook is for the first production deploy of the landing page to `brimax.life` and the API custom domain at `api.brimax.life`.

For GitHub Actions IAM role bootstrap through OIDC, use [bootstrap-github-oidc.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrap-github-oidc.md:1).

Fresh-account note: the shared GitHub OIDC bootstrap depends on both `BrimaxPlatformStack` and
`dev-BrimaxPlatformStack` already existing. Bring up prod platform first, then dev platform, and
only then run `pnpm deploy:github-oidc`.

Use two terminals because the ACM certificate stack pauses while waiting for DNS validation, and the DNS validation records are created by OpenTofu in a separate step.

This bootstrap also establishes the baseline edge hardening through IaC:
- Cloudflare minimum TLS version `1.2`
- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- CloudFront host-header restriction so only `brimax.life` and `www.brimax.life` are served
- API Gateway custom domain at `api.brimax.life`

## Prerequisites

1. Create a Cloudflare API token for the `brimax.life` zone with:
   - DNS edit
   - zone settings edit
2. Copy the Cloudflare zone ID.
3. Ensure the `personal-stg` AWS profile can deploy into account `183286346090`.
4. Install the OpenTofu CLI locally.
5. Create a local `.env` file from `.env.example`.
6. Ensure `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `TURNSTILE_SECRET_KEY`, `SENTRY_AUTH_TOKEN`, and `OBSERVABILITY_ALERT_EMAIL` are already set in `.env` before the backend deploy step. (`TURNSTILE_SECRET_KEY` is only required when `STAGE=prod`; dev falls back to Cloudflare's always-passes test secret.)

## CDK Bootstrap Upgrade / Remediation

`pnpm cdk:bootstrap` is not only for first-time setup. It is also the required remediation when the AWS account bootstrap stack is older than the CDK version this repo now needs.

Known current environment context:
- account: `183286346090`
- region: `us-east-1`
- last observed bootstrap version before remediation: `25`

If you see either of these failure signatures during deploy:
- `Bootstrap toolkit stack version 30 or later is needed; current version: 25`
- missing `cloudformation:DescribeEvents` on the CDK deploy role

rerun:

```bash
pnpm cdk:bootstrap
```

This updates the existing `CDKToolkit` stack in `us-east-1`. It is safer and more correct than trying to patch the bootstrap IAM roles manually.

## Sentry Bootstrap

Sentry account and organization creation happen outside this repo. Once the `brimax` Sentry organization exists, the rest of the initial backend setup is IaC-managed from `infra/opentofu/sentry`.

First-time Sentry setup:

1. Add `SENTRY_AUTH_TOKEN` to local `.env`.
2. Deploy the platform bootstrap first so the shared OpenTofu backend bucket/lock table exist.
3. Initialize the Sentry OpenTofu module:

   ```bash
   pnpm opentofu:sentry:init
   ```

4. Apply the Sentry OpenTofu module:

   ```bash
   pnpm opentofu:sentry:apply
   ```

5. Initialize the shared Cloudflare zone-settings module:

   ```bash
   pnpm opentofu:zone-settings:init
   ```

6. Apply the shared Cloudflare zone-settings module:

   ```bash
   pnpm opentofu:zone-settings:apply
   ```

Expected behavior:
- OpenTofu creates the shared `brimax-life` Sentry team on the first `prod` apply.
- OpenTofu creates the `prod` backend Sentry project and runtime key.
- The backend DSN becomes available through the module outputs and is consumed automatically by `pnpm deploy:backend`.
- The Sentry auth token stays local and is never deployed into AWS or written into application runtime config.

## What Must Exist In `.env`

```bash
STAGE=prod
AWS_PROFILE=personal-stg
AWS_REGION=us-east-1
ROOT_DOMAIN=brimax.life
API_DOMAIN=api.brimax.life
LANDING_CERTIFICATE_ARN=""
CLOUDFLARE_API_TOKEN="..."
CLOUDFLARE_ZONE_ID="..."
TOFU_STATE_KEY_PREFIX="brimax-life"
# Backend secret seed values (CDK writes these to Secrets Manager on deploy)
ASAAS_API_KEY="..."
ASAAS_WEBHOOK_TOKEN="..."
TURNSTILE_SECRET_KEY="..."   # required when STAGE=prod; dev uses the always-passes test secret
SENTRY_AUTH_TOKEN="..."
SENTRY_ORG="brimax"
SENTRY_TEAM_SLUG="brimax-life"
OBSERVABILITY_ALERT_EMAIL="alerts@example.com"
# Optional override. `pnpm deploy:backend` resolves this from
# `infra/opentofu/sentry` automatically after the module is applied.
SENTRY_DSN=""
```

Important:
- Keep `LANDING_CERTIFICATE_ARN=""` in the file before the first certificate request.
- The scripts auto-discover the certificate ARN during bootstrap, so you do not need to edit `.env` mid-run.
- The scripts now auto-load `.env`, so you do not need `set -a`.
- `SENTRY_DSN` is sourced from the Sentry OpenTofu module outputs; `SENTRY_AUTH_TOKEN` is only used by OpenTofu.
- `OBSERVABILITY_ALERT_EMAIL` drives the SNS email subscription for production CloudWatch alarms. Confirm the subscription email after the first observability deploy.

## Terminal 1: CDK Bootstrap, Platform Bootstrap, And Certificate Request

From the repo root:

```bash
pnpm cdk:bootstrap
pnpm deploy:platform
pnpm opentofu:sentry:init
pnpm opentofu:sentry:apply
pnpm build:web
pnpm deploy:landing:cert
```

Expected behavior:
- `pnpm deploy:platform` creates the OpenTofu backend bucket and lock table.
- `pnpm build:web` assembles the production landing bundle for `apps/web`.
- `pnpm deploy:landing:cert` starts `BrimaxCertificateStack` for both the website and API certificates.
- This last command pauses while ACM waits for DNS validation.

Leave Terminal 1 running.

## Terminal 2: DNS Validation While Terminal 1 Is Waiting

Open a second terminal from the repo root. The OpenTofu scripts auto-load `.env`, so there is no additional setup command required here.

Initialize and apply the DNS validation module:

```bash
pnpm opentofu:cert:init
pnpm opentofu:cert:apply
```

Expected behavior:
- OpenTofu creates the ACM DNS validation CNAMEs in Cloudflare for `brimax.life`, `www.brimax.life`, and `api.brimax.life`.
- ACM detects those records automatically.
- Terminal 1 should eventually finish `pnpm deploy:landing:cert`.

## Back To Terminal 1: Wait And Deploy The Landing Page

If `pnpm deploy:landing:cert` is still running, wait for it to finish.

If you are not sure whether the certificate is already issued, run:

```bash
pnpm wait:landing:cert
```

Then deploy the static site and CloudFront:

```bash
pnpm deploy:landing:edge
```

Deploy the backend with the API custom domain and IaC-managed payment secrets:

```bash
pnpm deploy:backend
```

## Final DNS Wiring

In either terminal:

```bash
pnpm opentofu:dns:init
pnpm opentofu:dns:apply
```

This creates the Cloudflare DNS records that point:
- `brimax.life` to CloudFront
- `www.brimax.life` to CloudFront

CloudFront then redirects `www.brimax.life` to `brimax.life`.

Apply the API DNS module:

```bash
pnpm opentofu:api-dns:init
pnpm opentofu:api-dns:apply
```

This creates the Cloudflare DNS record that points:
- `api.brimax.life` to the API Gateway custom-domain regional target

The shared `zone-settings` module enforces:
- `ssl = strict`
- `always_use_https = on`
- `min_tls_version = 1.2`

## SES Deliverability DNS

To unlock SES production access and align transactional email authentication, verify the `brimax.life` domain after the backend stack is deployed:

```bash
pnpm opentofu:ses-dns:init
pnpm opentofu:ses-dns:apply
aws sesv2 get-email-identity --region us-east-1 --email-identity brimax.life
```

Expected behavior:
- `BrimaxAppStack` exposes the SES Easy DKIM CNAME tokens.
- The `ses-dns` OpenTofu module creates the DKIM, MAIL FROM, SPF, and DMARC DNS records in Cloudflare.
- `aws sesv2 get-email-identity` eventually reports successful verification for `brimax.life`, successful DKIM status, and a healthy custom MAIL FROM status.

Use this verification command for a deeper status check:

```bash
aws sesv2 get-email-identity \
  --region us-east-1 \
  --email-identity brimax.life \
  --query '{VerifiedForSendingStatus:VerifiedForSendingStatus,DkimStatus:DkimAttributes.Status,MailFromDomain:MailFromAttributes.MailFromDomain,MailFromStatus:MailFromAttributes.MailFromDomainStatus}'
```

Only request SES production access after domain verification is complete and the custom MAIL FROM DNS is healthy.

## Full First-Time Command Sequence

### Terminal 1

```bash
pnpm cdk:bootstrap
pnpm deploy:platform
pnpm opentofu:sentry:init
pnpm opentofu:sentry:apply
pnpm opentofu:zone-settings:init
pnpm opentofu:zone-settings:apply
pnpm build:web
pnpm deploy:landing:cert
pnpm wait:landing:cert
pnpm deploy:landing:edge
pnpm deploy:backend
pnpm opentofu:ses-dns:init
pnpm opentofu:ses-dns:apply
```

### Terminal 2

```bash
pnpm opentofu:cert:init
pnpm opentofu:cert:apply
pnpm opentofu:dns:init
pnpm opentofu:dns:apply
pnpm opentofu:api-dns:init
pnpm opentofu:api-dns:apply
```

## Verification

- `BrimaxPlatformStack` reaches `CREATE_COMPLETE`
- `BrimaxCertificateStack` reaches `CREATE_COMPLETE`
- `pnpm wait:landing:cert` reports the ACM certificate as `ISSUED`
- `BrimaxEdgeStack` reaches `CREATE_COMPLETE`
- `BrimaxAppStack` reaches `CREATE_COMPLETE`
- `infra/opentofu/sentry` outputs a backend DSN and project slug
- Cloudflare minimum TLS version is `1.2`
- `https://brimax.life` returns:
  - `strict-transport-security`
  - `x-content-type-options: nosniff`
  - `x-frame-options: DENY`
  - `referrer-policy: strict-origin-when-cross-origin`
- `https://brimax.life` renders the landing page
- `https://www.brimax.life` redirects to `https://brimax.life`
- `https://api.brimax.life/payments/not-found` reaches API Gateway and returns an application response instead of DNS failure
- `https://ds721j5fxkwu6.cloudfront.net` returns `403`
- `brimax.life` and `www.brimax.life` Cloudflare records are proxied
- `api.brimax.life` Cloudflare record is DNS-only
