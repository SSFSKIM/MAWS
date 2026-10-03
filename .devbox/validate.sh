#!/usr/bin/env bash
# MAWS's automated checks for `devenv validate maws`: typecheck, lint and the unit suites — no
# Electron window, no model calls (the live and e2e suites are in validation.md). macOS only.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname -s)" != Darwin ]; then
  echo "validate: MAWS is a macOS Electron app; nothing checked on $(uname -s)"
  exit 0
fi

step() { printf '\n== %s\n' "$*"; }
step typecheck; pnpm typecheck
step lint;      pnpm lint
step "unit tests"; pnpm test
