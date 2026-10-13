#!/bin/zsh
# S2 harness: "main absent" end to end. Phase 1 spawns the detached host (its agent starts editing) and quits main;
# after $S2_GAP seconds with no main, phase 2 starts a new main that connects over the socket and relays renderers.
# Env: S2_OUT_DIR, S2_BASE (under /tmp), S2_AGENT (docId:session:sentences:intervalMs), S2_GAP (default 3).
E=${S2_ELECTRON:-/Users/new/Developer/GitHub/MAWS/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron}
B=${S2_BUILD:-/tmp/p3-s2/build/electron}
$E $B/main.cjs --scenario=detached-start > /dev/null 2>&1
sleep ${S2_GAP:-3}
$E $B/main.cjs --scenario=detached-connect 2>&1 | tail -5
