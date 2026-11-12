// UX wave, U8 probes "Does the engine say that a subagent waits on its own background work?" (#359) and "How does a
// shell that a subagent started name its starter?", in the folder probe's harness (MAWS's launch, uxwave-common.mjs).
// Three turns: (A) a subagent starts a background shell and waits for it; (B) a subagent runs a command that needs a
// permission, which the probe answers only after PZ_PERMISSION_DELAY_MS (default 20000) so the wire's account of the
// wait can be read; (C) the main loop starts a background shell itself, for comparison. A `task_record` note per turn
// lists every task-shaped frame of the turn whole (the permission delay stays on from (B) to the end, so a request the
// subagent of (A) makes later waits as long) (system task_* and background_tasks_changed, session_state_changed,
// the permission request and its agent id).
import {mawsLaunch,answer} from './uxwave-common.mjs';
const MODEL=process.env.PZ_MODEL||'haiku';
const DELAY=+(process.env.PZ_PERMISSION_DELAY_MS||20000);
const TASKY=f=>(f.type==='system'&&(/^task_|background_tasks_changed|session_state_changed|status/.test(f.subtype||'')))||f.type==='control_request';
export default async()=>{
 await mawsLaunch('uxwave-subagent-tasks'+(process.env.PZ_TAG||''),{model:MODEL},async p=>{
  const turn=async(name,prompt,setup)=>{setup?.();const from=p.seq;p.note({event:'step',name,prompt});const r=await p.turn(prompt);
   const frames=p.frames.filter(x=>x.seq>from&&TASKY(x.frame)).map(x=>({seq:x.seq,at:x.at,frame:x.frame.type==='control_request'?{type:'control_request',subtype:x.frame.request.subtype,tool_name:x.frame.request.tool_name,agent_id:x.frame.request.agent_id,tool_use_id:x.frame.request.tool_use_id,input:x.frame.request.input}:x.frame}));
   p.note({event:'task_record',name,seqFrom:from+1,seqTo:p.seq,answer:answer(p),result:{subtype:r.subtype,is_error:r.is_error},frames});
   console.log(name,frames.length,JSON.stringify(answer(p)).slice(0,120));};
  await turn('A-subagent-waits-on-background-shell','Use the Agent tool (subagent_type "general-purpose") with this exact prompt: "Start this command in Bash with run_in_background set to true: sleep 30; echo BG-DONE. Then wait until it has finished, and reply with its output." When the agent has finished, reply with what it answered.');
  await turn('B-subagent-needs-permission','Use the Agent tool (subagent_type "general-purpose") with this exact prompt: "Run this command in Bash: touch pz-permission-probe.txt && echo TOUCHED. Reply with its output." When the agent has finished, reply with what it answered.',()=>{p.permissionDelayMs=DELAY;});
  await turn('C-main-background-shell','Start this command in Bash with run_in_background set to true: sleep 8; echo MAIN-BG-DONE. Do not wait for it; reply OK right away.');
  // until every background task has ended (an empty background_tasks_changed) and the turns it woke have ended
  const from=p.seq;
  try{await p.wait(f=>f.type==='system'&&f.subtype==='background_tasks_changed'&&f.tasks?.length===0,{after:from,timeout:240000});}catch(e){p.note({event:'wait_timeout',what:'empty background_tasks_changed'});}
  await new Promise(r=>setTimeout(r,5000));
  if(p.frames.at(-1)?.frame.type!=='result'){try{await p.wait(f=>f.type==='result',{after:p.seq-1,timeout:90000});}catch{}}
  p.note({event:'task_record',name:'C-after-wait',seqFrom:from+1,seqTo:p.seq,frames:p.frames.filter(x=>x.seq>from&&TASKY(x.frame)).map(x=>({seq:x.seq,at:x.at,frame:x.frame}))});
 });
};
