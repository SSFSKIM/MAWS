#!/usr/bin/env bash
# U4's Linux half, run on a devcloud VM (Ubuntu 24.04, no display): fetches the pinned Electron's Linux build, finds
# what it needs from the system, runs the render probe (main.cjs) under each condition that matters for a render
# service owned by mawsd, reads the fonts the machine offers, and leaves every result under ~/u4/results/. Safe to
# re-run; every step is recorded, a failing one never stops the next.
#
#   bash run.sh [<electron version>]   (default: the repo's pin, read from package.json)
set -uo pipefail

repo=${MAWS_REPO:-$HOME/Developer/GitHub/MAWS}
version=${1:-$(node -p "require('$repo/package.json').devDependencies.electron")}
root=$HOME/u4
results=$root/results
probe=$root/probe
mkdir -p "$results" "$probe"
log() { printf '[u4 %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$results/run.log" >&2; }
record() { local name=$1; shift; { printf '$ %s\n' "$*"; "$@"; printf '\n[exit %s]\n' "$?"; } >"$results/$name.txt" 2>&1; }

log "electron $version on $(uname -srm), $(lsb_release -ds 2>/dev/null)"
record system-facts bash -c 'id; nproc; free -m; cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null; cat /proc/sys/user/max_user_namespaces 2>/dev/null; sysctl kernel.unprivileged_userns_clone 2>/dev/null; systemctl --user show-environment | head -20; loginctl show-user "$USER" --property=Linger; echo "DISPLAY=${DISPLAY:-} WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-} XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-}"; node --version'

# 1. Electron's Linux build, from GitHub's release, checked against its SHASUMS.
zip="electron-v$version-linux-x64.zip"
if [[ ! -x $root/electron/electron ]]; then
  log "downloading $zip"
  curl -fsSL -o "$root/$zip" "https://github.com/electron/electron/releases/download/v$version/$zip"
  curl -fsSL -o "$root/SHASUMS256.txt" "https://github.com/electron/electron/releases/download/v$version/SHASUMS256.txt"
  (cd "$root" && grep " \*$zip\$" SHASUMS256.txt | sha256sum -c -) | tee -a "$results/run.log"
  mkdir -p "$root/electron" && (cd "$root/electron" && unzip -oq "../$zip")
fi
record electron-files bash -c "ls -la $root/electron | head -40; ls -la $root/electron/chrome-sandbox; du -sh $root/electron"

# 2. What it needs from the system, before and after the packages a render host would ask devenv for.
record ldd-before bash -c "ldd $root/electron/electron | grep -E 'not found' || echo 'nothing missing'"
missing_before=$(ldd "$root/electron/electron" | grep -c 'not found')
log "shared libraries missing before packages: $missing_before"
packages=(libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgbm1 libgtk-3-0t64 libasound2t64 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libpango-1.0-0 libcairo2 libatspi2.0-0t64 libxshmfence1 fontconfig fonts-dejavu-core poppler-utils unzip)
sudo -n apt-get update -q >"$results/apt-update.txt" 2>&1
for p in "${packages[@]}"; do sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -yq "$p" >>"$results/apt-install.txt" 2>&1 || echo "apt: $p not installed" >>"$results/apt-install.txt"; done
record ldd-after bash -c "ldd $root/electron/electron | grep -E 'not found' || echo 'nothing missing'"
record packages-installed bash -c "dpkg-query -W -f='\${Package} \${Version}\n' ${packages[*]} 2>/dev/null"
record disk-of-packages bash -c "dpkg-query -W -f='\${Package} \${Installed-Size}\n' $(dpkg-query -W -f='\${Package}\n' ${packages[*]} 2>/dev/null | tr '\n' ' ') 2>/dev/null | awk '{s+=\$2} END {print s \" KiB installed size of the listed packages\"}'"

# 3. Fonts, as fontconfig answers a render.
record fonts bash -c "fc-list : family | sort -u | wc -l; fc-list : family | sort -u | head -40; for q in sans-serif serif monospace system-ui ':lang=ko' ':lang=ja' ':lang=zh' emoji; do printf '%-12s -> ' \"\$q\"; fc-match \"\$q\"; done"

# 4. The probe's files beside the font the repo bundles.
cp "$repo/spikes/u4-render-service/linux/main.cjs" "$repo/spikes/u4-render-service/linux/fixture.html" "$probe/"
cp "$repo/src/artifacts/types/design_system/defaults/official/assets/NotoSerifKR-Regular-full.woff2" "$probe/"

electron=$root/electron/electron
run() {
  # run <name> <timeout s> <command...>: the probe under one condition, its stdout and stderr kept, its exit recorded
  local name=$1 timeout_s=$2; shift 2
  local out=$results/$name
  rm -rf "$out"; mkdir -p "$out"
  log "run $name: $*"
  local started=$(date +%s%N)
  timeout -k 5 "$timeout_s" "$@" --out "$out" --fixture "$probe" >"$out/stdout.txt" 2>"$out/stderr.txt"
  local code=$?
  echo "$code" >"$out/exit.txt"
  echo "$(( ($(date +%s%N) - started) / 1000000 ))" >"$out/wall-ms.txt"
  log "run $name: exit $code after $(cat "$out/wall-ms.txt") ms; errors: $(node -e "try{const r=require('$out/result.json');console.log(r.errors.length+' ('+r.errors.map(e=>e.name).join(',')+')')}catch{console.log('no result.json')}")"
  pkill -f "$root/electron/electron" >/dev/null 2>&1 || true
}

# R1: headless, no sandbox, over ssh with no DISPLAY (the simplest condition that could work)
run r1-headless-nosandbox 90 "$electron" --headless --no-sandbox "$probe/main.cjs"
# R2: headless with Chromium's sandbox as the zip ships it (chrome-sandbox not setuid; user namespaces as Ubuntu 24.04 restricts them)
run r2-headless-sandbox-asis 90 "$electron" --headless "$probe/main.cjs"
# R3: the SUID helper configured (what a package install can do once, with root)
sudo -n chown root:root "$root/electron/chrome-sandbox" && sudo -n chmod 4755 "$root/electron/chrome-sandbox"
record chrome-sandbox-after ls -la "$root/electron/chrome-sandbox"
run r3-headless-sandbox-suid 90 "$electron" --headless "$probe/main.cjs"
# R4: the unit condition: a transient systemd user service, no session environment, no DISPLAY (what mawsd's unit is)
run r4-unit-headless-suid 120 systemd-run --user --wait --pipe --collect --quiet -p Environment=HOME="$HOME" "$electron" --headless "$probe/main.cjs"
# R5: no --headless and no display (Electron's ordinary start on Linux): expected to refuse, recorded
run r5-no-headless-no-display 60 "$electron" --no-sandbox "$probe/main.cjs"
# R6: headless with the GPU process off and software compositing explicit, the shape a server render would pin
run r6-headless-suid-disable-gpu 90 "$electron" --headless --disable-gpu "$probe/main.cjs"
# R7: the ozone headless platform named explicitly (what --headless implies on Linux), as a cross-check
run r7-ozone-headless-suid 90 "$electron" --ozone-platform=headless "$probe/main.cjs"

# 5. The PDFs read back by poppler: fonts embedded, pages, text extractable.
for r in r1-headless-nosandbox r3-headless-sandbox-suid r4-unit-headless-suid; do
  for f in offscreen hidden; do
    pdf=$results/$r/$f.pdf
    [[ -s $pdf ]] || continue
    record "pdf-$r-$f" bash -c "pdfinfo '$pdf'; echo; pdffonts '$pdf'; echo; pdftotext -layout '$pdf' - | head -30"
  done
done

# 6. Idle baselines for the shapes' cost: plain Node holding a timer, and Electron as Node (what mawsd runs on today).
idle_rss() {
  # idle_rss <name> <command...>: starts the command, reads its tree's RSS after 10 s, ends it
  local name=$1; shift
  "$@" >/dev/null 2>&1 &
  local pid=$!
  sleep 10
  { echo "command: $*"; ps -o pid,ppid,rss,vsz,args --ppid "$pid" -p "$pid" 2>/dev/null; echo; echo "tree rss KiB: $(ps -o rss= --ppid "$pid" -p "$pid" 2>/dev/null | awk '{s+=$1} END {print s}')"; } >"$results/idle-$name.txt" 2>&1
  kill "$pid" >/dev/null 2>&1; wait "$pid" 2>/dev/null
}
idle_rss node-timer node -e 'setInterval(() => {}, 1000)'
ELECTRON_RUN_AS_NODE=1 idle_rss electron-as-node "$electron" -e 'setInterval(() => {}, 1000)'
cat >"$probe/idle.cjs" <<'EOF'
const { app } = require('electron');
app.whenReady().then(() => setInterval(() => {}, 1000));
EOF
idle_rss electron-headless-ready "$electron" --headless "$probe/idle.cjs"
idle_rss electron-headless-ready-nogpu "$electron" --headless --disable-gpu "$probe/idle.cjs"

# 7. One summary for the findings file.
node - "$results" <<'EOF' >"$results/summary.json"
const fs = require('node:fs'); const path = require('node:path');
const results = process.argv[2];
const runs = {};
for (const name of fs.readdirSync(results)) {
  const dir = path.join(results, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const read = (file) => { try { return fs.readFileSync(path.join(dir, file), 'utf8').trim(); } catch { return null; } };
  let result = null; try { result = JSON.parse(read('result.json')); } catch {}
  runs[name] = { exit: read('exit.txt'), wallMs: read('wall-ms.txt'), stderrHead: (read('stderr.txt') ?? '').split('\n').slice(0, 12), steps: result?.steps.map((s) => { const { processes, procRss, ...rest } = s; return rest; }) ?? null, errors: result?.errors.map((e) => ({ name: e.name, message: e.message.split('\n')[0] })) ?? null };
}
const idle = {};
for (const name of fs.readdirSync(results).filter((n) => n.startsWith('idle-') && n.endsWith('.txt'))) idle[name] = (fs.readFileSync(path.join(results, name), 'utf8').match(/tree rss KiB: (\d+)/) ?? [])[1] ?? null;
console.log(JSON.stringify({ runs, idle }, null, 2));
EOF
log "done; results under $results"
