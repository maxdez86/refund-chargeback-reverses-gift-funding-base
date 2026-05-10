#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/payments-env.sh"

require_command curl jq
require_payments_test_env
require_env PAYMENT_ID

timeout_seconds="${PAYMENTS_WEBHOOK_WAIT_TIMEOUT_SECONDS:-300}"
poll_interval="${PAYMENTS_WEBHOOK_POLL_INTERVAL_SECONDS:-5}"
deadline=$(( $(date +%s) + timeout_seconds ))

printf 'Polling %s/payments/%s for webhook-driven transitions.\n' "${PAYMENTS_API_URL}" "${PAYMENT_ID}"

while (( $(date +%s) < deadline )); do
  response_file="$(mktemp)"
  http_status="$(
    curl -sS \
      -o "${response_file}" \
      -w '%{http_code}' \
      "${PAYMENTS_API_URL}/payments/${PAYMENT_ID}"
  )"

  if [[ "${http_status}" != "200" ]]; then
    printf 'GET /payments/%s returned HTTP %s while waiting for webhook confirmation.\n' "${PAYMENT_ID}" "${http_status}" >&2
    cat "${response_file}" >&2
    rm -f "${response_file}"
    exit 1
  fi

  status="$(jq -r '.payment.status // empty' "${response_file}")"
  confirmed_on="$(jq -r '.payment.confirmedOn // empty' "${response_file}")"
  received_on="$(jq -r '.payment.receivedOn // empty' "${response_file}")"
  updated_at="$(jq -r '.payment.updatedAt // empty' "${response_file}")"

  printf 'Current status: %s (updatedAt=%s)\n' "${status}" "${updated_at}"

  if [[ "${status}" == "CONFIRMED" || "${status}" == "RECEIVED" ]]; then
    printf '\nPayment webhook flow completed.\n'
    printf 'Payment ID: %s\n' "${PAYMENT_ID}"
    printf 'Status: %s\n' "${status}"
    printf 'Confirmed On: %s\n' "${confirmed_on:-n/a}"
    printf 'Received On: %s\n' "${received_on:-n/a}"
    rm -f "${response_file}"
    exit 0
  fi

  rm -f "${response_file}"
  sleep "${poll_interval}"
done

printf '\nTimed out waiting for payment %s to reach CONFIRMED or RECEIVED.\n' "${PAYMENT_ID}" >&2
printf 'Next steps:\n' >&2
printf '1. Check the Asaas production dashboard webhook delivery log for the payment.\n' >&2
printf '2. Confirm the webhook URL points to %s/webhooks/asaas.\n' "${PAYMENTS_API_URL}" >&2
printf '3. Re-send the event from Asaas and run this script again.\n' >&2
printf '4. Check CloudWatch logs for AsaasWebhookFunction and AsaasWebhookProcessorFunction.\n' >&2
exit 1
