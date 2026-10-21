// P4-R7y (docs/doperpowers/plans/2026-10-19-p4-smoothing.md, the follow-up to Decision Logs 48 and 49; parent pin
// bd54d325b4c967eeafb98fb6426049bff1c55669 at master 4326f0a97; 2026-10-21): on MAWS's own wire, which mechanism gives
// the model a SessionStart context at every start of a session (a new session, a compaction, a clear, a resume, a fork):
//   callback  a host hook callback registered through `initialize.hooks` (src/engine-host/host-hooks.ts) and answered
//             on `hook_callback` with `hookSpecificOutput.additionalContext`;
//   command   a command hook in the `--settings` JSON (src/engine-host/launch.ts) printing the same answer: the group
//             MAWS puts there (src/shared/owner/contract.ts messageToolHookGroup), exec form.
// The context is the owner's (contract.ts MESSAGE_TOOL_ALIAS). Each launch is MAWS's (p1-common: the
// launch line, the initialize payload, the `--settings` JSON with MAWS_NATIVE_TO_HUMAN in its env as a lane-on launch
// carries it). Fixtures under fixtures/p4/ (findings-p4-r7y-session-start.txt):
//   stub-<mechanism>[-plain|-resume|-resume-again|-fork]  against the scripted Messages API (../../stub-api.mjs,
//             nothing spent): one launch through a first turn, `/compact`, a turn, `/clear` and a turn; a session
//             without the hook, its `--resume` with it, a second `--resume` and a `--fork-session` of it, one turn each;
//             every request the engine sent is recorded, with each place the context appears
//   relay-control, relay-resume, relay-startup  the mechanism the stub runs chose, on a real model through the relay,
//             with a recorder between engine and relay: a new session without the hook asked what the plugin's tool is
//             here (the baseline), its `--resume` with the hook asked again, and a new session with the hook asked
// Run: PROBE_ENGINE=~/.local/share/claude/versions/<pinned> [R7Y_ARM=stub,relay] [R7Y_MECHANISM=callback] node run-pass3.mjs p4-r7y-session-start
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,delay,randomUUID,transcriptPath,ENGINE_VERSION} from './p1-common.mjs';
import {startStubApi,textTurn} from '../../stub-api.mjs';
import {startRecorder} from './p4-r7-message-tool.mjs';
import {existsSync,readFileSync} from 'node:fs';

const contract=await import('../../../../src/shared/owner/contract.ts');
export const TEXT=contract.MESSAGE_TOOL_ALIAS;
const PROVENANCE={child:'P4-R7y',pin:'bd54d325b4c967eeafb98fb6426049bff1c55669',document:'docs/doperpowers/plans/2026-10-19-p4-smoothing.md',spike:'the SessionStart context on MAWS\'s own wire (D-1)'};
export const CALLBACK_ID='maws_SessionStart_1'; // HostHookRegistry's first id for the event
export const ANSWER=JSON.parse(contract.messageToolHookGroup().hooks[0].args[1]); // the callback answers what the command prints
const LANE_ENV={MAWS_NATIVE_TO_HUMAN:String(contract.TO_HUMAN_CONTRACT_VERSION)};
// The `--settings` JSON of a lane-on launch, with MAWS's group when the command hook is the mechanism.
const settingsFor=(mechanism,hook)=>({dialogExpiry:'never',env:LANE_ENV,...(hook&&mechanism==='command'?{hooks:{SessionStart:[contract.messageToolHookGroup()]}}:{})});
const initFor=(run,mechanism,hook)=>({...initPayload(run.cwd),...(hook&&mechanism==='callback'?{hooks:{SessionStart:[{hookCallbackIds:[CALLBACK_ID]}]}}:{})});

// Each place the context appears in a request the engine sent, with the block around it whole, and the head of every
// user text block (which prompt the request carries).
const textOfSystem=s=>typeof s==='string'?s:Array.isArray(s)?s.map(b=>b?.text??'').join('\n'):'';
const blocksOf=m=>typeof m.content==='string'?[{type:'text',text:m.content}]:m.content??[];
const count=(text,needle)=>text.split(needle).length-1;
export function record(body){
 const hits=[];const prompts=[];
 (body.messages??[]).forEach((m,i)=>blocksOf(m).forEach((b,j)=>{
  if(b.type!=='text')return;
  if(b.text.includes(TEXT))hits.push({message:i,block:j,role:m.role,copies:count(b.text,TEXT),text:b.text.slice(0,3000)});
  else if(m.role==='user')prompts.push({message:i,block:j,head:b.text.slice(0,160)});
 }));
 return {model:body.model,messages:(body.messages??[]).length,tools:(body.tools??[]).length,inSystem:textOfSystem(body.system).includes(TEXT),copies:hits.reduce((n,h)=>n+h.copies,0),hits,prompts};
}

const hookFrames=p=>p.frames.filter(r=>r.frame.type==='system'&&String(r.frame.subtype).startsWith('hook_')).map(r=>({seq:r.seq,subtype:r.frame.subtype,hook_name:r.frame.hook_name??null,hook_event:r.frame.hook_event??null,outcome:r.frame.outcome??null}));
const callbackFrames=p=>p.frames.filter(r=>r.frame.type==='control_request'&&r.frame.request?.subtype==='hook_callback').map(r=>({seq:r.seq,callback_id:r.frame.request.callback_id,hook_event_name:r.frame.request.input?.hook_event_name??null,source:r.frame.request.input?.source??null}));
const initializeSeq=p=>{const rows=readFileSync(p.file,'utf8').trim().split('\n').map(l=>JSON.parse(l));return rows.find(r=>r.direction==='out'&&r.frame.type==='control_request'&&r.frame.request?.subtype==='initialize')?.seq??null;};
// The transcript's attachment records of the hook's context: what a resume reads back.
function diskContext(run,sessionId){
 const file=transcriptPath(run,sessionId);
 if(!existsSync(file))return null;
 return readFileSync(file,'utf8').trim().split('\n').map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(r=>r?.type==='attachment'&&r.attachment?.type==='hook_additional_context').map(r=>({uuid:r.uuid,hookEvent:r.attachment.hookEvent,content:r.attachment.content}));
}

// One launch: `steps` sent as turns in order, each step's requests noted beside it. `api`: the stub or the recorder,
// `{url, requests: () => recorded}`.
async function one(name,{run,api,mechanism,hook,question,steps,sessionId,resume=null,fork=false,model='haiku',relay=false,spendCap='0.01'}){
 const out={sessionId:null,callbacks:[],requests:[]};
 await launch(name,run,{dir:'fixtures/p4/',relay,spendCap,model,sessionId:resume&&!fork?null:sessionId,pinned:resume===null||fork,vars:{ANTHROPIC_BASE_URL:api.url,...(relay?{}:{ANTHROPIC_AUTH_TOKEN:'stub-token'})},flagSettings:settingsFor(mechanism,hook),flags:resume?['--resume',resume,...(fork?['--fork-session']:[])]:[],provenance:{...PROVENANCE,question,mechanism,hook,text:TEXT,api:relay?'the relay, through a recorder':'stub-api.mjs (nothing spent)'}},async p=>{
  p.on('hook_callback',r=>{
   const row={callback_id:r.callback_id,hook_event_name:r.input?.hook_event_name??null,source:r.input?.source??null};
   out.callbacks.push(row);p.note({event:'hook_callback_seen',...row});
   return r.callback_id===CALLBACK_ID?ANSWER:{};
  });
  const init=success(await p.init(initFor(run,mechanism,hook)),'initialize');
  p.note({event:'initialize_answer',hooks_applied:init.hooks_applied??null,initializeSeq:initializeSeq(p)});
  for(const prompt of steps){
   const before=api.requests().length;
   const result=await p.turn(prompt);
   await delay(800);
   p.note({event:'step',prompt,result:{subtype:result.subtype,is_error:result.is_error,total_cost_usd:result.total_cost_usd??null},session_id:p.sessionId,requests:api.requests().slice(before)});
  }
  out.sessionId=p.sessionId;
  out.requests=api.requests();
  p.note({event:'starts',callbacks:callbackFrames(p),hookFrames:hookFrames(p)});
  p.note({event:'disk',sessionId:p.sessionId,context:diskContext(run,p.sessionId)});
  check(p,'the engine sent a request',out.requests.length>0);
  await endAsStop(p);
 });
 return out;
}

// The stub arm of one mechanism: a launch through each start but a resume, then the resume.
async function stubArm(mechanism){
 const run=scratchRun('r7y-'+mechanism);
 const stub=await startStubApi({record,side:()=>textTurn('ok')});
 const api={url:stub.url,requests:()=>stub.requests};
 const opts={run,api,mechanism};
 const next=()=>{stub.requests.length=0;};
 try{
  await one(`p4-r7y-stub-${mechanism}`,{...opts,hook:true,sessionId:randomUUID(),question:`${mechanism}: does the context reach the model at startup, after /compact and after /clear`,steps:['Reply with OK.','/compact','Reply with OK again.','/clear','Reply with OK once more.']});
  next();
  const plain=await one(`p4-r7y-stub-${mechanism}-plain`,{...opts,hook:false,sessionId:randomUUID(),question:'the baseline: a session without the hook, the one the resumes read',steps:['Reply with OK.']});
  next();
  await one(`p4-r7y-stub-${mechanism}-resume`,{...opts,hook:true,resume:plain.sessionId,question:`${mechanism}: does the context reach the model at a --resume of a session that never had it`,steps:['Reply with OK after the resume.']});
  next();
  await one(`p4-r7y-stub-${mechanism}-resume-again`,{...opts,hook:true,resume:plain.sessionId,question:`${mechanism}: a second --resume, its history already carrying the context: how many copies reach the model`,steps:['Reply with OK after the second resume.']});
  next();
  await one(`p4-r7y-stub-${mechanism}-fork`,{...opts,hook:true,resume:plain.sessionId,fork:true,sessionId:randomUUID(),question:`${mechanism}: a --fork-session of that session, pinned as MAWS pins a fork: which source the start reports, and how many copies reach the model`,steps:['Reply with OK in the fork.']});
 }finally{await stub.close();removeRun(run);}
}

// The relay arm: the baseline, its resume with the hook, a new session with the hook; a real model's answers.
export const QUESTION='Without calling any tool, answer in one line: in this session, which tool do you call where your instructions name mcp__to-human__message? Reply with the exact tool name only, or "none" if there is none.';
async function relayArm(mechanism){
 const run=scratchRun('r7y-relay');
 const recorded=[];
 const {server,port}=await startRecorder(x=>recorded.push(x));
 const api={url:`http://127.0.0.1:${port}`,requests:()=>recorded.filter(x=>x.path?.startsWith('/v1/messages')&&!x.path.includes('count_tokens')&&x.body).map(x=>({status:x.status,...record(JSON.parse(x.body.toString('utf8'))),answer:answerOf(x)}))};
 const opts={run,api,mechanism,relay:true,spendCap:'0.10',steps:[QUESTION]};
 try{
  const control=await one('p4-r7y-relay-control',{...opts,hook:false,sessionId:randomUUID(),question:'the baseline: a new session without the hook, asked what the plugin\'s message tool is here'});
  recorded.length=0;
  await one('p4-r7y-relay-resume',{...opts,hook:true,resume:control.sessionId,question:`${mechanism}: the baseline's --resume with the hook, asked again`});
  recorded.length=0;
  await one('p4-r7y-relay-startup',{...opts,hook:true,sessionId:randomUUID(),question:`${mechanism}: a new session with the hook, asked`});
 }finally{server.close();removeRun(run);}
}
// The text the API streamed back for one exchange.
function answerOf(x){
 const text=x.response?.toString('utf8')??'';
 try{const json=JSON.parse(text);if(Array.isArray(json.content))return json.content.filter(b=>b.type==='text').map(b=>b.text).join('');}catch{}
 return text.split('\n').filter(l=>l.startsWith('data: ')).map(l=>{try{return JSON.parse(l.slice(6));}catch{return null;}}).filter(e=>e?.type==='content_block_delta'&&e.delta?.type==='text_delta').map(e=>e.delta.text).join('');
}

export default async()=>{
 console.log('engine',ENGINE_VERSION);
 const arms=(process.env.R7Y_ARM??'stub').split(',');
 const mechanisms=(process.env.R7Y_MECHANISM??'callback,command').split(',');
 if(arms.includes('stub'))for(const m of mechanisms)await stubArm(m);
 if(arms.includes('relay'))await relayArm(mechanisms[0]);
};
