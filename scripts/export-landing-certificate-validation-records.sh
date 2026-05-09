#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

require_env ROOT_DOMAIN API_DOMAIN WWW_DOMAIN AWS_REGION

AWS_ARGS=(--region "${AWS_REGION}")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

LANDING_CERTIFICATE_ARN="${LANDING_CERTIFICATE_ARN:-}"

if [[ -z "${LANDING_CERTIFICATE_ARN}" || "${LANDING_CERTIFICATE_ARN}" == "None" ]]; then
  LANDING_CERTIFICATE_ARN="$(
    aws acm list-certificates \
      "${AWS_ARGS[@]}" \
      --query "CertificateSummaryList[?DomainName=='${ROOT_DOMAIN}'].CertificateArn | [0]" \
      --output text
  )"
fi

if [[ -z "${LANDING_CERTIFICATE_ARN}" || "${LANDING_CERTIFICATE_ARN}" == "None" ]]; then
  printf 'Could not determine landing certificate ARN for %s\n' "${ROOT_DOMAIN}" >&2
  exit 1
fi

API_CERTIFICATE_ARN="$(
  aws acm list-certificates \
    "${AWS_ARGS[@]}" \
    --query "CertificateSummaryList[?DomainName=='${API_DOMAIN}'].CertificateArn | [0]" \
    --output text
)"

if [[ -z "${API_CERTIFICATE_ARN}" || "${API_CERTIFICATE_ARN}" == "None" ]]; then
  printf 'Could not determine API certificate ARN for %s\n' "${API_DOMAIN}" >&2
  exit 1
fi

query_record_field() {
  local certificate_arn="${1}"
  local domain_name="${2}"
  local field_name="${3}"

  aws acm describe-certificate \
    --certificate-arn "${certificate_arn}" \
    "${AWS_ARGS[@]}" \
    --query "Certificate.DomainValidationOptions[?DomainName=='${domain_name}'].ResourceRecord.${field_name} | [0]" \
    --output text
}

ROOT_VALIDATION_RECORD_NAME="$(query_record_field "${LANDING_CERTIFICATE_ARN}" "${ROOT_DOMAIN}" "Name")"
ROOT_VALIDATION_RECORD_TYPE="$(query_record_field "${LANDING_CERTIFICATE_ARN}" "${ROOT_DOMAIN}" "Type")"
ROOT_VALIDATION_RECORD_VALUE="$(query_record_field "${LANDING_CERTIFICATE_ARN}" "${ROOT_DOMAIN}" "Value")"

WWW_VALIDATION_RECORD_NAME="$(query_record_field "${LANDING_CERTIFICATE_ARN}" "${WWW_DOMAIN}" "Name")"
WWW_VALIDATION_RECORD_TYPE="$(query_record_field "${LANDING_CERTIFICATE_ARN}" "${WWW_DOMAIN}" "Type")"
WWW_VALIDATION_RECORD_VALUE="$(query_record_field "${LANDING_CERTIFICATE_ARN}" "${WWW_DOMAIN}" "Value")"

API_VALIDATION_RECORD_NAME="$(query_record_field "${API_CERTIFICATE_ARN}" "${API_DOMAIN}" "Name")"
API_VALIDATION_RECORD_TYPE="$(query_record_field "${API_CERTIFICATE_ARN}" "${API_DOMAIN}" "Type")"
API_VALIDATION_RECORD_VALUE="$(query_record_field "${API_CERTIFICATE_ARN}" "${API_DOMAIN}" "Value")"

for key in \
  ROOT_VALIDATION_RECORD_NAME \
  ROOT_VALIDATION_RECORD_TYPE \
  ROOT_VALIDATION_RECORD_VALUE \
  API_VALIDATION_RECORD_NAME \
  API_VALIDATION_RECORD_TYPE \
  API_VALIDATION_RECORD_VALUE \
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
printf 'export LANDING_CERTIFICATE_ARN=%q\n' "${LANDING_CERTIFICATE_ARN}"
printf 'export API_CERTIFICATE_ARN=%q\n' "${API_CERTIFICATE_ARN}"
printf 'export API_VALIDATION_RECORD_NAME=%q\n' "${API_VALIDATION_RECORD_NAME}"
printf 'export API_VALIDATION_RECORD_TYPE=%q\n' "${API_VALIDATION_RECORD_TYPE}"
printf 'export API_VALIDATION_RECORD_VALUE=%q\n' "${API_VALIDATION_RECORD_VALUE}"
printf 'export WWW_VALIDATION_RECORD_NAME=%q\n' "${WWW_VALIDATION_RECORD_NAME}"
printf 'export WWW_VALIDATION_RECORD_TYPE=%q\n' "${WWW_VALIDATION_RECORD_TYPE}"
printf 'export WWW_VALIDATION_RECORD_VALUE=%q\n' "${WWW_VALIDATION_RECORD_VALUE}"
