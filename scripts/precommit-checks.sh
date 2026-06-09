#!/usr/bin/env bash

set -euo pipefail

printf 'Running pre-commit validation: lint auto-fix\n'
pnpm lint:fix

printf '\nRunning pre-commit validation: lint check\n'
pnpm lint

printf '\nRunning pre-commit validation: typecheck\n'
pnpm typecheck

printf '\nRunning pre-commit validation: test\n'
pnpm test

printf '\nPre-commit validation completed successfully.\n'
