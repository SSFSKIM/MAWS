#!/usr/bin/env bash
# The unit files with macOS-only cases (§6 and Decision Log 24 of the gate-offload spec).
# Usage: scripts/darwin-unit-files.sh [repository-root]
set -euo pipefail
cd "${1:-.}"
if ! files=$(grep -rlE "platform !== 'darwin'" src test --include='*.test.ts' --include='*.test.tsx' | sort); then
  echo "darwin-unit-files: no guarded test files found in $PWD" >&2
  exit 1
fi
printf '%s\n' "$files"
