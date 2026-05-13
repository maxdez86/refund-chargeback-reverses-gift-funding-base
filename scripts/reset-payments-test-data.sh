#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/payments-env.sh"

require_command aws jq node
require_payments_test_env

mapfile -t _aws_args < <(aws_args)

items_json="$(
  aws dynamodb scan \
    --table-name "${PAYMENTS_TABLE_NAME}" \
    "${_aws_args[@]}" \
    --projection-expression "PK, SK" \
    --filter-expression "begins_with(PK, :payment) OR begins_with(PK, :idem) OR PK = :webhook OR begins_with(PK, :gift)" \
    --expression-attribute-values '{":payment":{"S":"PAYMENT#"},":idem":{"S":"IDEMPOTENCY#"},":webhook":{"S":"WEBHOOK#asaas"},":gift":{"S":"GIFT#"}}' \
    --output json
)"

count="$(printf '%s' "${items_json}" | jq '.Items | length')"

if [[ "${count}" == "0" ]]; then
  printf 'No payment test data found in %s.\n' "${PAYMENTS_TABLE_NAME}"
  exit 0
fi

printf '%s' "${items_json}" | jq -c '.Items[]' | while IFS= read -r key_item; do
  aws dynamodb delete-item \
    --table-name "${PAYMENTS_TABLE_NAME}" \
    "${_aws_args[@]}" \
    --key "{\"PK\":$(printf '%s' "${key_item}" | jq '.PK'),\"SK\":$(printf '%s' "${key_item}" | jq '.SK')}" \
    >/dev/null
done

printf 'Deleted %s payment-related and gift-state test items from %s.\n' "${count}" "${PAYMENTS_TABLE_NAME}"

node --experimental-strip-types "$(dirname "$0")/lib/reset-gift-state.ts"
