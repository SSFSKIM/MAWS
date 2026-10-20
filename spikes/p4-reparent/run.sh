#!/bin/zsh
# R-1 harness. From the repo root, after `pnpm install`:  spikes/p4-reparent/run.sh
# Builds the page bundle, then runs the repo's Electron on one hidden window under the global heavy-run slot.
# Output: spikes/p4-reparent/results/run.json (every measured value) and results/console.txt (the page's console).
# main.mjs ends Electron with SIGKILL once the report is written (its shutdown hung twice), so success is a fresh
# results/run.json rather than the exit status.
set -e
here=${0:A:h}
root=${here:h:h}
node $here/build.mjs
/tmp/maws-review/with-slot.sh $root/node_modules/.bin/electron $here/main.mjs || true
[[ $here/results/run.json -nt $here/out/page.js ]] || { echo 'R-1: no fresh results/run.json' >&2; exit 1; }
echo "R-1: results in $here/results/run.json"
