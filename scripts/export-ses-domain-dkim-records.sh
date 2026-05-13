#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

require_env AWS_REGION

APP_STACK_NAME="${PAYMENTS_STACK_NAME:-${STAGE_PREFIX}BrimaxAppStack}"

AWS_ARGS=(--region "${AWS_REGION}")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

query_stack_output() {
  local output_key="${1}"

  aws cloudformation describe-stacks \
    --stack-name "${APP_STACK_NAME}" \
    "${AWS_ARGS[@]}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

SES_DOMAIN_IDENTITY="$(query_stack_output "SesSenderDomainIdentity")"
SES_DKIM_RECORD_NAME_1="$(query_stack_output "SesDkimDnsTokenName1")"
SES_DKIM_RECORD_VALUE_1="$(query_stack_output "SesDkimDnsTokenValue1")"
SES_DKIM_RECORD_NAME_2="$(query_stack_output "SesDkimDnsTokenName2")"
SES_DKIM_RECORD_VALUE_2="$(query_stack_output "SesDkimDnsTokenValue2")"
SES_DKIM_RECORD_NAME_3="$(query_stack_output "SesDkimDnsTokenName3")"
SES_DKIM_RECORD_VALUE_3="$(query_stack_output "SesDkimDnsTokenValue3")"

for key in \
  SES_DOMAIN_IDENTITY \
  SES_DKIM_RECORD_NAME_1 \
  SES_DKIM_RECORD_VALUE_1 \
  SES_DKIM_RECORD_NAME_2 \
  SES_DKIM_RECORD_VALUE_2 \
  SES_DKIM_RECORD_NAME_3 \
  SES_DKIM_RECORD_VALUE_3; do
  if [[ -z "${!key:-}" || "${!key}" == "None" ]]; then
    printf 'Could not determine %s from CloudFormation stack %s\n' "${key}" "${APP_STACK_NAME}" >&2
    exit 1
  fi
done

printf 'export SES_DOMAIN_IDENTITY=%q\n' "${SES_DOMAIN_IDENTITY}"
printf 'export SES_DKIM_RECORD_NAME_1=%q\n' "${SES_DKIM_RECORD_NAME_1}"
printf 'export SES_DKIM_RECORD_VALUE_1=%q\n' "${SES_DKIM_RECORD_VALUE_1}"
printf 'export SES_DKIM_RECORD_NAME_2=%q\n' "${SES_DKIM_RECORD_NAME_2}"
printf 'export SES_DKIM_RECORD_VALUE_2=%q\n' "${SES_DKIM_RECORD_VALUE_2}"
printf 'export SES_DKIM_RECORD_NAME_3=%q\n' "${SES_DKIM_RECORD_NAME_3}"
printf 'export SES_DKIM_RECORD_VALUE_3=%q\n' "${SES_DKIM_RECORD_VALUE_3}"
