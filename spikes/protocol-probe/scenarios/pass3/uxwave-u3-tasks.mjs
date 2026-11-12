// UX wave U3, probe 1 (U3-transcript-rows.md, "Probes and checks" 1; serves O-28, O-34 and UC-2's `task` class): what
// the 2.1.322 wire and the transcript file carry for a task notification, in each of its forms, when the engine tells
// an idle model and when it takes the notification in at a tool boundary of a running turn. Launched as MAWS launches
// (uxwave-common.mjs). One case per turn; each case's wire frames and transcript rows are noted side by side
// (`uxw_case`), and the whole transcript is kept beside the journal.
//
// Cases (UXW_CASES picks a subset, comma-separated; UXW_TAG names the fixture; UXW_BARE=1 launches without the three
// product flags; UXW_MODEL the model, haiku by default):
//   idle-ok      a background command that exits 0, the model idle when it ends
//   idle-fail    one that exits 1
//   idle-stop    one stopped by the host's stop_task while the model is idle
//   agent        a background agent that finishes
//   agent-resume the same agent resumed with SendMessage, finishing again
//   busy         two background commands (exit 1 and exit 0) that end during a foreground command of a running turn
//   busy-agent   a background agent that finishes during a foreground command
//   monitor      a Monitor on a command that prints three lines and exits, the model idle
//   monitor-busy a Monitor whose events arrive during a foreground command
//   prompt-stall a background command that waits on an interactive prompt (the engine's stall notice), then stopped
//   checkin      a quiet background command (the engine's check-in; needs tengu_silent_heron, which the owner's cache
//                has at 0: run it with UXW_CHECKIN_MS=10000, which writes the gate into the scratch HOME's cache)
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,prompt,turn,sys,textOf,delay,cost} from './uxwave-common.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const ALL=['idle-ok','idle-fail','idle-stop','agent','agent-resume','busy','busy-agent','monitor','monitor-busy','prompt-stall'];
const CASES=(process.env.UXW_CASES||ALL.join(',')).split(',').filter(Boolean);
const TAG=process.env.UXW_TAG||'u3-tasks';
const BARE=process.env.UXW_BARE==='1';
const NOTE='Then reply with only the word STARTED and end your turn: do not wait for it, check on it or read its output.';
const isNotification=f=>f.type==='user'&&textOf(f.message?.content).includes('<task-notification>');
const notificationFor=re=>f=>isNotification(f)&&re.test(textOf(f.message?.content));

export default async()=>{
 if(process.env.UXW_CHECKIN_MS){ // the check-in's gate, in this scratch HOME's feature cache only
  const file=join(process.env.HOME,'.claude.json');const d=JSON.parse(readFileSync(file,'utf8'));d.cachedGrowthBookFeatures={...d.cachedGrowthBookFeatures,tengu_silent_heron:Number(process.env.UXW_CHECKIN_MS)};writeFileSync(file,JSON.stringify(d));
 }
 await mawsLaunch(TAG,{bare:BARE,model:process.env.UXW_MODEL||'haiku',spendCap:'2.00',provenance:{probe:'U3 probe 1',cases:CASES,checkinGateMs:process.env.UXW_CHECKIN_MS?Number(process.env.UXW_CHECKIN_MS):null}},async(p,{transcript})=>{
  let lastLine=0;
  const record=(name,from,extra={})=>{const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);lastLine=rows.length;const wire=wireArrivals(p,from);p.note({event:'uxw_case',case:name,fromSeq:from,toSeq:p.seq,...extra,wire,file});console.log(name,JSON.stringify({wireUserNotifications:wire.filter(w=>w.type==='user'&&/<task-notification>/.test(w.text??'')).map(w=>w.seq),fileRows:file.length}));};
  const startedTask=(from,type)=>waitFor(p,f=>sys(f,'task_started')&&(!type||f.task_type===type),{after:from,timeout:120000});
  // A turn the engine opened to tell the model (its `result` names the origin), after `from`.
 const engineTurn=(from,timeout=120000)=>waitFor(p,f=>f.type==='result'&&f.origin?.kind==='task-notification',{after:from,timeout});
 const told=(re,from,timeout=120000)=>waitFor(p,f=>(sys(f,'task_notification')&&re.test(String(f.summary)))||(isNotification(f)&&re.test(textOf(f.message?.content))),{after:from,timeout});
 // one idle case: the prompt starts the work, the turn ends, the engine tells the model in a turn of its own
 const idleCase=async(name,text,re,{timeout=120000}={})=>{
  const from=p.seq;const t=await turn(p,text);
  const n=await told(re,t.seq,timeout);const e=await engineTurn(t.result?p.frames.find(r=>r.frame===t.result)?.seq??t.seq:t.seq,60000);
  await idle(p);record(name,from,{systemOrUserNotificationSeen:!!n,engineTurnSeen:!!e});
 };
 for(const name of CASES){
   p.note({event:'uxw_case_start',case:name});
   if(name==='idle-ok')await idleCase(name,`Run exactly \`sleep 6; echo UXW-OK\` with the Bash tool, run_in_background true, description "uxw ok". ${NOTE}`,/uxw ok/);
   else if(name==='idle-fail')await idleCase(name,`Run exactly \`sleep 6; echo UXW-FAIL; exit 1\` with the Bash tool, run_in_background true, description "uxw fail". ${NOTE}`,/uxw fail/);
   else if(name==='idle-stop'){
    const from=p.seq;prompt(p,`Run exactly \`sleep 300\` with the Bash tool, run_in_background true, description "uxw stop". ${NOTE}`);
    const task=await startedTask(from,'local_bash');await waitFor(p,f=>f.type==='result',{after:from});await idle(p);
    const stopAt=p.seq;const r=task?await p.request('stop_task',{task_id:task.task_id}).catch(e=>({error:e.message})):{error:'no task_started'};
    p.note({event:'uxw_stop',task_id:task?.task_id??null,response:r});
    const n=await told(/uxw stop/,stopAt,60000);await engineTurn(stopAt,60000);await idle(p);record(name,from,{notificationSeen:!!n,stopSeq:stopAt});
   }
   else if(name==='agent')await idleCase(name,'Use the Agent tool with run_in_background true, subagent_type "general-purpose", description "uxw agent", prompt "Reply with only the word PONG. Use no tool." Then reply with only the word STARTED and end your turn.',/./);
   else if(name==='agent-resume')await idleCase(name,'Use SendMessage to send the agent you started as "uxw agent" (address it by the agent id its Agent result gave you) the message "Reply with only the word PONG2. Use no tool." Then reply with only the word SENT and end your turn.',/./,{timeout:150000});
   else if(name==='busy'){
    const from=p.seq;const t=await turn(p,'Do these in order, each with the Bash tool: (1) run exactly `sleep 3; echo UXW-BUSY-FAIL; exit 1` with run_in_background true, description "uxw busy fail"; (2) run exactly `sleep 4; echo UXW-BUSY-OK` with run_in_background true, description "uxw busy ok"; (3) run exactly `python3 -c "import time; time.sleep(20); print(\'UXW-FG-DONE\')"` with the Bash tool in the foreground (run_in_background false), description "uxw foreground". Then reply with only the word DONE.');
    await idle(p);record(name,from);
   }
   else if(name==='busy-agent'){
    const from=p.seq;await turn(p,'First use the Agent tool with run_in_background true, subagent_type "general-purpose", description "uxw busy agent", prompt "Reply with only the word PONG3. Use no tool." Then run exactly `python3 -c "import time; time.sleep(30); print(\'UXW-FG-DONE\')"` with the Bash tool in the foreground (run_in_background false), description "uxw foreground". Then reply with only the word DONE.');
    await idle(p);record(name,from);
   }
   else if(name==='monitor'){
    const from=p.seq;await turn(p,'Use the Monitor tool (find it with ToolSearch if it is not loaded) to watch exactly this command: `for i in 1 2 3; do echo UXW-EVENT-$i; sleep 4; done`, description "uxw monitor". Then reply with only the word STARTED and end your turn. When an event arrives, reply with only the word SEEN.');
    await waitFor(p,f=>sys(f,'task_notification')&&/uxw monitor/.test(String(f.summary)),{after:from,timeout:90000});await delay(5000);await idle(p);record(name,from);
   }
   else if(name==='monitor-busy'){
    const from=p.seq;await turn(p,'Use the Monitor tool (find it with ToolSearch if it is not loaded) to watch exactly this command: `for i in 1 2; do sleep 2; echo UXW-BEVENT-$i; done`, description "uxw busy monitor". Right after starting it, run exactly `python3 -c "import time; time.sleep(20); print(\'UXW-FG-DONE\')"` with the Bash tool in the foreground (run_in_background false), description "uxw foreground". Then reply with only the word DONE.');
    await idle(p);record(name,from);
   }
   else if(name==='prompt-stall'){
    const from=p.seq;prompt(p,`Run exactly \`echo "Continue? (y/n)"; sleep 240\` with the Bash tool, run_in_background true, description "uxw stall". ${NOTE} If you are later told it waits for input, reply with only the word NOTED and do nothing else.`);
    const task=await startedTask(from,'local_bash');
    const first=await waitFor(p,f=>f.type==='result',{after:from});const n=await engineTurn(p.frames.find(r=>r.frame===first)?.seq??from,120000);await idle(p);
    const stopAt=p.seq;if(task)p.note({event:'uxw_stop',task_id:task.task_id,response:await p.request('stop_task',{task_id:task.task_id}).catch(e=>({error:e.message}))});
    await told(/uxw stall/,stopAt,30000);await engineTurn(stopAt,30000);await idle(p);record(name,from,{stallTurnSeen:!!n,stopSeq:stopAt});
   }
   else if(name==='checkin'){
    const from=p.seq;prompt(p,`Run exactly \`sleep 240\` with the Bash tool, run_in_background true, description "uxw quiet". ${NOTE} If you are later told it is quiet, reply with only the word NOTED and do nothing else.`);
    const task=await startedTask(from,'local_bash');
    const first=await waitFor(p,f=>f.type==='result',{after:from});const n=await engineTurn(p.frames.find(r=>r.frame===first)?.seq??from,150000);await idle(p);
    const stopAt=p.seq;if(task)p.note({event:'uxw_stop',task_id:task.task_id,response:await p.request('stop_task',{task_id:task.task_id}).catch(e=>({error:e.message}))});
    await told(/uxw quiet/,stopAt,30000);await engineTurn(stopAt,30000);await idle(p);record(name,from,{checkinTurnSeen:!!n,stopSeq:stopAt});
   }
   else throw new Error('unknown case '+name);
  }
  keepTranscript(transcript,TAG);
  console.log(TAG,'cost',cost(p));
 });
};
