#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

AWS_ARGS=(--region "${AWS_REGION}")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

CERTIFICATE_ARN="${LANDING_CERTIFICATE_ARN:-}"

if [[ -z "${CERTIFICATE_ARN}" || "${CERTIFICATE_ARN}" == "None" ]]; then
  CERTIFICATE_ARN="$(
    aws cloudformation describe-stacks \
      --stack-name "${LANDING_CERT_STACK_NAME}" \
      "${AWS_ARGS[@]}" \
      --query "Stacks[0].Outputs[?OutputKey=='CertificateArn'].OutputValue | [0]" \
      --output text
  )"
fi

if [[ -z "${CERTIFICATE_ARN}" || "${CERTIFICATE_ARN}" == "None" ]]; then
  printf 'Could not determine certificate ARN. Set LANDING_CERTIFICATE_ARN or wait for stack outputs on %s.\n' "${LANDING_CERT_STACK_NAME}" >&2
  exit 1
fi

printf 'Waiting for ACM certificate %s to be ISSUED...\n' "${CERTIFICATE_ARN}"

while true; do
  STATUS="$(
    aws acm describe-certificate \
      --certificate-arn "${CERTIFICATE_ARN}" \
      "${AWS_ARGS[@]}" \
      --query "Certificate.Status" \
      --output text
  )"

  printf 'Current certificate status: %s\n' "${STATUS}"

  if [[ "${STATUS}" == "ISSUED" ]]; then
    break
  fi

  if [[ "${STATUS}" == "FAILED" ]]; then
    printf 'Certificate issuance failed.\n' >&2
    exit 1
  fi

  sleep 15
done
