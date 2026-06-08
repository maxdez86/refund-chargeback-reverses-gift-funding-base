# GitHub OIDC Bootstrap Runbook

Use this runbook to bootstrap GitHub Actions OIDC through one shared AWS stack, with GitHub environment updates scoped to the current local `.env`.

In this repository, `.env` currently sets:

```bash
STAGE=prod
```

That means this flow updates only the `prod` GitHub Environment in GitHub. On the AWS side it deploys one shared OIDC stack that always contains both the `prod` and `dev` deploy roles.

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
- one validation-only secret for the dev validation workflow:
  - `AWS_ROLE_TO_ASSUME_DEV_VALIDATION` when bootstrapping `STAGE=dev`

The role trust is restricted to:

- repository: `maxdez86/brimax-life`
- GitHub Environment: `STAGE`
- branch: `STAGE`

With the current `.env`, that means:

- GitHub environment updated: `prod`
- AWS stack deployed: `BrimaxGithubOidcStack`
- GitHub secret created or updated: `AWS_ROLE_TO_ASSUME_PROD`

## Prerequisites

1. Local AWS CLI access through profile `personal-stg`.
2. Account must be `183286346090`.
3. Region must be `us-east-1`.
4. Both platform stacks must already exist because the shared OIDC stack grants access for both stages:
   - `BrimaxPlatformStack`
   - `dev-BrimaxPlatformStack`
5. `.env` must contain a valid `GITHUB_TOKEN` with permission to manage:
   - environments
   - environment secrets
   - environment variables
6. Dependencies must already be installed locally.

The bootstrap uses values from `.env` through `scripts/landing-env.sh`, including `STAGE`, AWS settings, Cloudflare settings, application secrets, and `GITHUB_TOKEN`.

## One Command

From the repo root:

```bash
pnpm deploy:github-oidc
```

## What The Bootstrap Does

The bootstrap script now performs the full AWS + GitHub setup in one run:

1. Confirms the active AWS account is `183286346090`.
2. Uses the current `STAGE` from `.env` only to choose which GitHub Environment to update.
3. Checks whether `arn:aws:iam::183286346090:oidc-provider/token.actions.githubusercontent.com` already exists.
4. Resolves the exact OpenTofu backend bucket and lock table for both `dev` and `prod`.
5. Deletes the legacy `dev-BrimaxGithubOidcStack` first when it still exists from the old ownership model.
6. Deploys the shared OIDC stack `BrimaxGithubOidcStack`.
7. Verifies both deploy-role outputs exist in the shared stack:
   - `GithubActionsDevDeployRoleArn`
   - `GithubActionsProdDeployRoleArn`
8. Uses `GITHUB_TOKEN` from `.env` to create or update only the GitHub Environment named exactly `STAGE`.
9. Writes only that environment’s GitHub variables and secrets required by the current repository workflows.

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
- `ProdPromotionValidationRoleArn`
- `ProdPromotionValidationRoleSecretName`

With `STAGE=prod`, the environment-specific secret name still used in GitHub should be:

- `AWS_ROLE_TO_ASSUME_PROD`

## GitHub Setup Performed Automatically

The bootstrap now creates or updates only the GitHub Environment named `STAGE` and populates it automatically. Changing `.env` `STAGE` does not change which AWS OIDC stack is deployed.

For the current `.env`, the GitHub environment is:

- `prod`

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

When bootstrapping `STAGE=dev`, keep the separate validation secret for `prod-promotion-validation.yml`:

- `AWS_ROLE_TO_ASSUME_DEV_VALIDATION`

The opposite GitHub environment is not modified by this command.

No manual GitHub Environment setup is required after the command succeeds.

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
- `token.actions.githubusercontent.com:ref = refs/heads/prod`

GitHub validation:

1. Open the GitHub repository environment `prod`.
2. Confirm the environment now exists.
3. Confirm the variables and secrets above are present.
4. Confirm the `dev` environment was not modified by this run.
5. Trigger the existing `deploy-prod` workflow on branch `prod`.

Minimum success signals:

- `aws-actions/configure-aws-credentials` succeeds without static AWS keys
- the workflow can read `AWS_ROLE_TO_ASSUME_${STAGE_UPPER}`
- the workflow can deploy through CDK bootstrap roles
- OpenTofu can read/write the production state bucket and lock table
- ACM helper steps can call `acm:list-certificates` and `acm:describe-certificate`

## Rollback / Safety

- This flow only updates the GitHub Environment for the current stage from `.env`.
- This flow always deploys the shared AWS OIDC stack and requires both stage platform stacks to exist.
- During migration from the old model, this flow deletes `dev-BrimaxGithubOidcStack` before creating the shared dev-owned OIDC resources.
- If the GitHub cutover fails, revert the affected GitHub Environment secret values in the `prod` environment.
- If the trust policy is wrong, update the OIDC stack and rerun the bootstrap.
- Do not delete the shared OIDC provider unless you have confirmed nothing else depends on it.
- The stack is isolated from application stacks, so fixing OIDC does not require touching Lambda, API Gateway, DynamoDB, or CloudFront resources.
