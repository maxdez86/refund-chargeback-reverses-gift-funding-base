#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:?Expected env file path as the first argument}"
ENVIRONMENT_NAME="${2:-dev}"
shift 2 || true

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Environment file not found: %s\n' "${ENV_FILE}" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

required_vars=("$@")

if (( ${#required_vars[@]} == 0 )); then
  required_vars=(
    STAGE
    AWS_REGION
    ROOT_DOMAIN
    CONTACT_EMAIL
    API_DOMAIN
    WWW_DOMAIN
    CLOUDFLARE_API_TOKEN
    CLOUDFLARE_ZONE_ID
    OBSERVABILITY_ALERT_EMAIL
    XRAY_ENABLED
    ASAAS_ENV
    ASAAS_API_BASE_URL
    ASAAS_API_KEY
    ASAAS_WEBHOOK_TOKEN
    TURNSTILE_SECRET_KEY
    TURNSTILE_SITE_KEY
    PAYMENTS_TEST_GIFT_ID
    PAYMENTS_TEST_GIFT_QUANTITY
    PAYMENTS_TEST_PAYER_NAME
    PAYMENTS_TEST_PAYER_EMAIL
    PAYMENTS_TEST_PAYER_CPF
    PAYMENTS_TEST_PAYER_PHONE
    TOFU_STATE_KEY_PREFIX
    SENTRY_AUTH_TOKEN
    SENTRY_ORG
    SENTRY_TEAM_SLUG
  )
fi

missing=()
for key in "${required_vars[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("${key}")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing required GitHub environment vars/secrets for "%s": %s\n' "${ENVIRONMENT_NAME}" "${missing[*]}" >&2
  printf 'Populate the "%s" GitHub environment with `pnpm deploy:github-oidc:github` (or scripts/setup-github-environment.sh) or add the missing values manually.\n' "${ENVIRONMENT_NAME}" >&2
  exit 1
fi
