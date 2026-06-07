#!/usr/bin/env bash
set -euo pipefail

MODULE_NAME="${1:?Expected module name (certificate-validation, edge-dns, api-dns, ses-dns, sentry, or zone-settings)}"
ACTION="${2:?Expected action (init, validate, plan, apply)}"
shift 2

source "$(dirname "$0")/landing-env.sh"

MODULE_DIR="infra/opentofu/${MODULE_NAME}"
SHARED_PLATFORM_STACK_NAME="${TOFU_SHARED_PLATFORM_STACK_NAME:-BrimaxPlatformStack}"

is_shared_module() {
  [[ "${MODULE_NAME}" == "zone-settings" ]]
}

module_state_key() {
  if is_shared_module; then
    printf '%s/shared/%s.tfstate' "${TOFU_STATE_KEY_PREFIX}" "${MODULE_NAME}"
  else
    printf '%s/%s/%s.tfstate' "${TOFU_STATE_KEY_PREFIX}" "${STAGE}" "${MODULE_NAME}"
  fi
}

platform_backend_stack_name() {
  if is_shared_module; then
    printf '%s' "${SHARED_PLATFORM_STACK_NAME}"
  else
    printf '%s' "${PLATFORM_STACK_NAME}"
  fi
}

current_backend_key() {
  local backend_state_file="${MODULE_DIR}/.terraform/terraform.tfstate"

  if [[ ! -f "${backend_state_file}" ]]; then
    return 1
  fi

  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    const key = data?.backend?.config?.key;
    if (typeof key !== "string" || key.length === 0) {
      process.exit(1);
    }
    process.stdout.write(key);
  ' "${backend_state_file}"

  return 0
}

module_script_prefix() {
  case "${MODULE_NAME}" in
    certificate-validation) printf 'opentofu:cert' ;;
    edge-dns) printf 'opentofu:dns' ;;
    api-dns) printf 'opentofu:api-dns' ;;
    ses-dns) printf 'opentofu:ses-dns' ;;
    sentry) printf 'opentofu:sentry' ;;
    zone-settings) printf 'opentofu:zone-settings' ;;
    *) printf 'opentofu:%s' "${MODULE_NAME}" ;;
  esac
}

verify_backend_target() {
  local expected_key actual_key
  expected_key="$(module_state_key)"

  actual_key="$(current_backend_key 2>/dev/null || true)"

  if [[ -z "${actual_key}" ]]; then
    printf 'OpenTofu module %s is not initialized for any backend. Run `pnpm %s:init` first.\n' \
      "${MODULE_NAME}" \
      "$(module_script_prefix)" >&2
    exit 1
  fi

  if [[ "${actual_key}" != "${expected_key}" ]]; then
    printf 'OpenTofu backend mismatch for %s.\n' "${MODULE_NAME}" >&2
    printf '  expected backend key: %s\n' "${expected_key}" >&2
    printf '  current backend key:  %s\n' "${actual_key}" >&2
    printf 'Run `pnpm %s:init` with the intended env file before %s.\n' \
      "$(module_script_prefix)" \
      "${ACTION}" >&2
    exit 1
  fi
}

if [[ ! -d "${MODULE_DIR}" ]]; then
  printf 'Unknown OpenTofu module: %s\n' "${MODULE_NAME}" >&2
  exit 1
fi

print_env_summary "OpenTofu ${MODULE_NAME}:${ACTION}"

case "${ACTION}" in
  init)
    load_platform_backend_config "$(platform_backend_stack_name)"

    tofu -chdir="${MODULE_DIR}" init \
      -reconfigure \
      -backend-config="bucket=${TOFU_STATE_BUCKET}" \
      -backend-config="key=$(module_state_key)" \
      -backend-config="region=${TOFU_STATE_REGION}" \
      -backend-config="dynamodb_table=${TOFU_LOCK_TABLE}" \
      "$@"
    ;;
  validate)
    tofu -chdir="${MODULE_DIR}" validate "$@"
    ;;
  plan|apply)
    VAR_ARGS=()
    verify_backend_target

    if [[ "${MODULE_NAME}" == "sentry" ]]; then
      require_env SENTRY_AUTH_TOKEN

      VAR_ARGS+=(
        -var "stage=${STAGE}"
        -var "sentry_organization_slug=${SENTRY_ORG}"
        -var "sentry_team_slug=${SENTRY_TEAM_SLUG}"
      )
    else
      require_env CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID

      VAR_ARGS+=(
        -var "cloudflare_api_token=${CLOUDFLARE_API_TOKEN}"
        -var "cloudflare_zone_id=${CLOUDFLARE_ZONE_ID}"
      )

      if ! is_shared_module; then
        require_env ROOT_DOMAIN AWS_REGION

        VAR_ARGS+=(
          -var "aws_profile=${AWS_PROFILE:-}"
          -var "aws_region=${AWS_REGION}"
          -var "stage=${STAGE}"
        )
      fi
    fi

    if [[ "${MODULE_NAME}" == "certificate-validation" ]]; then
      # The export helper auto-discovers LANDING_CERTIFICATE_ARN from ACM when the
      # env value is empty (the first-bootstrap case), so resolve it first and then
      # require it. If discovery fails the export helper errors out, and the
      # require_env below still gives a clear message on an empty value.
      # shellcheck disable=SC1091
      source <(bash "$(dirname "$0")/export-landing-certificate-validation-records.sh")
      require_env LANDING_CERTIFICATE_ARN

      VAR_ARGS+=(
        -var "root_validation_record_name=${ROOT_VALIDATION_RECORD_NAME}"
        -var "root_validation_record_type=${ROOT_VALIDATION_RECORD_TYPE}"
        -var "root_validation_record_value=${ROOT_VALIDATION_RECORD_VALUE}"
        -var "api_validation_record_name=${API_VALIDATION_RECORD_NAME}"
        -var "api_validation_record_type=${API_VALIDATION_RECORD_TYPE}"
        -var "api_validation_record_value=${API_VALIDATION_RECORD_VALUE}"
        -var "www_validation_record_name=${WWW_VALIDATION_RECORD_NAME}"
        -var "www_validation_record_type=${WWW_VALIDATION_RECORD_TYPE}"
        -var "www_validation_record_value=${WWW_VALIDATION_RECORD_VALUE}"
      )
    elif [[ "${MODULE_NAME}" == "ses-dns" ]]; then
      # shellcheck disable=SC1091
      source <(bash "$(dirname "$0")/export-ses-domain-dkim-records.sh")

      VAR_ARGS+=(
        -var "ses_domain_identity=${SES_DOMAIN_IDENTITY}"
        -var "ses_mail_from_domain=${SES_MAIL_FROM_DOMAIN}"
        -var "ses_mail_from_mx_value=${SES_MAIL_FROM_MX_VALUE}"
        -var "ses_mail_from_txt_value=${SES_MAIL_FROM_TXT_VALUE}"
        -var "ses_dkim_record_name_1=${SES_DKIM_RECORD_NAME_1}"
        -var "ses_dkim_record_value_1=${SES_DKIM_RECORD_VALUE_1}"
        -var "ses_dkim_record_name_2=${SES_DKIM_RECORD_NAME_2}"
        -var "ses_dkim_record_value_2=${SES_DKIM_RECORD_VALUE_2}"
        -var "ses_dkim_record_name_3=${SES_DKIM_RECORD_NAME_3}"
        -var "ses_dkim_record_value_3=${SES_DKIM_RECORD_VALUE_3}"
      )
    elif [[ "${MODULE_NAME}" == "edge-dns" ]]; then
      VAR_ARGS+=(
        -var "edge_stack_name=${LANDING_EDGE_STACK_NAME}"
        -var "root_domain=${ROOT_DOMAIN}"
        -var "www_domain=${WWW_DOMAIN}"
      )
    elif [[ "${MODULE_NAME}" == "sentry" || "${MODULE_NAME}" == "zone-settings" ]]; then
      :
    else
      VAR_ARGS+=(
        -var "app_stack_name=${PAYMENTS_STACK_NAME:-${STAGE_PREFIX}BrimaxAppStack}"
        -var "api_domain=${API_DOMAIN}"
      )
    fi

    tofu -chdir="${MODULE_DIR}" "${ACTION}" "${VAR_ARGS[@]}" "$@"
    ;;
  *)
    printf 'Unsupported action: %s\n' "${ACTION}" >&2
    exit 1
    ;;
esac
