// Board ticket 851 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, M0): what an engine started before its first
// message does while it waits, and which of a new chat's picks the control protocol can still change then. Answered
// from what the engine sends a scripted Messages API stand-in (../../stub-api.mjs), so nothing is spent, under a scratch
// CLAUDE_CONFIG_DIR (p1-common.mjs: none of the person's settings, hooks or plugins load; the environment is rebuilt from
// the base keys, so no sminos variable reaches the engine and the only token is the stand-in's).
//   uxwave-851-idle            a new session (pinned id) initialized and held 60 s with no message: every request it
//                              makes, and whether a transcript is written before, during or after
//   uxwave-851-hook-idle       a SessionStart hook that returns additionalContext, the session stopped before any
//                              message: does the context make the engine write a file
//   uxwave-851-hook-turn       the same hook, then one message: the hook did run (its context reaches the request), and
//                              the file appears only now
//   uxwave-851-set-model       launched on haiku, `set_model sonnet` before the first message: the first request's
//                              model, system/init's model and permission mode
//   uxwave-851-set-mode        `set_permission_mode acceptEdits` before the first message (W5 on this engine)
//   uxwave-851-effort-launch   effortLevel "low" in the launch's --settings: what an effort set at launch puts in the
//                              request (the reference the live arm is read against)
//   uxwave-851-effort-live     the same launch without it, then `apply_flag_settings {effortLevel: "low"}` before the
//                              first message
//   uxwave-851-effort-none     neither: the request at the default effort
import {check,success,initFrame,endAsStop,launch,scratchRun,removeRun,initPayload,delay,randomUUID,existsSync,transcriptPath,projectFiles} from './p1-common.mjs';
import {startStubApi,textTurn} from '../../stub-api.mjs';

const CONTEXT_MARK='PROBE-851-CONTEXT';
const HOOK_OUTPUT=JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:`${CONTEXT_MARK}: the scratch hook ran.`}});
const HOOK_SETTINGS={hooks:{SessionStart:[{matcher:'startup',hooks:[{type:'command',command:`printf '%s' '${HOOK_OUTPUT}'`}]}]}};
const FLAG_SETTINGS={dialogExpiry:'never'};
const IDLE_MS=Number(process.env.UX851_IDLE_MS??60000);

// What a request carried, kept to what the questions read: the model, the effort and thinking fields wherever the
// engine puts them, the body's keys, and whether the hook's context reached it.
const PICKED=['model','max_tokens','thinking','output_config','temperature','context_management'];
function record(body){
 return {keys:Object.keys(body).sort(),...Object.fromEntries(PICKED.filter(k=>k in body).map(k=>[k,body[k]])),tools:(body.tools??[]).length,hookContext:JSON.stringify(body).includes(CONTEXT_MARK)};
}
const PROVENANCE={charter:'docs/charter.md',child:'board ticket 851',document:'docs/doperpowers/plans/2026-11-24-prestart-engine.md',api:'stub-api.mjs (nothing spent)'};
const files=(run,id)=>({transcript:existsSync(transcriptPath(run,id)),projectFiles:projectFiles(run)});

async function probe(name,{question,model='haiku',settings={},flagSettings=FLAG_SETTINGS,script=[textTurn('ready')],body}){
 const run=scratchRun(name.replace(/^uxwave-/,''),{settings});
 const stub=await startStubApi({script,record});
 const sessionId=randomUUID();
 try{
  await launch(name,run,{dir:'fixtures/uxwave/',relay:false,spendCap:'0.01',model,sessionId,flagSettings,vars:{ANTHROPIC_BASE_URL:stub.url,ANTHROPIC_AUTH_TOKEN:'stub-token'},provenance:{...PROVENANCE,question}},async p=>{
   const spawnedAt=Date.now();
   const init=success(await p.init(initPayload(run.cwd)),'initialize');
   p.note({event:'initialized',afterSpawnMs:Date.now()-spawnedAt,currentPermissionMode:init.current_permission_mode??null,model:init.model??null,files:files(run,sessionId),requests:stub.requests.slice()});
   await body(p,{stub,run,sessionId});
   const sysInit=initFrame(p);
   p.note({event:'system_init',present:sysInit!==undefined,model:sysInit?.model??null,permissionMode:sysInit?.permissionMode??null});
   p.note({event:'stub_requests',requests:stub.requests});
   p.note({event:'files_before_exit',...files(run,sessionId)});
   await endAsStop(p);
   p.note({event:'files_after_exit',...files(run,sessionId)});
  });
 }finally{await stub.close();removeRun(run);}
}

const turn=async p=>{await p.turn('Say ready.');};
const idle=async(p,{stub,run,sessionId})=>{
 const marks=[];
 for(let waited=0;waited<IDLE_MS;waited+=10000){await delay(Math.min(10000,IDLE_MS-waited));marks.push({afterMs:Math.min(waited+10000,IDLE_MS),requests:stub.requests.length,...files(run,sessionId)});}
 p.note({event:'idle_marks',marks});
 check(p,'no Messages API request while idle',stub.requests.every(r=>r.path!=='/v1/messages'),stub.requests);
};
const shortIdle=async(p,{run,sessionId})=>{await delay(5000);p.note({event:'idle_marks',marks:[{afterMs:5000,...files(run,sessionId)}]});};
const control=(subtype,payload)=>async(p,ctx)=>{
 const answer=await p.request(subtype,payload,15000).catch(e=>({error:String(e.message)}));
 p.note({event:'control_answer',subtype,payload,answer});
 await turn(p,ctx);
};

const SCENARIOS={
 'uxwave-851-idle':{question:'a new session held 60 s after initialize with no message: requests and files',body:idle},
 'uxwave-851-hook-idle':{question:'a SessionStart hook with additionalContext, stopped before any message: is a file written',settings:HOOK_SETTINGS,body:shortIdle},
 'uxwave-851-hook-turn':{question:'the same hook, then one message: the context reaches the request and the file appears',settings:HOOK_SETTINGS,body:turn},
 'uxwave-851-set-model':{question:'set_model before the first message: the first request\'s model, init model and mode',body:control('set_model',{model:'sonnet'})},
 'uxwave-851-set-mode':{question:'set_permission_mode before the first message on this engine',body:control('set_permission_mode',{mode:'acceptEdits'})},
 'uxwave-851-effort-launch':{question:'effortLevel low at launch: what the request carries',model:'opus',flagSettings:{...FLAG_SETTINGS,effortLevel:'low'},body:turn},
 'uxwave-851-effort-live':{question:'apply_flag_settings effortLevel low before the first message: what the request carries',model:'opus',body:control('apply_flag_settings',{settings:{effortLevel:'low'}})},
 'uxwave-851-effort-none':{question:'no effort set: the request at the default',model:'opus',body:turn},
};

export default async()=>{
 const only=(process.env.UX851_ONLY??'').split(',').filter(Boolean);
 for(const [name,scenario] of Object.entries(SCENARIOS))if(only.length===0||only.includes(name))await probe(name,scenario);
};
