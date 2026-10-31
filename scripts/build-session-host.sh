#!/usr/bin/env bash
# Builds maws-session-host (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M1; Interfaces §H) from
# native/session-host/ for darwin-arm64, linux-x64 and linux-arm64 into native/session-host/prebuilds/<target>/, the
# prebuilds committed beside their source (native/peer-auth's precedent). Std-only Go with cgo off, so one machine
# builds all three and the builds are the same bytes on any build host under -trimpath; scripts/check-session-host.sh
# rebuilds them in CI and compares. Refuses any Go but native/session-host/go.version's.
# Usage: scripts/build-session-host.sh [output-dir]   (default native/session-host/prebuilds)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/native/session-host"
out="${1:-$src/prebuilds}"
want="go$(tr -d '[:space:]' < "$src/go.version")"
have="$(GOTOOLCHAIN=local go env GOVERSION 2>/dev/null || true)"
if [ "$have" != "$want" ]; then
  echo "build-session-host: needs $want (native/session-host/go.version) first on PATH, found ${have:-no go}." >&2
  exit 1
fi
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

for target in darwin/arm64 linux/amd64 linux/arm64; do
  goos="${target%/*}"
  goarch="${target#*/}"
  name="$goos-${goarch/amd64/x64}"
  mkdir -p "$out/$name"
  bin="$out/$name/maws-session-host"
  # Everything that reaches the bytes is pinned here, never read from the caller's environment.
  (cd "$src" && env GOTOOLCHAIN=local GOFLAGS= GOEXPERIMENT= CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" GOAMD64=v1 GOARM64=v8.0 \
    go build -trimpath -buildvcs=false -ldflags='-s -w' -o "$bin" .)
  echo "$name $(wc -c < "$bin" | tr -d ' ') $(sha256 "$bin")"
done
