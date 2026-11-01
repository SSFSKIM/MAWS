#!/usr/bin/env bash
# U3's Linux half (O5 M7), on a devcloud VM (Ubuntu 24.04, no display): U4's facts for the display, the sandbox and the
# packages (spikes/u4-render-service/FINDINGS.md §1: Xvfb through xvfb-run for GTK, --headless for Chromium's software
# compositing, --hide-scrollbars, the SUID chrome-sandbox set root:root 4755, never --no-sandbox), then the probe in its
# four tab modes (a hidden window with the app's background throttling, the same unthrottled, an offscreen view, and
# the window shown without focus on the Xvfb display nobody sees), each
# a driver run (../driver.mjs) that writes results/<mode>/driver.json; results/summary.json is the one-page reading.
#
#   cd ~/Developer/GitHub/MAWS && bash spikes/u3-remote-browser/linux/run.sh
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$here/../.." && pwd)
results=$here/results
mkdir -p "$results"
log() { printf '[u3 %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$results/run.log" >&2; }

# Electron's Linux build: the repository's install, else the pinned release from GitHub checked against its SHASUMS.
version=$(node -p "require('$repo/package.json').devDependencies.electron")
electron=$repo/node_modules/electron/dist/electron
if [[ ! -x $electron ]]; then
  root=$HOME/u3 && mkdir -p "$root"
  zip="electron-v$version-linux-x64.zip"
  if [[ ! -x $root/electron/electron ]]; then
    log "downloading $zip"
    curl -fsSL -o "$root/$zip" "https://github.com/electron/electron/releases/download/v$version/$zip"
    curl -fsSL -o "$root/SHASUMS256.txt" "https://github.com/electron/electron/releases/download/v$version/SHASUMS256.txt"
    (cd "$root" && grep " \*$zip\$" SHASUMS256.txt | sha256sum -c -) | tee -a "$results/run.log"
    mkdir -p "$root/electron" && (cd "$root/electron" && unzip -oq "../$zip")
  fi
  electron=$root/electron/electron
fi
# U4 §1.1's libraries and xvfb, the Noto fonts of §1.4
packages=(xvfb libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgbm1 libgtk-3-0t64 libasound2t64 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libpango-1.0-0 libcairo2 libatspi2.0-0t64 libxshmfence1 fontconfig fonts-dejavu-core fonts-noto-core unzip)
if ! command -v xvfb-run >/dev/null || ldd "$electron" | grep -q 'not found'; then
  log "installing packages"
  sudo -n apt-get update -q >"$results/apt.txt" 2>&1
  sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -yq "${packages[@]}" >>"$results/apt.txt" 2>&1 || log "apt-get install failed (see apt.txt)"
fi
ldd "$electron" | grep 'not found' >"$results/ldd-missing.txt" || true
sandbox=$(dirname "$electron")/chrome-sandbox
sudo -n chown root:root "$sandbox" && sudo -n chmod 4755 "$sandbox"
log "electron $("$electron" --version 2>/dev/null) at $electron on $(uname -srm), $(lsb_release -ds 2>/dev/null); sandbox $(stat -c '%U:%G %a' "$sandbox")"

node "$here/build.mjs" 2>&1 | tee -a "$results/run.log"
xvfb=(xvfb-run -a -s "-screen 0 1280x800x24 -nolisten tcp")
modes=${U3_MODES:-hidden,hidden-unthrottled,offscreen,shown} # the tab modes to run, comma-separated (host/main.ts VARIANTS names them all)
for mode in ${modes//,/ }; do
  rm -rf "$results/$mode"
  log "mode $mode"
  timeout -k 10 300 node "$here/driver.mjs" --out "$results/$mode" --mode "$mode" --repo "$repo" -- "${xvfb[@]}" "$electron" --headless --hide-scrollbars "$here/build/host.cjs" 2>"$results/$mode.driver-stderr.txt"
  log "mode $mode: driver exit $?"
  pkill -f "$here/build/host.cjs" >/dev/null 2>&1 || true
done
node "$here/summarize.mjs" "$results" >"$results/summary.json"
log "done; $results/summary.json"
