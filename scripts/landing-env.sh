#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

load_local_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    return
  fi

  local env_keys=(
    STAGE
    AWS_PROFILE
    AWS_REGION
    ROOT_DOMAIN
    API_DOMAIN
    WWW_DOMAIN
    PAYMENTS_STACK_NAME
    PAYMENTS_DATA_STACK_NAME
    PAYMENTS_OBSERVABILITY_STACK_NAME
    ASAAS_ENV
    ASAAS_API_BASE_URL
    ASAAS_API_KEY
    ASAAS_WEBHOOK_TOKEN
    PAYMENTS_TEST_GIFT_ID
    PAYMENTS_TEST_GIFT_QUANTITY
    PAYMENTS_TEST_PAYER_NAME
    PAYMENTS_TEST_PAYER_EMAIL
    PAYMENTS_TEST_PAYER_CPF
    PAYMENTS_TEST_PAYER_PHONE
    LANDING_CERTIFICATE_ARN
    CLOUDFLARE_API_TOKEN
    CLOUDFLARE_ZONE_ID
    TOFU_STATE_KEY_PREFIX
    LANDING_CERT_STACK_NAME
    LANDING_EDGE_STACK_NAME
    PLATFORM_STACK_NAME
  )
  local key
  local output

  output="$(
    ENV_FILE="${ENV_FILE}" bash -lc '
      set -a
      source "${ENV_FILE}"
      set +a

      for key in "$@"; do
        printf "%s=%q\n" "${key}" "${!key-}"
      done
    ' bash "${env_keys[@]}"
  )"

  while IFS= read -r line; do
    key="${line%%=*}"

    if [[ -n "${!key+x}" ]]; then
      continue
    fi

    eval "export ${line}"
  done <<< "${output}"
}

load_local_env_file

export AWS_REGION="${AWS_REGION:-us-east-1}"
export ROOT_DOMAIN="${ROOT_DOMAIN:-brimax.life}"
export STAGE="${STAGE:-prod}"
export API_DOMAIN="${API_DOMAIN:-api.${ROOT_DOMAIN}}"
export WWW_DOMAIN="${WWW_DOMAIN:-www.${ROOT_DOMAIN}}"

if [[ "${STAGE}" == "dev" ]]; then
  export STAGE_PREFIX="dev-"
else
  export STAGE="prod"
  export STAGE_PREFIX=""
fi

export LANDING_CERT_STACK_NAME="${LANDING_CERT_STACK_NAME:-${STAGE_PREFIX}BrimaxCertificateStack}"
export LANDING_EDGE_STACK_NAME="${LANDING_EDGE_STACK_NAME:-${STAGE_PREFIX}BrimaxEdgeStack}"
export PLATFORM_STACK_NAME="${PLATFORM_STACK_NAME:-${STAGE_PREFIX}BrimaxPlatformStack}"
export TOFU_STATE_KEY_PREFIX="${TOFU_STATE_KEY_PREFIX:-brimax-life}"

require_env() {
  local missing=()

  for key in "$@"; do
    if [[ -z "${!key:-}" ]]; then
      missing+=("${key}")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    printf 'Missing required environment variables: %s\n' "${missing[*]}" >&2
    exit 1
  fi
}

load_platform_backend_config() {
  local aws_args=(--region "${AWS_REGION}")

  if [[ -n "${AWS_PROFILE:-}" ]]; then
    aws_args+=(--profile "${AWS_PROFILE}")
  fi

  export TOFU_STATE_BUCKET="$(
    aws cloudformation describe-stacks \
      --stack-name "${PLATFORM_STACK_NAME}" \
      "${aws_args[@]}" \
      --query "Stacks[0].Outputs[?OutputKey=='TofuStateBucketName'].OutputValue | [0]" \
      --output text
  )"

  export TOFU_LOCK_TABLE="$(
    aws cloudformation describe-stacks \
      --stack-name "${PLATFORM_STACK_NAME}" \
      "${aws_args[@]}" \
      --query "Stacks[0].Outputs[?OutputKey=='TofuLockTableName'].OutputValue | [0]" \
      --output text
  )"

  export TOFU_STATE_REGION="$(
    aws cloudformation describe-stacks \
      --stack-name "${PLATFORM_STACK_NAME}" \
      "${aws_args[@]}" \
      --query "Stacks[0].Outputs[?OutputKey=='TofuBackendRegion'].OutputValue | [0]" \
      --output text
  )"

  require_env TOFU_STATE_BUCKET TOFU_LOCK_TABLE TOFU_STATE_REGION
}
