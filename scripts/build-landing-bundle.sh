#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

source "${SCRIPT_DIR}/landing-env.sh"

cd "${REPO_ROOT}"

rm -rf apps/web/dist

export_public_web_env
print_env_summary "Building landing bundle"
pnpm --filter @brimax/web build

required_files=(
  apps/web/dist/index.html
)

for file in "${required_files[@]}"; do
  if [[ ! -f "${file}" ]]; then
    printf 'Missing landing bundle artifact: %s\n' "${file}" >&2
    exit 1
  fi
done

printf 'Landing bundle ready at %s\n' "${REPO_ROOT}/apps/web/dist"
