// Our own launcher script, executed by OpenAI's signed node: spawns node_repl with inherited stdio.
import {spawn} from 'node:child_process';
const c=spawn(process.env.CUA_REPL_NODE_REPL_PATH,[],{stdio:'inherit',env:process.env});c.on('close',code=>process.exit(code??1));
