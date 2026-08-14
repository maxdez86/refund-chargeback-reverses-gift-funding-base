# Step 01 — Prepare and validate the local Node 24 environment

Paste this entire prompt into a fresh Claude Code session started from /home/maxreis86/consulting/brimax-life.

You are executing only Step 01 of the Node 24 migration. Do not perform repository migration work from later steps.

## Objective

Make Node 24 available through the existing local version manager and validate the repository under Node 24. Keep Node 26 installed and available. Do not change repository-tracked files in this step.

## Non-negotiable safety rules

- Read and obey the repository AGENTS.md files.
- Never print .env contents, tokens, credentials, or secret values.
- Preserve the working tree exactly: do not edit, create, delete, stage, unstage, commit, reset, restore, stash, push, create branches, or open PRs.
- Do not create .nvmrc, edit package.json, edit workflows, edit CDK code, or alter any prompt document. Those belong to later steps.
- Do not uninstall Node 26 or any other installed Node version.
- Do not change the machine-wide default Node version. Use a repository/session selection only.
- Do not install an OS-level Node distribution or run an unreviewed curl | shell installer.
- Do not deploy to AWS or Cloudflare, run payment integration commands, or modify cloud resources.

## Deployment boundary

This migration is written locally by an agent and deployed manually by the repository owner. The agent never deploys anything at any step.

- No git push, no merge, no branch, no PR, no deploy:* script, no cdk deploy, no opentofu:*:apply, no AWS or Cloudflare mutation.
- Merging is deploying. .github/workflows/deploy-dev.yml runs on push to dev and .github/workflows/deploy-prod.yml runs on push to prod. There is no manual approval between the merge and the deploy.
- The owner performs every deployment: merge to dev, let CI/CD deploy, then test in dev.
- The root package.json, pnpm-lock.yaml, apps/api/**, apps/web/**, infra/cdk/lib/stacks/app-stack.ts, and .github/workflows/deploy-dev.yml all appear in the deploy-dev.yml path filters, so merging any intermediate step would deploy a partially migrated tree. Never recommend merging before the plan reaches its deployment gate at the end of Step 06.
- End the completion report with exactly one of these verdicts:
  - DEPLOYMENT REQUIRED BEFORE NEXT STEP
  - NO DEPLOYMENT REQUIRED BEFORE NEXT STEP

  If a deployment turns out to be required before the next step can be validated, stop and say so, stating what must be merged, what CI/CD will do, and what the owner should verify.

## Procedure

1. Record the starting state with git status --short and git diff --stat; do not alter it.
2. Inspect, without secrets:
   - node --version and command -v node;
   - pnpm --version and command -v pnpm;
   - whether a Corepack command is present on the current PATH (record the path only; do not execute it before selecting Node 24);
   - available nvm, fnm, mise, volta, and asdf commands;
   - relevant shell initialization files for version-manager loading;
   - installed Node versions exposed by the available version manager.
3. Prefer the existing nvm installation. Source nvm explicitly in commands if the current non-interactive shell does not load it automatically, then select Node 24 before executing 'corepack', 'pnpm', or 'pnpx'.
4. Install the latest available Node 24 release with the existing version manager if Node 24 is not already installed. Do not remove Node 26. Do not set Node 24 as the global default for unrelated projects.
5. After Node 24 is selected, re-run 'command -v node', 'command -v pnpm', and 'command -v corepack'. If the Node 24 installation already provides pnpm 9.12.1, use it and make no Corepack changes. Only if the Node 24-local pnpm is absent or has the wrong version may you use the Node 24-local Corepack to activate pnpm 9.12.1; never invoke or repair the pre-selection PATH's Corepack executable.
6. Verify Node 24 and pnpm 9.12.1 in a fresh interactive shell. Confirm executable paths and confirm Node 26 is still installed.
7. From the repository root, run pnpm install --frozen-lockfile. This may update ignored dependency caches or node_modules, but it must not modify tracked files.
8. Run the current baseline checks under Node 24:

   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm test:coverage
   pnpm build
   Before running synth, verify that .env.dev exists by name only. If it is absent, do not fall back to .env; report synth as blocked for lack of a safe dev environment. Otherwise run the synth command explicitly in the dev stage:

   BRIMAX_ENV_FILE=.env.dev STAGE=dev pnpm synth

   Do not run deployment commands or payment/integration commands excluded by the repository guide.
9. If a command fails, classify it as either an environment/setup failure or an existing repository failure. Do not fix repository configuration in this step.
10. Re-run git status --short and confirm no repository-tracked files changed.

## Completion report

Report:

- starting and ending Node/pnpm versions and executable paths;
- version manager used and exact Node 24 installation/use commands;
- confirmation that Node 26 remains installed;
- whether a fresh interactive shell selected Node 24 for the session;
- result of every validation command;
- environment or baseline failures, with classification;
- confirmation that no repository-tracked files were changed;
- the deployment verdict. This step changes no tracked file, so the expected verdict is NO DEPLOYMENT REQUIRED BEFORE NEXT STEP.

Do not begin Step 02 or make recommendations that require editing the repository. Stop after this report.
