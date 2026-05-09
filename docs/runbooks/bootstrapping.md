# Bootstrapping

This runbook is for the **first production deploy** of the landing page to `brimax.life` and the API custom domain at `api.brimax.life`.

Use **two terminals** because the ACM certificate stack pauses while waiting for DNS validation, and the DNS validation records are created by OpenTofu in a separate step.

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
6. Ensure `ASAAS_API_KEY` and `ASAAS_WEBHOOK_TOKEN` are already set in `.env` before the backend deploy step.

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
```

Important:
- Keep `LANDING_CERTIFICATE_ARN=""` in the file before the first certificate request.
- The scripts auto-discover the certificate ARN during bootstrap, so you do not need to edit `.env` mid-run.
- The scripts now auto-load `.env`, so you do not need `set -a`.

## Terminal 1: CDK Bootstrap, AWS Bootstrap, And Certificate Request

From the repo root:

```bash
pnpm cdk:bootstrap
pnpm deploy:platform
pnpm build:web
pnpm deploy:landing:cert
```

Expected behavior:
- `pnpm deploy:platform` creates the OpenTofu backend bucket and lock table.
- `pnpm build:web` assembles the production landing bundle for `apps/web`.
- `pnpm deploy:landing:cert` starts `BrimaxCertificateStack` for both the website and API certificates.
- This last command will **pause** while ACM waits for DNS validation.

Leave Terminal 1 running.

## Terminal 2: DNS Validation While Terminal 1 Is Waiting

Open a second terminal from the repo root. The OpenTofu scripts auto-load `.env`, so there is no additional setup command required here.

Initialize and apply the DNS validation module:

```bash
bash scripts/landing-opentofu.sh certificate-validation init
bash scripts/landing-opentofu.sh certificate-validation apply
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
bash scripts/deploy-backend.sh
```

## Final DNS Wiring

In either terminal:

```bash
bash scripts/landing-opentofu.sh edge-dns init
bash scripts/landing-opentofu.sh edge-dns apply
```

This creates the Cloudflare DNS records that point:
- `brimax.life` to CloudFront
- `www.brimax.life` to CloudFront

CloudFront then redirects `www.brimax.life` to `brimax.life`.

Apply the API DNS module:

```bash
bash scripts/landing-opentofu.sh api-dns init
bash scripts/landing-opentofu.sh api-dns apply
```

This creates the Cloudflare DNS record that points:
- `api.brimax.life` to the API Gateway custom-domain regional target

This same `edge-dns` apply also enforces:
- `ssl = strict`
- `always_use_https = on`
- `min_tls_version = 1.2`

## Full First-Time Command Sequence

### Terminal 1

```bash
pnpm cdk:bootstrap
pnpm deploy:platform
pnpm build:web
pnpm deploy:landing:cert
pnpm wait:landing:cert
pnpm deploy:landing:edge
bash scripts/deploy-backend.sh
```

### Terminal 2

```bash
bash scripts/landing-opentofu.sh certificate-validation init
bash scripts/landing-opentofu.sh certificate-validation apply
bash scripts/landing-opentofu.sh edge-dns init
bash scripts/landing-opentofu.sh edge-dns apply
bash scripts/landing-opentofu.sh api-dns init
bash scripts/landing-opentofu.sh api-dns apply
```

## Verification

- `BrimaxPlatformStack` reaches `CREATE_COMPLETE`
- `BrimaxCertificateStack` reaches `CREATE_COMPLETE`
- `pnpm wait:landing:cert` reports the ACM certificate as `ISSUED`
- `BrimaxEdgeStack` reaches `CREATE_COMPLETE`
- `BrimaxAppStack` reaches `CREATE_COMPLETE`
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
