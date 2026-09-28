// Item 7, second half: the affordance governs background agents and workflows, so interrupt while a one-agent workflow runs.
import {run,initPayload,delay} from './common.mjs';
import {existsSync} from 'node:fs';
const script=`export const meta = { name: 'maws-stop-probe', description: 'One slow agent', phases: [{ title: 'Wait' }] }
phase('Wait')
return await agent('Use Bash to run exactly: sleep 25 && echo WF_DONE > wf.txt . Then reply DONE.', {label: 'sleeper', effort: 'low'})`;
const body=affordance=>async p=>{await p.request('initialize',initPayload(affordance?{perTaskStopAffordance:true}:{}));
 p.on('can_use_tool',r=>{p.note({event:'escalation',tool:r.tool_name,agent_id:r.agent_id,decision_reason_type:r.decision_reason_type});return {behavior:'allow',updatedInput:r.input};});
 const after=p.seq;p.user('Step 1: call the Workflow tool with this exact script:\n\n'+script+'\n\nStep 2: then use Bash in the foreground to run exactly: sleep 20\nStep 3: reply DONE.');
 await p.wait(f=>f.type==='system'&&f.subtype==='task_started'&&f.task_type==='local_workflow',{after,timeout:120000});
 await p.wait(f=>f.type==='assistant'&&f.message.content.some(b=>b.type==='tool_use'&&/sleep 20/.test(b.input?.command||'')),{after,timeout:120000});await delay(2000);
 const t0=Date.now();const r=await p.request('interrupt',{reason:'probe'});p.note({event:'interrupted',affordance,receipt:r.response});
 await p.wait(f=>f.type==='result',{after});
 await p.wait(f=>f.type==='system'&&f.subtype==='task_notification',{after,timeout:60000}).catch(()=>p.note({event:'no_task_notification'}));
 await delay(Math.max(0,32000-(Date.now()-t0)));p.note({event:'background_outcome',affordance,wfFileExists:existsSync(p.cwd+'/wf.txt'),secondsAfterInterrupt:Math.round((Date.now()-t0)/1000)});
 await p.wait(f=>f.type==='result',{after:p.seq,timeout:30000}).catch(()=>{});
};
const o={model:'sonnet',env:{CLAUDE_CODE_SUBAGENT_MODEL:'sonnet'},flags:['--settings',JSON.stringify({enableWorkflows:true,skipWorkflowUsageWarning:true})]};
export default async()=>{await run('per-task-stop-workflow-off',body(false),o);await run('per-task-stop-workflow-on',body(true),o);};
