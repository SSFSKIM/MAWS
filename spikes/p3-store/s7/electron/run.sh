#!/bin/zsh
# S7b: one scenario of the Electron scale harness, behind the shared machine's load gate and heavy-run slot.
# Usage: zsh spikes/p3-store/s7/electron/run.sh <probe|typing|firstsync|history|memory|ime|kill|deck> [tag]
# Build first: node spikes/p3-store/s7/electron/build.mjs; seeds: see the header of seed.ts.
here=${0:A:h}
electron=${here:h:h:h:h}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
/tmp/maws-review/waitload20.sh
export S7_OUT=${S7_OUT:-${here:h}/out}
[[ -n $2 ]] && export S7_TAG=$2
exec /tmp/maws-review/with-slot.sh $electron /tmp/p3-s7b/build/main.cjs --scenario=$1
