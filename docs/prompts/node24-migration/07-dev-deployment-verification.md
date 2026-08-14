# Step 07 — Verify the deployed dev environment and hand off prod promotion

**after the owner has merged Steps 02–05 to dev, the deploy-dev workflow has finished, and the owner has tested dev**.

You are executing only the post-deployment verification. You are not deploying, promoting, or fixing.

## Objective

Confirm that the dev environment actually runs Node 24 end to end after the owner's deployment, and produce the decision record the owner needs before promoting to prod.

## Preconditions

- Steps 01–06 have completed and their reports are available.
- The owner has merged to dev and the deploy-dev workflow has completed. Ask for the workflow run URL and its outcome if it was not provided. Do not guess whether it ran.
- Node 24 is active locally.

## Deployment boundary

This migration is written locally by an agent and deployed manually by the repository owner. The agent never deploys anything at any step.

- No git push, no merge, no branch, no PR, no deploy:* script, no cdk deploy, no opentofu:*:apply, no AWS or Cloudflare mutation.
- Merging is deploying. .github/workflows/deploy-dev.yml runs on push to dev and .github/workflows/deploy-prod.yml runs on push to prod. There is no manual approval between the merge and the deploy.
- Promotion to prod is the owner's decision and the owner's action. This step produces the evidence for that decision and stops.

## Non-negotiable safety rules

- Read and obey all applicable AGENTS.md files.
- Never print .env contents, tokens, credentials, or secret values.
- Never stage, unstage, commit, reset, restore, stash, push, create a branch, or open a PR.
- Read-only AWS describe/get/list calls against the **dev** stage are permitted if credentials are already available. Any AWS call that creates, updates, or deletes is forbidden, as is every call against prod.
- Do not run payment integration commands, prod-promotion preparation, smoke:prod, or any Cloudflare command.
- Do not fix anything you find. Report it and stop.

## Verification

1. Confirm the deploy-dev run completed successfully and that its jobs used Node 24. Record the run URL and which jobs executed.
2. For each app-stack Lambda in the dev stage, confirm the deployed runtime is nodejs24.x. Prefer a read-only aws lambda get-function-configuration or list-functions query against dev. If credentials are unavailable, say so and ask the owner to paste the runtime listing rather than inferring it from the synthesized template.
3. Compare the deployed function list against the runtime declarations in infra/cdk/lib/stacks/app-stack.ts. Report any function that was expected to change and did not.
4. Ask the owner for the result of their own dev testing and record it verbatim. Do not substitute your own judgement for a test the owner ran.
5. Review CloudWatch logs for the changed functions for new startup, module-resolution, or runtime errors dating from the deployment. Read-only queries only.
6. Confirm no prod resource changed: deploy-prod.yml runs only on push to prod, so verify no push to prod occurred.

## Completion report

Report:

- deploy-dev run outcome, URL, and the jobs that ran;
- deployed dev Lambda runtimes, with the evidence source for each;
- any function still on nodejs20.x;
- the owner's dev test results;
- new errors in dev logs since the deployment, or an explicit statement that none were found;
- confirmation that prod is untouched;
- a clear go / no-go recommendation for prod promotion, with the specific reasons.

## Prod promotion handoff

If the recommendation is go, state for the owner:

1. That promotion is a PR from dev to prod, which runs prod-promotion-validation.yml, and that merging it triggers deploy-prod.yml with no further approval.
2. The same Lambda runtime change will then apply to prod.
3. The rollback path: revert on prod, which redeploys nodejs20.x through the same workflow.
4. Any prod-specific precondition discovered during dev verification.

Then stop. Do not open the promotion PR, do not merge, and do not deploy to prod.
