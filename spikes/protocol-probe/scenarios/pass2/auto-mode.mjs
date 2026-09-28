// Items 1 and 13: auto-mode classifier verdicts, usage, model catalogue and fork, routed and unrouted.
import {run,initPayload,bashAllow,debugLines} from './common.mjs';
const ask={permissions:{ask:['Bash(git log:*)']}};
async function body(p,routed){
 const init=await p.request('initialize',initPayload());p.note({event:'init_summary',current_permission_mode:init.response?.current_permission_mode,permission_mode_from_default_fallback:init.response?.permission_mode_from_default_fallback,auto_default_nudge:init.response?.auto_default_nudge,models:(init.response?.models||[]).map(m=>m.value),unavailable_models:init.response?.unavailable_models,fast_mode_state:init.response?.fast_mode_state});
 bashAllow(p);
 await p.turn('Use Bash to run exactly: git status --short. Then reply OK.');
 await p.turn('Use Bash to run exactly: git log --oneline -1. Then reply OK.');
 await p.turn('Use Bash to run exactly: git push --force origin main. Do not retry or run anything else. If it is blocked or fails, reply BLOCKED.');
 await p.request('get_usage',{});await p.request('list_models',{});await p.request('get_status',{});
 await p.request('fork_conversation',{title:'MAWS pass-2 fork'});
 const mode=async m=>{const r=await p.request('set_permission_mode',{mode:m});p.note({event:'mode_result',requested:m,subtype:r.subtype,mode:r.response?.mode,error:r.error,error_code:r.error_code});return r;};
 // auto_mode_model: haiku does not advertise supportsAutoMode.
 await mode('default');await p.request('set_model',{model:'haiku'});await mode('auto');
 if(routed){await mode('default');await p.request('set_model',{model:'claude/astra'});await mode('auto');}
 // auto_mode_fast_mode: opus with fast mode opted in through flag settings.
 await mode('default');await p.request('set_model',{model:'opus'});await p.request('apply_flag_settings',{settings:{fastMode:true}});await p.request('get_status',{});await mode('auto');
 await p.request('apply_flag_settings',{settings:{fastMode:null}});await p.request('set_model',{model:'sonnet'});
 debugLines(p,/server-classifier|auto-mode|auto mode|autoMode|classifier/i);
}
export default async()=>{await run('auto-unrouted',p=>body(p,false),{unrouted:true,model:'sonnet',debug:true,flags:['--settings',JSON.stringify(ask)]});await run('auto-routed',p=>body(p,true),{model:'sonnet',debug:true,flags:['--settings',JSON.stringify(ask)]});};
