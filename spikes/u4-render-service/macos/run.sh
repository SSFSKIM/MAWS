#!/usr/bin/env bash
# U4's macOS half, run on a Mac other than the owner's MacBook (the mini's macOS guest through CI-opt): the repo's
# pinned Electron, windowless, rendering the same fixture as the Linux half (../linux/main.cjs) under four conditions
# that a render service owned by mawsd meets: (R1) started from a shell in the GUI session; (R3) R1 with the Dock icon
# hidden through the activation policy (the probe's --accessory); (R2) the production tree under launchd in the user's
# GUI domain, a plain-Node parent (the app binary run as Node, what a LaunchAgent-run mawsd is) bootstrapped as a job
# with RunAtLoad and no KeepAlive, spawning the Electron probe as its windowless child (parent.cjs); (R2b) the fallback
# the execution document names if R2 fails to reach ready: Electron itself as the job. Each launchd job runs exactly
# once (a `launchctl submit` job keeps alive and relaunched the probe every 13 s on the first mini run) and is booted
# out after its result. Each run records the capture, the PDF, the idle memory of the process tree and whether a Dock
# icon showed, and keeps its Chromium profile under its own result directory (never ~/Library/Application Support).
# Results under spikes/u4-render-service/macos/results/ (gitignored by the harness's test-results rule; copy them into
# the findings).
#
#   cd <worktree> && pnpm install --frozen-lockfile && bash spikes/u4-render-service/macos/run.sh
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
electron=$repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
results=$here/results
probe=$here/probe
uid=$(id -u)
mkdir -p "$results" "$probe"
log() { printf '[u4 %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$results/run.log" >&2; }
[[ -x $electron ]] || { log "no Electron binary at $electron (pnpm install first)"; exit 1; }
cp "$here/../linux/main.cjs" "$here/../linux/fixture.html" "$here/parent.cjs" "$probe/"
cp "$repo/src/artifacts/types/design_system/defaults/official/assets/NotoSerifKR-Regular-full.woff2" "$probe/"
log "electron $("$electron" --version 2>/dev/null | tr -d '\n') on $(sw_vers -productVersion) $(uname -m); user $(id -un) uid $uid; GUI session: $(launchctl print gui/$uid 2>/dev/null | head -1)"

summary() { node -e "try{const r=require('$1/result.json');console.log(r.steps.length+' steps, '+r.errors.length+' errors, last: '+(r.steps.at(-1)?.name??'none'))}catch{console.log('no result.json')}"; }

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
  echo "$code" >"$out/exit.txt"; echo "$(( $(date +%s) - started )) s" >"$out/wall-s.txt"
  log "run $name: exit $code after $(cat "$out/wall-s.txt"); $(summary "$out")"
}

# R1: from this shell (the GUI session), as the app would be started by a mawsd that an app started (a private daemon)
run r1-shell-windowless 120 "$electron" "$probe/main.cjs"
# R3: the Dock icon hidden before ready (the render host's own line; the probe's --accessory switch)
run r3-shell-accessory 120 "$electron" "$probe/main.cjs" --accessory

# A launchd job in gui/<uid> that runs once: a plist with RunAtLoad and KeepAlive false, bootstrapped, awaited on its
# result.json's last step (or 150 s), then booted out; `launchctl print` of the job is kept before the bootout. The
# environment is launchd's own plus what the plist names: HOME and PATH for the parent, ELECTRON_RUN_AS_NODE for the
# Node parent alone (its child deletes it, parent.cjs).
bootstrap() {
  local name=$1 node_parent=$2; shift 2
  local out=$results/$name; rm -rf "$out"; mkdir -p "$out"
  local label=dev.maws.u4probe.$name
  local plist=$out/$label.plist
  launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "<key>Label</key><string>$label</string>"
    echo '<key>ProgramArguments</key><array>'
    for arg in "$@" --accessory --out "$out" --fixture "$probe"; do printf '<string>%s</string>\n' "$(printf '%s' "$arg" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')"; done
    echo '</array>'
    echo '<key>EnvironmentVariables</key><dict>'
    echo "<key>HOME</key><string>$HOME</string>"
    echo "<key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>"
    [[ $node_parent == node ]] && echo '<key>ELECTRON_RUN_AS_NODE</key><string>1</string>'
    echo '</dict>'
    echo '<key>RunAtLoad</key><true/>'
    echo '<key>KeepAlive</key><false/>'
    echo '<key>ProcessType</key><string>Interactive</string>'
    echo "<key>StandardOutPath</key><string>$out/stdout.txt</string>"
    echo "<key>StandardErrorPath</key><string>$out/stderr.txt</string>"
    echo '</dict></plist>'
  } >"$plist"
  log "run $name: launchctl bootstrap gui/$uid $plist: $*"
  local started=$(date +%s)
  if ! launchctl bootstrap "gui/$uid" "$plist" 2>"$out/bootstrap.txt"; then log "run $name: bootstrap failed: $(cat "$out/bootstrap.txt")"; return; fi
  for i in $(seq 1 150); do [[ -s $out/result.json ]] && grep -q 'memory idle 10 s' "$out/result.json" && break; sleep 1; done
  sleep 2
  launchctl print "gui/$uid/$label" >"$out/launchctl-print.txt" 2>&1 || true
  launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
  echo "$(( $(date +%s) - started )) s" >"$out/wall-s.txt"
  local runs; runs=$(grep -E '^[[:space:]]*runs = ' "$out/launchctl-print.txt" 2>/dev/null | head -1 | tr -d '\t')
  log "run $name: after $(cat "$out/wall-s.txt"); $(summary "$out"); launchd says ${runs:-runs = ?}"
}
# R2: the production tree: the Node parent is the job, the Electron probe its child
bootstrap r2-launchd-node-parent node "$electron" "$probe/parent.cjs" "$electron" "$probe/main.cjs"
# R2b: the fallback: the Electron probe is the job
bootstrap r2b-launchd-electron-direct electron "$electron" "$probe/main.cjs"

# The idle cost of a windowless Electron that has only reached ready (what a single-process mawsd would pay at all times)
cat >"$probe/idle.cjs" <<'EOF'
const { app } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'idle-userData'));
if (process.argv.includes('--accessory')) app.setActivationPolicy('accessory');
app.whenReady().then(() => { if (process.argv.includes('--accessory')) app.dock?.hide(); setInterval(() => {}, 1000); });
EOF
"$electron" "$probe/idle.cjs" --accessory >/dev/null 2>&1 & pid=$!
sleep 15
{ echo "windowless Electron at ready, accessory policy, idle 15 s"; ps -o pid,ppid,rss,command -p "$pid" $(pgrep -P "$pid" | tr '\n' ' ') 2>/dev/null | cut -c1-160; echo "tree rss KiB: $(ps -o rss= -p "$pid" $(pgrep -P "$pid" | tr '\n' ' ') 2>/dev/null | awk '{s+=$1} END {print s}')"; } >"$results/idle-electron-ready.txt" 2>&1
# proc_pid_rusage's physical footprint, the number acceptance 14 reads (test/support/daemon-idle.ts's reader): the
# process's own `phys_footprint:` line of /usr/bin/footprint, never its per-region rows (the GPU helper's first row
# reading "Owned physical footprint (unmapped) (graphics)" matched the first reader); summed in KiB over the tree.
node -e "
const {execFileSync}=require('node:child_process');
const pids=[$pid,...execFileSync('pgrep',['-P','$pid']).toString().trim().split('\n').filter(Boolean)];
const kib=(n,u)=>u==='KB'?n:u==='MB'?n*1024:u==='GB'?n*1024*1024:u==='B'?n/1024:NaN;
let sum=0;
for(const p of pids){
  try{
    const text=execFileSync('/usr/bin/footprint',['-p',String(p)],{stdio:['ignore','pipe','ignore']}).toString();
    const m=/^\s*\d*\s*phys_footprint:\s*([\d.]+)\s*(B|KB|MB|GB)\b/m.exec(text);
    if(!m){console.log(p,'no phys_footprint line');continue;}
    const k=kib(Number(m[1]),m[2]); sum+=k; console.log(p,'phys_footprint',Math.round(k),'KiB ('+m[1]+' '+m[2]+')');
  }catch(e){console.log(p,'footprint tool unavailable:',e.message.split('\n')[0])}
}
console.log('tree phys_footprint KiB:',Math.round(sum));
" >>"$results/idle-electron-ready.txt" 2>&1
kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
ELECTRON_RUN_AS_NODE=1 "$electron" -e 'setInterval(() => {}, 1000)' >/dev/null 2>&1 & pid=$!
sleep 15
{ echo "Electron as Node (mawsd's runtime), idle 15 s"; ps -o pid,rss,command -p "$pid"; /usr/bin/footprint -p "$pid" 2>/dev/null | grep -E '^\s*[0-9]*\s*phys_footprint:' ; } >"$results/idle-electron-as-node.txt" 2>&1
kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null

# Which PDF fonts were embedded, where poppler is present (brew install poppler); otherwise the result.json's counts stand
for r in r1-shell-windowless r2-launchd-node-parent r2b-launchd-electron-direct r3-shell-accessory; do
  for f in offscreen hidden; do pdf=$results/$r/$f.pdf; [[ -s $pdf ]] && command -v pdffonts >/dev/null && { pdfinfo "$pdf"; pdffonts "$pdf"; } >"$results/pdf-$r-$f.txt" 2>&1; done
done
log "done; results under $results"
