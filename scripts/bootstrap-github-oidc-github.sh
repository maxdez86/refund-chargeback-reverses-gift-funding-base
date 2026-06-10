#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_ACCOUNT_ID="183286346090"
AWS_BIN="${AWS_BIN:-aws}"
SETUP_GITHUB_ENVIRONMENT_SCRIPT="${SETUP_GITHUB_ENVIRONMENT_SCRIPT:-${SCRIPT_DIR}/setup-github-environment.sh}"
GITHUB_OIDC_STACK_NAME="BrimaxGithubOidcStack"
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

ROLE_OUTPUT_KEY="GithubActionsProdDeployRoleArn"
if [[ "${SELECTED_STAGE}" == "dev" ]]; then
  ROLE_OUTPUT_KEY="GithubActionsDevDeployRoleArn"
fi

ROLE_ARN="$(
  resolve_required_stack_output "${GITHUB_OIDC_STACK_NAME}" "${ROLE_OUTPUT_KEY}"
)"

print_env_summary "Refreshing GitHub environment from shared GitHub OIDC stack"
printf '  account: %s\n' "${account_id}"
printf '  stack: %s\n' "${GITHUB_OIDC_STACK_NAME}"
printf '  github environment to update: %s\n' "${SELECTED_STAGE}"
printf '  repository: %s\n' "${GITHUB_OIDC_REPOSITORY}"

printf 'Selected GitHub environment role ARN for %s: %s\n' "${SELECTED_STAGE}" "${ROLE_ARN}"
printf 'Refreshing GitHub environment %s.\n' "${SELECTED_STAGE}"
bash "${SETUP_GITHUB_ENVIRONMENT_SCRIPT}" "${ROLE_ARN}"
