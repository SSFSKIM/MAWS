#!/usr/bin/env bash
# Runs one gate command of .github/workflows/gate.yml with its output in the job's log, then appends the command, its
# result and its count lines (those matching <count-pattern>, colours stripped) to the job's step summary
# (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.2). Exits with the command's status.
# Usage: gate-run.sh <count-pattern> <command> [args…]
set -uo pipefail
pattern=$1
shift
log=$(mktemp)
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
{
  if ((status == 0)); then echo "#### \`$*\` passed"; else echo "#### \`$*\` failed (exit $status)"; fi
  echo '```'
  sed 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log" | grep -E -- "$pattern" || true
  echo '```'
} >>"$GITHUB_STEP_SUMMARY"
exit "$status"
