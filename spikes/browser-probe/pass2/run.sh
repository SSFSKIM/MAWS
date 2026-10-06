#!/bin/zsh
# Runs one pass-two scenario in the repository's Electron (44.4.5) through the shared load gate and slot.
# Usage: spikes/browser-probe/pass2/run.sh <input|layer|crosssite|oopif|snapshot|chips|all> [extra electron args]
set -u
here=${0:A:h}
electron="$here/../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
export pnpm_config_verify_deps_before_run=false
unset ELECTRON_RUN_AS_NODE
scenario=${1:-all}
shift || true
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh "$electron" "$here" "--scenario=$scenario" "$@"
