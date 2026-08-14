# Step 04 — Migrate GitHub Actions jobs to Node 24

Step 03 has completed.

You are executing only Step 04 of the Node 24 migration.

## Objective

Make every GitHub Actions job use Node 24 while preserving existing pnpm, caching, credentials, stages, and deployment commands. This step edits workflow definitions only; it does not execute deployments.

## Preconditions

- Steps 01–03 have completed and their reports are available.
- Inspect git status --short and the complete current diff first. Preserve all prior migration edits and unrelated user work.

## Non-negotiable safety rules

- Read and obey all applicable AGENTS.md files.
- Never print .env contents, tokens, credentials, or secret values.
- Never stage, unstage, commit, reset, restore, stash, push, create a branch, or open a PR.
- Do not modify the prod-promotion test suite or its scripts. Workflow runtime changes are in scope; integration-test implementation changes are not.
- Do not execute any workflow, deployment, payment integration, AWS, or Cloudflare command.
- Do not change pnpm version, cache settings, credentials, environment files, stages, job dependencies, or action versions.

## Deployment boundary

This migration is written locally by an agent and deployed manually by the repository owner. The agent never deploys anything at any step.

- No git push, no merge, no branch, no PR, no deploy:* script, no cdk deploy, no opentofu:*:apply, no AWS or Cloudflare mutation.
- Merging is deploying. .github/workflows/deploy-dev.yml runs on push to dev and .github/workflows/deploy-prod.yml runs on push to prod. There is no manual approval between the merge and the deploy.
- The owner performs every deployment: merge to dev, let CI/CD deploy, then test in dev.
- .github/workflows/deploy-dev.yml is itself listed in that workflow's sync_asaas_webhook path filter, so editing it means a later merge will also run the Asaas webhook sync job. Record this in the report; do not act on it. Never recommend merging before the plan reaches its deployment gate at the end of Step 06.
- End the completion report with exactly one of these verdicts:
  - DEPLOYMENT REQUIRED BEFORE NEXT STEP
  - NO DEPLOYMENT REQUIRED BEFORE NEXT STEP

  If a deployment turns out to be required before the next step can be validated, stop and say so, stating what must be merged, what CI/CD will do, and what the owner should verify.

## Changes to make

Update every actions/setup-node invocation in these workflows so node-version is 24:

- .github/workflows/ci.yml
- .github/workflows/smoke-prod.yml
- .github/workflows/deploy-dev.yml
- .github/workflows/deploy-prod.yml
- .github/workflows/prod-promotion-validation.yml

Preserve the existing pnpm/action-setup version 9.12.1, pnpm cache configuration, install modes, and all other workflow behavior.

## Validation

1. Search all workflow YAML files for node-version, nodejs20, and NODEJS_20. No active workflow job may request Node 20.
2. Confirm every actions/setup-node job in the five named workflows uses Node 24.
3. Inspect the diff to ensure only intended runtime values changed.
4. Run git diff --check.
5. Run local non-deployment checks relevant to changed workflow commands, but do not run deployment or external-service scripts.

Do not emulate GitHub Actions by invoking AWS credentials or deployment wrappers.

## Completion report

Report:

- every workflow/job changed;
- count of Node setup entries before and after;
- searches proving no active workflow still requests Node 20;
- validation results;
- confirmation that no deployment or external resource was touched;
- which deploy-dev.yml path filters the migration diff now matches, so the owner knows what a future merge will trigger;
- final working-tree status;
- the deployment verdict. This step changes only workflow definitions, which take effect the next time a workflow runs, so the expected verdict is NO DEPLOYMENT REQUIRED BEFORE NEXT STEP.

Stop after Step 04. Do not change CDK Lambda runtime declarations.
