// Keeps /bin/sh (an Apple platform binary, not on any allowlist) as node_repl's parent.
import {spawn} from 'node:child_process';
const c=spawn('/bin/sh',['-c','"$CUA_REPL_NODE_REPL_PATH"; exit $?'],{stdio:'inherit',env:process.env});c.on('close',code=>process.exit(code??1));
