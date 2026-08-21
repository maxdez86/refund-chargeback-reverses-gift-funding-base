#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/landing-env.sh"

if ! command -v pnpm >/dev/null 2>&1; then
  printf 'Missing required command: pnpm\n' >&2
  exit 1
fi

require_env WHATSAPP_ACCESS_TOKEN

print_env_summary "Exporting WhatsApp templates from the Meta Graph API"
printf '  side effects: none (read-only Graph API GETs)\n'
pnpm exec tsx "${SCRIPT_DIR}/lib/export-whatsapp-templates.ts" "$@"
