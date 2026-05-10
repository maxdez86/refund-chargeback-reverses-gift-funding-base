#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export PAYMENTS_DATA_STACK_NAME="${PAYMENTS_DATA_STACK_NAME:-${STAGE_PREFIX}BrimaxDataStack}"
export PAYMENTS_STACK_NAME="${PAYMENTS_STACK_NAME:-${STAGE_PREFIX}BrimaxAppStack}"
export PAYMENTS_OBSERVABILITY_STACK_NAME="${PAYMENTS_OBSERVABILITY_STACK_NAME:-${STAGE_PREFIX}BrimaxObservabilityStack}"
export ASAAS_ENV="${ASAAS_ENV:-production}"
export ASAAS_API_BASE_URL="${ASAAS_API_BASE_URL:-https://api.asaas.com/v3}"
export PAYMENTS_TEST_GIFT_ID="${PAYMENTS_TEST_GIFT_ID:-g-test-pix}"
export PAYMENTS_TEST_GIFT_QUANTITY="${PAYMENTS_TEST_GIFT_QUANTITY:-1}"

aws_args() {
  local args=(--region "${AWS_REGION}")

  if [[ -n "${AWS_PROFILE:-}" ]]; then
    args+=(--profile "${AWS_PROFILE}")
  fi

  printf '%s\n' "${args[@]}"
}

require_command() {
  local missing=()
  local command_name

  for command_name in "$@"; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      missing+=("${command_name}")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    printf 'Missing required commands: %s\n' "${missing[*]}" >&2
    return 1
  fi
}

cloudformation_output() {
  local stack_name="$1"
  local output_key="$2"
  local value

  mapfile -t _aws_args < <(aws_args)

  value="$(
    aws cloudformation describe-stacks \
      --stack-name "${stack_name}" \
      "${_aws_args[@]}" \
      --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
      --output text
  )"

  if [[ -z "${value}" || "${value}" == "None" ]]; then
    printf 'Could not resolve CloudFormation output %s from %s\n' "${output_key}" "${stack_name}" >&2
    return 1
  fi

  printf '%s\n' "${value}"
}

secret_string() {
  local secret_id="$1"

  mapfile -t _aws_args < <(aws_args)

  aws secretsmanager get-secret-value \
    --secret-id "${secret_id}" \
    "${_aws_args[@]}" \
    --query 'SecretString' \
    --output text
}

parse_secret_value() {
  local raw_value="$1"

  if [[ "${raw_value}" =~ ^\{ ]]; then
    local parsed
    parsed="$(
      printf '%s' "${raw_value}" | jq -r '.value // .token // .apiKey // empty'
    )"

    if [[ -n "${parsed}" && "${parsed}" != "null" ]]; then
      printf '%s\n' "${parsed}"
      return 0
    fi
  fi

  printf '%s\n' "${raw_value}"
}

load_payments_stack_outputs() {
  export PAYMENTS_API_URL="$(cloudformation_output "${PAYMENTS_STACK_NAME}" "ApiCustomDomainUrl")"
  if PAYMENTS_EXECUTE_API_URL_RAW="$(cloudformation_output "${PAYMENTS_STACK_NAME}" "RawExecuteApiUrl" 2>/dev/null)"; then
    export PAYMENTS_EXECUTE_API_URL="${PAYMENTS_EXECUTE_API_URL_RAW}"
  else
    export PAYMENTS_EXECUTE_API_URL="$(cloudformation_output "${PAYMENTS_STACK_NAME}" "PublicHttpApiUrl")"
  fi
  export PAYMENTS_WEBHOOK_URL="$(cloudformation_output "${PAYMENTS_STACK_NAME}" "AsaasWebhookUrl")"
  export PAYMENTS_TABLE_NAME="$(cloudformation_output "${PAYMENTS_STACK_NAME}" "WeddingTableName")"
  export PAYMENTS_WEBHOOK_QUEUE_URL="$(cloudformation_output "${PAYMENTS_STACK_NAME}" "WebhookQueueUrl")"
  export PAYMENTS_ASAAS_API_SECRET_ARN="$(cloudformation_output "${PAYMENTS_STACK_NAME}" "AsaasApiSecretArn")"
  export PAYMENTS_ASAAS_WEBHOOK_SECRET_ARN="$(cloudformation_output "${PAYMENTS_STACK_NAME}" "AsaasWebhookSecretArn")"
}

load_payments_webhook_token() {
  require_command jq >/dev/null

  if [[ -n "${ASAAS_WEBHOOK_TOKEN:-}" ]]; then
    export ASAAS_WEBHOOK_TOKEN
    return 0
  fi

  if [[ -z "${PAYMENTS_ASAAS_WEBHOOK_SECRET_ARN:-}" ]]; then
    load_payments_stack_outputs
  fi

  export ASAAS_WEBHOOK_TOKEN="$(
    parse_secret_value "$(secret_string "${PAYMENTS_ASAAS_WEBHOOK_SECRET_ARN}")"
  )"

  require_env ASAAS_WEBHOOK_TOKEN
}

verify_payments_secret_contract() {
  require_env PAYMENTS_ASAAS_API_SECRET_ARN PAYMENTS_ASAAS_WEBHOOK_SECRET_ARN
  require_command jq >/dev/null

  local api_secret_raw webhook_secret_raw api_secret_value webhook_secret_value
  api_secret_raw="$(secret_string "${PAYMENTS_ASAAS_API_SECRET_ARN}")"
  webhook_secret_raw="$(secret_string "${PAYMENTS_ASAAS_WEBHOOK_SECRET_ARN}")"
  api_secret_value="$(parse_secret_value "${api_secret_raw}")"
  webhook_secret_value="$(parse_secret_value "${webhook_secret_raw}")"

  if [[ -z "${api_secret_value}" || -z "${webhook_secret_value}" ]]; then
    printf 'Resolved payment secrets are empty.\n' >&2
    return 1
  fi

  printf 'Verified deployed payment secrets in Secrets Manager.\n'
}

create_payments_artifact_dir() {
  local prefix="${1:-run}"
  local timestamp

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  export PAYMENTS_TEST_OUTPUT_DIR="${REPO_ROOT}/.tmp/payments-tests/${timestamp}-${prefix}"
  mkdir -p "${PAYMENTS_TEST_OUTPUT_DIR}"
  printf '%s\n' "${PAYMENTS_TEST_OUTPUT_DIR}"
}

require_payments_test_env() {
  require_env \
    AWS_REGION \
    ROOT_DOMAIN \
    STAGE \
    PAYMENTS_STACK_NAME \
    PAYMENTS_DATA_STACK_NAME \
    PAYMENTS_OBSERVABILITY_STACK_NAME \
    ASAAS_ENV \
    ASAAS_API_BASE_URL \
    PAYMENTS_TEST_GIFT_ID \
    PAYMENTS_TEST_GIFT_QUANTITY \
    PAYMENTS_TEST_PAYER_NAME \
    PAYMENTS_TEST_PAYER_EMAIL \
    PAYMENTS_TEST_PAYER_CPF

  load_payments_stack_outputs

  require_env \
    PAYMENTS_API_URL \
    PAYMENTS_EXECUTE_API_URL \
    PAYMENTS_WEBHOOK_URL \
    PAYMENTS_TABLE_NAME \
    PAYMENTS_WEBHOOK_QUEUE_URL \
    PAYMENTS_ASAAS_API_SECRET_ARN \
    PAYMENTS_ASAAS_WEBHOOK_SECRET_ARN
}
