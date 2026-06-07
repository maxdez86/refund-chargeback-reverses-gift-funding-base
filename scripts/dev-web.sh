#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export BRIMAX_ENV_FILE="${BRIMAX_ENV_FILE:-.env.dev}"
source "${SCRIPT_DIR}/landing-env.sh"

assert_local_frontend_target_safe
export_public_web_env

export MEDIA_PROXY_TARGET="${MEDIA_PROXY_TARGET:-https://${ROOT_DOMAIN}}"
export API_PROXY_TARGET="${API_PROXY_TARGET:-https://${API_DOMAIN}}"

print_env_summary "Local web dev"
printf '  media proxy target: %s\n' "${MEDIA_PROXY_TARGET}"
printf '  api proxy target: %s\n' "${API_PROXY_TARGET}"

cd "${REPO_ROOT}"
pnpm --filter @brimax/web exec vite --config vite.config.ts --host 0.0.0.0 --port 5173 --strictPort "$@"
