#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/payments-env.sh"

require_command curl node

if [[ "${STAGE}" != "prod" && "${STAGE}" != "dev" ]]; then
  printf 'Skipping Asaas webhook sync for STAGE=%s. Only prod and dev are managed.\n' "${STAGE}"
  exit 0
fi

require_env ROOT_DOMAIN API_DOMAIN ASAAS_API_KEY ASAAS_WEBHOOK_TOKEN

if ! load_payments_stack_outputs; then
  export PAYMENTS_WEBHOOK_URL="https://${API_DOMAIN}/webhooks/asaas"
fi

export PAYMENTS_WEBHOOK_URL="${PAYMENTS_WEBHOOK_URL:-https://${API_DOMAIN}/webhooks/asaas}"
export ASAAS_API_BASE_URL="${ASAAS_API_BASE_URL:-https://api.asaas.com/v3}"

timeout_seconds="${ASAAS_WEBHOOK_SYNC_WAIT_TIMEOUT_SECONDS:-300}"
poll_interval="${ASAAS_WEBHOOK_SYNC_WAIT_INTERVAL_SECONDS:-5}"
deadline=$(( $(date +%s) + timeout_seconds ))

printf 'Waiting for public webhook endpoint readiness at %s\n' "${PAYMENTS_WEBHOOK_URL}"

while (( $(date +%s) < deadline )); do
  http_status="$(
    curl -sS \
      -o /dev/null \
      -w '%{http_code}' \
      -X OPTIONS \
      "${PAYMENTS_WEBHOOK_URL}" || true
  )"

  if [[ "${http_status}" == "200" || "${http_status}" == "204" ]]; then
    printf 'Webhook endpoint is reachable with HTTP %s.\n' "${http_status}"
    node scripts/asaas-webhook-sync.mjs
    exit 0
  fi

  printf 'Webhook endpoint not ready yet (HTTP %s). Retrying in %ss.\n' "${http_status:-n/a}" "${poll_interval}"
  sleep "${poll_interval}"
done

printf 'Timed out waiting for %s to become reachable.\n' "${PAYMENTS_WEBHOOK_URL}" >&2
exit 1
