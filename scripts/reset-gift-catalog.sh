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
    --filter-expression "begins_with(PK, :payment) OR begins_with(PK, :idem) OR begins_with(PK, :gift) OR begins_with(PK, :webhook)" \
    --expression-attribute-values '{":payment":{"S":"PAYMENT#"},":idem":{"S":"IDEMPOTENCY#"},":gift":{"S":"GIFT#"},":webhook":{"S":"WEBHOOK#"}}' \
    --output json
)"

count="$(printf '%s' "${items_json}" | jq '.Items | length')"

if [[ "${count}" != "0" ]]; then
  printf '%s' "${items_json}" | jq -c '.Items[]' | while IFS= read -r key_item; do
    aws dynamodb delete-item \
      --table-name "${PAYMENTS_TABLE_NAME}" \
      "${_aws_args[@]}" \
      --key "{\"PK\":$(printf '%s' "${key_item}" | jq '.PK'),\"SK\":$(printf '%s' "${key_item}" | jq '.SK')}" \
      >/dev/null
  done
fi

printf 'Deleted %s payment and gift catalog items from %s.\n' "${count}" "${PAYMENTS_TABLE_NAME}"

node --experimental-strip-types "$(dirname "$0")/lib/seed-gift-catalog.ts"
