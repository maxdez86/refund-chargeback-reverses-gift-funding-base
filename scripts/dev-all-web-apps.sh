#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${REPO_ROOT}/.tmp/dev-all-web-apps"

export BRIMAX_ENV_FILE="${BRIMAX_ENV_FILE:-.env.dev}"
source "${SCRIPT_DIR}/landing-env.sh"

assert_local_frontend_target_safe
export_public_web_env

export MEDIA_PROXY_TARGET="${MEDIA_PROXY_TARGET:-https://${ROOT_DOMAIN}}"
export API_PROXY_TARGET="${API_PROXY_TARGET:-https://${API_DOMAIN}}"

mkdir -p "${LOG_DIR}"

apps=(
  "web|5173|pnpm --filter @brimax/web exec vite --config vite.config.ts --host 0.0.0.0 --port 5173 --strictPort"
)

pids=()

cleanup() {
  local pid
  for pid in "${pids[@]:-}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts=60

  while (( attempts > 0 )); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
    ((attempts--))
  done

  printf 'Timed out waiting for %s at %s\n' "${name}" "${url}" >&2
  return 1
}

open_url() {
  local url="$1"

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${url}" >/dev/null 2>&1 || true
    return 0
  fi

  if command -v open >/dev/null 2>&1; then
    open "${url}" >/dev/null 2>&1 || true
    return 0
  fi

  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "${url}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "${REPO_ROOT}"

print_env_summary "Local web dev"
printf '  media proxy target: %s\n' "${MEDIA_PROXY_TARGET}"
printf '  api proxy target: %s\n' "${API_PROXY_TARGET}"
printf 'Logs: %s\n' "${LOG_DIR}"

for app in "${apps[@]}"; do
  IFS='|' read -r name port cmd <<<"${app}"
  log_file="${LOG_DIR}/${name}.log"

  printf 'Starting %-6s http://127.0.0.1:%s\n' "${name}" "${port}"
  bash -lc "${cmd}" >"${log_file}" 2>&1 &
  pids+=("$!")
done

for app in "${apps[@]}"; do
  IFS='|' read -r name port _ <<<"${app}"
  url="http://127.0.0.1:${port}"
  wait_for_http "${name}" "${url}"
  printf 'Ready    %-6s %s\n' "${name}" "${url}"
done

for app in "${apps[@]}"; do
  IFS='|' read -r _ port _ <<<"${app}"
  open_url "http://127.0.0.1:${port}"
done

printf '\nThe web app is running. Press Ctrl+C to stop it.\n'
wait
