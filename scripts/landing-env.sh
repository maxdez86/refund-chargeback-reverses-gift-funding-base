#!/usr/bin/env bash
set -euo pipefail
# redeploy trigger 2026-06-08 — forces apply-*-sentry path-filter to match; no functional effect

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RAW_ENV_FILE="${BRIMAX_ENV_FILE:-${ENV_FILE:-${REPO_ROOT}/.env}}"

if [[ "${RAW_ENV_FILE}" = /* ]]; then
  ENV_FILE="${RAW_ENV_FILE}"
else
  ENV_FILE="${REPO_ROOT}/${RAW_ENV_FILE}"
fi

export ENV_FILE
export BRIMAX_ENV_FILE="${RAW_ENV_FILE}"

ensure_env_file_exists() {
  if [[ -f "${ENV_FILE}" ]]; then
    return 0
  fi

  printf 'Environment file not found: %s\n' "${ENV_FILE}" >&2
  printf 'Create it from the matching example before running this command.\n' >&2
  if [[ "${RAW_ENV_FILE}" == ".env.dev" ]]; then
    printf 'Example: cp .env.dev.example .env.dev\n' >&2
  else
    printf 'Example: cp .env.example .env\n' >&2
  fi
  exit 1
}

load_local_env_file() {
  local env_keys=(
    STAGE
    AWS_PROFILE
    AWS_REGION
    ROOT_DOMAIN
    CONTACT_EMAIL
    API_DOMAIN
    WWW_DOMAIN
    TURNSTILE_SITE_KEY
    PAYMENTS_STACK_NAME
    PAYMENTS_DATA_STACK_NAME
    PAYMENTS_OBSERVABILITY_STACK_NAME
    OBSERVABILITY_ALERT_EMAIL
    XRAY_ENABLED
    ASAAS_ENV
    ASAAS_API_BASE_URL
    ASAAS_API_KEY
    ASAAS_WEBHOOK_TOKEN
    TURNSTILE_SECRET_KEY
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
    SENTRY_AUTH_TOKEN
    GITHUB_TOKEN
    GITHUB_OIDC_REPOSITORY
    SENTRY_ORG
    SENTRY_TEAM_SLUG
    SENTRY_DSN
    LANDING_CERT_STACK_NAME
    LANDING_EDGE_STACK_NAME
    PLATFORM_STACK_NAME
    VITE_CONTACT_EMAIL
    VITE_API_URL
    VITE_TURNSTILE_SITE_KEY
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

ensure_env_file_exists
load_local_env_file

if [[ -z "${AWS_PROFILE:-}" ]]; then
  unset AWS_PROFILE
fi

export STAGE="${STAGE:-prod}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
if [[ "${STAGE}" != "dev" && "${STAGE}" != "prod" ]]; then
  printf 'Invalid STAGE value: %s (expected dev or prod)\n' "${STAGE}" >&2
  exit 1
fi

if [[ "${STAGE}" == "dev" ]]; then
  export ROOT_DOMAIN="${ROOT_DOMAIN:-dev.brimax.life}"
else
  export ROOT_DOMAIN="${ROOT_DOMAIN:-brimax.life}"
fi
export CONTACT_EMAIL="${CONTACT_EMAIL:-casamento@brimax.life}"
export API_DOMAIN="${API_DOMAIN:-api.${ROOT_DOMAIN}}"
export WWW_DOMAIN="${WWW_DOMAIN:-www.${ROOT_DOMAIN}}"

if [[ "${STAGE}" == "dev" ]]; then
  export STAGE_PREFIX="dev-"
else
  export STAGE_PREFIX=""
fi

export LANDING_CERT_STACK_NAME="${LANDING_CERT_STACK_NAME:-${STAGE_PREFIX}BrimaxCertificateStack}"
export LANDING_EDGE_STACK_NAME="${LANDING_EDGE_STACK_NAME:-${STAGE_PREFIX}BrimaxEdgeStack}"
export PLATFORM_STACK_NAME="${PLATFORM_STACK_NAME:-${STAGE_PREFIX}BrimaxPlatformStack}"
export TOFU_STATE_KEY_PREFIX="${TOFU_STATE_KEY_PREFIX:-brimax-life}"
export SENTRY_ORG="${SENTRY_ORG:-brimax}"
export SENTRY_TEAM_SLUG="${SENTRY_TEAM_SLUG:-brimax-life}"

validate_stage_configuration() {
  if [[ "${STAGE}" == "dev" ]]; then
    if [[ "${ROOT_DOMAIN}" == "brimax.life" || "${API_DOMAIN}" == "api.brimax.life" || "${WWW_DOMAIN}" == "www.brimax.life" ]]; then
      printf 'Invalid dev configuration in %s: dev stage cannot target production domains.\n' "${ENV_FILE}" >&2
      exit 1
    fi
    if [[ "${LANDING_CERT_STACK_NAME}" != dev-* || "${LANDING_EDGE_STACK_NAME}" != dev-* || "${PLATFORM_STACK_NAME}" != dev-* ]]; then
      printf 'Invalid dev configuration in %s: dev stack names must start with dev-.\n' "${ENV_FILE}" >&2
      exit 1
    fi
  else
    if [[ "${ROOT_DOMAIN}" == "dev.brimax.life" || "${API_DOMAIN}" == "api.dev.brimax.life" || "${WWW_DOMAIN}" == "www.dev.brimax.life" ]]; then
      printf 'Invalid prod configuration in %s: prod stage cannot target dev domains.\n' "${ENV_FILE}" >&2
      exit 1
    fi
    if [[ "${LANDING_CERT_STACK_NAME}" == dev-* || "${LANDING_EDGE_STACK_NAME}" == dev-* || "${PLATFORM_STACK_NAME}" == dev-* ]]; then
      printf 'Invalid prod configuration in %s: prod stack names cannot start with dev-.\n' "${ENV_FILE}" >&2
      exit 1
    fi
  fi
}

export_public_web_env() {
  export VITE_CONTACT_EMAIL="${VITE_CONTACT_EMAIL:-${CONTACT_EMAIL}}"
  export VITE_API_URL="${VITE_API_URL:-https://${API_DOMAIN}}"

  if [[ "${STAGE}" == "dev" ]]; then
    export VITE_TURNSTILE_SITE_KEY="${VITE_TURNSTILE_SITE_KEY:-${TURNSTILE_SITE_KEY:-1x00000000000000000000AA}}"
  else
    export VITE_TURNSTILE_SITE_KEY="${VITE_TURNSTILE_SITE_KEY:-${TURNSTILE_SITE_KEY:-}}"
  fi
}

print_env_summary() {
  local context="${1:-Environment}"
  printf '%s\n' "${context}"
  printf '  stage: %s\n' "${STAGE}"
  printf '  env file: %s\n' "${ENV_FILE}"
  printf '  root domain: %s\n' "${ROOT_DOMAIN}"
  printf '  api domain: %s\n' "${API_DOMAIN}"
  printf '  www domain: %s\n' "${WWW_DOMAIN}"
}

assert_local_frontend_target_safe() {
  if [[ "${STAGE}" == "prod" && "${BRIMAX_LOCAL_ALLOW_PROD:-}" != "true" ]]; then
    printf 'Refusing to run the local frontend against prod.\n' >&2
    printf 'Use BRIMAX_ENV_FILE=.env.dev for the safe default, or set BRIMAX_LOCAL_ALLOW_PROD=true with BRIMAX_ENV_FILE=.env for an explicit prod override.\n' >&2
    exit 1
  fi
}

validate_stage_configuration

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
  local platform_stack_name="${1:-${PLATFORM_STACK_NAME}}"
  local aws_args=(--region "${AWS_REGION}")

  if [[ -n "${AWS_PROFILE:-}" ]]; then
    aws_args+=(--profile "${AWS_PROFILE}")
  fi

  export TOFU_STATE_BUCKET="$(
    aws cloudformation describe-stacks \
      --stack-name "${platform_stack_name}" \
      "${aws_args[@]}" \
      --query "Stacks[0].Outputs[?OutputKey=='TofuStateBucketName'].OutputValue | [0]" \
      --output text
  )"

  export TOFU_LOCK_TABLE="$(
    aws cloudformation describe-stacks \
      --stack-name "${platform_stack_name}" \
      "${aws_args[@]}" \
      --query "Stacks[0].Outputs[?OutputKey=='TofuLockTableName'].OutputValue | [0]" \
      --output text
  )"

  export TOFU_STATE_REGION="$(
    aws cloudformation describe-stacks \
      --stack-name "${platform_stack_name}" \
      "${aws_args[@]}" \
      --query "Stacks[0].Outputs[?OutputKey=='TofuBackendRegion'].OutputValue | [0]" \
      --output text
  )"

  require_env TOFU_STATE_BUCKET TOFU_LOCK_TABLE TOFU_STATE_REGION
}
