#!/usr/bin/env bash
# U4's macOS half, run on a Mac other than the owner's MacBook (the mini's macOS guest through CI-opt): the repo's
# pinned Electron, windowless, rendering the same fixture as the Linux half (../linux/main.cjs) under three conditions
# that a render service owned by mawsd meets: (R1) started from a shell in the GUI session; (R2) started by launchd as a
# transient job in the user's GUI domain (what a LaunchAgent-run mawsd's child is: `launchctl submit` into gui/<uid>);
# (R3) R1 with the Dock icon hidden through the activation policy (the probe's --accessory). Each run records the
# capture, the PDF, the idle memory of the process tree and whether a Dock icon showed. Results under
# spikes/u4-render-service/macos/results/ (gitignored by the harness's test-results rule; copy them into the findings).
#
#   cd <worktree> && pnpm install --frozen-lockfile && bash spikes/u4-render-service/macos/run.sh
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
electron=$repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
results=$here/results
probe=$here/probe
mkdir -p "$results" "$probe"
log() { printf '[u4 %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$results/run.log" >&2; }
[[ -x $electron ]] || { log "no Electron binary at $electron (pnpm install first)"; exit 1; }
cp "$here/../linux/main.cjs" "$here/../linux/fixture.html" "$probe/"
cp "$repo/src/artifacts/types/design_system/defaults/official/assets/NotoSerifKR-Regular-full.woff2" "$probe/"
log "electron $("$electron" --version 2>/dev/null | tr -d '\n') on $(sw_vers -productVersion) $(uname -m); user $(id -un) uid $(id -u); GUI session: $(launchctl print gui/$(id -u) 2>/dev/null | head -1)"

run() {
  local name=$1 timeout_s=$2; shift 2
  local out=$results/$name
  rm -rf "$out"; mkdir -p "$out"
  log "run $name: $*"
  local started=$(date +%s)
  ( "$@" --out "$out" --fixture "$probe" >"$out/stdout.txt" 2>"$out/stderr.txt" ) &
  local pid=$!
  ( sleep "$timeout_s"; kill "$pid" 2>/dev/null ) & local guard=$!
  wait "$pid"; local code=$?
  kill "$guard" 2>/dev/null
  echo "$code" >"$out/exit.txt"; echo "$(( $(date +%s) - started ))" >"$out/wall-s.txt"
  log "run $name: exit $code after $(cat "$out/wall-s.txt") s"
}

# R1: from this shell (the GUI session), as the app would be started by a mawsd that an app started (a private daemon)
run r1-shell-windowless 120 "$electron" "$probe/main.cjs"
# R3: the Dock icon hidden before ready (the render host's own line; the probe's --accessory switch)
run r3-shell-accessory 120 "$electron" "$probe/main.cjs" --accessory
# R2: under launchd in the GUI domain, as a child of a LaunchAgent-run mawsd is: a transient job, its environment launchd's
out=$results/r2-launchd-gui-domain; rm -rf "$out"; mkdir -p "$out"
label=dev.maws.u4probe.$$
log "run r2: launchctl submit -l $label into gui/$(id -u)"
launchctl submit -l "$label" -o "$out/stdout.txt" -e "$out/stderr.txt" -- "$electron" "$probe/main.cjs" --accessory --out "$out" --fixture "$probe" 2>"$out/submit.txt"
for i in $(seq 1 120); do [[ -s $out/result.json ]] && grep -q 'memory idle 10 s' "$out/result.json" && break; sleep 1; done
sleep 2; launchctl remove "$label" 2>/dev/null || true
[[ -s $out/result.json ]] && log "run r2: result.json written" || log "run r2: no result.json (see $out/stderr.txt and submit.txt)"

# The idle cost of a windowless Electron that has only reached ready (what a single-process mawsd would pay at all times)
cat >"$probe/idle.cjs" <<'EOF'
const { app } = require('electron');
if (process.argv.includes('--accessory')) app.setActivationPolicy('accessory');
app.whenReady().then(() => { if (process.argv.includes('--accessory')) app.dock?.hide(); setInterval(() => {}, 1000); });
EOF
"$electron" "$probe/idle.cjs" --accessory >/dev/null 2>&1 & pid=$!
sleep 15
{ echo "windowless Electron at ready, accessory policy, idle 15 s"; ps -o pid,ppid,rss,command -p "$pid" $(pgrep -P "$pid" | tr '\n' ' ') 2>/dev/null; echo "tree rss KiB: $(ps -o rss= -p "$pid" $(pgrep -P "$pid" | tr '\n' ' ') 2>/dev/null | awk '{s+=$1} END {print s}')"; } >"$results/idle-electron-ready.txt" 2>&1
# proc_pid_rusage's physical footprint, the number acceptance 14 reads (test/support/daemon-idle.ts's reader)
node -e "const {execFileSync}=require('node:child_process');const pids=[$pid,...execFileSync('pgrep',['-P','$pid']).toString().trim().split('\n').filter(Boolean)];for(const p of pids){try{console.log(p, execFileSync('/usr/bin/footprint',['-p',String(p)],{stdio:['ignore','pipe','ignore']}).toString().split('\n').find(l=>/phys_footprint|Physical footprint/i.test(l))??'(no footprint line)')}catch(e){console.log(p,'footprint tool unavailable:',e.message.split('\n')[0])}}" >>"$results/idle-electron-ready.txt" 2>&1
kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
ELECTRON_RUN_AS_NODE=1 "$electron" -e 'setInterval(() => {}, 1000)' >/dev/null 2>&1 & pid=$!
sleep 15
{ echo "Electron as Node (mawsd's runtime), idle 15 s"; ps -o pid,rss,command -p "$pid"; } >"$results/idle-electron-as-node.txt" 2>&1
kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null

# Which PDF fonts were embedded, where poppler is present (brew install poppler); otherwise the result.json's counts stand
for r in r1-shell-windowless r2-launchd-gui-domain r3-shell-accessory; do
  for f in offscreen hidden; do pdf=$results/$r/$f.pdf; [[ -s $pdf ]] && command -v pdffonts >/dev/null && { pdfinfo "$pdf"; pdffonts "$pdf"; } >"$results/pdf-$r-$f.txt" 2>&1; done
done
log "done; results under $results"
