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
SELECTED_STAGE="${STAGE}"
OPPOSITE_STAGE="dev"

if [[ "${SELECTED_STAGE}" == "dev" ]]; then
  OPPOSITE_STAGE="prod"
fi

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
  printf 'Refusing to deploy GitHub OIDC stacks into account %s. Expected %s.\n' \
    "${account_id}" \
    "${EXPECTED_ACCOUNT_ID}" >&2
  exit 1
fi

stage_prefix_for() {
  local stage="${1}"

  if [[ "${stage}" == "dev" ]]; then
    printf 'dev-\n'
  else
    printf '\n'
  fi
}

stack_name_for() {
  local stage="${1}"
  local base_name="${2}"

  printf '%s%s\n' "$(stage_prefix_for "${stage}")" "${base_name}"
}

resolve_stack_output() {
  local stack_name="${1}"
  local output_key="${2}"

  "${AWS_BIN}" cloudformation describe-stacks \
    "${AWS_ARGS[@]}" \
    --stack-name "${stack_name}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

platform_stack_name_for() {
  local stage="${1}"
  stack_name_for "${stage}" "BrimaxPlatformStack"
}

github_oidc_stack_name_for() {
  local stage="${1}"
  stack_name_for "${stage}" "BrimaxGithubOidcStack"
}

root_domain_for() {
  local stage="${1}"

  if [[ "${stage}" == "dev" ]]; then
    printf 'dev.brimax.life\n'
  else
    printf 'brimax.life\n'
  fi
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

warn_optional_stack_skip() {
  local stage="${1}"
  local platform_stack_name="${2}"

  printf 'Warning: skipping %s GitHub OIDC bootstrap because %s is missing or incomplete.\n' \
    "${stage}" \
    "${platform_stack_name}" >&2
}

try_resolve_optional_stack_output() {
  local stack_name="${1}"
  local output_key="${2}"
  local value

  if ! value="$(resolve_stack_output "${stack_name}" "${output_key}" 2>/dev/null)"; then
    return 1
  fi

  if [[ -z "${value}" || "${value}" == "None" ]]; then
    return 1
  fi

  printf '%s\n' "${value}"
}

export GITHUB_OIDC_REPOSITORY="${GITHUB_OIDC_REPOSITORY:-maxdez86/brimax-life}"

if "${AWS_BIN}" iam get-open-id-connect-provider \
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

declare -A ROLE_ARNS=()

deploy_stage_oidc() {
  local stage="${1}"
  local mode="${2}"
  local oidc_stack_name platform_stack_name stage_root_domain stage_api_domain stage_www_domain
  local state_bucket_name lock_table_name role_arn

  oidc_stack_name="$(github_oidc_stack_name_for "${stage}")"
  platform_stack_name="$(platform_stack_name_for "${stage}")"

  if [[ "${mode}" == "required" ]]; then
    state_bucket_name="$(resolve_required_stack_output "${platform_stack_name}" "TofuStateBucketName")"
    lock_table_name="$(resolve_required_stack_output "${platform_stack_name}" "TofuLockTableName")"
  else
    if ! state_bucket_name="$(try_resolve_optional_stack_output "${platform_stack_name}" "TofuStateBucketName")"; then
      warn_optional_stack_skip "${stage}" "${platform_stack_name}"
      return 0
    fi

    if ! lock_table_name="$(try_resolve_optional_stack_output "${platform_stack_name}" "TofuLockTableName")"; then
      warn_optional_stack_skip "${stage}" "${platform_stack_name}"
      return 0
    fi
  fi

  stage_root_domain="$(root_domain_for "${stage}")"
  stage_api_domain="api.${stage_root_domain}"
  stage_www_domain="www.${stage_root_domain}"

  printf 'Deploying AWS role bootstrap for %s\n' "${stage}"
  printf '  stack: %s\n' "${oidc_stack_name}"
  printf '  platform stack: %s\n' "${platform_stack_name}"
  printf '  state bucket: %s\n' "${state_bucket_name}"
  printf '  lock table: %s\n' "${lock_table_name}"

  env \
    STAGE="${stage}" \
    ROOT_DOMAIN="${stage_root_domain}" \
    API_DOMAIN="${stage_api_domain}" \
    WWW_DOMAIN="${stage_www_domain}" \
    GITHUB_OIDC_STATE_BUCKET_NAME="${state_bucket_name}" \
    GITHUB_OIDC_LOCK_TABLE_NAME="${lock_table_name}" \
    GITHUB_OIDC_REPOSITORY="${GITHUB_OIDC_REPOSITORY}" \
    GITHUB_OIDC_PROVIDER_ARN="${GITHUB_OIDC_PROVIDER_ARN:-}" \
    "${PNPM_BIN}" --filter @brimax/infra-cdk cdk deploy \
      "${oidc_stack_name}" \
      --output "${CDK_OUTPUT_DIR}" \
      --require-approval never \
      "${CDK_ARGS[@]}"

  role_arn="$(resolve_required_stack_output "${oidc_stack_name}" "GithubActionsDeployRoleArn")"
  ROLE_ARNS["${stage}"]="${role_arn}"

  printf '  deploy role ARN: %s\n' "${role_arn}"
}

print_env_summary "Deploying GitHub OIDC bootstrap"
printf '  account: %s\n' "${account_id}"
printf '  github environment to update: %s\n' "${SELECTED_STAGE}"
printf '  aws role bootstrap order: %s, %s\n' "${SELECTED_STAGE}" "${OPPOSITE_STAGE}"
printf '  repository: %s\n' "${GITHUB_OIDC_REPOSITORY}"
printf '  provider: %s\n' "${provider_status}"

deploy_stage_oidc "${SELECTED_STAGE}" "required"
deploy_stage_oidc "${OPPOSITE_STAGE}" "optional"

bash "${SETUP_GITHUB_ENVIRONMENT_SCRIPT}" "${ROLE_ARNS[${SELECTED_STAGE}]}"
