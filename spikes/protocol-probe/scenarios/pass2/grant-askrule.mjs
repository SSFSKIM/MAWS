// Item 9, first variant: the prompt comes from an ask rule, which shows that an allow rule never outranks a matching ask rule.
import {run,initPayload,scratch2} from './common.mjs';
const RULE='git log --oneline';
const o=cwd=>({cwd,mode:'default',model:'sonnet',flags:['--settings',JSON.stringify({permissions:{ask:['Bash(git:*)']}})]});
const answer=p=>p.on('can_use_tool',r=>{const cmd=r.input?.command||'';p.note({event:'prompt',command:cmd,decision_reason_type:r.decision_reason_type,matched_ask_rule:r.matched_ask_rule});
 if(cmd.trim()===RULE)return {behavior:'allow',updatedInput:r.input,updatedPermissions:[{type:'addRules',rules:[{toolName:'Bash',ruleContent:RULE}],behavior:'allow',destination:'session'}]};
 return {behavior:'deny',message:'Probe denial: do not retry.'};});
export default async()=>{const cwd=scratch2();
 const first=await run('grant-askrule-start',async p=>{await p.request('initialize',initPayload());answer(p);
  await p.turn('Use Bash to run exactly: git log --oneline\nThen use Bash to run exactly: git branch --show-current\nIf anything is denied, do not retry. Reply DONE.');
  await p.request('list_permission_rules',{});},o(cwd));
 await run('grant-askrule-resume',async p=>{await p.request('initialize',initPayload());answer(p);
  await p.request('list_permission_rules',{});
  await p.request('apply_flag_settings',{settings:{permissions:{allow:['Bash('+RULE+')']}}});
  await p.request('list_permission_rules',{});
  await p.turn('Use Bash to run exactly: git log --oneline\nThen reply DONE.');
 },{...o(cwd),flags:[...o(cwd).flags,'--resume',first.sessionId]});
};
