#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

CDK_ARGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  CDK_ARGS+=(--profile "${AWS_PROFILE}")
fi
if [[ "${STAGE}" == "dev" ]]; then
  CDK_ARGS+=(--context "stage=dev")
fi

pnpm --filter @brimax/infra-cdk cdk deploy "${PLATFORM_STACK_NAME}" --require-approval never "${CDK_ARGS[@]}"
