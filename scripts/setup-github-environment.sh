#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

require_env GITHUB_TOKEN AWS_REGION STAGE ROOT_DOMAIN CONTACT_EMAIL API_DOMAIN WWW_DOMAIN \
  CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID OBSERVABILITY_ALERT_EMAIL XRAY_ENABLED ASAAS_ENV ASAAS_API_BASE_URL \
  ASAAS_API_KEY ASAAS_WEBHOOK_TOKEN TURNSTILE_SECRET_KEY TURNSTILE_SITE_KEY \
  PAYMENTS_TEST_GIFT_ID PAYMENTS_TEST_GIFT_QUANTITY PAYMENTS_TEST_PAYER_NAME \
  PAYMENTS_TEST_PAYER_EMAIL PAYMENTS_TEST_PAYER_CPF PAYMENTS_TEST_PAYER_PHONE SENTRY_AUTH_TOKEN

ROLE_ARN="${1:?Expected the stage-specific AWS role ARN as the first argument}"
DEV_VALIDATION_ROLE_ARN="${2:-}"
STAGE_UPPER="$(printf '%s' "${STAGE}" | tr '[:lower:]' '[:upper:]')"
ROLE_SECRET_NAME="AWS_ROLE_TO_ASSUME_${STAGE_UPPER}"
ENVIRONMENT_NAME="${STAGE}"
DEV_ENVIRONMENT_NAME="dev"
REPOSITORY="${GITHUB_OIDC_REPOSITORY:-}"

resolve_repository() {
  if [[ -n "${REPOSITORY}" ]]; then
    printf '%s\n' "${REPOSITORY}"
    return
  fi

  local remote_url
  remote_url="$(git -C "$(dirname "$0")/.." remote get-url origin)"

  remote_url="${remote_url%.git}"
  remote_url="${remote_url#https://github.com/}"
  remote_url="${remote_url#git@github.com:}"

  if [[ "${remote_url}" != */* ]]; then
    printf 'Could not determine GitHub repository from origin remote.\n' >&2
    exit 1
  fi

  printf '%s\n' "${remote_url}"
}

REPOSITORY="$(resolve_repository)"
export GH_TOKEN="${GITHUB_TOKEN}"

ensure_environment_exists() {
  local environment_name="${1}"

  gh api \
    --method PUT \
    --header "Accept: application/vnd.github+json" \
    "repos/${REPOSITORY}/environments/${environment_name}" >/dev/null
}

set_environment_variable() {
  local name="${1}"
  local value="${2}"
  local environment_name="${3:-${ENVIRONMENT_NAME}}"

  gh variable set "${name}" \
    --env "${environment_name}" \
    --repo "${REPOSITORY}" \
    --body "${value}"
}

set_environment_secret() {
  local name="${1}"
  local value="${2}"
  local environment_name="${3:-${ENVIRONMENT_NAME}}"

  gh secret set "${name}" \
    --env "${environment_name}" \
    --repo "${REPOSITORY}" \
    --body "${value}"
}

printf 'Configuring GitHub environment %s in %s\n' "${ENVIRONMENT_NAME}" "${REPOSITORY}"
ensure_environment_exists "${ENVIRONMENT_NAME}"
ensure_environment_exists "${DEV_ENVIRONMENT_NAME}"

set_environment_variable "AWS_REGION" "${AWS_REGION}"
set_environment_variable "STAGE" "${STAGE}"
set_environment_variable "ROOT_DOMAIN" "${ROOT_DOMAIN}"
set_environment_variable "CONTACT_EMAIL" "${CONTACT_EMAIL}"
set_environment_variable "API_DOMAIN" "${API_DOMAIN}"
set_environment_variable "WWW_DOMAIN" "${WWW_DOMAIN}"
set_environment_variable "CLOUDFLARE_ZONE_ID" "${CLOUDFLARE_ZONE_ID}"
set_environment_variable "OBSERVABILITY_ALERT_EMAIL" "${OBSERVABILITY_ALERT_EMAIL}"
set_environment_variable "XRAY_ENABLED" "${XRAY_ENABLED}"
set_environment_variable "ASAAS_ENV" "${ASAAS_ENV}"
set_environment_variable "ASAAS_API_BASE_URL" "${ASAAS_API_BASE_URL}"
set_environment_variable "TURNSTILE_SITE_KEY" "${TURNSTILE_SITE_KEY}"
set_environment_variable "PAYMENTS_TEST_GIFT_ID" "${PAYMENTS_TEST_GIFT_ID}"
set_environment_variable "PAYMENTS_TEST_GIFT_QUANTITY" "${PAYMENTS_TEST_GIFT_QUANTITY}"
set_environment_variable "TOFU_STATE_KEY_PREFIX" "${TOFU_STATE_KEY_PREFIX}"
set_environment_variable "SENTRY_ORG" "${SENTRY_ORG}"
set_environment_variable "SENTRY_TEAM_SLUG" "${SENTRY_TEAM_SLUG}"

set_environment_secret "CLOUDFLARE_API_TOKEN" "${CLOUDFLARE_API_TOKEN}"
set_environment_secret "ASAAS_API_KEY" "${ASAAS_API_KEY}"
set_environment_secret "ASAAS_WEBHOOK_TOKEN" "${ASAAS_WEBHOOK_TOKEN}"
set_environment_secret "TURNSTILE_SECRET_KEY" "${TURNSTILE_SECRET_KEY}"
set_environment_secret "PAYMENTS_TEST_PAYER_NAME" "${PAYMENTS_TEST_PAYER_NAME}"
set_environment_secret "PAYMENTS_TEST_PAYER_EMAIL" "${PAYMENTS_TEST_PAYER_EMAIL}"
set_environment_secret "PAYMENTS_TEST_PAYER_CPF" "${PAYMENTS_TEST_PAYER_CPF}"
set_environment_secret "PAYMENTS_TEST_PAYER_PHONE" "${PAYMENTS_TEST_PAYER_PHONE}"
set_environment_secret "SENTRY_AUTH_TOKEN" "${SENTRY_AUTH_TOKEN}"
set_environment_secret "${ROLE_SECRET_NAME}" "${ROLE_ARN}"

if [[ -z "${DEV_VALIDATION_ROLE_ARN}" ]]; then
  printf 'Expected the dev validation AWS role ARN as the second argument.\n' >&2
  exit 1
fi

set_environment_secret "AWS_ROLE_TO_ASSUME_DEV_VALIDATION" "${DEV_VALIDATION_ROLE_ARN}" "${DEV_ENVIRONMENT_NAME}"

printf 'Updated GitHub environment %s.\n' "${ENVIRONMENT_NAME}"
printf '  variable set: STAGE=%s\n' "${STAGE}"
printf '  secret set: %s\n' "${ROLE_SECRET_NAME}"
printf 'Updated GitHub environment %s.\n' "${DEV_ENVIRONMENT_NAME}"
printf '  secret set: AWS_ROLE_TO_ASSUME_DEV_VALIDATION\n'
