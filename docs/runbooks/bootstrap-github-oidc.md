# GitHub OIDC Bootstrap Runbook

Use this runbook to bootstrap GitHub Actions OIDC through one shared AWS stack, with stage-specific GitHub environment updates. The work is split into two commands:

- `pnpm deploy:github-oidc:cdk` — deploys the shared `BrimaxGithubOidcStack` (both deploy roles).
- `pnpm deploy:github-oidc:github` — pushes the `.env` vars/secrets and the stage role ARN to the GitHub Environment named after `STAGE`.

> **Two commands, two cadences.** `pnpm deploy:github-oidc:cdk` is **run-once**: after the
> role-unification change the shared stack covers all `dev-*`/`Brimax*` CloudFormation stacks and
> `dev-*` DynamoDB tables via wildcards, so adding a table, stack, or Lambda never requires
> re-running it (re-run only for rare events: a repo rename or a new OpenTofu state bucket / lock
> table). `pnpm deploy:github-oidc:github` is the **re-runnable** half: run it whenever a secret or
> `.env` variable changes, or to create a new GitHub Environment. It reads the stage deploy-role ARN
> from the already-deployed stack, so it never mutates AWS.

In this repository, `.env` currently sets:

```bash
STAGE=dev
```

That means a local `pnpm deploy:github-oidc:github` run against the default `.env` updates only the `dev` GitHub Environment in GitHub. `pnpm deploy:github-oidc:cdk` is stage-independent: it always deploys one shared OIDC stack containing both the `prod` and `dev` deploy roles. The `dev` deploy role doubles as the credential for `prod-promotion-validation.yml` (which runs under `environment: dev`).

## What This Creates

- one shared CloudFormation stack:
  - `BrimaxGithubOidcStack`
- shared IAM OIDC provider for `https://token.actions.githubusercontent.com`
  - reused if it already exists in the AWS account
- one deploy role per stage in the shared stack:
  - `brimax-github-actions-prod-deploy`
  - `brimax-github-actions-dev-deploy`
- one stage-specific GitHub Environment:
  - environment name = `STAGE`
- one stage-specific environment secret:
  - `AWS_ROLE_TO_ASSUME_${STAGE_UPPER}`

The role trust is restricted to:

- repository: `maxdez86/brimax-life`
- GitHub Environment: `STAGE`

There is no longer a `ref`/branch condition on the trust: each role is trusted purely by its GitHub
Environment (`sub`). That lets the single `dev` deploy role serve both push-to-dev deploys and the
`prod-promotion-validation.yml` pull-request runs, since both present `environment:dev`.

With the current `.env`, that means:

- GitHub environment updated: `dev`
- AWS stack deployed: `BrimaxGithubOidcStack`
- GitHub secrets created or updated:
  - `AWS_ROLE_TO_ASSUME_DEV`

## Fresh Account Order

For a fresh AWS account, this bootstrap is **not** dependency-free. The current script resolves
CloudFormation outputs from both platform stacks before it can deploy the shared OIDC stack, so the
correct order is:

1. `pnpm cdk:bootstrap`
2. `pnpm deploy:platform` with `STAGE=prod`
3. `BRIMAX_ENV_FILE=.env.dev pnpm deploy:platform`
4. `pnpm deploy:github-oidc:cdk`
5. `pnpm deploy:github-oidc:github`

Why both platform stacks must exist first:

- the shared OIDC stack grants access to both stage backends
- `scripts/bootstrap-github-oidc-cdk.sh` reads the OpenTofu backend bucket and lock-table outputs from
  both `BrimaxPlatformStack` and `dev-BrimaxPlatformStack`
- `scripts/bootstrap-github-oidc-github.sh` then reads the stage deploy-role ARN from the deployed
  `BrimaxGithubOidcStack` and pushes it into the `STAGE` GitHub Environment

This is a current implementation dependency of the bootstrap script, not just an operational
recommendation.

## Prerequisites

1. Local AWS CLI access through profile `personal-stg`.
2. Account must be `183286346090`.
3. Region must be `us-east-1`.
4. Both platform stacks must already exist because the shared OIDC stack grants access for both stages:
   - `BrimaxPlatformStack`
   - `dev-BrimaxPlatformStack`
5. For `pnpm deploy:github-oidc:github` only, `.env` must contain a valid `GITHUB_TOKEN` with permission to manage:
   - environments
   - environment secrets
   - environment variables

   `pnpm deploy:github-oidc:cdk` does **not** need `GITHUB_TOKEN` — it only touches AWS.
6. Dependencies must already be installed locally.

The bootstrap uses values from `.env` through `scripts/landing-env.sh`, including `STAGE`, AWS settings, Cloudflare settings, application secrets, and `GITHUB_TOKEN`.

## Two Commands

From the repo root, in order:

```bash
pnpm deploy:github-oidc:cdk     # run-once: deploys the shared stack (both deploy roles)
pnpm deploy:github-oidc:github  # re-run on secret/var change: pushes the STAGE GitHub Environment
```

- `pnpm deploy:github-oidc:cdk` deploys `BrimaxGithubOidcStack`. It is stage-independent (it always
  builds both the `dev` and `prod` deploy roles), needs AWS credentials but **not** `GITHUB_TOKEN`,
  and is run-once because the roles use wildcards.
- `pnpm deploy:github-oidc:github` reads the stage deploy-role ARN from the deployed stack and pushes
  every `.env` var/secret (including `AWS_ROLE_TO_ASSUME_<STAGE>`) into the GitHub Environment named
  exactly `STAGE`. It needs `GITHUB_TOKEN` and re-runs whenever a secret or `.env` variable changes.

## What The CDK Command Does

`pnpm deploy:github-oidc:cdk` performs the AWS-only half:

1. Confirms the active AWS account is `183286346090`.
2. Checks whether `arn:aws:iam::183286346090:oidc-provider/token.actions.githubusercontent.com` already exists.
3. Resolves the exact OpenTofu backend bucket and lock table for both `dev` and `prod`.
4. Deletes the legacy `dev-BrimaxGithubOidcStack` first when it still exists from the old ownership model.
5. Deploys the shared OIDC stack `BrimaxGithubOidcStack`, which always contains both the
   `GithubActionsDevDeployRoleArn` and `GithubActionsProdDeployRoleArn` outputs.

It never touches GitHub.

## What The GitHub Command Does

`pnpm deploy:github-oidc:github` performs the GitHub-only half:

1. Confirms the active AWS account is `183286346090`.
2. Resolves the stage deploy-role ARN from the already-deployed `BrimaxGithubOidcStack`
   (`GithubActionsDevDeployRoleArn` when `STAGE=dev`, otherwise `GithubActionsProdDeployRoleArn`).
3. Uses `GITHUB_TOKEN` from `.env` to create or update the GitHub Environment named exactly `STAGE`.
4. Writes that environment’s GitHub variables, stage-specific secrets, and the
   `AWS_ROLE_TO_ASSUME_<STAGE>` role secret required by the current repository workflows.

It never mutates the AWS stack.

## AWS Outputs

After deploy, inspect the current stage stack outputs:

```bash
aws cloudformation describe-stacks \
  --profile personal-stg \
  --region us-east-1 \
  --stack-name BrimaxGithubOidcStack \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
```

Expected outputs from the shared stack:

- `GithubOidcProviderArn`
- `GithubActionsDevDeployRoleArn`
- `GithubActionsDevDeployRoleSecretName`
- `GithubActionsDevEnvironmentName`
- `GithubActionsProdDeployRoleArn`
- `GithubActionsProdDeployRoleSecretName`
- `GithubActionsProdEnvironmentName`

With `STAGE=dev`, the GitHub environment should contain:

- `AWS_ROLE_TO_ASSUME_DEV`

`prod-promotion-validation.yml` reuses this same `AWS_ROLE_TO_ASSUME_DEV` secret (it runs under
`environment: dev`), so there is no separate validation secret to manage.

With `STAGE=prod`, the environment-specific secret name used in GitHub should be:

- `AWS_ROLE_TO_ASSUME_PROD`

## GitHub Setup Performed Automatically

The bootstrap creates or updates the GitHub Environment named `STAGE`. Changing `.env` `STAGE` does not change which AWS OIDC stack is deployed.

For the current `.env`, the GitHub environment is:

- `dev`

Environment variables set by the script:

- `AWS_REGION`
- `STAGE`
- `ROOT_DOMAIN`
- `CONTACT_EMAIL`
- `API_DOMAIN`
- `WWW_DOMAIN`
- `CLOUDFLARE_ZONE_ID`
- `OBSERVABILITY_ALERT_EMAIL`
- `XRAY_ENABLED`
- `ASAAS_ENV`
- `ASAAS_API_BASE_URL`
- `TURNSTILE_SITE_KEY`
- `PAYMENTS_TEST_GIFT_ID`
- `PAYMENTS_TEST_GIFT_QUANTITY`
- `TOFU_STATE_KEY_PREFIX`
- `SENTRY_ORG`
- `SENTRY_TEAM_SLUG`

Environment secrets set by the script:

- `CLOUDFLARE_API_TOKEN`
- `ASAAS_API_KEY`
- `ASAAS_WEBHOOK_TOKEN`
- `TURNSTILE_SECRET_KEY`
- `PAYMENTS_TEST_PAYER_NAME`
- `PAYMENTS_TEST_PAYER_EMAIL`
- `PAYMENTS_TEST_PAYER_CPF`
- `PAYMENTS_TEST_PAYER_PHONE`
- `SENTRY_AUTH_TOKEN`
- `AWS_ROLE_TO_ASSUME_${STAGE_UPPER}`

No manual GitHub Environment setup is required after the command succeeds.

## Backend Deploy Secret Requirement

`deploy-backend` and `prod-promotion-validation.yml` are stricter than the other
`dev` jobs. They require raw Asaas secrets to be present in the GitHub `dev`
environment:

- `ASAAS_API_KEY`
- `ASAAS_WEBHOOK_TOKEN`

Those values are consumed by `scripts/deploy-backend.sh` and enforced again by
`infra/cdk/bin/app.ts` when the backend stacks are part of the CDK invocation.
`prod-promotion-validation.yml` also reads `ASAAS_API_KEY` from the same `dev`
environment so the `payment-webhook-payment-id-fallback` phase can resolve the
live Asaas `payment.id` without widening AWS IAM access. Frontend, DNS, and
Sentry-only dev deploy jobs do not require the raw Asaas secrets.

If `deploy-backend` fails at the "Generate dev environment file" step with:

```text
Missing required GitHub environment vars/secrets for "dev": ASAAS_API_KEY
```

refresh the `dev` GitHub environment from the current local env source instead of
editing the GitHub secret manually:

```bash
BRIMAX_ENV_FILE=.env.dev pnpm deploy:github-oidc:github
```

This auto-resolves the stage deploy-role ARN from `BrimaxGithubOidcStack` and rewrites
every var/secret in the `dev` environment. Then re-run `deploy-dev`.

> If you need to push a specific ARN by hand, the underlying script still accepts it
> directly: `BRIMAX_ENV_FILE=.env.dev bash scripts/setup-github-environment.sh <GithubActionsDevDeployRoleArn>`
> (resolve that ARN from the shared stack outputs in `BrimaxGithubOidcStack`).

## Validation

Local AWS validation:

```bash
aws iam get-open-id-connect-provider \
  --profile personal-stg \
  --region us-east-1 \
  --open-id-connect-provider-arn arn:aws:iam::183286346090:oidc-provider/token.actions.githubusercontent.com

aws iam get-role \
  --profile personal-stg \
  --region us-east-1 \
  --role-name brimax-github-actions-prod-deploy
```

Inspect the trust policy and confirm:

- `token.actions.githubusercontent.com:aud = sts.amazonaws.com`
- `token.actions.githubusercontent.com:repository = maxdez86/brimax-life`
- `token.actions.githubusercontent.com:sub = repo:maxdez86/brimax-life:environment:prod`

There should be **no** `token.actions.githubusercontent.com:ref` condition: trust is scoped purely by
the GitHub Environment (`sub`).

GitHub validation:

1. Open the GitHub repository environment that matches `STAGE`.
2. Confirm the environment now exists.
3. Confirm the variables and secrets above are present.
4. Confirm `AWS_ROLE_TO_ASSUME_DEV` is present in the `dev` environment because `prod-promotion-validation.yml` reuses it.
5. If `STAGE=prod`, confirm the prod environment was updated.
6. Trigger the stage-matching deploy workflow on the stage-matching branch:
   - `deploy-dev` on branch `dev`
   - `deploy-prod` on branch `prod`

Minimum success signals:

- `aws-actions/configure-aws-credentials` succeeds without static AWS keys
- the workflow can read `AWS_ROLE_TO_ASSUME_${STAGE_UPPER}`
- the workflow can deploy through CDK bootstrap roles
- OpenTofu can read/write the production state bucket and lock table
- ACM helper steps can call `acm:list-certificates` and `acm:describe-certificate`

## Rollback / Safety

- This flow always updates the GitHub Environment for the current stage from `.env`.
- This flow always deploys the shared AWS OIDC stack and requires both stage platform stacks to exist.
- During migration from the old model, this flow deletes `dev-BrimaxGithubOidcStack` before creating the shared dev-owned OIDC resources.
- If the GitHub cutover fails, revert the affected GitHub Environment secret values in the environment selected by `STAGE`.
- If the trust policy is wrong, update the OIDC stack and rerun the bootstrap.
- Do not delete the shared OIDC provider unless you have confirmed nothing else depends on it.
- The stack is isolated from application stacks, so fixing OIDC does not require touching Lambda, API Gateway, DynamoDB, or CloudFront resources.
