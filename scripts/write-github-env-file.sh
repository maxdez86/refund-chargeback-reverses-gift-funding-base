#!/usr/bin/env bash
set -euo pipefail

DESTINATION_PATH="${1:?Expected destination path as the first argument}"
PROFILE="${2:?Expected profile as the second argument}"
VALIDATION_ENVIRONMENT="${3:-}"

if [[ -n "${VALIDATION_ENVIRONMENT}" ]]; then
  shift 3
else
  shift 2
fi

write_ci_dev_minimal() {
  {
    printf 'STAGE=%q\n' "dev"
    printf 'AWS_REGION=%q\n' "us-east-1"
    printf 'ROOT_DOMAIN=%q\n' "dev.brimax.life"
    printf 'CONTACT_EMAIL=%q\n' "casamento-dev@brimax.life"
    printf 'API_DOMAIN=%q\n' "api.dev.brimax.life"
    printf 'WWW_DOMAIN=%q\n' "www.dev.brimax.life"
    printf 'TURNSTILE_SITE_KEY=%q\n' "1x00000000000000000000AA"
  } > "${DESTINATION_PATH}"
}

write_full_stage() {
  {
    printf 'STAGE=%q\n' "${STAGE:-}"
    printf 'AWS_REGION=%q\n' "${AWS_REGION:-}"
    printf 'ROOT_DOMAIN=%q\n' "${ROOT_DOMAIN:-}"
    printf 'CONTACT_EMAIL=%q\n' "${CONTACT_EMAIL:-}"
    printf 'API_DOMAIN=%q\n' "${API_DOMAIN:-}"
    printf 'WWW_DOMAIN=%q\n' "${WWW_DOMAIN:-}"
    printf 'CLOUDFLARE_API_TOKEN=%q\n' "${CLOUDFLARE_API_TOKEN:-}"
    printf 'CLOUDFLARE_ZONE_ID=%q\n' "${CLOUDFLARE_ZONE_ID:-}"
    printf 'OBSERVABILITY_ALERT_EMAIL=%q\n' "${OBSERVABILITY_ALERT_EMAIL:-}"
    printf 'XRAY_ENABLED=%q\n' "${XRAY_ENABLED:-}"
    printf 'ASAAS_ENV=%q\n' "${ASAAS_ENV:-}"
    printf 'ASAAS_API_BASE_URL=%q\n' "${ASAAS_API_BASE_URL:-}"
    printf 'ASAAS_API_KEY=%q\n' "${ASAAS_API_KEY:-}"
    printf 'ASAAS_WEBHOOK_TOKEN=%q\n' "${ASAAS_WEBHOOK_TOKEN:-}"
    printf 'TURNSTILE_SECRET_KEY=%q\n' "${TURNSTILE_SECRET_KEY:-}"
    printf 'TURNSTILE_SITE_KEY=%q\n' "${TURNSTILE_SITE_KEY:-}"
    printf 'PAYMENTS_TEST_GIFT_ID=%q\n' "${PAYMENTS_TEST_GIFT_ID:-}"
    printf 'PAYMENTS_TEST_GIFT_QUANTITY=%q\n' "${PAYMENTS_TEST_GIFT_QUANTITY:-}"
    printf 'PAYMENTS_TEST_PAYER_NAME=%q\n' "${PAYMENTS_TEST_PAYER_NAME:-}"
    printf 'PAYMENTS_TEST_PAYER_EMAIL=%q\n' "${PAYMENTS_TEST_PAYER_EMAIL:-}"
    printf 'PAYMENTS_TEST_PAYER_CPF=%q\n' "${PAYMENTS_TEST_PAYER_CPF:-}"
    printf 'PAYMENTS_TEST_PAYER_PHONE=%q\n' "${PAYMENTS_TEST_PAYER_PHONE:-}"
    printf 'TOFU_STATE_KEY_PREFIX=%q\n' "${TOFU_STATE_KEY_PREFIX:-}"
    printf 'SENTRY_AUTH_TOKEN=%q\n' "${SENTRY_AUTH_TOKEN:-}"
    printf 'SENTRY_ORG=%q\n' "${SENTRY_ORG:-}"
    printf 'SENTRY_TEAM_SLUG=%q\n' "${SENTRY_TEAM_SLUG:-}"
  } > "${DESTINATION_PATH}"
}

case "${PROFILE}" in
  ci-dev-minimal)
    write_ci_dev_minimal
    ;;
  full-stage)
    write_full_stage
    ;;
  *)
    printf 'Unknown env file profile: %s\n' "${PROFILE}" >&2
    exit 1
    ;;
esac

test -f "${DESTINATION_PATH}"

if [[ -n "${VALIDATION_ENVIRONMENT}" ]]; then
  bash scripts/validate-github-env-file.sh "${DESTINATION_PATH}" "${VALIDATION_ENVIRONMENT}" "$@"
fi
