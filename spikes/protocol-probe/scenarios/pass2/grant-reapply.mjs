// Item 9: a session grant answered on can_use_tool, then exit, --resume, and re-application through apply_flag_settings.
// No ask rule: the prompt comes from default mode on a write command, so allow rules can decide it.
import {run,initPayload,scratch2} from './common.mjs';
const CMD='touch granted.txt';
const answer=p=>p.on('can_use_tool',r=>{const cmd=(r.input?.command||'').trim();p.note({event:'prompt',command:cmd,decision_reason_type:r.decision_reason_type});
 if(cmd===CMD)return {behavior:'allow',updatedInput:r.input,updatedPermissions:[{type:'addRules',rules:[{toolName:'Bash',ruleContent:CMD}],behavior:'allow',destination:'session'}]};
 return {behavior:'deny',message:'Probe denial: do not retry.'};});
export default async()=>{const cwd=scratch2();const o={cwd,mode:'default',model:'sonnet'};
 const first=await run('grant-reapply-start',async p=>{await p.request('initialize',initPayload());answer(p);
  await p.turn('Use Bash to run exactly: '+CMD+'\nThen use Bash to run exactly the same command a second time.\nReply DONE.');
  await p.request('list_permission_rules',{});},o);
 await run('grant-reapply-resume',async p=>{await p.request('initialize',initPayload());answer(p);
  await p.request('list_permission_rules',{});
  await p.request('apply_flag_settings',{settings:{permissions:{allow:['Bash('+CMD+')']}}});
  await p.request('list_permission_rules',{});
  await p.turn('Use Bash to run exactly: '+CMD+'\nThen reply DONE.');
 },{...o,flags:['--resume',first.sessionId]});
};
