#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODULE_DIR="${REPO_ROOT}/infra/opentofu/sentry"

source "${SCRIPT_DIR}/landing-env.sh"

if [[ ! -d "${MODULE_DIR}" ]]; then
  printf 'Missing OpenTofu module: %s\n' "${MODULE_DIR}" >&2
  exit 1
fi

if [[ ! -d "${MODULE_DIR}/.terraform" ]]; then
  printf 'Sentry OpenTofu module is not initialized. Run `pnpm opentofu:sentry:init` first.\n' >&2
  exit 1
fi

SENTRY_DSN="$(
  tofu -chdir="${MODULE_DIR}" output -raw backend_dsn_public
)"
export SENTRY_DSN

SENTRY_BACKEND_PROJECT_SLUG="$(
  tofu -chdir="${MODULE_DIR}" output -raw backend_project_slug
)"
export SENTRY_BACKEND_PROJECT_SLUG

printf 'export SENTRY_DSN=%q\n' "${SENTRY_DSN}"
printf 'export SENTRY_BACKEND_PROJECT_SLUG=%q\n' "${SENTRY_BACKEND_PROJECT_SLUG}"
