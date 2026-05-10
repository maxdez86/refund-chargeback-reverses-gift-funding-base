#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/payments-env.sh"

require_command curl jq
require_payments_test_env
load_payments_webhook_token

artifact_dir="$(create_payments_artifact_dir negative)"

post_json() {
  local url="$1"
  local body_file="$2"
  local response_file="$3"
  shift 3

  curl -sS \
    -o "${response_file}" \
    -w '%{http_code}' \
    -X POST "${url}" \
    -H 'content-type: application/json' \
    "$@" \
    --data @"${body_file}"
}

build_payment_request() {
  local gift_id="$1"
  local quantity="$2"
  local payer_email="$3"
  local output_file="$4"

  jq -n \
    --arg giftId "${gift_id}" \
    --argjson quantity "${quantity}" \
    --arg paymentMethod "PIX" \
    --arg payerName "${PAYMENTS_TEST_PAYER_NAME}" \
    --arg payerEmail "${payer_email}" \
    --arg payerCpf "${PAYMENTS_TEST_PAYER_CPF}" \
    --arg payerPhone "${PAYMENTS_TEST_PAYER_PHONE:-}" \
    '{
      giftId: $giftId,
      quantity: $quantity,
      paymentMethod: $paymentMethod,
      payer: {
        name: $payerName,
        email: $payerEmail,
        cpf: $payerCpf
      }
    } + (if $payerPhone == "" then {} else { payer: { name: $payerName, email: $payerEmail, cpf: $payerCpf, phone: $payerPhone } } end)' \
    > "${output_file}"
}

aws_ddb_payment_item() {
  local payment_id="$1"
  local output_file="$2"
  mapfile -t _aws_args < <(aws_args)

  aws dynamodb get-item \
    --table-name "${PAYMENTS_TABLE_NAME}" \
    --key "{\"PK\":{\"S\":\"PAYMENT#${payment_id}\"},\"SK\":{\"S\":\"PAYMENT\"}}" \
    "${_aws_args[@]}" \
    --output json > "${output_file}"
}

invalid_body="${artifact_dir}/invalid-gift.json"
invalid_response="${artifact_dir}/invalid-gift-response.json"
build_payment_request "g-does-not-exist" 1 "${PAYMENTS_TEST_PAYER_EMAIL}" "${invalid_body}"
invalid_status="$(post_json "${PAYMENTS_API_URL}/payments" "${invalid_body}" "${invalid_response}")"

if [[ "${invalid_status}" != "400" ]]; then
  printf 'Expected invalid gift request to return 400, got %s\n' "${invalid_status}" >&2
  cat "${invalid_response}" >&2
  exit 1
fi

printf 'Invalid gift test passed.\n'

same_body="${artifact_dir}/same-body.json"
same_response_one="${artifact_dir}/same-response-1.json"
same_response_two="${artifact_dir}/same-response-2.json"
same_idempotency_key="negative-same-${STAGE}-${PAYMENTS_TEST_GIFT_ID}-$(date -u +%Y%m%dT%H%M%SZ)"
build_payment_request "${PAYMENTS_TEST_GIFT_ID}" "${PAYMENTS_TEST_GIFT_QUANTITY}" "${PAYMENTS_TEST_PAYER_EMAIL}" "${same_body}"

same_status_one="$(
  post_json \
    "${PAYMENTS_API_URL}/payments" \
    "${same_body}" \
    "${same_response_one}" \
    -H "idempotency-key: ${same_idempotency_key}"
)"
same_status_two="$(
  post_json \
    "${PAYMENTS_API_URL}/payments" \
    "${same_body}" \
    "${same_response_two}" \
    -H "idempotency-key: ${same_idempotency_key}"
)"

if [[ "${same_status_one}" != "201" || "${same_status_two}" != "201" ]]; then
  printf 'Expected idempotency replay requests to return 201.\n' >&2
  cat "${same_response_one}" >&2
  cat "${same_response_two}" >&2
  exit 1
fi

same_payment_id_one="$(jq -r '.payment.paymentId // empty' "${same_response_one}")"
same_payment_id_two="$(jq -r '.payment.paymentId // empty' "${same_response_two}")"
same_checkout_url_one="$(jq -r '.payment.checkout.url // empty' "${same_response_one}")"
same_checkout_url_two="$(jq -r '.payment.checkout.url // empty' "${same_response_two}")"

if [[ -z "${same_payment_id_one}" || "${same_payment_id_one}" != "${same_payment_id_two}" ]]; then
  printf 'Expected same idempotency key replay to return the same paymentId.\n' >&2
  exit 1
fi

if [[ -z "${same_checkout_url_one}" || "${same_checkout_url_one}" != "${same_checkout_url_two}" ]]; then
  printf 'Expected same idempotency key replay to return the same checkout url.\n' >&2
  exit 1
fi

printf 'Idempotency replay test passed for payment %s.\n' "${same_payment_id_one}"

conflict_body="${artifact_dir}/conflict-body.json"
conflict_response="${artifact_dir}/conflict-response.json"
conflict_email="conflict+$(date -u +%Y%m%d%H%M%S)@example.com"
build_payment_request "${PAYMENTS_TEST_GIFT_ID}" 2 "${conflict_email}" "${conflict_body}"
conflict_status="$(
  post_json \
    "${PAYMENTS_API_URL}/payments" \
    "${conflict_body}" \
    "${conflict_response}" \
    -H "idempotency-key: ${same_idempotency_key}"
)"

if [[ "${conflict_status}" != "409" ]]; then
  printf 'Expected idempotency conflict request to return 409, got %s\n' "${conflict_status}" >&2
  cat "${conflict_response}" >&2
  exit 1
fi

printf 'Idempotency conflict test passed.\n'

forbidden_webhook_body="${artifact_dir}/forbidden-webhook.json"
forbidden_webhook_response="${artifact_dir}/forbidden-webhook-response.json"
cat > "${forbidden_webhook_body}" <<EOF
{"event":"PAYMENT_CREATED","payment":{"id":"fake-payment","externalReference":"${same_payment_id_one}","status":"PENDING"}}
EOF

forbidden_status="$(
  post_json \
    "${PAYMENTS_API_URL}/webhooks/asaas" \
    "${forbidden_webhook_body}" \
    "${forbidden_webhook_response}" \
    -H 'asaas-access-token: invalid-token'
)"

if [[ "${forbidden_status}" != "403" ]]; then
  printf 'Expected invalid webhook token to return 403, got %s\n' "${forbidden_status}" >&2
  cat "${forbidden_webhook_response}" >&2
  exit 1
fi

printf 'Webhook auth failure test passed.\n'

ddb_item_file="${artifact_dir}/ddb-item.json"
aws_ddb_payment_item "${same_payment_id_one}" "${ddb_item_file}"
asaas_payment_id="$(jq -r '.Item.asaasPaymentId.S // empty' "${ddb_item_file}")"

if [[ -z "${asaas_payment_id}" ]]; then
  printf 'Could not resolve asaasPaymentId from DynamoDB for payment %s.\n' "${same_payment_id_one}" >&2
  cat "${ddb_item_file}" >&2
  exit 1
fi

duplicate_webhook_body="${artifact_dir}/duplicate-webhook.json"
duplicate_webhook_response_one="${artifact_dir}/duplicate-webhook-response-1.json"
duplicate_webhook_response_two="${artifact_dir}/duplicate-webhook-response-2.json"
cat > "${duplicate_webhook_body}" <<EOF
{"event":"PAYMENT_CREATED","payment":{"id":"${asaas_payment_id}","externalReference":"${same_payment_id_one}","status":"PENDING"}}
EOF

duplicate_status_one="$(
  post_json \
    "${PAYMENTS_API_URL}/webhooks/asaas" \
    "${duplicate_webhook_body}" \
    "${duplicate_webhook_response_one}" \
    -H "asaas-access-token: ${ASAAS_WEBHOOK_TOKEN}"
)"
duplicate_status_two="$(
  post_json \
    "${PAYMENTS_API_URL}/webhooks/asaas" \
    "${duplicate_webhook_body}" \
    "${duplicate_webhook_response_two}" \
    -H "asaas-access-token: ${ASAAS_WEBHOOK_TOKEN}"
)"

if [[ "${duplicate_status_one}" != "200" || "${duplicate_status_two}" != "200" ]]; then
  printf 'Expected duplicate webhook submissions to return 200.\n' >&2
  cat "${duplicate_webhook_response_one}" >&2
  cat "${duplicate_webhook_response_two}" >&2
  exit 1
fi

if [[ "$(jq -r '.duplicate // empty' "${duplicate_webhook_response_one}")" != "false" ]]; then
  printf 'Expected first duplicate webhook submission to be accepted.\n' >&2
  cat "${duplicate_webhook_response_one}" >&2
  exit 1
fi

if [[ "$(jq -r '.duplicate // empty' "${duplicate_webhook_response_two}")" != "true" ]]; then
  printf 'Expected second duplicate webhook submission to report duplicate=true.\n' >&2
  cat "${duplicate_webhook_response_two}" >&2
  exit 1
fi

printf 'Duplicate webhook test passed.\n'
printf 'Negative-path artifacts: %s\n' "${artifact_dir}"
