#!/usr/bin/env bash
# U3's macOS half (O5 M7), on a Mac other than the owner's MacBook (the mini through CI-opt): the repository's pinned
# Electron as the render host's tab engine, windowless with the accessory policy (no Dock icon), the peer check through
# the committed darwin-arm64 addon with the driver as the trusted root, in the probe's three tab modes (a hidden window
# with the app's background throttling, the same unthrottled, an offscreen view). Each mode is a driver run
# (../driver.mjs, plain Node, the second process) writing results/<mode>/driver.json; results/summary.json is the
# one-page reading. Raises no dialog: nothing here asks for a permission (no screen recording: the frames are
# Chromium's own), and each run's Chromium profile lives under /tmp/u3-*/ and is removed after it.
#
#   cd <worktree> && pnpm install --frozen-lockfile && bash spikes/u3-remote-browser/macos/run.sh
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$here/../.." && pwd)
results=$here/results
electron=$repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
mkdir -p "$results"
log() { printf '[u3 %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$results/run.log" >&2; }
[[ -x $electron ]] || { log "no Electron binary at $electron (pnpm install first)"; exit 1; }
log "electron $("$electron" --version 2>/dev/null | tr -d '\n') on $(sw_vers -productVersion) $(uname -m); node $(node --version); addon $(ls "$repo/native/peer-auth/prebuilds/darwin-arm64/peer-auth.node" 2>&1)"

node "$here/build.mjs" 2>&1 | tee -a "$results/run.log"
for mode in hidden hidden-unthrottled offscreen; do
  rm -rf "$results/$mode"
  log "mode $mode"
  node "$here/driver.mjs" --out "$results/$mode" --mode "$mode" --repo "$repo" -- "$electron" "$here/build/host.cjs" --accessory 2>"$results/$mode.driver-stderr.txt" &
  pid=$!
  ( sleep 300; kill "$pid" 2>/dev/null ) & guard=$!
  wait "$pid"; code=$?
  kill "$guard" 2>/dev/null
  log "mode $mode: driver exit $code"
  pkill -f "$here/build/host.cjs" >/dev/null 2>&1 || true
done
node "$here/summarize.mjs" "$results" >"$results/summary.json"
log "done; $results/summary.json"
