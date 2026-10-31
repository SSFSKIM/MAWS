#!/usr/bin/env bash
# U4's Linux half, round 3: the candidate shape from round 2 (Xvfb for GTK's display, --headless for Chromium's
# software compositing, the SUID sandbox) run whole, with the hidden-window steps and the idle reading the earlier
# rounds never reached (the probe exited at window-all-closed), under the shell and under the unit; SwiftShader as the
# named alternate. Results under ~/u4/results3/.
set -uo pipefail
repo=${MAWS_REPO:-$HOME/Developer/GitHub/MAWS}
root=$HOME/u4
results=$root/results3
probe=$root/probe
electron=$root/electron/electron
mkdir -p "$results" "$probe"
log() { printf '[u4r3 %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$results/run.log" >&2; }
record() { local name=$1; shift; { printf '$ %s\n' "$*"; "$@"; printf '\n[exit %s]\n' "$?"; } >"$results/$name.txt" 2>&1; }
cp "$repo/spikes/u4-render-service/linux/main.cjs" "$repo/spikes/u4-render-service/linux/fixture.html" "$probe/"
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
# Y1: the candidate, from a shell
run y1-xvfb-headless-sandbox 150 "${xvfb[@]}" "$electron" --headless --hide-scrollbars "$probe/main.cjs"
# Y2: the candidate under a transient systemd user service (the unit's condition)
run y2-unit-xvfb-headless-sandbox 180 systemd-run --user --wait --pipe --collect --quiet -p Environment=HOME="$HOME" "${xvfb[@]}" "$electron" --headless --hide-scrollbars "$probe/main.cjs"
# Y3: the alternate, SwiftShader without --headless
run y3-xvfb-swiftshader-sandbox 150 "${xvfb[@]}" "$electron" --use-gl=angle --use-angle=swiftshader "$probe/main.cjs"
# Y4: the candidate a second time, for the timings' spread
run y4-xvfb-headless-sandbox-again 150 "${xvfb[@]}" "$electron" --headless --hide-scrollbars "$probe/main.cjs"

for r in y1-xvfb-headless-sandbox y2-unit-xvfb-headless-sandbox y3-xvfb-swiftshader-sandbox; do
  for f in offscreen hidden; do
    pdf=$results/$r/$f.pdf
    [[ -s $pdf ]] || continue
    record "pdf-$r-$f" bash -c "pdfinfo '$pdf' | grep -E 'Pages|Page size|File size'; pdffonts '$pdf' | awk 'NR>2 {print \$1, \$2, \$5}' | sort -u; pdftotext -layout '$pdf' - | head -8"
  done
done

node - "$results" <<'EOF' >"$results/summary.json"
const fs = require('node:fs'); const path = require('node:path');
const results = process.argv[2];
const runs = {};
for (const name of fs.readdirSync(results)) {
  const dir = path.join(results, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const read = (file) => { try { return fs.readFileSync(path.join(dir, file), 'utf8').trim(); } catch { return null; } };
  let result = null; try { result = JSON.parse(read('result.json')); } catch {}
  runs[name] = { exit: read('exit.txt'), wallMs: read('wall-ms.txt'), stderrTail: (read('stderr.txt') ?? '').split('\n').filter((l) => !/angle_platform_impl|egl_util|gl_display|ERR: Display|gl_ozone_egl/.test(l)).slice(-6),
    steps: result?.steps.map((s) => { const { processes, procRss, versions, gpu, ...rest } = s; return rest; }) ?? null,
    idle: result?.steps.filter((s) => s.name.startsWith('memory')).map((s) => ({ name: s.name, rssKiB: s.rssKiB, sumWorkingSetKiB: s.sumWorkingSetKiB, sumProcRssKiB: s.sumProcRssKiB, processes: s.processes?.map((p) => `${p.type}${p.serviceName ? ':' + p.serviceName : ''}=${p.workingSetKiB}`) })) ?? null,
    errors: result?.errors.map((e) => ({ name: e.name, message: e.message.split('\n')[0] })) ?? null };
}
console.log(JSON.stringify({ runs }, null, 2));
EOF
log "done; results under $results"
