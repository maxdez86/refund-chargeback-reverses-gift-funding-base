#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/payments-env.sh"
require_command node pnpm aws
export WEDDING_TABLE_NAME="${WEDDING_TABLE_NAME:-$(cloudformation_output "${PAYMENTS_STACK_NAME}" "WeddingTableName")}"
export WHATSAPP_QUEUE_URL="${WHATSAPP_QUEUE_URL:-$(cloudformation_output "${PAYMENTS_STACK_NAME}" "WhatsappQueueUrl")}"
print_env_summary "WhatsApp RSVP operation"
printf '  wedding table: %s\n' "${WEDDING_TABLE_NAME}"
printf '  WhatsApp queue: %s\n' "${WHATSAPP_QUEUE_URL}"
pnpm exec tsx "${SCRIPT_DIR}/lib/whatsapp-rsvp-operations.ts" "$@"
