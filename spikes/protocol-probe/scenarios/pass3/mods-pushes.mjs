// R0 questions 1 and 2 (mods-common.mjs): MAWS's launch on the installed 2.1.287 with the owner's switch as their
// settings give it (`env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1"` in the user settings), the probe mod in the scratch
// skills folder, and one no-tools prompt; MAWS never sends ui_attach. Does system/init carry ui_surface_v1, and do the
// mod's ui_toast, ui_status and ui_log reach stdout without an attach?
import {scratchRun,removeRun,launch,initPayload,success,check,endAsStop,summarize,promptTurn,GATE} from './mods-common.mjs';

export default async()=>{
 const run=scratchRun('pushes',{settings:{env:{[GATE]:'1'}}});
 try{
  await launch('mods-pushes',run,{provenance:{question:'R0 Q1 init capability, Q2 pushes without ui_attach'}},async p=>{
   const init=success(await p.init(initPayload(run.cwd)),'initialize');
   p.note({event:'initialize_capabilities',capabilities:init.capabilities??null,workspace_trust_recorded:init.workspace_trust_recorded??null});
   await promptTurn(p);
   const s=summarize(p,'mods-pushes');
   check(p,'one turn answered',s.answer!==null);
   await endAsStop(p);
  });
 }finally{removeRun(run);}
};
