#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/payments-env.sh"
require_command node pnpm aws
require_env ADMIN_AUTHORIZATION
load_payments_stack_outputs
print_env_summary "WhatsApp RSVP automatic send"
pnpm exec tsx "${SCRIPT_DIR}/lib/whatsapp-rsvp-auto-send.ts" "$@"
