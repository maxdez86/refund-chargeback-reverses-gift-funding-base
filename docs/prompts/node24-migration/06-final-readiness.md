# Step 06 — Run the final Node 24 migration readiness gate

Steps 01–05 have completed.

You are executing only the final readiness gate. Do not deploy anything.

## Objective

Validate that local development, direct dependencies, tests, CI configuration, CDK source, and synthesized Lambda templates consistently target Node 24, while confirming the Node 26 Vitest safeguard remains useful.

## Preconditions

- Steps 01–05 have completed and their reports are available.
- Node 24 is active for the repository.
- Node 26 remains installed for the explicit compatibility check.
- Inspect and record the starting git status --short; preserve every staged, unstaged, and untracked change.

## Non-negotiable safety rules

- Read and obey all applicable AGENTS.md files.
- Never print .env contents, tokens, credentials, or secret values.
- Never stage, unstage, commit, reset, restore, stash, push, create a branch, or open a PR.
- Do not edit files during this gate unless a command generates ignored build/cache output. If a required fix is discovered, stop and report it instead of implementing it.
- Do not run deployments, payment integration commands, production-promotion preparation, AWS CLI mutations, or Cloudflare commands.

## Deployment boundary

This migration is written locally by an agent and deployed manually by the repository owner. The agent never deploys anything at any step.

- No git push, no merge, no branch, no PR, no deploy:* script, no cdk deploy, no opentofu:*:apply, no AWS or Cloudflare mutation.
- Merging is deploying. .github/workflows/deploy-dev.yml runs on push to dev and .github/workflows/deploy-prod.yml runs on push to prod. There is no manual approval between the merge and the deploy.
- The owner performs every deployment: merge to dev, let CI/CD deploy, then test in dev.
- This step is the deployment gate. It is the last purely local step. If it passes, the owner deploys to dev before anything else happens; if it fails, nothing is merged. Produce the deployment brief described below and stop — do not merge, and do not describe the deployment as optional or deferred.

## Validation

The repository runtime contract remains Node 24 (engines.node: 24.x). The Node 26 web run below is deliberately an out-of-contract compatibility check, not a second supported runtime.

Before running synth, verify that .env.dev exists by name only. Do not fall back to .env; if the safe dev environment is absent, report synth as blocked instead of producing a production-default build/template.

Under Node 24, run:

   pnpm install --frozen-lockfile
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm test:coverage
   pnpm build
   BRIMAX_ENV_FILE=.env.dev STAGE=dev pnpm synth

Then run the web test suite once explicitly under Node 26. Confirm the localStorage regression test and affected web tests pass because the worker safeguard disables Node Web Storage for that process. Do not change or uninstall Node 26 to make the check pass.

Perform static consistency checks:

- .nvmrc selects Node 24;
- root package.json requires Node 24 and still declares pnpm 9.12.1;
- direct @types/node declarations use the approved Node 24 range;
- all active GitHub Actions setup-node entries use Node 24;
- CDK source and assertions use Node 24;
- synthesized Lambda resources use nodejs24.x;
- apps/web/vitest.config.ts selects its worker flag through a process.allowedNodeEnvironmentFlags probe and passes --no-experimental-webstorage, never the bare --no-webstorage, which is fatal on Node 24;
- no active workflow, CDK source, or runtime contract still requests Node 20.

Run git diff --check, inspect the complete diff, and identify remaining Node 20 references as active configuration, test expectation, documentation, or historical text.

## Completion report

Produce a final readiness report containing:

- active Node/pnpm versions and executable paths;
- results of every validation command;
- Node 26 compatibility-test results;
- static-search results for Node 20/24 references;
- coverage/build/synth status and warnings;
- remaining blockers or files requiring follow-up;
- confirmation that no AWS or Cloudflare resource was changed;
- final staged, unstaged, and untracked working-tree status;
- the deployment verdict, which is DEPLOYMENT REQUIRED BEFORE NEXT STEP when every check above passes.

## Owner deployment brief

If and only if every validation above passes, end the report with a brief the owner can act on directly. Do not perform any part of it.

State:

1. **What to merge.** The exact branch and the full list of files changed across Steps 02–05.
2. **What CI/CD will do on push to dev.** Read .github/workflows/deploy-dev.yml and report which detect-changes path filters the diff matches and therefore which jobs will run. Expect deploy_frontend, deploy_backend, apply_dev_api_dns, and sync_asaas_webhook to match, but verify against the actual diff rather than repeating this list.
3. **The infrastructure effect.** The number of Lambda functions in the app stack whose managed runtime changes from nodejs20.x to nodejs24.x, taken from the synthesized dev template, not from memory.
4. **What the owner should verify in dev after the deploy**, as a concrete checklist: the deploy-dev run is green on Node 24 runners; every app-stack Lambda reports runtime nodejs24.x; the guest-facing flows that exercise those handlers still work; and CloudWatch logs for the changed functions show no new startup or runtime errors.
5. **How to roll back.** The revert commit that restores nodejs20.x and the fact that pushing that revert to dev redeploys the previous runtime through the same workflow.
6. **That prod is untouched.** deploy-prod.yml only runs on push to prod, so a dev merge cannot promote. Prod promotion is a separate, later owner decision that goes through prod-promotion-validation.yml.

Then stop. Do not merge, deploy, or begin the production rollout. Once the owner has deployed and tested dev, Step 07 verifies the deployed result.
