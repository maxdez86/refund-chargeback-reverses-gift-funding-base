# Step 02 — Add the repository Node 24 runtime contract

Paste this entire prompt into a fresh Claude Code session started from /home/maxreis86/consulting/brimax-life after Step 01 has completed successfully.

You are executing only Step 02 of the Node 24 migration.

## Objective

Make Node 24 the explicit, repository-scoped runtime contract while retaining Node 26 on the machine as an optional compatibility runtime.

## Preconditions

- Step 01 confirms Node 24 is installed and usable through the local version manager.
- Start by inspecting the current working tree. Existing staged and unstaged changes, including the staged Vitest localStorage safeguard and modified agent guides, are user work and must be preserved.

## Non-negotiable safety rules

- Read and obey all applicable AGENTS.md files.
- Never print .env contents, tokens, credentials, or secret values.
- Never stage, unstage, commit, reset, restore, stash, push, create a branch, or open a PR.
- Preserve unrelated staged, unstaged, and untracked work. Merge edits into existing files; do not overwrite them wholesale.
- Do not update dependency versions, @types/node, CI workflows, CDK runtimes, or the Vitest implementation. Those belong to later steps.
- Do not deploy or modify any AWS, Cloudflare, or other external resource.

## Deployment boundary

This migration is written locally by an agent and deployed manually by the repository owner. The agent never deploys anything at any step.

- No git push, no merge, no branch, no PR, no deploy:* script, no cdk deploy, no opentofu:*:apply, no AWS or Cloudflare mutation.
- Merging is deploying. .github/workflows/deploy-dev.yml runs on push to dev and .github/workflows/deploy-prod.yml runs on push to prod. There is no manual approval between the merge and the deploy.
- The owner performs every deployment: merge to dev, let CI/CD deploy, then test in dev.
- This step edits the root package.json, which matches the deploy_frontend, deploy_backend, and sync_asaas_webhook path filters in deploy-dev.yml. Merging it on its own would deploy a partially migrated tree to dev. Never recommend merging before the plan reaches its deployment gate at the end of Step 06.
- End the completion report with exactly one of these verdicts:
  - DEPLOYMENT REQUIRED BEFORE NEXT STEP
  - NO DEPLOYMENT REQUIRED BEFORE NEXT STEP

  If a deployment turns out to be required before the next step can be validated, stop and say so, stating what must be merged, what CI/CD will do, and what the owner should verify.

## Changes to make

1. Add a root .nvmrc containing the repository Node 24 major-version policy. Do not include Node 26 or a machine-wide default directive.
2. Add the root package.json engine declaration node: 24.x while preserving packageManager pnpm@9.12.1 and all unrelated fields.
3. Update the root and applicable nested agent guides to state:
   - Node 24 LTS is required for repository commands, tests, builds, typechecking, and coding-agent sessions;
   - Node 26 may remain installed but is only an optional compatibility runtime;
   - .nvmrc and package.json are the local runtime sources of truth.
   - The engines.node value of 24.x is intentional and defines the supported project runtime. Node 26 checks in later prompts are out-of-contract compatibility checks, not an additional supported runtime.
4. If a guide has no existing Node/runtime section, add a new Node runtime section rather than assuming one exists. Preserve all existing guide content and staged modifications; apply focused patches only to the new or relevant runtime section.

## Validation

Run:

   git diff --check
   node --version
   pnpm --version
   pnpm install --frozen-lockfile
   pnpm typecheck

Source the version manager as needed, enter the repository, run nvm use, and verify that .nvmrc selects Node 24. Confirm active pnpm remains 9.12.1.

Do not update the lockfile in this step. If the new engine declaration causes an install or typecheck failure, report it and stop rather than changing dependencies.

## Completion report

Report:

- files changed and exact runtime-contract additions;
- confirmation that Node 26 was not removed or modified;
- validation results;
- pre-existing or newly exposed failures;
- final git status --short summary confirming no existing work was staged, discarded, or overwritten;
- the deployment verdict. This step changes only local runtime-contract and guide files, so the expected verdict is NO DEPLOYMENT REQUIRED BEFORE NEXT STEP.

Stop after Step 02. Do not perform the tooling, CI, or Lambda migration.
