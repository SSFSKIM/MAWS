// Item 3: a tiny Workflow run (one phase, two agents); capture task_progress.workflow_progress and the session's workflows/ directory.
import {run,initPayload,transcriptPath,delay} from './common.mjs';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
const script=`export const meta = { name: 'maws-probe', description: 'Two echo agents in one phase', phases: [{ title: 'Echo' }] }
phase('Echo')
const out = await parallel([() => agent('Reply with exactly ALPHA and nothing else.', {label: 'alpha', effort: 'low'}), () => agent('Reply with exactly BETA and nothing else.', {label: 'beta', effort: 'low'})])
return out`;
export default ()=>run('workflow',async p=>{await p.request('initialize',initPayload({perTaskStopAffordance:true}));
 p.on('can_use_tool',r=>{p.note({event:'escalation',tool:r.tool_name,decision_reason_type:r.decision_reason_type});return {behavior:'allow',updatedInput:r.input};});
 const after=p.seq;await p.turn('Call the Workflow tool once with this exact script as the script parameter, then reply STARTED:\n\n'+script);
 await p.wait(f=>f.type==='system'&&f.subtype==='task_notification'&&/workflow/i.test(JSON.stringify(f)),{after,timeout:240000}).catch(e=>p.note({event:'wait_failed',what:'workflow task_notification',error:e.message}));
 await p.wait(f=>f.type==='result',{after:p.seq,timeout:90000}).catch(()=>p.note({event:'no_followup_turn'}));await delay(2000);
 const t=transcriptPath(p.sessionId);if(t){const dir=dirname(t)+'/'+p.sessionId;let listing='';try{listing=execFileSync('find',[dir,'-maxdepth','4'],{encoding:'utf8'});}catch(e){listing=String(e.message).slice(0,200);}p.note({event:'session_dir',dir:dir.replace(/^.*\/\.claude\//,'~/.claude/'),listing:listing.split('\n').filter(Boolean).map(s=>s.replace(dir,'<session>'))});}
},{model:'sonnet',flags:['--settings',JSON.stringify({enableWorkflows:true,skipWorkflowUsageWarning:true})]});
