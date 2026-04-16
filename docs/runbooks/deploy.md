# Deploy Runbook

## Prerequisites

- AWS account and credentials configured locally
- Cloudflare-managed DNS already provisioned for `brimax.life`
- `corepack enable`
- `pnpm install`

## Validation Commands

```bash
source .env
pnpm typecheck
pnpm test
pnpm --filter @brimax/infra-cdk cdk synth
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
```

If DNS needs to be reconciled again:

```bash
bash scripts/landing-opentofu.sh edge-dns init
bash scripts/landing-opentofu.sh edge-dns apply
```

## Notes

- Source your local `.env` before running deploy commands.
- The first landing-page bootstrap is intentionally documented separately because the certificate validation step blocks in one terminal while OpenTofu must run in another.
- Replace placeholder secrets before deploying webhook or admin flows.
- `prod` is the default stage, so you do not need to pass `stage=prod`.
- Use `STAGE=dev` or `--context stage=dev` only when you intentionally want prefixed development resources.
- First-time landing-page DNS and certificate validation are handled in `infra/opentofu`; use the two-terminal bootstrap steps in [bootstrapping.md](/home/maxreis86/consulting/brimax-life/docs/runbooks/bootstrapping.md:1).
- Keep production resources on retain policies unless there is a deliberate teardown plan.
