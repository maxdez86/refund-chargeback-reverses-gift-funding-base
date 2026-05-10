#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/landing-env.sh"

pnpm deploy:backend

if [[ "${STAGE}" != "prod" ]]; then
  printf 'Skipping API DNS apply and Asaas webhook sync for STAGE=%s.\n' "${STAGE}"
  exit 0
fi

pnpm opentofu:api-dns:apply -auto-approve
pnpm asaas:webhook:sync
