// P5 O2 M2, the spike that comes first (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M2 "The spike comes first";
// parent docs/doperpowers/plans/2026-10-27-p5-org.md, child O2, parent pin blob 063f83c39b873ee8401870c12179a859c0ac31a5;
// 2026-10-27): on MAWS's own wire, what a Stop host hook callback (`initialize.hooks`, callback id maws_Stop_1, event
// Stop, no matcher, timeout 10 s, answered `{}` at once) tells the engine host about a session's scheduled jobs:
//   1  does the Stop `hook_callback` arrive before the turn's `result`, listing a CronCreate's job in `session_crons`,
//      and an empty list after CronDelete?
//   2  does an interrupted turn send no Stop?
//   3  in -p, does a dynamic `/loop` tick that ends without ScheduleWakeup get the keepalive wakeup, and does the next
//      Stop list it?
//   4  after --resume of a session holding a durable cron and of one holding a session-only cron, does the first Stop
//      list them, and can one fire before that Stop?
//   5  does a subagent's CronCreate appear in the main thread's Stop list?
// Each launch is MAWS's (p1-common: the launch line, the initialize payload, a scratch config home) against a scripted
// Messages API (sseOf from ../../stub-api.mjs; nothing spent). The script is keyed by content rather than by order: a
// prompt carries a marker `[[P5O2:<plan>]]` that picks its plan, and a tool_result continues the plan of the tool_use it
// answers, so side requests (titles) and a subagent's requests never shift the script. Fixtures under fixtures/p5/
// (findings-p5-o2-stop-crons.txt):
//   main              one session: CronCreate, CronDelete, a subagent's CronCreate (launched as the model launches one,
//                     then with run_in_background false), CronList, an interrupted turn after
//                     a CronCreate, a plain turn, a dynamic /loop (ScheduleWakeup), its tick ending without one, a plain
//                     turn and CronList
//   durable, session  a session creating a durable (`durable: true`) or a session-only every-minute cron
//   durable-resume, session-resume  the --resume of each, idle until a Stop or 150 s, then a CronList turn
// Run on a Linux host or the mini, never on the owner's MacBook (P5 Decision Log 29):
//   PROBE_ENGINE=~/.local/share/claude/versions/<pinned> node run-pass3.mjs p5-o2-stop-crons
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,delay,randomUUID,existsSync,ENGINE_VERSION} from './p1-common.mjs';
import {sseOf,jsonOf,textTurn,toolTurn} from '../../stub-api.mjs';
import {allowAll,blocks,textOf} from './e7-common.mjs';
import {idle} from './c8b-common.mjs';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';

const PROVENANCE={child:'P5-O2',pin:'063f83c39b873ee8401870c12179a859c0ac31a5',document:'docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md',spike:'M2: the Stop hook callback and the session\'s crons (D-1)',api:'a content-keyed script over stub-api.mjs sseOf (nothing spent)'};
export const CALLBACK_ID='maws_Stop_1'; // HostHookRegistry's first id for the event
const HOOKS={Stop:[{hookCallbackIds:[CALLBACK_ID],timeout:10}]}; // host-hooks.ts forInitialize: no matcher, the timeout
const DEBUG=/\[loop|keepalive|ScheduledTasks|scheduler|cron|wakeup|resurrect|Stop hook|hook_callback|session_crons|callback/i;
const MANAGED=['/etc/claude-code/managed-settings.json','/Library/Application Support/ClaudeCode/managed-settings.json'];
const CRON_TOOLS=['CronCreate','CronDelete','CronList','ScheduleWakeup'];
export const LOOP_PROMPT='/loop [[P5O2:LOOP]] check the build';

// The plans: each an array of turns (a function of the shared state for an input known only at run time).
const search=names=>toolTurn(null,'ToolSearch',{query:'select:'+names.join(','),max_results:names.length});
const tool=(name,input)=>toolTurn(null,name,input);
const PLANS={
 CREATE:()=>[search(CRON_TOOLS),tool('CronCreate',{cron:'0 3 * * *',prompt:'nightly report job',recurring:true}),textTurn('Created the nightly job.')],
 DELETE:()=>[s=>tool('CronDelete',{id:s.ids['nightly report job']}),textTurn('Deleted it.')],
 // a subagent as the model launches one by default (in the background), and one in the foreground
 SUB:()=>[s=>tool(s.agentTool,{description:'Schedule a job',prompt:'[[P5O2:SUBTASK]] Schedule the weekly job.',subagent_type:'general-purpose'}),textTurn('The subagent is done.')],
 SUBFG:()=>[s=>tool(s.agentTool,{description:'Schedule a job',prompt:'[[P5O2:SUBTASK]] Schedule the weekly job.',subagent_type:'general-purpose',run_in_background:false}),textTurn('The foreground subagent is done.')],
 SUBTASK:()=>[search(['CronCreate','CronList']),tool('CronCreate',{cron:'0 4 * * 1',prompt:'subagent weekly job',recurring:true}),textTurn('Scheduled the weekly job.')],
 LIST:()=>[tool('CronList',{}),textTurn('Listed.')],
 INT:()=>[tool('CronCreate',{cron:'0 5 * * *',prompt:'interrupted turn job',recurring:true}),tool('Bash',{command:'sleep 45',description:'Wait'}),textTurn('(not reached: the turn is interrupted in the Bash call)')],
 PLAIN:()=>[textTurn('OK.')],
 // the dynamic /loop: the first turn schedules a wakeup; its tick (the same prompt, fired) ends without one
 LOOP:occ=>occ===0?[tool('ScheduleWakeup',{delaySeconds:60,prompt:LOOP_PROMPT,reason:'probe: one tick',noop:false}),textTurn('Scheduled the next tick.')]:[textTurn('Tick done; not rescheduling.')],
 HOLD_DURABLE:()=>[search(['CronCreate','CronList']),tool('CronCreate',{cron:'* * * * *',prompt:'[[P5O2:FIRE]] durable minute job',recurring:true,durable:true}),textTurn('Created the durable job.')],
 HOLD_SESSION:()=>[search(['CronCreate','CronList']),tool('CronCreate',{cron:'* * * * *',prompt:'[[P5O2:FIRE]] session minute job',recurring:true}),textTurn('Created the session job.')],
 RESUMED_LIST:()=>[search(['CronList']),tool('CronList',{}),textTurn('Listed.')],
 FIRE:()=>[textTurn('Fired.')],
};
const MARK=/\[\[P5O2:([A-Z_]+)\]\]/;
const isMainLoop=body=>Array.isArray(body.tools)&&body.tools.some(t=>t?.name==='Bash'||t?.name==='Read');
const userBlocks=m=>m?.role!=='user'?[]:typeof m.content==='string'?[{type:'text',text:m.content}]:m.content??[];
const resultText=b=>typeof b.content==='string'?b.content:Array.isArray(b.content)?b.content.map(x=>x.text??'').join('\n'):'';

// The scripted API: every POST /v1/messages recorded with what it was taken for and what it was answered.
export async function startScriptedApi(){
 const requests=[];const issued=new Map();const occurrences=new Map();const state={ids:{},agentTool:'Agent'};let n=0;
 const answer=body=>{
  if(!isMainLoop(body))return {kind:'side',turn:textTurn('ok')};
  const names=body.tools.map(t=>t.name);
  if(names.includes('Agent'))state.agentTool='Agent';else if(names.includes('Task'))state.agentTool='Task';
  const last=userBlocks(body.messages?.at(-1));
  const text=last.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  // a CronCreate's result names its job; kept by the job's prompt for a later CronDelete
  for(const b of last.filter(b=>b.type==='tool_result')){const t=issued.get(b.tool_use_id);if(t?.name==='CronCreate'){const id=resultText(b).match(/job ([0-9a-f]{8})/)?.[1];if(id)state.ids[t.input.prompt]=id;}}
  let plan,step,occ,marker;
  const m=text.match(MARK);
  if(m&&PLANS[m[1]]){marker=m[1];occ=occurrences.get(marker)??0;occurrences.set(marker,occ+1);plan=PLANS[marker](occ);step=0;}
  else{
   const prior=last.filter(b=>b.type==='tool_result').map(b=>issued.get(b.tool_use_id)).find(Boolean);
   if(!prior)return {kind:'unscripted',turn:textTurn('ok'),head:text.slice(0,200)};
   ({plan,marker,occ}=prior);step=prior.step+1;
  }
  let turn=plan[step]??textTurn('(the plan has no more turns)');
  if(typeof turn==='function')turn=turn(state);
  turn={...turn,blocks:turn.blocks.map(b=>{if(b.type!=='tool_use')return b;const id=`toolu_p5o2_${String(++n).padStart(3,'0')}`;issued.set(id,{name:b.name,input:b.input,plan,step,marker,occ});return {...b,id};})};
  return {kind:'main',marker,occurrence:occ,step,turn,head:text.slice(0,200),cronToolsOffered:CRON_TOOLS.filter(c=>names.includes(c))};
 };
 const server=createServer((req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));
  req.on('end',()=>{
   const path=req.url.split('?')[0];
   if(req.method==='POST'&&path==='/v1/messages/count_tokens'){requests.push({n:requests.length+1,path});res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({input_tokens:1000}));}
   if(req.method!=='POST'||path!=='/v1/messages'){requests.push({n:requests.length+1,method:req.method,path,status:404});res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({type:'error',error:{type:'not_found_error',message:'stub'}}));}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{res.writeHead(400);return res.end();}
   const {turn,...why}=answer(body);
   requests.push({n:requests.length+1,at:new Date().toISOString(),path,stream:body.stream===true,messages:(body.messages??[]).length,...why,reply:turn.blocks.map(b=>b.type==='tool_use'?{tool_use:b.name,id:b.id,input:b.input}:{text:b.text})});
   const id=`msg_stub_${requests.length}`;
   if(body.stream===true){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});return res.end(sseOf(turn,{id,model:body.model}));}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(jsonOf(turn,{id,model:body.model})));
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,requests,close:()=>new Promise(r=>server.close(()=>r()))};
}

// What the probe sent, read back from its journal (it keeps only inbound frames in memory).
const sentUuids=p=>new Set(readFileSync(p.file,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.direction==='out'&&r.frame.type==='user').map(r=>r.frame.uuid));
// One inbound frame in brief: the rows a finding cites.
function brief(r,sent){
 const f=r.frame,o={seq:r.seq,at:r.at,type:f.type};
 if(f.type==='control_request'){o.subtype=f.request?.subtype;if(o.subtype==='hook_callback'){const i=f.request.input??{};Object.assign(o,{callback_id:f.request.callback_id,hook_event_name:i.hook_event_name,stop_hook_active:i.stop_hook_active,session_crons:i.session_crons,background_tasks:i.background_tasks,inputKeys:Object.keys(i).sort(),lastAssistantChars:typeof i.last_assistant_message==='string'?i.last_assistant_message.length:null});}else if(o.subtype==='can_use_tool')o.tool=f.request.tool_name;}
 else if(f.type==='result')Object.assign(o,{subtype:f.subtype,is_error:f.is_error,terminal_reason:f.terminal_reason??null,result:typeof f.result==='string'?f.result.slice(0,200):null});
 else if(f.type==='assistant')Object.assign(o,{parent_tool_use_id:f.parent_tool_use_id??null,blocks:blocks(f).map(b=>b.type==='tool_use'?{tool_use:b.name,id:b.id,input:b.input}:b.type==='text'?{text:b.text.slice(0,120)}:{type:b.type})});
 else if(f.type==='user')Object.assign(o,{parent_tool_use_id:f.parent_tool_use_id??null,uuid:f.uuid,isReplay:f.isReplay??null,origin:f.origin??null,sentByProbe:sent.has(f.uuid),blocks:blocks(f).length?blocks(f).map(b=>b.type==='tool_result'?{tool_result:b.tool_use_id,is_error:b.is_error??false,text:textOf(b.content).slice(0,300)}:{text:textOf([b]).slice(0,160)}):[{text:textOf(f.message?.content).slice(0,160)}]});
 else if(f.type==='command_lifecycle')Object.assign(o,{state:f.state,command_uuid:f.command_uuid,sentByProbe:sent.has(f.command_uuid)});
 else if(f.type==='system')Object.assign(o,{subtype:f.subtype,...(f.subtype==='background_tasks_changed'||f.subtype==='session_state_changed'?{detail:f}:{})});
 return o;
}
const KEEP=r=>r.frame.type!=='stream_event'&&!(r.frame.type==='system'&&r.frame.subtype==='init');
const framesFrom=(p,from)=>{const sent=sentUuids(p);return p.frames.filter(r=>r.seq>from&&KEEP(r)).map(r=>brief(r,sent));};
// The probe's answers to the Stop callbacks, from the journal: the reply's seq beside the request's.
const stopAnswers=(p,from)=>{const rows=readFileSync(p.file,'utf8').split('\n').filter(Boolean).map(JSON.parse);const ids=new Set(p.frames.filter(r=>r.seq>from&&r.frame.type==='control_request'&&r.frame.request?.subtype==='hook_callback').map(r=>r.frame.request_id));return rows.filter(r=>r.direction==='out'&&r.frame.type==='control_response'&&ids.has(r.frame.response.request_id)).map(r=>({seq:r.seq,request_id:r.frame.response.request_id,response:r.frame.response.response??null}));};

// The probe end of every launch: the Stop callback answered `{}` and noted, every tool allowed, the hook registered.
async function open(p,run){
 allowAll(p);
 p.on('hook_callback',r=>{p.note({event:'stop_callback',callback_id:r.callback_id,hook_event_name:r.input?.hook_event_name??null,session_crons:r.input?.session_crons??null});return {};});
 const init=success(await p.init({...initPayload(run.cwd),hooks:HOOKS}),'initialize');
 p.note({event:'initialize_answer',hooks_applied:init.hooks_applied??null});
}
// One step: a prompt (or nothing, for a wait), then until the engine is idle; its frames and requests noted.
async function step(p,api,label,prompt,{waitFor=null,quiet=4000}={}){
 const from=p.seq,before=api.requests.length;
 if(prompt!==null)p.user(prompt);
 if(waitFor)await waitFor(from);
 else if(prompt!==null)await p.wait(f=>f.type==='result',{after:from,timeout:180000});
 await idle(p,180000,quiet);
 const frames=framesFrom(p,from);
 p.note({event:'step',label,prompt,frames,stopAnswers:stopAnswers(p,from),requests:api.requests.slice(before)});
 return frames;
}
const stopsIn=frames=>frames.filter(f=>f.subtype==='hook_callback');
const resultsIn=frames=>frames.filter(f=>f.type==='result');
const engineStarts=frames=>frames.filter(f=>f.type==='command_lifecycle'&&f.state==='started'&&!f.sentByProbe);

async function withLaunch(name,run,api,{question,resume=null},body){
 const managed=MANAGED.filter(f=>existsSync(f));
 await launch(name,run,{dir:'fixtures/p5/',relay:false,spendCap:'0.05',debugPattern:DEBUG,sessionId:resume?null:randomUUID(),pinned:resume===null,vars:{ANTHROPIC_BASE_URL:api.url,ANTHROPIC_AUTH_TOKEN:'stub-token'},flags:resume?['--resume',resume]:[],provenance:{...PROVENANCE,question,hooks:HOOKS,managedSettings:managed,...(resume?{resumed:resume}:{})}},async p=>{
  // a managed settings file applies to every launch whatever --setting-sources says; one naming a gateway would route
  // the engine past the stub, so the probe refuses to run beside one
  check(p,'no managed settings file routes the engine',managed.every(f=>!/ANTHROPIC_BASE_URL/.test(readFileSync(f,'utf8'))),managed);
  await open(p,run);
  await body(p);
  check(p,'every main-loop request reached the stub',api.requests.some(r=>r.kind==='main'));
  await endAsStop(p);
 });
}

async function mainArm(){
 const run=scratchRun('p5o2-main');
 const api=await startScriptedApi();
 try{
  await withLaunch('p5-o2-stop-crons-main',run,api,{question:'1, 2, 3 and 5: Stop vs result, CronCreate and CronDelete in session_crons, an interrupted turn, the dynamic /loop keepalive in -p, a subagent\'s CronCreate'},async p=>{
   await step(p,api,'create','[[P5O2:CREATE]] Schedule the nightly report.');
   await step(p,api,'delete','[[P5O2:DELETE]] Cancel the nightly report.');
   await step(p,api,'subagent','[[P5O2:SUB]] Have a subagent schedule the weekly job.');
   await step(p,api,'subagent-foreground','[[P5O2:SUBFG]] Have a foreground subagent schedule the weekly job.');
   await step(p,api,'list-after-subagent','[[P5O2:LIST]] List the jobs.');
   // the interrupted turn: a CronCreate, then a Bash call interrupted while it runs
   await step(p,api,'interrupt','[[P5O2:INT]] Schedule a job, then wait.',{waitFor:async from=>{
    await p.wait(f=>f.type==='assistant'&&blocks(f).some(b=>b.type==='tool_use'&&b.name==='Bash'),{after:from,timeout:120000});
    await delay(2500);
    const ack=await p.request('interrupt',{});
    p.note({event:'interrupt_sent',ack:ack.subtype});
    await p.wait(f=>f.type==='result',{after:from,timeout:60000});
   }});
   await step(p,api,'after-interrupt','[[P5O2:PLAIN]] Reply with OK.');
   // the dynamic /loop: ScheduleWakeup(60 s); its tick fires within about two minutes and ends without one
   await step(p,api,'loop',LOOP_PROMPT);
   const tick=await step(p,api,'loop-tick',null,{waitFor:async from=>{
    const started=await p.wait(f=>f.type==='command_lifecycle'&&f.state==='started'&&!sentUuids(p).has(f.command_uuid),{after:from,timeout:240000}).catch(()=>null);
    p.note({event:'loop_tick_wait',fired:!!started});
    if(started)await p.wait(f=>f.type==='result',{after:from,timeout:120000});
    await delay(15000); // the REPL's idle effect would arm the keepalive here, at once
   }});
   p.note({event:'loop_tick_summary',engineStarts:engineStarts(tick).length,stops:stopsIn(tick).map(s=>s.session_crons)});
   await step(p,api,'after-tick','[[P5O2:PLAIN]] Reply with OK again.');
   await step(p,api,'list-after-tick','[[P5O2:LIST]] List the jobs again.');
  });
 }finally{await api.close();removeRun(run);}
}

// A session holding one every-minute cron, then its --resume: idle until the first Stop (or 150 s), then a CronList turn.
async function holdArm(kind){
 const run=scratchRun('p5o2-'+kind);
 const api=await startScriptedApi();
 let sessionId=null;
 try{
  await withLaunch(`p5-o2-stop-crons-${kind}`,run,api,{question:`4: a session holding a ${kind} every-minute cron, the one the resume reads`},async p=>{
   await step(p,api,'hold',`[[P5O2:HOLD_${kind.toUpperCase()}]] Schedule the minute job.`);
   sessionId=p.sessionId;
   p.note({event:'durable_file',exists:existsSync(run.cwd+'/.claude/scheduled_tasks.json'),content:existsSync(run.cwd+'/.claude/scheduled_tasks.json')?JSON.parse(readFileSync(run.cwd+'/.claude/scheduled_tasks.json','utf8')):null});
  });
  await withLaunch(`p5-o2-stop-crons-${kind}-resume`,run,api,{question:`4: the --resume of a session holding a ${kind} cron: does the first Stop list it, and can it fire before that Stop`,resume:sessionId},async p=>{
   const waited=await step(p,api,'resumed-idle',null,{waitFor:async from=>{
    const first=await p.wait(f=>f.type==='control_request'&&f.request?.subtype==='hook_callback',{after:from,timeout:150000}).catch(()=>null);
    p.note({event:'resume_first_stop_wait',stopSeen:!!first});
   }});
   p.note({event:'resume_summary',engineStartsBeforeFirstStop:engineStarts(waited).filter(s=>!stopsIn(waited)[0]||s.seq<stopsIn(waited)[0].seq).length,firstStop:stopsIn(waited)[0]??null,results:resultsIn(waited).length});
   await step(p,api,'resumed-list','[[P5O2:RESUMED_LIST]] List the jobs.');
   p.note({event:'durable_file',exists:existsSync(run.cwd+'/.claude/scheduled_tasks.json'),content:existsSync(run.cwd+'/.claude/scheduled_tasks.json')?JSON.parse(readFileSync(run.cwd+'/.claude/scheduled_tasks.json','utf8')):null});
  });
 }finally{await api.close();removeRun(run);}
}

export default async()=>{
 console.log('engine',ENGINE_VERSION);
 const arms=(process.env.P5O2_ARM??'main,durable,session').split(',');
 if(arms.includes('main'))await mainArm();
 for(const kind of ['durable','session'])if(arms.includes(kind))await holdArm(kind);
};
