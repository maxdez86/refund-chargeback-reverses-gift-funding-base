# Step 05 — Migrate CDK Lambda runtimes to Node 24

Step 04 has completed.

You are executing only Step 05 of the Node 24 migration.

## Objective

Change every CDK-managed Lambda runtime and its assertions from Node 20 to Node 24 without deploying or modifying any AWS resource.

## Preconditions

- Steps 01–04 have completed.
- Node 24 is active.
- Inspect git status --short and the complete diff before editing. Preserve all prior migration changes and unrelated user work.

## Non-negotiable safety rules

- Read and obey all applicable AGENTS.md files.
- Never print .env contents, tokens, credentials, or secret values.
- Never stage, unstage, commit, reset, restore, stash, push, create a branch, or open a PR.
- Do not run deployment commands, CDK deploy, AWS CLI mutation commands, CloudFormation updates, or Cloudflare commands.
- Do not change Lambda handlers, business logic, environment variables, IAM policies, event sources, memory, timeout, architecture, or resource naming.
- Do not modify the prod-promotion integration suite.
- Any lockfile change must be limited to the smallest CDK package compatibility update required by the Node 24 runtime enum.

## Deployment boundary

This migration is written locally by an agent and deployed manually by the repository owner. The agent never deploys anything at any step.

- No git push, no merge, no branch, no PR, no deploy:* script, no cdk deploy, no opentofu:*:apply, no AWS or Cloudflare mutation.
- Merging is deploying. .github/workflows/deploy-dev.yml runs on push to dev and .github/workflows/deploy-prod.yml runs on push to prod. There is no manual approval between the merge and the deploy.
- The owner performs every deployment: merge to dev, let CI/CD deploy, then test in dev.
- This is the step that produces a real infrastructure change. infra/cdk/lib/stacks/app-stack.ts matches the deploy_backend and apply_dev_api_dns path filters in deploy-dev.yml, so the eventual merge will replace the managed runtime on every Lambda in the app stack. That deployment is owner-executed and happens once, at the gate at the end of Step 06 — not now, and not between Step 05 and Step 06.
- End the completion report with exactly one of these verdicts:
  - DEPLOYMENT REQUIRED BEFORE NEXT STEP
  - NO DEPLOYMENT REQUIRED BEFORE NEXT STEP

  Step 06 is a local, read-only readiness gate that needs no deployed change, so the expected verdict here is NO DEPLOYMENT REQUIRED BEFORE NEXT STEP. Say so while also recording that a dev deployment becomes required immediately after Step 06.

## Changes to make

1. Replace every lambda.Runtime.NODEJS_20_X in CDK source with lambda.Runtime.NODEJS_24_X.
2. Update CDK unit-test assertions from nodejs20.x to nodejs24.x.
3. Confirm the installed aws-cdk-lib exposes Runtime.NODEJS_24_X.
4. If the installed CDK package does not support the enum, update only the minimum compatible aws-cdk-lib/CLI package versions needed, preserve major version 2, refresh the lockfile narrowly, and reject unrelated dependency churn.

## Validation

Before synthesizing, verify that .env.dev exists by name only. If it is absent, stop and report synth as blocked; do not fall back to .env or run a production-default synth. Run the synth command with BRIMAX_ENV_FILE=.env.dev STAGE=dev so the landing bundle and CDK app are explicitly dev-scoped:

   Run under Node 24:

   pnpm --filter @brimax/infra-cdk typecheck
   pnpm --filter @brimax/infra-cdk test
   BRIMAX_ENV_FILE=.env.dev STAGE=dev pnpm synth

Inspect synthesized templates and confirm every managed Lambda resource uses nodejs24.x. Search CDK source and tests for stale NODEJS_20_X and nodejs20.x references. Treat historical documentation references separately and report them; do not silently delete unrelated history.

Run git diff --check and inspect the complete source, test, synthesized-template, and lockfile diff. Confirm no AWS API or deployment command was invoked.

## Completion report

Report:

- every CDK runtime declaration and assertion changed;
- whether a CDK package update was required;
- synthesized-template runtime evidence;
- test/typecheck/synth results;
- remaining Node 20 references and whether each is active or historical;
- final working-tree status;
- the exact count and list of Lambda logical IDs whose runtime changed, so the owner can size the pending dev deployment;
- the deployment verdict, plus an explicit note that the changed stacks are now pending an owner-executed dev deployment at the end of Step 06.

Stop after Step 05. Do not deploy the changed stacks and do not merge them.
