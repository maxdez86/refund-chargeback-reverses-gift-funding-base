#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/payments-env.sh"

require_command curl jq
require_payments_test_env

artifact_dir="$(create_payments_artifact_dir pix)"
idempotency_key="pix-smoke-${STAGE}-${PAYMENTS_TEST_GIFT_ID}-${PAYMENTS_TEST_GIFT_QUANTITY}-$(date -u +%Y%m%dT%H%M%SZ)"
create_body_file="${artifact_dir}/create-request.json"
create_response_file="${artifact_dir}/create-response.json"
get_response_file="${artifact_dir}/get-response.json"
summary_file="${artifact_dir}/summary.env"

jq -n \
  --arg giftId "${PAYMENTS_TEST_GIFT_ID}" \
  --argjson quantity "${PAYMENTS_TEST_GIFT_QUANTITY}" \
  --arg paymentMethod "PIX" \
  --arg payerName "${PAYMENTS_TEST_PAYER_NAME}" \
  --arg payerEmail "${PAYMENTS_TEST_PAYER_EMAIL}" \
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
  > "${create_body_file}"

printf 'Creating PIX payment via %s/payments\n' "${PAYMENTS_API_URL}"

create_status="$(
  curl -sS \
    -o "${create_response_file}" \
    -w '%{http_code}' \
    -X POST "${PAYMENTS_API_URL}/payments" \
    -H 'content-type: application/json' \
    -H "idempotency-key: ${idempotency_key}" \
    --data @"${create_body_file}"
)"

if [[ "${create_status}" != "201" ]]; then
  printf 'Expected HTTP 201 from POST /payments, got %s\n' "${create_status}" >&2
  cat "${create_response_file}" >&2
  exit 1
fi

payment_id="$(jq -r '.payment.paymentId // empty' "${create_response_file}")"
payment_status="$(jq -r '.payment.status // empty' "${create_response_file}")"
pix_copy_paste="$(jq -r '.payment.pix.copyPaste // empty' "${create_response_file}")"
pix_qr_code="$(jq -r '.payment.pix.qrCodeBase64 // empty' "${create_response_file}")"
amount_cents="$(jq -r '.payment.amountCents // empty' "${create_response_file}")"

if [[ "$(jq -r '.ok' "${create_response_file}")" != "true" ]]; then
  printf 'Expected ok=true in create response.\n' >&2
  cat "${create_response_file}" >&2
  exit 1
fi

if [[ "${payment_status}" != "AWAITING_PAYMENT" ]]; then
  printf 'Expected initial payment status AWAITING_PAYMENT, got %s\n' "${payment_status}" >&2
  cat "${create_response_file}" >&2
  exit 1
fi

if [[ -z "${payment_id}" || -z "${pix_copy_paste}" || -z "${pix_qr_code}" ]]; then
  printf 'Create response is missing paymentId or PIX payload fields.\n' >&2
  cat "${create_response_file}" >&2
  exit 1
fi

get_status="$(
  curl -sS \
    -o "${get_response_file}" \
    -w '%{http_code}' \
    "${PAYMENTS_API_URL}/payments/${payment_id}"
)"

if [[ "${get_status}" != "200" ]]; then
  printf 'Expected HTTP 200 from GET /payments/%s, got %s\n' "${payment_id}" "${get_status}" >&2
  cat "${get_response_file}" >&2
  exit 1
fi

if [[ "$(jq -r '.ok' "${get_response_file}")" != "true" ]]; then
  printf 'Expected ok=true in get response.\n' >&2
  cat "${get_response_file}" >&2
  exit 1
fi

if [[ "$(jq -r '.payment.paymentId // empty' "${get_response_file}")" != "${payment_id}" ]]; then
  printf 'GET /payments returned a different paymentId.\n' >&2
  cat "${get_response_file}" >&2
  exit 1
fi

if [[ "$(jq -r '.payment.status // empty' "${get_response_file}")" != "AWAITING_PAYMENT" ]]; then
  printf 'Expected GET /payments to remain in AWAITING_PAYMENT before manual PIX payment.\n' >&2
  cat "${get_response_file}" >&2
  exit 1
fi

cat > "${summary_file}" <<EOF
PAYMENT_ID=${payment_id}
PAYMENT_STATUS=${payment_status}
PAYMENT_AMOUNT_CENTS=${amount_cents}
ASAAS_PAYMENT_STATUS_URL=${PAYMENTS_API_URL}/payments/${payment_id}
IDEMPOTENCY_KEY=${idempotency_key}
EOF

printf '\nPIX payment created successfully.\n'
printf 'Artifact directory: %s\n' "${artifact_dir}"
printf 'Payment ID: %s\n' "${payment_id}"
printf 'Amount (cents): %s\n' "${amount_cents}"
printf 'Status: %s\n' "${payment_status}"
printf '\nUse the copy-paste code below to complete the PIX payment manually:\n\n'
printf '%s\n\n' "${pix_copy_paste}"
printf 'Then verify webhook processing with:\n'
printf 'PAYMENT_ID=%q bash scripts/test-payments-webhook.sh\n' "${payment_id}"
