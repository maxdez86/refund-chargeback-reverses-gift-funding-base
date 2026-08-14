# Step 03 — Align Node-dependent tooling, types, and Vitest behavior

Steps 01 and 02 have completed.

You are executing only Step 03 of the Node 24 migration.

## Objective

Align direct Node type declarations to Node 24 and make the existing Vitest localStorage safeguard accurate for Node 24 and accidental Node 26 execution.

## Preconditions

- .nvmrc and the root Node 24 engine declaration exist.
- Node 24 is active through the repository version-manager selection.
- Inspect git status --short and the existing diff before editing. Preserve the staged apps/web/tests/test-environment.test.ts, the staged apps/web/vitest.config.ts, and all unrelated user work.

## Non-negotiable safety rules

- Read and obey all applicable AGENTS.md files.
- Never print .env contents, tokens, credentials, or secret values.
- Never stage, unstage, commit, reset, restore, stash, push, create a branch, or open a PR.
- Do not upgrade unrelated dependencies or rewrite lockfile sections unrelated to Node typings.
- This step has explicit owner approval to update pnpm-lock.yaml, but only for the direct @types/node changes described below. Stop and report if unrelated lockfile churn cannot be avoided.
- Do not modify CI workflows, CDK runtime declarations, or deploy anything.

## Deployment boundary

This migration is written locally by an agent and deployed manually by the repository owner. The agent never deploys anything at any step.

- No git push, no merge, no branch, no PR, no deploy:* script, no cdk deploy, no opentofu:*:apply, no AWS or Cloudflare mutation.
- Merging is deploying. .github/workflows/deploy-dev.yml runs on push to dev and .github/workflows/deploy-prod.yml runs on push to prod. There is no manual approval between the merge and the deploy.
- The owner performs every deployment: merge to dev, let CI/CD deploy, then test in dev.
- This step edits package manifests and pnpm-lock.yaml, which match the deploy_frontend and deploy_backend path filters in deploy-dev.yml. Merging it on its own would deploy a partially migrated tree to dev. Never recommend merging before the plan reaches its deployment gate at the end of Step 06.
- End the completion report with exactly one of these verdicts:
  - DEPLOYMENT REQUIRED BEFORE NEXT STEP
  - NO DEPLOYMENT REQUIRED BEFORE NEXT STEP

  If a deployment turns out to be required before the next step can be validated, stop and say so, stating what must be merged, what CI/CD will do, and what the owner should verify.

## Changes to make

1. Unify the direct @types/node declarations on major version 24. Inspect every workspace manifest first; the three that declare it today are:

   | manifest | current | target |
   |---|---|---|
   | package.json (root) | ^22.15.14 | ^24.0.0 |
   | apps/api/package.json | ^22.15.14 | ^24.0.0 |
   | apps/web/package.json | ^25.3.3 | ^24.0.0 |

   apps/web is a deliberate major **downgrade**, not an upgrade. Apply it knowingly and label it as a downgrade in the report. Do not "correct" it back to 25 on the assumption that this prompt made a mistake.

   Why the downgrade is the right direction: @types/node in apps/web types only the build and test tooling — apps/web/vite.config.ts and apps/web/tests/shell.test.ts — which runs on the developer and CI Node, and after this migration that is Node 24. The ^25 pin arrived incidentally in commit 5549b9e alongside a React 19 bump; it describes a runtime nothing in this repository runs, because CI becomes Node 24 in Step 04, Lambda becomes nodejs24.x in Step 05, and the local compatibility runtime is Node 26. Leaving root and apps/api on 22 while apps/web sits on 25 also makes vite and vitest resolve against different @types/node peers per workspace.

   The downgrade was verified against the current tree before this prompt was written: with @types/node 24.13.3 substituted into apps/web, tsc -p tsconfig.json --noEmit exits 0 and the full Vitest suite passes at 16 files / 113 tests. The web Node type surface is only node:fs, node:path, process.env, and process.cwd, with no NodeJS.* namespace types anywhere.

   Failure handling: if apps/web typecheck fails with errors that trace to @types/node 24, do not silently restore ^25, do not widen the range to something like >=24, and do not add a per-workspace exception. Stop and report the exact errors and the symbols involved. Such a failure means web tooling code depends on a Node 25+ API that will not exist in CI or Lambda, and the owner decides whether to change that code or hold apps/web at 25.

   Do not change transitive packages or unrelated direct dependencies.
2. Refresh pnpm-lock.yaml using the least broad lockfile-only/install operation that records those importer changes. Review the lockfile diff and stop if it contains unrelated dependency resolution changes.
3. Rewrite the comment above the worker execArgv workaround in apps/web/vitest.config.ts so it is accurate for every runtime this repository now supports:
   - Node 25 and 26 enable the Web Storage API by default, and their localStorage getter on globalThis shadows the jsdom implementation Vitest installs (vitest-dev/vitest#8757);
   - do not claim that every Node version returns undefined;
   - delete the sentence stating that CI runs Node 20, which Step 04 makes false.
4. Replace the runtime detection with a capability probe and fix the flag spelling.

   The current condition asks "is Web Storage active in this process?" and uses the answer to decide "does this binary accept this flag?". Those are different questions, they are evaluated in the config process but applied to worker processes, and on Node 24 they disagree in the fatal direction. Measured directly:

   | runtime | global localStorage | --no-webstorage | --no-experimental-webstorage |
   |---|---|---|---|
   | Node 24.19.0 | absent | fatal `bad option`, process dies | accepted, no-op |
   | Node 26.7.0 | present | accepted | accepted |

   process.allowedNodeEnvironmentFlags reports --no-experimental-webstorage as true on both runtimes, and --no-webstorage as false on both. Probe the `experimental` spelling specifically.

   Implement exactly this shape:

       const workerExecArgv = process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
         ? ["--no-experimental-webstorage"]
         : [];

   The probe is mandatory, not incidental. It is the only thing that prevents an unsupported flag from reaching a worker, and it is what makes the config degrade gracefully: if a future Node removes the deprecated alias, the array is empty, workers run with native Web Storage, and apps/web/tests/test-environment.test.ts fails with a readable localStorage assertion instead of an opaque worker crash. Do not substitute a process.versions.node major-version comparison, and do not drop the probe on the grounds that the flag is currently accepted everywhere.

   Preserve the existing forks/threads poolOptions shape and leave the regression test unchanged.

The repository runtime contract remains Node 24 (engines.node: 24.x). The Node 26 web run below is deliberately an out-of-contract compatibility check and must not be used as justification for widening the engine range.

## Validation

Under Node 24, run:

   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm --filter @brimax/web test
   pnpm --filter @brimax/api test
   pnpm --filter @brimax/config test
   pnpm --filter @brimax/infra-cdk test

If Node 26 is installed, run the web suite once explicitly under Node 26 and confirm the localStorage regression test and affected web tests pass. Do not remove or alter Node 26 to make this check pass.

The Node 24 and Node 26 web runs must report the same test-file and test counts, with no `bad option` output and no worker-crash or "worker exited unexpectedly" message. A worker crash here means an unsupported flag reached a worker; treat it as a failure of change 4, not as a flaky suite.

Run pnpm --filter @brimax/web typecheck on its own as well, so a failure caused by the apps/web downgrade is attributed to change 1 rather than buried in the workspace-wide run. Then confirm that exactly one @types/node major resolves across the workspace after the lockfile refresh; two coexisting majors mean the unification did not take.

Note that node_modules on the current machine has drifted ahead of the lockfile for this package — the lockfile pins @types/node 25.6.0 for apps/web while 25.9.5 is installed. Expect pnpm install to move it, and do not treat that movement as unrelated churn.

Run git diff --check and inspect the complete package-manifest, Vitest, and lockfile diff. Confirm no unrelated dependency upgrade occurred.

## Completion report

Report:

- all direct @types/node declarations changed and final ranges, stating explicitly that apps/web moved down a major and that its typecheck was run on its own;
- exact lockfile scope and confirmation that unrelated dependency entries were not changed;
- Vitest behavior change, quoting the final execArgv expression and reporting what the probe evaluated to under each runtime;
- Node 24 and Node 26 validation results, including the test-file and test counts from both web runs;
- failures or warnings;
- final staged/unstaged/untracked status;
- the deployment verdict. This step changes only local dependency and test-harness configuration, so the expected verdict is NO DEPLOYMENT REQUIRED BEFORE NEXT STEP.

Stop after Step 03. Do not migrate workflows or Lambda runtimes.
