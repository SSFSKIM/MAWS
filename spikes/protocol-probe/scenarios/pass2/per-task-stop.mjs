// Item 7: interrupt while a background Bash task runs, with and without perTaskStopAffordance.
import {run,initPayload,bashAllow,delay} from './common.mjs';
import {existsSync} from 'node:fs';
const body=affordance=>async p=>{await p.request('initialize',initPayload(affordance?{perTaskStopAffordance:true}:{}));bashAllow(p);
 const after=p.seq;p.user('Step 1: use Bash with run_in_background true to run exactly: sleep 30 && echo BG_DONE > bg.txt\nStep 2: then use Bash in the foreground to run exactly: sleep 20\nStep 3: reply DONE.');
 await p.wait(f=>f.type==='system'&&f.subtype==='task_started'&&f.is_backgrounded!==false,{after,timeout:90000});
 await p.wait(f=>f.type==='assistant'&&f.message.content.some(b=>b.type==='tool_use'&&/sleep 20/.test(b.input?.command||'')),{after,timeout:90000});await delay(2000);
 const t0=Date.now();const r=await p.request('interrupt',{reason:'probe'});p.note({event:'interrupted',affordance,receipt:r.response});
 await p.wait(f=>f.type==='result',{after});await delay(3000);p.tree('after-interrupt');
 await delay(Math.max(0,34000-(Date.now()-t0)));p.note({event:'background_outcome',affordance,bgFileExists:existsSync(p.cwd+'/bg.txt'),secondsAfterInterrupt:Math.round((Date.now()-t0)/1000)});
};
export default async()=>{await run('per-task-stop-off',body(false),{model:'sonnet'});await run('per-task-stop-on',body(true),{model:'sonnet'});};
