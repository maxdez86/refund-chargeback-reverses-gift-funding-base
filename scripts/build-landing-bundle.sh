#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

rm -rf apps/web/dist

pnpm --filter @brimax/web build
pnpm --filter @brimax/web-v2 build
pnpm --dir apps/web-v3 --filter @workspace/brimax build:prod
npm --prefix apps/web-v4 run build:prod

required_files=(
  apps/web/dist/index.html
  apps/web/dist/v2/index.html
  apps/web/dist/v3/index.html
  apps/web/dist/v4/index.html
)

for file in "${required_files[@]}"; do
  if [[ ! -f "${file}" ]]; then
    printf 'Missing landing bundle artifact: %s\n' "${file}" >&2
    exit 1
  fi
done

printf 'Landing bundle ready at %s\n' "${REPO_ROOT}/apps/web/dist"
