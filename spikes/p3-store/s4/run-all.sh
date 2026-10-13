#!/bin/zsh
# S4: every run behind the findings, heavy ones gated by the shared load and slot scripts (hidden windows only).
# Run from anywhere: zsh spikes/p3-store/s4/run-all.sh   (outputs under spikes/p3-store/s4/out/)
S4=${0:A:h}
E=${S4_ELECTRON:-/Users/new/Developer/GitHub/MAWS/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron}
B=${S4_BUILD:-/tmp/p3-s4/build}
node $S4/test/writer.ts > $S4/out/writer.txt 2>&1
node $S4/test/s5-cases.ts > $S4/out/s5-cases.txt 2>&1
node $S4/test/moves.ts > $S4/out/moves.txt 2>&1
node $S4/electron/build.mjs
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh timeout 900 node $S4/test/numbers.ts > $S4/out/numbers.txt 2>&1
run () { /tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh env "$@" timeout 1500 $E $B/main.cjs 2>&1 | grep -v ':ERROR:\|DevTools' }
run S4_PAGE=14 S4_HOLD=1 > /tmp/p3-s4/run-v14.log
run S4_PAGE=14 S4_HOLD=0 > /tmp/p3-s4/run-v14-nohold.log
run S4_PAGE=14 S4_HOLD=1 S4_FOLLOW=0 'S4_ONLY=no awareness' > /tmp/p3-s4/run-v14-nofollow.log
run S4_PAGE=13 S4_HOLD=1 > /tmp/p3-s4/run-v13.log
run S4_PAGE=13 S4_HOLD=0 > /tmp/p3-s4/run-v13-nohold.log
echo done
