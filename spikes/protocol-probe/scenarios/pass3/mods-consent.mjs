// R0 question 5 (mods-common.mjs): does the "Mods" consent ("Enable hot reloading for this session?", r6 §3.5) reach a
// stdio host, and as what? The engine watches the session's dev-mods folder (`<config>/dev-mods/<sessionId>`) from the
// start when the folder exists and someone can be asked, and asks the person once a mod appears in it while no turn
// runs (S287 chunk-5xa9nbn4: Co → _ → ho; the ask is confirmWithUser, an AskUserQuestion permission request with a
// `confirm_` id, `personOnly`). So: MAWS's launch with that folder created empty and the session id pinned, no mod in the
// skills folder; after initialize the probe writes the probe mod into the folder and waits. A consent request is
// recorded whole and answered "Enable for this session" (the scratch session's only mod is the probe's); then one
// no-tools turn shows what the session tells the model and whether the loaded mod pushes.
import {scratchRun,removeRun,launch,initPayload,success,check,endAsStop,summarize,promptTurn,writeMod,delay,join,mkdirSync,randomUUID,uiPushes,GATE,MOD_NAME} from './mods-common.mjs';

const ENABLE='Enable for this session';

export default async()=>{
 const run=scratchRun('consent',{settings:{env:{[GATE]:'1'}},mod:false});
 const sessionId=randomUUID();
 const folder=join(run.home,'dev-mods',sessionId);
 mkdirSync(folder,{recursive:true});
 try{
  await launch('mods-consent',run,{sessionId,provenance:{question:'R0 Q5 the dev-mods consent over stdio',devModsFolder:folder}},async p=>{
   const asked=[];
   p.on('can_use_tool',r=>{
    const isConsent=String(r.tool_use_id??'').startsWith('confirm_');
    p.note({event:isConsent?'consent_request':'tool_request',tool_name:r.tool_name,tool_use_id:r.tool_use_id,keys:Object.keys(r).sort()});
    if(!isConsent)return {behavior:'deny',message:'Probe has no handler for this tool.'};
    asked.push(r);
    const question=r.input?.questions?.[0]?.question;
    return {behavior:'allow',updatedInput:{...r.input,answers:{[question]:ENABLE}}};
   });
   success(await p.init(initPayload(run.cwd)),'initialize');
   await delay(3000);
   const before=p.seq;
   writeMod(join(folder,MOD_NAME));
   p.note({event:'mod_written',folder:join(folder,MOD_NAME)});
   for(let i=0;i<30&&asked.length===0;i++)await delay(1000);
   p.note({event:'consent_outcome',asked:asked.length,framesSinceWrite:p.frames.filter(r=>r.seq>before).map(r=>({seq:r.seq,type:r.frame.type,subtype:r.frame.subtype??r.frame.request?.subtype??null}))});
   if(asked.length>0)await delay(8000);
   const pushesBeforeTurn=uiPushes(p).map(f=>f.subtype+':'+(f.text??''));
   await promptTurn(p);
   const s=summarize(p,'mods-consent');
   p.note({event:'consent_observation',asked:asked.length,pushesBeforeTurn,pushes:s.pushes.map(x=>x.subtype+':'+(x.text??'')),plugins:s.plugins});
   check(p,'one turn answered',s.answer!==null);
   await endAsStop(p);
  });
 }finally{removeRun(run);}
};
