# Deploy Runbook

## Prerequisites

- AWS account and credentials configured locally
- Cloudflare-managed DNS already provisioned for `brimax.life`
- `corepack enable`
- `pnpm install`

## Validation Commands

```bash
pnpm build:web
pnpm typecheck
pnpm test
pnpm --filter @brimax/infra-cdk cdk synth
```

## Fresh Account Setup

For a brand-new AWS account or region, bootstrap CDK before any deploy:

```bash
pnpm cdk:bootstrap
```

## First Landing-Page Bootstrap

Do **not** use a single-terminal linear flow for the first deploy of `brimax.life`.

The first landing-page bootstrap requires:
- one terminal to run the AWS certificate stack
- a second terminal to create the Cloudflare validation records through OpenTofu while the certificate stack is waiting

Use the dedicated two-terminal runbook:

- [bootstrapping.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrapping.md:1)

## Subsequent Landing-Page Deploys

After the certificate has already been issued and the DNS wiring exists, the landing-page deploy flow is simpler:

```bash
source .env
pnpm build:web
pnpm deploy:landing:edge
bash scripts/landing-opentofu.sh edge-dns init
bash scripts/landing-opentofu.sh edge-dns apply
```

## API Domain Deploy

The payment API custom domain is separate from the website edge deploy. The rollout order is:

```bash
bash scripts/deploy-landing-certificate.sh
bash scripts/landing-opentofu.sh certificate-validation init
bash scripts/landing-opentofu.sh certificate-validation apply
pnpm wait:landing:cert
bash scripts/deploy-backend.sh
bash scripts/landing-opentofu.sh api-dns init
bash scripts/landing-opentofu.sh api-dns apply
```

This provisions:
- ACM certificate for `api.brimax.life`
- API Gateway custom domain and mapping
- Cloudflare DNS record for `api.brimax.life`

The final branded webhook URL comes from `BrimaxAppStack` output `AsaasWebhookUrl`.
The branded public API base URL comes from `BrimaxAppStack` output `ApiCustomDomainUrl`.
The raw `execute-api` hostname remains available only as a fallback/debug output and should not be used for normal production traffic.

## SES Domain Verification

To unlock SES production access, verify the `brimax.life` domain after the backend stack is deployed:

```bash
bash scripts/landing-opentofu.sh ses-dns init
bash scripts/landing-opentofu.sh ses-dns apply
aws sesv2 get-email-identity --region us-east-1 --email-identity brimax.life
```

Expected behavior:
- `BrimaxAppStack` exposes the SES Easy DKIM CNAME tokens.
- The `ses-dns` OpenTofu module creates those three DNS-only Cloudflare CNAMEs.
- `aws sesv2 get-email-identity` eventually reports successful verification for `brimax.life`.

Only request SES production access after domain verification is complete.

## Notes

- The deploy scripts auto-load `.env`, so manual `source .env` is optional.
- `pnpm build:web` assembles the production landing bundle for `apps/web` into `apps/web/dist`.
- The first landing-page bootstrap is intentionally documented separately because the certificate validation step blocks in one terminal while OpenTofu must run in another.
- Replace placeholder env values before deploying webhook or admin flows.
- `prod` is the default stage, so you do not need to pass `stage=prod`.
- Use `STAGE=dev` or `--context stage=dev` only when you intentionally want prefixed development resources.
- First-time landing-page DNS and certificate validation are handled in `infra/opentofu`; use the two-terminal bootstrap steps in [bootstrapping.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrapping.md:1).
- Edge hardening is part of the normal managed deploy:
  - CloudFront adds the baseline security headers
  - CloudFront only serves the canonical hosts and rejects the default `cloudfront.net` hostname
  - OpenTofu keeps Cloudflare `ssl`, `always_use_https`, and `min_tls_version` aligned
- Keep production resources on retain policies unless there is a deliberate teardown plan.
