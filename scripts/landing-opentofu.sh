#!/usr/bin/env bash
set -euo pipefail

MODULE_NAME="${1:?Expected module name (certificate-validation or edge-dns)}"
ACTION="${2:?Expected action (init, validate, plan, apply)}"
shift 2

source "$(dirname "$0")/landing-env.sh"

MODULE_DIR="infra/opentofu/${MODULE_NAME}"

if [[ ! -d "${MODULE_DIR}" ]]; then
  printf 'Unknown OpenTofu module: %s\n' "${MODULE_NAME}" >&2
  exit 1
fi

case "${ACTION}" in
  init)
    load_platform_backend_config

    tofu -chdir="${MODULE_DIR}" init \
      -backend-config="bucket=${TOFU_STATE_BUCKET}" \
      -backend-config="key=${TOFU_STATE_KEY_PREFIX}/${STAGE}/${MODULE_NAME}.tfstate" \
      -backend-config="region=${TOFU_STATE_REGION}" \
      -backend-config="dynamodb_table=${TOFU_LOCK_TABLE}" \
      "$@"
    ;;
  validate)
    tofu -chdir="${MODULE_DIR}" validate "$@"
    ;;
  plan|apply)
    require_env CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID ROOT_DOMAIN AWS_REGION

    VAR_ARGS=(
      -var "aws_profile=${AWS_PROFILE:-}"
      -var "aws_region=${AWS_REGION}"
      -var "cloudflare_api_token=${CLOUDFLARE_API_TOKEN}"
      -var "cloudflare_zone_id=${CLOUDFLARE_ZONE_ID}"
    )

    if [[ "${MODULE_NAME}" == "certificate-validation" ]]; then
      require_env LANDING_CERTIFICATE_ARN
      # shellcheck disable=SC1091
      source <(bash "$(dirname "$0")/export-landing-certificate-validation-records.sh")

      VAR_ARGS+=(
        -var "root_validation_record_name=${ROOT_VALIDATION_RECORD_NAME}"
        -var "root_validation_record_type=${ROOT_VALIDATION_RECORD_TYPE}"
        -var "root_validation_record_value=${ROOT_VALIDATION_RECORD_VALUE}"
        -var "www_validation_record_name=${WWW_VALIDATION_RECORD_NAME}"
        -var "www_validation_record_type=${WWW_VALIDATION_RECORD_TYPE}"
        -var "www_validation_record_value=${WWW_VALIDATION_RECORD_VALUE}"
      )
    else
      VAR_ARGS+=(
        -var "edge_stack_name=${LANDING_EDGE_STACK_NAME}"
        -var "root_domain=${ROOT_DOMAIN}"
        -var "www_domain=${WWW_DOMAIN}"
      )
    fi

    tofu -chdir="${MODULE_DIR}" "${ACTION}" "${VAR_ARGS[@]}" "$@"
    ;;
  *)
    printf 'Unsupported action: %s\n' "${ACTION}" >&2
    exit 1
    ;;
esac
