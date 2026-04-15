# Deploy Runbook

## Prerequisites

- AWS account and credentials configured locally
- Cloudflare-managed DNS already provisioned for `brimax.life`
- `corepack enable`
- `pnpm install`

## Commands

```bash
pnpm typecheck
pnpm test
pnpm --filter @brimax/infra-cdk cdk synth
pnpm --filter @brimax/infra-cdk cdk deploy --all --context stage=dev
```

## Notes

- Replace placeholder secrets before deploying webhook or admin flows.
- Keep `prod` resources on retain policies unless there is a deliberate teardown plan.
