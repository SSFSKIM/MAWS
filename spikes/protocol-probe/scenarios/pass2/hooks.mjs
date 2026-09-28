// Item 5: host-registered PreToolUse hook over hook_callback plus a settings command hook, with --include-hook-events.
import {run,initPayload,bashAllow} from './common.mjs';
const settings={hooks:{PostToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'echo MAWS_POSTHOOK'}]}]}};
export default ()=>run('hooks',async p=>{
 p.on('hook_callback',r=>{p.note({event:'hook_callback_seen',callback_id:r.callback_id,hook_event_name:r.input?.hook_event_name,tool_name:r.input?.tool_name,tool_use_id:r.tool_use_id,deadline_ms:r.deadline_ms});return {continue:true,hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext:'MAWS host hook saw this call.'}};});
 const init=await p.request('initialize',initPayload({hooks:{PreToolUse:[{matcher:'Bash',hookCallbackIds:['maws_pre_bash'],timeout:15}]}}));p.note({event:'hooks_applied',hooks_applied:init.response?.hooks_applied});
 bashAllow(p);await p.turn('Use Bash to run exactly: git status --short. Then reply OK.');
 await p.request('get_hooks_listing',{});
},{model:'sonnet',flags:['--include-hook-events','--settings',JSON.stringify(settings)]});
