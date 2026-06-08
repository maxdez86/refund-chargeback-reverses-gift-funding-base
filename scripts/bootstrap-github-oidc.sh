#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CDK_OUTPUT_DIR="${REPO_ROOT}/infra/cdk/cdk.out.github-oidc"
EXPECTED_ACCOUNT_ID="183286346090"
OIDC_PROVIDER_ARN="arn:aws:iam::${EXPECTED_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
AWS_BIN="${AWS_BIN:-aws}"
PNPM_BIN="${PNPM_BIN:-pnpm}"
SETUP_GITHUB_ENVIRONMENT_SCRIPT="${SETUP_GITHUB_ENVIRONMENT_SCRIPT:-${SCRIPT_DIR}/setup-github-environment.sh}"
GITHUB_OIDC_STACK_NAME="BrimaxGithubOidcStack"
LEGACY_DEV_GITHUB_OIDC_STACK_NAME="dev-BrimaxGithubOidcStack"
SELECTED_STAGE="${STAGE}"

AWS_ARGS=(--region "${AWS_REGION}")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

account_id="$(
  "${AWS_BIN}" sts get-caller-identity \
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

  "${AWS_BIN}" cloudformation describe-stacks \
    "${AWS_ARGS[@]}" \
    --stack-name "${stack_name}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

stack_exists() {
  local stack_name="${1}"

  "${AWS_BIN}" cloudformation describe-stacks \
    "${AWS_ARGS[@]}" \
    --stack-name "${stack_name}" >/dev/null 2>&1
}

delete_legacy_dev_oidc_stack_if_present() {
  if ! stack_exists "${LEGACY_DEV_GITHUB_OIDC_STACK_NAME}"; then
    return 0
  fi

  printf 'Migrating legacy GitHub OIDC stack: deleting %s before deploying %s.\n' \
    "${LEGACY_DEV_GITHUB_OIDC_STACK_NAME}" \
    "${GITHUB_OIDC_STACK_NAME}"

  "${AWS_BIN}" cloudformation delete-stack \
    "${AWS_ARGS[@]}" \
    --stack-name "${LEGACY_DEV_GITHUB_OIDC_STACK_NAME}"

  "${AWS_BIN}" cloudformation wait stack-delete-complete \
    "${AWS_ARGS[@]}" \
    --stack-name "${LEGACY_DEV_GITHUB_OIDC_STACK_NAME}"
}

resolve_required_stack_output() {
  local stack_name="${1}"
  local output_key="${2}"
  local value

  value="$(resolve_stack_output "${stack_name}" "${output_key}")"

  if [[ -z "${value}" || "${value}" == "None" ]]; then
    printf 'Could not resolve required CloudFormation output %s from %s.\n' \
      "${output_key}" \
      "${stack_name}" >&2
    exit 1
  fi

  printf '%s\n' "${value}"
}

export GITHUB_OIDC_REPOSITORY="${GITHUB_OIDC_REPOSITORY:-maxdez86/brimax-life}"
GITHUB_OIDC_DEV_STATE_BUCKET_NAME="$(
  resolve_required_stack_output "dev-BrimaxPlatformStack" "TofuStateBucketName"
)"
export GITHUB_OIDC_DEV_STATE_BUCKET_NAME
GITHUB_OIDC_DEV_LOCK_TABLE_NAME="$(
  resolve_required_stack_output "dev-BrimaxPlatformStack" "TofuLockTableName"
)"
export GITHUB_OIDC_DEV_LOCK_TABLE_NAME
GITHUB_OIDC_PROD_STATE_BUCKET_NAME="$(
  resolve_required_stack_output "BrimaxPlatformStack" "TofuStateBucketName"
)"
export GITHUB_OIDC_PROD_STATE_BUCKET_NAME
GITHUB_OIDC_PROD_LOCK_TABLE_NAME="$(
  resolve_required_stack_output "BrimaxPlatformStack" "TofuLockTableName"
)"
export GITHUB_OIDC_PROD_LOCK_TABLE_NAME

if "${AWS_BIN}" iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "${OIDC_PROVIDER_ARN}" \
  "${AWS_ARGS[@]}" >/dev/null 2>&1; then
  provider_status="reusing existing provider"
else
  provider_status="creating new provider"
fi

CDK_ARGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  CDK_ARGS+=(--profile "${AWS_PROFILE}")
fi

print_env_summary "Deploying shared GitHub OIDC bootstrap"
printf '  account: %s\n' "${account_id}"
printf '  stack: %s\n' "${GITHUB_OIDC_STACK_NAME}"
printf '  github environment to update: %s\n' "${SELECTED_STAGE}"
printf '  repository: %s\n' "${GITHUB_OIDC_REPOSITORY}"
printf '  provider: %s\n' "${provider_status}"
printf '  dev state bucket: %s\n' "${GITHUB_OIDC_DEV_STATE_BUCKET_NAME}"
printf '  dev lock table: %s\n' "${GITHUB_OIDC_DEV_LOCK_TABLE_NAME}"
printf '  prod state bucket: %s\n' "${GITHUB_OIDC_PROD_STATE_BUCKET_NAME}"
printf '  prod lock table: %s\n' "${GITHUB_OIDC_PROD_LOCK_TABLE_NAME}"

delete_legacy_dev_oidc_stack_if_present

"${PNPM_BIN}" --filter @brimax/infra-cdk cdk deploy \
  "${GITHUB_OIDC_STACK_NAME}" \
  --output "${CDK_OUTPUT_DIR}" \
  --require-approval never \
  "${CDK_ARGS[@]}"

DEV_ROLE_ARN="$(
  resolve_required_stack_output "${GITHUB_OIDC_STACK_NAME}" "GithubActionsDevDeployRoleArn"
)"
PROD_ROLE_ARN="$(
  resolve_required_stack_output "${GITHUB_OIDC_STACK_NAME}" "GithubActionsProdDeployRoleArn"
)"
DEV_VALIDATION_ROLE_ARN="$(
  resolve_required_stack_output "${GITHUB_OIDC_STACK_NAME}" "ProdPromotionValidationRoleArn"
)"

printf 'Deploy role ARN for dev: %s\n' "${DEV_ROLE_ARN}"
printf 'Deploy role ARN for prod: %s\n' "${PROD_ROLE_ARN}"
printf 'Validation role ARN for dev prod-promotion checks: %s\n' "${DEV_VALIDATION_ROLE_ARN}"

ROLE_ARN="${PROD_ROLE_ARN}"
if [[ "${SELECTED_STAGE}" == "dev" ]]; then
  ROLE_ARN="${DEV_ROLE_ARN}"
fi

printf 'Selected GitHub environment role ARN for %s: %s\n' "${SELECTED_STAGE}" "${ROLE_ARN}"
bash "${SETUP_GITHUB_ENVIRONMENT_SCRIPT}" "${ROLE_ARN}" "${DEV_VALIDATION_ROLE_ARN}"
