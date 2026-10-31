#!/usr/bin/env bash
# U4's Linux half, round 2 (after run.sh's round 1 found that Electron's BrowserWindow needs a display connection for
# GTK even under --headless): the same probe under a virtual X display (Xvfb), with the sandbox, the GPU and the unit
# conditions, the Noto fonts for CJK and emoji, and the idle cost of the shape with Xvfb beside it. Results under
# ~/u4/results2/. Safe to re-run; a failing step never stops the next.
set -uo pipefail
repo=${MAWS_REPO:-$HOME/Developer/GitHub/MAWS}
root=$HOME/u4
results=$root/results2
probe=$root/probe
electron=$root/electron/electron
mkdir -p "$results" "$probe"
log() { printf '[u4r2 %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$results/run.log" >&2; }
record() { local name=$1; shift; { printf '$ %s\n' "$*"; "$@"; printf '\n[exit %s]\n' "$?"; } >"$results/$name.txt" 2>&1; }
[[ -x $electron ]] || { log "no electron at $electron: run run.sh first"; exit 1; }
cp "$repo/spikes/u4-render-service/linux/main.cjs" "$repo/spikes/u4-render-service/linux/fixture.html" "$probe/"

# 1. Xvfb and the fonts a render needs beyond DejaVu.
for p in xvfb fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji; do sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -yq "$p" >>"$results/apt-install.txt" 2>&1 || echo "apt: $p not installed" >>"$results/apt-install.txt"; done
record packages bash -c "dpkg-query -W -f='\${Package} \${Version} \${Installed-Size}\n' xvfb fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-dejavu-core libgtk-3-0t64 libnss3 2>/dev/null"
record fonts bash -c "fc-list : family | sort -u | wc -l; for q in sans-serif serif monospace system-ui ':lang=ko' ':lang=ja' ':lang=zh' emoji; do printf '%-12s -> ' \"\$q\"; fc-match \"\$q\"; done"
sudo -n chown root:root "$root/electron/chrome-sandbox" && sudo -n chmod 4755 "$root/electron/chrome-sandbox"

xvfb=(xvfb-run -a -s "-screen 0 1280x800x24 -nolisten tcp")
run() {
  local name=$1 timeout_s=$2; shift 2
  local out=$results/$name
  rm -rf "$out"; mkdir -p "$out"
  log "run $name: $*"
  local started=$(date +%s%N)
  timeout -k 5 "$timeout_s" "$@" --out "$out" --fixture "$probe" >"$out/stdout.txt" 2>"$out/stderr.txt"
  local code=$?
  echo "$code" >"$out/exit.txt"
  echo "$(( ($(date +%s%N) - started) / 1000000 ))" >"$out/wall-ms.txt"
  log "run $name: exit $code after $(cat "$out/wall-ms.txt") ms; $(node -e "try{const r=require('$out/result.json');console.log('steps '+r.steps.map(s=>s.name+'@'+s.atMs).join(', ')+'; errors '+r.errors.length+' ('+r.errors.map(e=>e.name).join(',')+')')}catch{console.log('no result.json')}")"
  pkill -f "$root/electron/electron" >/dev/null 2>&1 || true
  pkill -f 'Xvfb :' >/dev/null 2>&1 || true
}

# X1: Xvfb, the SUID sandbox, Chromium's own GL fallback
run x1-xvfb-sandbox 120 "${xvfb[@]}" "$electron" "$probe/main.cjs"
# X2: Xvfb, the sandbox, the GPU process off (software compositing)
run x2-xvfb-sandbox-disable-gpu 120 "${xvfb[@]}" "$electron" --disable-gpu "$probe/main.cjs"
# X3: Xvfb, the sandbox, SwiftShader named as the GL
run x3-xvfb-sandbox-swiftshader 120 "${xvfb[@]}" "$electron" --use-gl=angle --use-angle=swiftshader "$probe/main.cjs"
# X4: Xvfb beside --headless (GTK gets its display; Chromium's headless mode does the rest)
run x4-xvfb-headless 120 "${xvfb[@]}" "$electron" --headless "$probe/main.cjs"
# X5: the unit condition: a transient systemd user service running xvfb-run (no session environment)
run x5-unit-xvfb-sandbox 150 systemd-run --user --wait --pipe --collect --quiet -p Environment=HOME="$HOME" "${xvfb[@]}" "$electron" "$probe/main.cjs"
# X6: no sandbox, for the comparison of the cost alone (never the product's flag)
run x6-xvfb-nosandbox 120 "${xvfb[@]}" "$electron" --no-sandbox "$probe/main.cjs"

# 2. The PDFs read back by poppler.
for r in x1-xvfb-sandbox x2-xvfb-sandbox-disable-gpu x4-xvfb-headless x5-unit-xvfb-sandbox; do
  for f in offscreen hidden; do
    pdf=$results/$r/$f.pdf
    [[ -s $pdf ]] || continue
    record "pdf-$r-$f" bash -c "pdfinfo '$pdf'; echo; pdffonts '$pdf'; echo; pdftotext -layout '$pdf' - | head -24"
  done
done

# 3. Idle: Electron at ready under Xvfb (the tree, Xvfb included), and Xvfb alone.
idle_rss() {
  local name=$1; shift
  "$@" >/dev/null 2>&1 &
  local pid=$!
  sleep 12
  { echo "command: $*"; ps -eo pid,ppid,rss,args | grep -E 'electron|Xvfb' | grep -v grep; echo; echo "tree rss KiB: $(ps -eo rss,args | grep -E 'electron|Xvfb' | grep -v grep | awk '{s+=$1} END {print s}')"; } >"$results/idle-$name.txt" 2>&1
  kill "$pid" >/dev/null 2>&1; wait "$pid" 2>/dev/null
  pkill -f "$root/electron/electron" >/dev/null 2>&1 || true; pkill -f 'Xvfb :' >/dev/null 2>&1 || true
}
idle_rss xvfb-alone Xvfb :97 -screen 0 1280x800x24 -nolisten tcp
idle_rss electron-ready-xvfb "${xvfb[@]}" "$electron" "$probe/idle.cjs"
idle_rss electron-ready-xvfb-disable-gpu "${xvfb[@]}" "$electron" --disable-gpu "$probe/idle.cjs"

node - "$results" <<'EOF' >"$results/summary.json"
const fs = require('node:fs'); const path = require('node:path');
const results = process.argv[2];
const runs = {};
for (const name of fs.readdirSync(results)) {
  const dir = path.join(results, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const read = (file) => { try { return fs.readFileSync(path.join(dir, file), 'utf8').trim(); } catch { return null; } };
  let result = null; try { result = JSON.parse(read('result.json')); } catch {}
  runs[name] = { exit: read('exit.txt'), wallMs: read('wall-ms.txt'), stderrTail: (read('stderr.txt') ?? '').split('\n').filter((l) => !/angle_platform_impl|egl_util|gl_display|ERR: Display|gl_ozone_egl/.test(l)).slice(-6), steps: result?.steps.map((s) => { const { processes, procRss, ...rest } = s; return rest; }) ?? null, errors: result?.errors.map((e) => ({ name: e.name, message: e.message.split('\n')[0] })) ?? null };
}
const idle = {};
for (const name of fs.readdirSync(results).filter((n) => n.startsWith('idle-') && n.endsWith('.txt'))) idle[name] = (fs.readFileSync(path.join(results, name), 'utf8').match(/tree rss KiB: (\d+)/) ?? [])[1] ?? null;
console.log(JSON.stringify({ runs, idle }, null, 2));
EOF
log "done; results under $results"
