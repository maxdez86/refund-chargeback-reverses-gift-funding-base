#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/payments-env.sh"

require_command node pnpm aws

export WEDDING_TABLE_NAME="${WEDDING_TABLE_NAME:-$(cloudformation_output "${PAYMENTS_STACK_NAME}" "WeddingTableName")}"

if [[ "${STAGE}" == "prod" && " $* " == *" --apply "* && " $* " != *" --confirm-prod "* ]]; then
  printf 'Refusing to modify production WhatsApp templates without --confirm-prod.\n' >&2
  exit 1
fi

print_env_summary "Managing WhatsApp templates"
printf '  target table: %s\n' "${WEDDING_TABLE_NAME}"
pnpm exec tsx "${SCRIPT_DIR}/lib/manage-whatsapp-templates.ts" "$@"
