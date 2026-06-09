#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

source "$(dirname "$0")/landing-env.sh"
source <(bash "$(dirname "$0")/export-sentry-config.sh")

export PAYMENTS_DATA_STACK_NAME="${PAYMENTS_DATA_STACK_NAME:-${STAGE_PREFIX}BrimaxDataStack}"
export PAYMENTS_STACK_NAME="${PAYMENTS_STACK_NAME:-${STAGE_PREFIX}BrimaxAppStack}"
export PAYMENTS_OBSERVABILITY_STACK_NAME="${PAYMENTS_OBSERVABILITY_STACK_NAME:-${STAGE_PREFIX}BrimaxObservabilityStack}"

require_env ASAAS_API_KEY ASAAS_WEBHOOK_TOKEN
require_env SENTRY_DSN

# Turnstile secret is only enforced for prod. Dev/test deploys fall back to
# Cloudflare's always-passes test secret (handled in infra/cdk/bin/app.ts).
if [[ "${STAGE}" == "prod" ]]; then
  require_env TURNSTILE_SECRET_KEY
fi

AWS_ARGS=(--region "${AWS_REGION}")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

bootstrap_version="$(
  aws cloudformation describe-stacks \
    "${AWS_ARGS[@]}" \
    --stack-name CDKToolkit \
    --query "Stacks[0].Outputs[?OutputKey=='BootstrapVersion'].OutputValue | [0]" \
    --output text 2>/dev/null || true
)"

if [[ -z "${bootstrap_version}" || "${bootstrap_version}" == "None" ]]; then
  printf 'CDK bootstrap preflight failed: could not determine CDKToolkit BootstrapVersion in %s for stage %s.\n' "${AWS_REGION}" "${STAGE}" >&2
  printf 'Run `pnpm cdk:bootstrap` to create or upgrade the bootstrap stack, then rerun `pnpm deploy:backend`.\n' >&2
  exit 1
fi

if [[ "${bootstrap_version}" -lt 30 ]]; then
  printf 'CDK bootstrap preflight failed: BootstrapVersion=%s, but this deploy requires version 30 or later.\n' "${bootstrap_version}" >&2
  printf 'This is the same issue that surfaces later as missing `cloudformation:DescribeEvents` on the CDK deploy role.\n' >&2
  printf 'Run `pnpm cdk:bootstrap` to upgrade the existing CDKToolkit stack in %s, then rerun `pnpm deploy:backend`.\n' "${AWS_REGION}" >&2
  exit 1
fi

CDK_ARGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  CDK_ARGS+=(--profile "${AWS_PROFILE}")
fi
if [[ "${STAGE}" == "dev" ]]; then
  CDK_ARGS+=(--context "stage=dev")
fi

CDK_OUTPUT_DIR="${REPO_ROOT}/infra/cdk/cdk.out.backend"

print_env_summary "Deploying backend"
printf 'Deploying backend stacks in %s (%s)\n' "${AWS_REGION}" "${STAGE}"
printf '  - %s\n' "${PAYMENTS_DATA_STACK_NAME}"
printf '  - %s\n' "${PAYMENTS_STACK_NAME}"
printf '  - %s\n' "${PAYMENTS_OBSERVABILITY_STACK_NAME}"
printf '  - using CDK-managed Secrets Manager values from ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN, TURNSTILE_SECRET_KEY\n'
printf '  - using Sentry project %s from infra/opentofu/sentry\n' "${SENTRY_BACKEND_PROJECT_SLUG}"
printf '  - using CDK output directory %s\n' "${CDK_OUTPUT_DIR}"

pnpm --filter @brimax/infra-cdk cdk deploy \
  "${PAYMENTS_DATA_STACK_NAME}" \
  "${PAYMENTS_STACK_NAME}" \
  "${PAYMENTS_OBSERVABILITY_STACK_NAME}" \
  --output "${CDK_OUTPUT_DIR}" \
  --require-approval never \
  "${CDK_ARGS[@]}"
