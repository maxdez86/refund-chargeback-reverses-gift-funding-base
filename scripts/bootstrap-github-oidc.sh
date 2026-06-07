#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CDK_OUTPUT_DIR="${REPO_ROOT}/infra/cdk/cdk.out.github-oidc"
EXPECTED_ACCOUNT_ID="183286346090"
OIDC_PROVIDER_ARN="arn:aws:iam::${EXPECTED_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
GITHUB_OIDC_STACK_NAME="${STAGE_PREFIX}BrimaxGithubOidcStack"

AWS_ARGS=(--region "${AWS_REGION}")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

account_id="$(
  aws sts get-caller-identity \
    "${AWS_ARGS[@]}" \
    --query 'Account' \
    --output text
)"

if [[ "${account_id}" != "${EXPECTED_ACCOUNT_ID}" ]]; then
  printf 'Refusing to deploy %s into account %s. Expected %s.\n' \
    "${GITHUB_OIDC_STACK_NAME}" \
    "${account_id}" \
    "${EXPECTED_ACCOUNT_ID}" >&2
  exit 1
fi

resolve_stack_output() {
  local stack_name="${1}"
  local output_key="${2}"

  aws cloudformation describe-stacks \
    "${AWS_ARGS[@]}" \
    --stack-name "${stack_name}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

export GITHUB_OIDC_STATE_BUCKET_NAME="$(resolve_stack_output "${PLATFORM_STACK_NAME}" "TofuStateBucketName")"
export GITHUB_OIDC_LOCK_TABLE_NAME="$(resolve_stack_output "${PLATFORM_STACK_NAME}" "TofuLockTableName")"
export GITHUB_OIDC_REPOSITORY="${GITHUB_OIDC_REPOSITORY:-maxdez86/brimax-life}"

for key in GITHUB_OIDC_STATE_BUCKET_NAME GITHUB_OIDC_LOCK_TABLE_NAME; do
  if [[ -z "${!key:-}" || "${!key}" == "None" ]]; then
    printf 'Could not resolve required CloudFormation output for %s.\n' "${key}" >&2
    exit 1
  fi
done

if aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "${OIDC_PROVIDER_ARN}" \
  "${AWS_ARGS[@]}" >/dev/null 2>&1; then
  export GITHUB_OIDC_PROVIDER_ARN="${OIDC_PROVIDER_ARN}"
  provider_status="reusing existing provider"
else
  unset GITHUB_OIDC_PROVIDER_ARN || true
  provider_status="creating new provider"
fi

CDK_ARGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  CDK_ARGS+=(--profile "${AWS_PROFILE}")
fi

print_env_summary "Deploying GitHub OIDC bootstrap"
printf '  account: %s\n' "${account_id}"
printf '  stack: %s\n' "${GITHUB_OIDC_STACK_NAME}"
printf '  stage: %s\n' "${STAGE}"
printf '  repository: %s\n' "${GITHUB_OIDC_REPOSITORY}"
printf '  provider: %s\n' "${provider_status}"
printf '  state bucket: %s\n' "${GITHUB_OIDC_STATE_BUCKET_NAME}"
printf '  lock table: %s\n' "${GITHUB_OIDC_LOCK_TABLE_NAME}"

pnpm --filter @brimax/infra-cdk cdk deploy \
  "${GITHUB_OIDC_STACK_NAME}" \
  --output "${CDK_OUTPUT_DIR}" \
  --require-approval never \
  "${CDK_ARGS[@]}"

ROLE_ARN="$(
  aws cloudformation describe-stacks \
    "${AWS_ARGS[@]}" \
    --stack-name "${GITHUB_OIDC_STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='GithubActionsDeployRoleArn'].OutputValue | [0]" \
    --output text
)"

if [[ -z "${ROLE_ARN}" || "${ROLE_ARN}" == "None" ]]; then
  printf 'Could not resolve GithubActionsDeployRoleArn from %s.\n' "${GITHUB_OIDC_STACK_NAME}" >&2
  exit 1
fi

printf 'Deploy role ARN: %s\n' "${ROLE_ARN}"
bash "${SCRIPT_DIR}/setup-github-environment.sh" "${ROLE_ARN}"
