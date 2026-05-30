#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/payments-env.sh"

require_command node
require_payments_test_env

export WEDDING_TABLE_NAME="${PAYMENTS_TABLE_NAME}"

mode="${1:-dry-run}"

if [[ "${mode}" == "dry-run" ]]; then
  node --experimental-strip-types "$(dirname "$0")/lib/reset-wedding-fresh-start.ts" dry-run
  exit 0
fi

if [[ "${mode}" != "--apply" ]]; then
  printf 'Usage: %s [dry-run|--apply]\n' "$0" >&2
  exit 1
fi

node --experimental-strip-types "$(dirname "$0")/lib/reset-wedding-fresh-start.ts" apply
node --experimental-strip-types "$(dirname "$0")/seed-dev.ts"
bash "$(dirname "$0")/reset-gift-catalog.sh"
node --experimental-strip-types "$(dirname "$0")/lib/reset-wedding-fresh-start.ts" verify
