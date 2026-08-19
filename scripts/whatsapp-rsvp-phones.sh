#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

source "${SCRIPT_DIR}/payments-env.sh"

require_command node pnpm aws

# The TypeScript entrypoint is the authority on argument validation; this loop only
# reads what the wrapper itself needs for the stage guard and the env summary.
batch_args=("$@")
csv_path=""
mode="dry-run"
confirm_prod="false"

index=0
while [[ ${index} -lt ${#batch_args[@]} ]]; do
  case "${batch_args[${index}]}" in
    --csv)
      csv_path="${batch_args[$((index + 1))]:-}"
      index=$((index + 2))
      ;;
    --limit)
      index=$((index + 2))
      ;;
    --apply)
      mode="apply"
      index=$((index + 1))
      ;;
    --confirm-prod)
      confirm_prod="true"
      index=$((index + 1))
      ;;
    *)
      index=$((index + 1))
      ;;
  esac
done

if [[ -z "${csv_path}" || "${csv_path}" == --* ]]; then
  printf 'Usage: %s --csv <file> [dry-run|--apply] [--confirm-prod] [--limit <n>] [--full]\n' "$0" >&2
  exit 1
fi

if [[ ! -f "${csv_path}" ]]; then
  printf 'CSV not found: %s\n' "${csv_path}" >&2
  exit 1
fi

resolved_csv="$(cd "$(dirname "${csv_path}")" && pwd)/$(basename "${csv_path}")"

if [[ "${STAGE}" == "prod" && "${mode}" == "apply" && "${confirm_prod}" != "true" ]]; then
  printf 'Refusing to apply a production phone batch without --confirm-prod.\n' >&2
  printf 'Run: BRIMAX_ENV_FILE=.env bash %s --csv %s --apply --confirm-prod\n' "${0}" "${csv_path}" >&2
  exit 1
fi

# The CSV holds real phone numbers. .tmp/ is gitignored; anywhere else in the repo is not.
if [[ "${resolved_csv}" == "${REPO_ROOT}/"* && "${resolved_csv}" != "${REPO_ROOT}/.tmp/"* ]]; then
  printf 'Warning: %s is inside the repository but outside .tmp/. Keep guest phone data out of Git.\n' \
    "${resolved_csv}" >&2
fi

export WEDDING_TABLE_NAME="${WEDDING_TABLE_NAME:-$(cloudformation_output "${PAYMENTS_STACK_NAME}" "WeddingTableName")}"

print_env_summary "WhatsApp RSVP phone batch"
printf '  target table: %s\n' "${WEDDING_TABLE_NAME}"
printf '  csv: %s\n' "${resolved_csv}"
printf '  mode: %s\n' "${mode}"

pnpm exec tsx "${SCRIPT_DIR}/lib/whatsapp-rsvp-phones.ts" "${batch_args[@]}"
