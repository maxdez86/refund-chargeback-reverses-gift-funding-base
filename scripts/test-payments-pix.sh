#!/usr/bin/env bash
set -euo pipefail

PAYMENTS_TEST_PAYMENT_METHOD=PIX bash "$(dirname "$0")/test-payments-checkout.sh"
