#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/payments-env.sh"

mode="dry-run"
confirm_prod="false"

for arg in "$@"; do
  case "${arg}" in
    --apply)
      mode="apply"
      ;;
    --confirm-prod)
      confirm_prod="true"
      ;;
    dry-run)
      mode="dry-run"
      ;;
    *)
      printf 'Usage: %s [dry-run|--apply] [--confirm-prod]\n' "$0" >&2
      exit 1
      ;;
  esac
done

require_command node pnpm aws

if [[ -z "${WEDDING_TABLE_NAME:-}" ]]; then
  if [[ -n "${PAYMENTS_TABLE_NAME:-}" ]]; then
    export WEDDING_TABLE_NAME="${PAYMENTS_TABLE_NAME}"
  else
    WEDDING_TABLE_NAME="$(cloudformation_output "${PAYMENTS_STACK_NAME}" "WeddingTableName")"
    export WEDDING_TABLE_NAME
  fi
fi

if [[ "${STAGE}" == "prod" && "${mode}" == "apply" && "${confirm_prod}" != "true" ]]; then
  printf 'Refusing to apply production import without --confirm-prod.\n' >&2
  printf 'Run: BRIMAX_ENV_FILE=.env bash %s --apply --confirm-prod\n' "${0}" >&2
  exit 1
fi

print_env_summary "Importing new invitations"
printf '  target table: %s\n' "${WEDDING_TABLE_NAME}"
printf '  mode: %s\n' "${mode}"

if [[ "${mode}" == "apply" ]]; then
  pnpm exec tsx "${SCRIPT_DIR}/lib/import-new-invitations.ts" --apply
else
  pnpm exec tsx "${SCRIPT_DIR}/lib/import-new-invitations.ts"
fi
