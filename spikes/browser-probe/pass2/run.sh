#!/bin/zsh
# Runs one pass-two scenario in the repository's Electron (44.4.5). On the author's machine heavy runs go through the
# shared load gate and slot scripts under /tmp/maws-review (outside the repository); without them the app runs directly.
# Usage: spikes/browser-probe/pass2/run.sh <input|input2|layer|crosssite|oopif|snapshot|chips|all> [--front=1]
set -u
here=${0:A:h}
electron="$here/../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
export pnpm_config_verify_deps_before_run=false
unset ELECTRON_RUN_AS_NODE
scenario=${1:-all}
shift || true
if [[ -x /tmp/maws-review/waitload20.sh && -x /tmp/maws-review/with-slot.sh ]]; then
  /tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh "$electron" "$here" "--scenario=$scenario" "$@"
else
  "$electron" "$here" "--scenario=$scenario" "$@"
fi
