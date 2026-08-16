#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/payments-env.sh"

require_command node pnpm aws
if [[ "${STAGE}" != "dev" ]]; then
  printf 'Refusing to send a WhatsApp template outside the dev stage.\n' >&2
  exit 1
fi
require_env WHATSAPP_PHONE_NUMBER_ID

export WEDDING_TABLE_NAME="${WEDDING_TABLE_NAME:-$(cloudformation_output "${PAYMENTS_STACK_NAME}" "WeddingTableName")}"
export APP_SECRET_ARN="${APP_SECRET_ARN:-$(cloudformation_output "${PAYMENTS_STACK_NAME}" "AppSecretArn")}"

print_env_summary "Sending a WhatsApp template"
printf '  template source: active DynamoDB version\n'
printf '  external side effect: one irreversible WhatsApp message\n'
pnpm exec tsx "${SCRIPT_DIR}/lib/send-whatsapp-template.ts" "$@"
