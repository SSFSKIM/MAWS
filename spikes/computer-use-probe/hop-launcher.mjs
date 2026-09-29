// Spawns the next hop with inherited stdio: HOP_EXEC (an executable) running HOP_SCRIPT, or node_repl when unset.
import {spawn} from 'node:child_process';
const exec=process.env.HOP_EXEC_1||process.env.CUA_REPL_NODE_REPL_PATH;const args=process.env.HOP_EXEC_1?[new URL(import.meta.url).pathname]:[];
const env={...process.env};delete env.HOP_EXEC_1;
const c=spawn(exec,args,{stdio:'inherit',env});c.on('close',code=>process.exit(code??1));
