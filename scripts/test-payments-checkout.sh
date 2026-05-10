#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/payments-env.sh"

require_command curl jq
require_payments_test_env

payment_method="${PAYMENTS_TEST_PAYMENT_METHOD:-PIX}"
artifact_dir="$(create_payments_artifact_dir checkout)"
idempotency_key="checkout-smoke-${STAGE}-${payment_method}-${PAYMENTS_TEST_GIFT_ID}-${PAYMENTS_TEST_GIFT_QUANTITY}-$(date -u +%Y%m%dT%H%M%SZ)"
create_body_file="${artifact_dir}/create-request.json"
create_response_file="${artifact_dir}/create-response.json"
get_response_file="${artifact_dir}/get-response.json"
summary_file="${artifact_dir}/summary.env"

jq -n \
  --arg giftId "${PAYMENTS_TEST_GIFT_ID}" \
  --argjson quantity "${PAYMENTS_TEST_GIFT_QUANTITY}" \
  --arg paymentMethod "${payment_method}" \
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

printf 'Creating hosted checkout payment via %s/payments\n' "${PAYMENTS_API_URL}"

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
checkout_session_id="$(jq -r '.payment.checkout.sessionId // empty' "${create_response_file}")"
checkout_url="$(jq -r '.payment.checkout.url // empty' "${create_response_file}")"
checkout_expires_at="$(jq -r '.payment.checkout.expiresAt // empty' "${create_response_file}")"
amount_cents="$(jq -r '.payment.amountCents // empty' "${create_response_file}")"

if [[ "$(jq -r '.ok' "${create_response_file}")" != "true" ]]; then
  printf 'Expected ok=true in create response.\n' >&2
  cat "${create_response_file}" >&2
  exit 1
fi

if [[ "${payment_status}" != "CREATED" ]]; then
  printf 'Expected initial payment status CREATED, got %s\n' "${payment_status}" >&2
  cat "${create_response_file}" >&2
  exit 1
fi

if [[ -z "${payment_id}" || -z "${checkout_session_id}" || -z "${checkout_url}" ]]; then
  printf 'Create response is missing paymentId or checkout metadata.\n' >&2
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

if [[ "$(jq -r '.payment.checkout.url // empty' "${get_response_file}")" != "${checkout_url}" ]]; then
  printf 'Expected GET /payments to preserve the hosted checkout url.\n' >&2
  cat "${get_response_file}" >&2
  exit 1
fi

cat > "${summary_file}" <<EOF
PAYMENT_ID=${payment_id}
PAYMENT_STATUS=${payment_status}
PAYMENT_AMOUNT_CENTS=${amount_cents}
PAYMENT_METHOD=${payment_method}
PAYMENTS_STATUS_URL=${PAYMENTS_API_URL}/payments/${payment_id}
CHECKOUT_SESSION_ID=${checkout_session_id}
CHECKOUT_URL=${checkout_url}
CHECKOUT_EXPIRES_AT=${checkout_expires_at}
IDEMPOTENCY_KEY=${idempotency_key}
EOF

printf '\nHosted checkout payment created successfully.\n'
printf 'Artifact directory: %s\n' "${artifact_dir}"
printf 'Payment ID: %s\n' "${payment_id}"
printf 'Payment method: %s\n' "${payment_method}"
printf 'Amount (cents): %s\n' "${amount_cents}"
printf 'Status: %s\n' "${payment_status}"
printf 'Checkout session: %s\n' "${checkout_session_id}"
printf 'Checkout expires at: %s\n' "${checkout_expires_at:-n/a}"
printf '\nOpen the hosted checkout url below and complete the payment manually:\n\n'
printf '%s\n\n' "${checkout_url}"
printf 'Then verify webhook processing with:\n'
printf 'PAYMENT_ID=%q bash scripts/test-payments-webhook.sh\n' "${payment_id}"
