#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

AWS_ARGS=(--region "${AWS_REGION}")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

ACCOUNT_ID="$(
  aws sts get-caller-identity \
    "${AWS_ARGS[@]}" \
    --query 'Account' \
    --output text
)"

if [[ -z "${ACCOUNT_ID}" || "${ACCOUNT_ID}" == "None" ]]; then
  printf 'Could not determine AWS account ID for CDK bootstrap.\n' >&2
  exit 1
fi

CDK_ARGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  CDK_ARGS+=(--profile "${AWS_PROFILE}")
fi

print_env_summary "CDK bootstrap"
printf 'Bootstrapping CDK for aws://%s/%s\n' "${ACCOUNT_ID}" "${AWS_REGION}"

pnpm --filter @brimax/infra-cdk cdk bootstrap "aws://${ACCOUNT_ID}/${AWS_REGION}" "${CDK_ARGS[@]}"
