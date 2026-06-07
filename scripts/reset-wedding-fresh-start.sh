#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/payments-env.sh"

require_command node pnpm
require_payments_test_env

export WEDDING_TABLE_NAME="${PAYMENTS_TABLE_NAME}"

mode="${1:-dry-run}"

if [[ "${mode}" == "dry-run" ]]; then
  pnpm exec tsx "$(dirname "$0")/lib/reset-wedding-fresh-start.ts" dry-run
  exit 0
fi

if [[ "${mode}" != "--apply" ]]; then
  printf 'Usage: %s [dry-run|--apply]\n' "$0" >&2
  exit 1
fi

pnpm exec tsx "$(dirname "$0")/lib/reset-wedding-fresh-start.ts" apply
pnpm exec tsx "$(dirname "$0")/seed-dev.ts"
bash "$(dirname "$0")/reset-gift-catalog.sh"
pnpm exec tsx "$(dirname "$0")/lib/reset-wedding-fresh-start.ts" verify
