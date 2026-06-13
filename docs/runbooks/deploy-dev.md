# Dev Deployment Runbook

Use this runbook for repeatable `dev` deploys after the environment has already been bootstrapped.

For the **first** public `dev` bring-up (CDK/Sentry bootstrap, certificate request, and the
two-terminal certificate validation dance), use [bootstrapping-dev.md](bootstrapping-dev.md).

## Env File

Keep `prod` and `dev` in separate files.

- production: `.env`
- development: `.env.dev`

All scripts support an explicit env file, and **every dev command must use it** — otherwise `STAGE`
falls back to `prod` and the work silently targets production in the shared account:

```bash
BRIMAX_ENV_FILE=.env.dev <command>
```

If you have not created the dev env file yet:

```bash
cp .env.dev.example .env.dev
```

Fill in the dev-only values (Asaas sandbox API key + webhook token, dedicated dev contact inbox,
`SENTRY_AUTH_TOKEN`, Cloudflare token / zone id) before deploying.

For local frontend work, `pnpm dev:web` and `pnpm dev:all-web` already default to `.env.dev`.
To point the local frontend at production intentionally, use
`BRIMAX_ENV_FILE=.env BRIMAX_LOCAL_ALLOW_PROD=true`.

## Dev Defaults

The repo assumes these defaults for `STAGE=dev` unless overridden:

- `ROOT_DOMAIN=dev.brimax.life`
- `WWW_DOMAIN=www.dev.brimax.life`
- `API_DOMAIN=api.dev.brimax.life`
- Asaas base URL: `https://api-sandbox.asaas.com/v3`
- Turnstile public test site key: `1x00000000000000000000AA`
- Turnstile private test secret: `1x0000000000000000000000000000000AA`

Confirm the stage resolves to `dev` before deploying:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm --filter @brimax/infra-cdk cdk ls --context stage=dev
```

Every listed stack must carry the `dev-` prefix. If you see bare names, stop — the env file is not
being read and you would act on production.

## Quick Commands

### Deploy Complete Backend

```bash
BRIMAX_ENV_FILE=.env.dev pnpm deploy:backend:with-webhook
```

Updates the dev data, app, and observability stacks, initializes and applies dev API DNS, then
synchronizes and verifies the sandbox Asaas webhook. It resolves the dev `SENTRY_DSN` from
`infra/opentofu/sentry` automatically.

Use `BRIMAX_ENV_FILE=.env.dev pnpm deploy:backend` only for an intentional AWS-only backend deploy.
It does not apply API DNS and does not update Asaas webhook subscriptions.

### Deploy Frontend

```bash
BRIMAX_ENV_FILE=.env.dev pnpm build:web && BRIMAX_ENV_FILE=.env.dev pnpm deploy:landing:edge
```

Rebuilds and deploys the dev landing edge stack. (`deploy:landing:edge` also rebuilds the bundle
internally, so `build:web` is optional but keeps the artifact fresh for local inspection.)

### Refresh Sentry Infrastructure

```bash
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:sentry:init
BRIMAX_ENV_FILE=.env.dev pnpm opentofu:sentry:apply
```

Run this only when the dev Sentry-managed resources change (for example rotating the dev backend
runtime key / DSN). Then redeploy the backend so it picks up the new DSN.

## Repeatable Deployment Sequence

This assumes the dev platform stack, certificate, and initial DNS/certificate validation are already
in place from [bootstrapping-dev.md](bootstrapping-dev.md). **There is no certificate dance here** —
the dev certificate is already issued.

Recurring `dev` deploys are selective by changed live target:

- frontend changes deploy the landing edge stack
- backend changes deploy the data/app/observability stacks
- landing-DNS changes apply only `opentofu:dns`
- API-target changes apply only `opentofu:api-dns`
- backend, API-target, or webhook-configuration changes synchronize and verify the sandbox Asaas webhook
- Sentry changes apply `opentofu:sentry`, then redeploy the backend when the DSN/output glue changed

Shared live files can fan out to multiple targets. For example, a common CDK entrypoint change can
trigger frontend, backend, and the affected DNS jobs together.

The recurring `dev` workflow intentionally excludes bootstrap-only paths:

- `deploy:platform`
- `deploy:landing:cert`
- `opentofu:cert:*`
- `opentofu:zone-settings:*`
- `opentofu:ses-dns:*`

Use the quick commands above to run only the live target you intend to refresh locally.

## Asaas Sandbox

The backend uses sandbox Asaas automatically in `dev`. The standard complete backend command is:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm deploy:backend:with-webhook
```

To sync the sandbox webhook separately:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm asaas:webhook:sync
```

The managed dev webhook is:

```text
https://api.dev.brimax.life/webhooks/asaas
```

Never point sandbox traffic or credentials at production Asaas resources.

## Verification

- `BRIMAX_ENV_FILE=.env.dev pnpm --filter @brimax/infra-cdk cdk ls --context stage=dev` lists all `dev-` stacks
- `https://dev.brimax.life` renders the dev landing page
- `https://www.dev.brimax.life` redirects to `https://dev.brimax.life`
- `https://api.dev.brimax.life/payments/not-found` reaches the dev API
- the dev app stack outputs a dev webhook URL and dev API custom-domain URL
- dev email notifications point at `dev.brimax.life`
- dev media bucket and DynamoDB table names differ from prod
- `BRIMAX_ENV_FILE=.env.dev pnpm opentofu:dns:plan` only targets `dev.brimax.life` and `www.dev.brimax.life`
- `BRIMAX_ENV_FILE=.env.dev pnpm opentofu:api-dns:plan` only targets `api.dev.brimax.life`
