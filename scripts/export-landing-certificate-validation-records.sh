#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

require_env LANDING_CERTIFICATE_ARN ROOT_DOMAIN WWW_DOMAIN AWS_REGION

AWS_ARGS=(--region "${AWS_REGION}")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

query_record_field() {
  local domain_name="${1}"
  local field_name="${2}"

  aws acm describe-certificate \
    --certificate-arn "${LANDING_CERTIFICATE_ARN}" \
    "${AWS_ARGS[@]}" \
    --query "Certificate.DomainValidationOptions[?DomainName=='${domain_name}'].ResourceRecord.${field_name} | [0]" \
    --output text
}

ROOT_VALIDATION_RECORD_NAME="$(query_record_field "${ROOT_DOMAIN}" "Name")"
ROOT_VALIDATION_RECORD_TYPE="$(query_record_field "${ROOT_DOMAIN}" "Type")"
ROOT_VALIDATION_RECORD_VALUE="$(query_record_field "${ROOT_DOMAIN}" "Value")"

WWW_VALIDATION_RECORD_NAME="$(query_record_field "${WWW_DOMAIN}" "Name")"
WWW_VALIDATION_RECORD_TYPE="$(query_record_field "${WWW_DOMAIN}" "Type")"
WWW_VALIDATION_RECORD_VALUE="$(query_record_field "${WWW_DOMAIN}" "Value")"

for key in \
  ROOT_VALIDATION_RECORD_NAME \
  ROOT_VALIDATION_RECORD_TYPE \
  ROOT_VALIDATION_RECORD_VALUE \
  WWW_VALIDATION_RECORD_NAME \
  WWW_VALIDATION_RECORD_TYPE \
  WWW_VALIDATION_RECORD_VALUE; do
  if [[ -z "${!key:-}" || "${!key}" == "None" ]]; then
    printf 'Could not determine %s from ACM certificate %s\n' "${key}" "${LANDING_CERTIFICATE_ARN}" >&2
    exit 1
  fi
done

printf 'export ROOT_VALIDATION_RECORD_NAME=%q\n' "${ROOT_VALIDATION_RECORD_NAME}"
printf 'export ROOT_VALIDATION_RECORD_TYPE=%q\n' "${ROOT_VALIDATION_RECORD_TYPE}"
printf 'export ROOT_VALIDATION_RECORD_VALUE=%q\n' "${ROOT_VALIDATION_RECORD_VALUE}"
printf 'export WWW_VALIDATION_RECORD_NAME=%q\n' "${WWW_VALIDATION_RECORD_NAME}"
printf 'export WWW_VALIDATION_RECORD_TYPE=%q\n' "${WWW_VALIDATION_RECORD_TYPE}"
printf 'export WWW_VALIDATION_RECORD_VALUE=%q\n' "${WWW_VALIDATION_RECORD_VALUE}"
