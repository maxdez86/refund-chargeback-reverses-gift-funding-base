#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

export PAYMENTS_DATA_STACK_NAME="${PAYMENTS_DATA_STACK_NAME:-${STAGE_PREFIX}BrimaxDataStack}"
export PAYMENTS_STACK_NAME="${PAYMENTS_STACK_NAME:-${STAGE_PREFIX}BrimaxAppStack}"
export PAYMENTS_OBSERVABILITY_STACK_NAME="${PAYMENTS_OBSERVABILITY_STACK_NAME:-${STAGE_PREFIX}BrimaxObservabilityStack}"

CDK_ARGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  CDK_ARGS+=(--profile "${AWS_PROFILE}")
fi
if [[ "${STAGE}" == "dev" ]]; then
  CDK_ARGS+=(--context "stage=dev")
fi

printf 'Deploying backend stacks in %s (%s)\n' "${AWS_REGION}" "${STAGE}"
printf '  - %s\n' "${PAYMENTS_DATA_STACK_NAME}"
printf '  - %s\n' "${PAYMENTS_STACK_NAME}"
printf '  - %s\n' "${PAYMENTS_OBSERVABILITY_STACK_NAME}"

pnpm --filter @brimax/infra-cdk cdk deploy \
  "${PAYMENTS_DATA_STACK_NAME}" \
  "${PAYMENTS_STACK_NAME}" \
  "${PAYMENTS_OBSERVABILITY_STACK_NAME}" \
  --require-approval never \
  "${CDK_ARGS[@]}"
