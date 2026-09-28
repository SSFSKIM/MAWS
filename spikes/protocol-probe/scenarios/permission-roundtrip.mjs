import {run} from '../harness.mjs';
export default ()=>run('permission-roundtrip',async p=>{
 await p.init();let mode='allow';
 p.on('can_use_tool',r=>{if(r.tool_name!=='Bash')return {behavior:'deny',message:'Only Bash is in scope.'};if(mode==='deny')return {behavior:'deny',message:'Probe denial: do not retry this command.'};return {behavior:'allow',updatedInput:r.input,...(mode==='rule'?{updatedPermissions:[{type:'addRules',rules:[{toolName:'Bash',ruleContent:'git status --short'}],behavior:'allow',destination:'session'}]}:{})};});
 await p.turn('Use Bash to run exactly git log --oneline. Then say DONE.');mode='deny';
 await p.turn('Use Bash to run exactly git branch --show-current. If denied, stop.');mode='rule';
 await p.turn('Use Bash to run exactly git status --short. Then say DONE.');
 await p.request('list_permission_rules');await p.request('set_permission_mode',{mode:'acceptEdits'});await p.request('set_permission_mode',{mode:'default'});
},{flags:['--settings',JSON.stringify({permissions:{ask:['Bash']}})]});
