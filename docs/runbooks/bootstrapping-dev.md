# Bootstrap Runbook (dev)

Use this only for the **first** public bring-up of the isolated `dev` environment:
`dev.brimax.life`, `www.dev.brimax.life`, and `api.dev.brimax.life`.

For repeatable `dev` deploys after this bootstrap, use [deploy-dev.md](deploy-dev.md).

Use **two terminals**. The ACM certificate stack pauses while waiting for DNS validation,
and the DNS validation records are created by OpenTofu in a separate step. A single terminal
deadlocks: the cert deploy blocks, so the OpenTofu command that would unblock it never runs.

## How dev differs from the prod bootstrap

- **Every command is prefixed `BRIMAX_ENV_FILE=.env.dev`.** Without it, `STAGE` falls back to
  `prod` and the work silently targets production in the shared account.
- **The CDK account bootstrap (`CDKToolkit`) and the `brimax` Sentry org already exist** from the
  prod bootstrap. You do not recreate them. You *do* deploy a separate `dev-` platform stack and a
  `dev` Sentry project.
- **`zone-settings` is shared** and was already applied during prod bootstrap. **Do not run it for
  dev** — it is not stage-scoped.
- **SES is prod-only.** Dev **skips `ses-dns`** entirely (see [What dev intentionally skips](#what-dev-intentionally-skips)).

## Prerequisites

1. A Cloudflare API token for the `brimax.life` zone with **DNS edit** (the dev hostnames live in
   the same zone). Zone-settings edit is not needed for dev — the shared baseline is already applied.
2. The Cloudflare zone ID.
3. The `personal-stg` AWS profile can deploy into account `183286346090`.
4. The OpenTofu CLI installed locally.
5. A local `.env.dev` file created from `.env.dev.example`:

   ```bash
   cp .env.dev.example .env.dev
   ```

6. The CDK account bootstrap (`CDKToolkit`, version ≥ 30) and the `brimax` Sentry org already exist
   from the prod bootstrap.

Fill in the dev-only values before deploying:

- Asaas **sandbox** API key and webhook token
- a dedicated dev contact inbox
- `SENTRY_AUTH_TOKEN` (used only by OpenTofu; never deployed into AWS)
- Cloudflare API token / zone ID

## What Must Exist In `.env.dev`

```bash
STAGE=dev
AWS_PROFILE=personal-stg
AWS_REGION=us-east-1
ROOT_DOMAIN=dev.brimax.life
API_DOMAIN=api.dev.brimax.life
WWW_DOMAIN=www.dev.brimax.life
CONTACT_EMAIL=casamento-dev@brimax.life
LANDING_CERTIFICATE_ARN=""
CLOUDFLARE_API_TOKEN="..."
CLOUDFLARE_ZONE_ID="..."
TOFU_STATE_KEY_PREFIX=brimax-life
# Sandbox payments — never point these at production Asaas
ASAAS_ENV=sandbox
ASAAS_API_BASE_URL=https://api-sandbox.asaas.com/v3
ASAAS_API_KEY="..."
ASAAS_WEBHOOK_TOKEN="..."
# Turnstile test credentials (always-passes); a real dev site is optional
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
TURNSTILE_SITE_KEY=1x00000000000000000000AA
# Sentry — auth token is local-only; DSN is resolved from infra/opentofu/sentry
SENTRY_AUTH_TOKEN="..."
SENTRY_ORG=brimax
SENTRY_TEAM_SLUG=brimax-life
SENTRY_DSN=""
```

Isolation-critical values:

- **`STAGE=dev`** — the single switch that prefixes every resource with `dev-`. If this is wrong,
  everything else targets prod.
- **`ROOT_DOMAIN` / `WWW_DOMAIN` / `API_DOMAIN`** — must be the `dev.` hostnames.
- **`ASAAS_ENV=sandbox`** plus the sandbox base URL — keeps payments off production Asaas.
- **`TURNSTILE_*` test keys** — dev falls back to Cloudflare's always-passes test secret, so a real
  Turnstile site is optional.

Important:

- Keep `LANDING_CERTIFICATE_ARN=""` before the first certificate request. The scripts auto-discover
  the ARN during bootstrap, so you do not edit `.env.dev` mid-run.
- The scripts auto-load the env file, so you do not need `set -a` or `source`.
- `SENTRY_DSN` is resolved from the dev `infra/opentofu/sentry` module outputs by `deploy:backend`;
  `SENTRY_AUTH_TOKEN` is only used by OpenTofu.

## Confirm The Stage Before Every Step

`STAGE` must resolve to exactly `dev`. Verify before you start, and any time you are unsure:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm --filter @brimax/infra-cdk cdk ls --context stage=dev
```

Every listed stack must carry the `dev-` prefix (`dev-BrimaxPlatformStack`, `dev-BrimaxAppStack`, …).
If you see bare names, the env file is not being read and you would be acting on production — stop.

## Ordering That Matters

- **Platform before any dev OpenTofu module.** Each module's `init` reads the
  `dev-BrimaxPlatformStack` CloudFormation outputs for the OpenTofu state bucket and lock table.
- **Sentry before backend.** `deploy:backend` resolves the dev `SENTRY_DSN` from the dev
  `infra/opentofu/sentry` module, so that module must be applied first.
- **Certificate request (Terminal 1) and validation records (Terminal 2) overlap.** That is the
  whole reason for two terminals.

## Terminal 1: Platform, Sentry, And Certificate Request

From the repo root:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm cdk:bootstrap
BRIMAX_ENV_FILE=.env.dev pnpm deploy:platform
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:sentry:init
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:sentry:apply
BRIMAX_ENV_FILE=.env.dev pnpm deploy:landing:cert
```

Expected behavior:

- `cdk:bootstrap` is account-wide and is normally already current from the prod bootstrap; this
  confirms the `CDKToolkit` version is ≥ 30 (the version `deploy:backend` later requires).
- `deploy:platform` creates the `dev-BrimaxPlatformStack` and its OpenTofu backend bucket / lock table.
- `opentofu:sentry:init` / `:apply` create the `dev` backend Sentry project and runtime key, exposing
  the dev DSN through the module outputs.
- `deploy:landing:cert` starts `dev-BrimaxCertificateStack` for the website and API certificates.
- **This last command pauses** while ACM waits for DNS validation.

Leave Terminal 1 running.

## Terminal 2: DNS Validation While Terminal 1 Is Waiting

Open a second terminal from the repo root. Start it once Terminal 1's platform stack has finished —
in practice, once Terminal 1 has reached the paused cert step (platform is already complete by then).
The OpenTofu scripts auto-load the env file, but you still pass `BRIMAX_ENV_FILE=.env.dev` so the dev
state key and dev backend are selected.

```bash
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:cert:init
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:cert:apply
```

Expected behavior:

- OpenTofu creates the ACM DNS validation CNAMEs in Cloudflare for `dev.brimax.life`,
  `www.dev.brimax.life`, and `api.dev.brimax.life`.
- ACM detects those records automatically.
- Terminal 1 should eventually finish `deploy:landing:cert`.

## Back To Terminal 1: Wait And Deploy The Landing Page And Backend

If `deploy:landing:cert` is still running, wait for it to finish. If you are unsure whether the
certificate is already issued:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm wait:landing:cert
```

Then deploy the static site and CloudFront (this command rebuilds the web bundle internally):

```bash
BRIMAX_ENV_FILE=.env.dev pnpm deploy:landing:edge
```

Deploy the backend with the API custom domain and IaC-managed payment secrets. It resolves the dev
`SENTRY_DSN` from the dev Sentry module applied in Terminal 1:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm deploy:backend
```

## Final DNS Wiring (Terminal 2, After The Backend Is Up)

```bash
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:dns:init
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:dns:apply
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:api-dns:init
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:api-dns:apply
```

This creates the Cloudflare DNS records that point:

- `dev.brimax.life` and `www.dev.brimax.life` to CloudFront (CloudFront redirects `www` to the apex)
- `api.dev.brimax.life` to the API Gateway custom-domain regional target

## Seed And Asaas Sandbox

Seed the dev table:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm reset:wedding:fresh-start
```

The backend uses sandbox Asaas automatically in `dev`. Once `api.dev.brimax.life` is reachable, sync
the sandbox webhook:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm asaas:webhook:sync
```

The managed dev webhook is:

```text
https://api.dev.brimax.life/webhooks/asaas
```

Never point sandbox traffic or credentials at production Asaas resources.

## What Dev Intentionally Skips

- **`ses-dns`** — SES identities are created only when `STAGE=prod` (`infra/cdk/lib/stacks/app-stack.ts`).
  Dev has no DKIM tokens to export, so running `opentofu:ses-dns:apply` would fail. Skip it.
- **`zone-settings`** — the shared Cloudflare baseline (`ssl=strict`, `always_use_https`,
  `min_tls_version=1.2`) was already applied during prod bootstrap and is not stage-scoped. Do not
  run it for dev.

## Full First-Time Command Sequence

### Terminal 1

```bash
BRIMAX_ENV_FILE=.env.dev pnpm cdk:bootstrap
BRIMAX_ENV_FILE=.env.dev pnpm deploy:platform
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:sentry:init
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:sentry:apply
BRIMAX_ENV_FILE=.env.dev pnpm deploy:landing:cert   # pauses — leave running
BRIMAX_ENV_FILE=.env.dev pnpm wait:landing:cert
BRIMAX_ENV_FILE=.env.dev pnpm deploy:landing:edge
BRIMAX_ENV_FILE=.env.dev pnpm deploy:backend
BRIMAX_ENV_FILE=.env.dev pnpm reset:wedding:fresh-start
BRIMAX_ENV_FILE=.env.dev pnpm asaas:webhook:sync
```

### Terminal 2 (while Terminal 1 is paused at the cert step)

```bash
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:cert:init
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:cert:apply
# after the backend is up in Terminal 1:
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:dns:init
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:dns:apply
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:api-dns:init
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:api-dns:apply
```

## Verification

- `BRIMAX_ENV_FILE=.env.dev pnpm --filter @brimax/infra-cdk cdk ls --context stage=dev` lists only
  `dev-` stacks
- `dev-BrimaxPlatformStack`, `dev-BrimaxCertificateStack`, `dev-BrimaxEdgeStack`, and
  `dev-BrimaxAppStack` reach `CREATE_COMPLETE`
- `BRIMAX_ENV_FILE=.env.dev pnpm wait:landing:cert` reports the ACM certificate as `ISSUED`
- `infra/opentofu/sentry` outputs a dev backend DSN and project slug
- `https://dev.brimax.life` renders the dev landing page
- `https://www.dev.brimax.life` redirects to `https://dev.brimax.life`
- `dig @1.1.1.1 api.dev.brimax.life +short` returns the API Gateway custom-domain target chain or
  final IPs
- `curl --resolve api.dev.brimax.life:443:<resolved-ip> -i https://api.dev.brimax.life/payments/not-found`
  returns the dev API's JSON `404`, proving the API custom domain is wired even if your local
  resolver is stale
- `https://api.dev.brimax.life/payments/not-found` reaches the dev API
- the dev app stack outputs a dev webhook URL and dev API custom-domain URL
- dev email notifications point at `dev.brimax.life`
- dev media bucket and DynamoDB table names differ from prod
- `BRIMAX_ENV_FILE=.env.dev pnpm opentofu:dns:plan` only targets `dev.brimax.life` and
  `www.dev.brimax.life`

## DNS Troubleshooting

If `dig @1.1.1.1 api.dev.brimax.life +short` works but `curl https://api.dev.brimax.life/...`
fails locally with `Could not resolve host`, your backend is up and your local resolver is stale.
This can happen if WSL or your OS cached NXDOMAIN before `BRIMAX_ENV_FILE=.env.dev pnpm
opentofu:api-dns:apply` finished publishing the Cloudflare record.

On Windows + WSL, clear the stale cache in this order:

```powershell
ipconfig /flushdns
wsl --shutdown
```

Reopen the distro and re-test:

```bash
dig api.dev.brimax.life +short
curl -i https://api.dev.brimax.life/payments/not-found
```

If WSL still serves stale DNS, disable the auto-generated resolver and pin a public nameserver:

```ini
# /etc/wsl.conf
[network]
generateResolvConf=false
```

```text
# /etc/resolv.conf
nameserver 1.1.1.1
nameserver 8.8.8.8
```

After changing those files, run `wsl --shutdown`, reopen WSL, and repeat the `dig` / `curl`
checks above.
