#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CDK_OUTPUT_DIR="${REPO_ROOT}/infra/cdk/cdk.out.edge"

CDK_ARGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  CDK_ARGS+=(--profile "${AWS_PROFILE}")
fi
if [[ "${STAGE}" == "dev" ]]; then
  CDK_ARGS+=(--context "stage=dev")
fi

print_env_summary "Deploying landing edge"
pnpm build:web
pnpm --filter @brimax/infra-cdk cdk deploy \
  "${LANDING_EDGE_STACK_NAME}" \
  --output "${CDK_OUTPUT_DIR}" \
  --require-approval never \
  "${CDK_ARGS[@]}"
