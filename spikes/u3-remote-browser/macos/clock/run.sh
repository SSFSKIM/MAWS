#!/usr/bin/env bash
# The clock probe (P5 O17 M8; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8): whether one cheap, supported
# remedy lifts an offscreen tab's throttled clocks (U3: about 110 ms click to paint, 100 ms timers near 6 Hz). On a Mac
# other than the owner's MacBook (the mini through CI-opt, the architect's go): the repository's pinned Electron runs
# probe.cjs windowless under the accessory policy (no Dock icon), one process per variant (baseline, fps30, fps60,
# beginframe; probe.cjs says what each is), so no variant's frame rate, invalidate loop or process state carries into the
# next and a stuck one is killed by its guard without costing the others. Each writes results/<variant>.json;
# results/summary.json is the one-page reading with a mechanical `verdict` (summarize.mjs); results/run.log the run.
# Raises no dialog (no permission is asked; an error in main is recorded, not shown); each variant's Chromium profile
# lives under a /tmp/u3-clock-* scratch dir removed afterwards. At most 20 minutes in all, 120 s per variant.
# A measurement, not a gate; no product code imports anything here.
#
#   cd <worktree> && pnpm install --frozen-lockfile && bash spikes/u3-remote-browser/macos/clock/run.sh
#   CLOCK_VARIANTS=baseline,beginframe bash spikes/u3-remote-browser/macos/clock/run.sh   (a subset)
set -uo pipefail
clock=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$clock/../../../.." && pwd)
results=$clock/results
electron=$repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
rm -rf "$results"
mkdir -p "$results"
log() { printf '[clock %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$results/run.log" >&2; }
[[ $(uname -s) == Darwin ]] || { log "macOS only (this is $(uname -s))"; exit 1; }
[[ -x $electron ]] || { log "no Electron binary at $electron (pnpm install first)"; exit 1; }
unset ELECTRON_RUN_AS_NODE
pinned=$(node -p "require('$repo/node_modules/electron/package.json').version" 2>&1)
log "electron pinned $pinned, binary $("$electron" --version 2>/dev/null | tr -d '\n') on macOS $(sw_vers -productVersion) $(uname -m); node $(node --version)"

scratch=$(mktemp -d /tmp/u3-clock-XXXXXX)
trap 'pkill -f "$scratch" >/dev/null 2>&1; rm -rf "$scratch"' EXIT
deadline=$((SECONDS + 1200)) # the whole run's bound
per_variant=120
variants=${CLOCK_VARIANTS:-baseline,fps30,fps60,beginframe}
for variant in ${variants//,/ }; do
  left=$((deadline - SECONDS - 30)) # 30 s kept for the summary
  if ((left < 30)); then
    log "variant $variant: skipped, the run's 20 minutes are spent"
    continue
  fi
  guard_s=$((left < per_variant ? left : per_variant))
  log "variant $variant (guard ${guard_s}s)"
  "$electron" "$clock/probe.cjs" --variant "$variant" --out "$results/$variant.json" --user-data "$scratch/$variant" \
    >"$results/$variant.stdout.txt" 2>"$results/$variant.stderr.txt" &
  pid=$!
  (
    sleep "$guard_s"
    echo "guard: killed after ${guard_s}s" >>"$results/$variant.stderr.txt"
    kill -TERM "$pid" 2>/dev/null
    sleep 5
    kill -KILL "$pid" 2>/dev/null
  ) &
  guard=$!
  wait "$pid"
  code=$?
  pkill -P "$guard" >/dev/null 2>&1
  kill "$guard" 2>/dev/null
  wait "$guard" 2>/dev/null
  pkill -f "$scratch/$variant" >/dev/null 2>&1 || true # helpers (renderer, GPU) carry the profile path
  log "variant $variant: exit $code$([[ -s $results/$variant.json ]] || printf ', no result file')"
done

if node "$clock/summarize.mjs" "$results" >"$results/summary.json.tmp"; then
  mv "$results/summary.json.tmp" "$results/summary.json"
  log "verdict: $(node -p "require('$results/summary.json').verdict.reading")"
else
  log "summarize failed"
  exit 1
fi
log "done in ${SECONDS}s; $results/summary.json"
