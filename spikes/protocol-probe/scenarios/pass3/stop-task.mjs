// C8b R6 (docs/doperpowers/plans/2026-09-28-c8b-agent-work-tools.md, Interfaces, Spike specifications): `stop_task` on a
// background shell, a background agent and a workflow run; the frames each stop produces, the response's timing against
// them, and the answers for a missing id and an already-stopped id. Runs under `mode: 'auto'` (pass 2's default, the mode
// the per-task-stop fixtures were recorded under): no can_use_tool is expected, so the parent's background Bash, the
// agent's `sleep 90` and the Workflow tool need no handler; a run under `mode: 'default'` must allow Bash, Agent and
// Workflow instead. An allow-and-record handler is still installed, so any escalation auto mode makes is a recorded fact
// rather than a hang. Scratch CLAUDE_CONFIG_DIR under /tmp: nothing reads or writes the owner's ~/.claude.
import {run,initPayload,delay} from '../pass2/common.mjs';
import {C8B,scratchConfig,sys,idle,spend} from './c8b-common.mjs';
const script=`export const meta = { name: 'maws-stop-task', description: 'One slow agent', phases: [{ title: 'Wait' }] }
phase('Wait')
return await agent('Run "sleep 90" with Bash, then reply SLOW.', { label: 'slow', effort: 'low' })`;
const ms=(row,t0)=>Date.parse(row.at)-t0;

export default ()=>{const config=scratchConfig();return run('stop-task',async p=>{
 p.note({event:'c8b_scenario',...C8B,probe:'R6',mode:'auto',configHome:config});
 p.on('can_use_tool',r=>{p.note({event:'escalation',tool:r.tool_name,agentId:r.agent_id??null,decision_reason_type:r.decision_reason_type});return {behavior:'allow',updatedInput:r.input};});
 await p.request('initialize',initPayload({perTaskStopAffordance:true}));
 const stop=async(kind,task)=>{
  const t0=Date.now(),from=p.seq;const r=await p.request('stop_task',{task_id:task.task_id});const responseSeq=p.frames.find(x=>x.frame.type==='control_response'&&x.seq>from)?.seq??null;
  p.note({event:'stop_response',kind,task_id:task.task_id,subtype:r.subtype,error:r.error??null,response:r.response??null,ms:Date.now()-t0,seq:responseSeq});
  await p.wait(f=>sys(f,'task_notification')&&f.task_id===task.task_id,{after:from,timeout:30000}).catch(()=>p.note({event:'stop_no_notification',kind,task_id:task.task_id}));
  await delay(3000);
  const rows=p.frames.filter(x=>x.seq>from);
  const frames=rows.filter(x=>JSON.stringify(x.frame).includes(task.task_id)&&x.frame.type==='system').map(x=>({seq:x.seq,ms:ms(x,t0),subtype:x.frame.subtype,status:x.frame.status??x.frame.patch?.status??null,patch:x.frame.patch??null,output_file:x.frame.output_file??null,summary:x.frame.summary??null}));
  const snapshots=rows.filter(x=>sys(x.frame,'background_tasks_changed')).map(x=>({seq:x.seq,ms:ms(x,t0),listsTask:x.frame.tasks.some(t=>t.task_id===task.task_id),tasks:x.frame.tasks.map(t=>({task_id:t.task_id,task_type:t.task_type}))}));
  p.note({event:'stop_sequence',kind,task_id:task.task_id,responseSeq,frames});
  p.note({event:'stop_snapshot',kind,task_id:task.task_id,snapshots});
  const others=rows.filter(x=>(sys(x.frame,'task_notification')||sys(x.frame,'task_updated'))&&x.frame.task_id!==task.task_id).map(x=>({seq:x.seq,ms:ms(x,t0),subtype:x.frame.subtype,task_id:x.frame.task_id,status:x.frame.status??x.frame.patch?.status??null}));
  if(kind==='workflow')p.note({event:'cascade',kind,task_id:task.task_id,otherTaskFrames:others,workflowProgressAfterStop:rows.filter(x=>sys(x.frame,'task_progress')&&x.frame.task_id===task.task_id).length});
 };
 const started=async(after,type)=>{const f=await p.wait(f=>sys(f,'task_started')&&f.task_type===type,{after,timeout:120000});p.note({event:'task_started_seen',type,task_id:f.task_id,tool_use_id:f.tool_use_id,is_backgrounded:f.is_backgrounded??null,description:f.description});return f;};
 const progressed=(after,task)=>p.wait(f=>sys(f,'task_progress')&&f.task_id===task.task_id,{after,timeout:120000});

 let after=p.seq;p.user('Run exactly "sleep 120 && echo DONE > bg.txt" with Bash, run_in_background true; reply STARTED.');
 const shell=await started(after,'local_bash');await stop('shell',shell);await idle(p);

 after=p.seq;p.user('Dispatch one general-purpose Agent in the background, model haiku, named "sleeper": run "sleep 90" with Bash then reply SLOW. Reply STARTED.');
 const agent=await started(after,'local_agent');await progressed(after,agent);await stop('agent',agent);await idle(p);

 after=p.seq;p.user('Call the Workflow tool once with this exact script, then reply STARTED:\n\n'+script);
 const workflow=await started(after,'local_workflow');await progressed(after,workflow);await stop('workflow',workflow);await idle(p);

 for(const [event,id] of [['stop_missing','no-such-task'],['stop_again',shell.task_id]]){const t0=Date.now(),from=p.seq;const r=await p.request('stop_task',{task_id:id});const answeredMs=Date.now()-t0;await delay(3000);
  p.note({event,task_id:id,subtype:r.subtype,error:r.error??null,response:r.response??null,ms:answeredMs,framesAfter:p.frames.filter(x=>x.seq>from&&x.frame.type==='system'&&JSON.stringify(x.frame).includes(id)).map(x=>({seq:x.seq,subtype:x.frame.subtype}))});}
 await idle(p,30000);
 spend(p);
},{dir:'fixtures/pass3/',mode:'auto',model:'sonnet',env:{CLAUDE_CONFIG_DIR:config},flags:['--forward-subagent-text','--replay-user-messages','--settings',JSON.stringify({enableWorkflows:true,skipWorkflowUsageWarning:true}),'--max-budget-usd','0.60']});};
