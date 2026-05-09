#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

source "$(dirname "$0")/landing-env.sh"

export PAYMENTS_DATA_STACK_NAME="${PAYMENTS_DATA_STACK_NAME:-${STAGE_PREFIX}BrimaxDataStack}"
export PAYMENTS_STACK_NAME="${PAYMENTS_STACK_NAME:-${STAGE_PREFIX}BrimaxAppStack}"
export PAYMENTS_OBSERVABILITY_STACK_NAME="${PAYMENTS_OBSERVABILITY_STACK_NAME:-${STAGE_PREFIX}BrimaxObservabilityStack}"

require_env ASAAS_API_KEY ASAAS_WEBHOOK_TOKEN

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
printf '  - using CDK-managed Secrets Manager values from ASAAS_API_KEY and ASAAS_WEBHOOK_TOKEN\n'

pnpm --filter @brimax/infra-cdk cdk deploy \
  "${PAYMENTS_DATA_STACK_NAME}" \
  "${PAYMENTS_STACK_NAME}" \
  "${PAYMENTS_OBSERVABILITY_STACK_NAME}" \
  --require-approval never \
  "${CDK_ARGS[@]}"
