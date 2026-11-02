#!/usr/bin/env bash
# Rebuilds every committed maws-session-host prebuild from native/session-host/ (scripts/build-session-host.sh, into a
# temp directory) and compares bytes: the prebuilds are what their source builds, under go.version's toolchain
# (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M1; the gate's static job runs it).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prebuilds="$root/native/session-host/prebuilds"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

"$root/scripts/build-session-host.sh" "$scratch" >/dev/null
total=0
matched=0
for target in darwin-arm64 linux-x64 linux-arm64; do
  total=$((total + 1))
  if cmp -s "$prebuilds/$target/maws-session-host" "$scratch/$target/maws-session-host"; then
    matched=$((matched + 1))
  else
    echo "session-host: $target differs from its source's build (rebuild with \`pnpm build:session-host\` and commit)" >&2
  fi
done
echo "session-host: $matched of $total prebuilds match their source"
[ "$matched" -eq "$total" ]
