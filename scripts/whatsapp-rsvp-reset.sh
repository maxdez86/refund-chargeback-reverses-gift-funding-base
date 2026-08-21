#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/payments-env.sh"
require_command node pnpm aws

export WEDDING_TABLE_NAME="${WEDDING_TABLE_NAME:-$(cloudformation_output "${PAYMENTS_STACK_NAME}" "WeddingTableName")}"
print_env_summary "WhatsApp RSVP flow reset"
printf '  wedding table: %s\n' "${WEDDING_TABLE_NAME}"
pnpm exec tsx "${SCRIPT_DIR}/lib/whatsapp-rsvp-reset.ts" "$@"
