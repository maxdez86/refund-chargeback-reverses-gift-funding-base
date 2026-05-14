# Deploy Runbook

Use this runbook for repeatable production deploys after the environment has already been bootstrapped.

## Quick Commands

### Deploy Backend

```bash
pnpm deploy:backend
```

Updates the backend application stack and API.

### Deploy Frontend

```bash
pnpm build:web && pnpm deploy:landing:edge
```

Rebuilds and deploys the landing page edge stack.

## Before You Deploy

- AWS credentials must already be configured locally.
- `.env` must be present and contain the correct production values.
- Dependencies must already be installed locally.

Notes:
- The deploy scripts auto-load `.env`, so manual `source .env` is optional.
- `prod` is the default stage, so you do not need to pass `stage=prod`.
- Use `STAGE=dev` or `--context stage=dev` only when you intentionally want prefixed development resources.
- Keep production resources on retain policies unless there is a deliberate teardown plan.

## Recommended Validation

Run these checks before a production deploy when you want extra confidence:

```bash
pnpm build:web
pnpm typecheck
pnpm test
pnpm --filter @brimax/infra-cdk cdk synth
```

## Full Deployment Sequence

This is the standard post-bootstrap production sequence. It assumes the platform resources, certificates, and initial DNS/certificate validation are already in place.

1. Build the landing page bundle:

   ```bash
   pnpm build:web
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

The normal managed deploy keeps these production settings aligned:
- CloudFront adds the baseline security headers.
- CloudFront only serves the canonical hosts and rejects the default `cloudfront.net` hostname.
- OpenTofu keeps Cloudflare `ssl`, `always_use_https`, and `min_tls_version` aligned.

## Outputs / What To Check

- `BrimaxAppStack` output `AsaasWebhookUrl` is the branded webhook URL.
- `BrimaxAppStack` output `ApiCustomDomainUrl` is the branded public API base URL.
- The raw `execute-api` hostname remains available only for fallback or debugging and should not be used for normal production traffic.

## First-Time Setup

For first production setup, certificate issuance, or first DNS wiring, use [bootstrapping.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrapping.md:1).
