// U4b, the probe its execution document states under "Probes" (docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-
// integrations.md on ux-wave/U4b, "Reported to the architect" 8): Send now on an after-the-turn row early in a shell call,
// built as a promote at `next` followed at once by `interrupt {send_now, message_uuid}` for the message just written.
// The launch and environment are the second and third passes' (uxwave-u4-send-now-2.mjs, -3.mjs). One case per process:
//   UXW_CASE  pair       1.5 s after the shell call starts (its waiter's pid file): M written at `next` (as queue.ts
//                        promote() writes it with priority next: a fresh uuid, origin human) and the request naming M,
//                        in the same tick, the request after the frame (no gap)
//             pair-late  the same 10 s into the call (the call long a task)
//             two        P written at `next` 1.0 s into the call, its `queued` awaited; 0.5 s later the pair for M
//             two-late   the same at 9.5 s / 10 s
//             reqfirst   1.5 s into the call: the request naming M, then M at `next`, in the same tick
//             read       the pair at 1.5 s; then the request naming M again (a second press) at M's `started`, at the first
//                        assistant frame of M's turn, and 0.5 s after M's turn's result
//   UXW_RUN   a label for repeated runs.
import {run,delay,configEnv,handshake,steer,lifecycle,alive,until,writeWaiter,MAWS_FLAGS,WORK} from './uxwave-common-send-permission.mjs';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
const CASE=process.env.UXW_CASE,RUN=process.env.UXW_RUN||'1',SECS=30;
const AT={pair:1500,'pair-late':10000,two:1500,'two-late':10000,reqfirst:1500,read:1500}[CASE];if(AT===undefined)throw new Error('UXW_CASE');
const MAWS_ENV={CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'false',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',CLAUDE_CODE_QUESTION_PREVIEW_FORMAT:'html'};
const tag=(CASE+RUN).replace(/[^a-z0-9]/g,'');
const PROMPT=`Run this exact shell command with the Bash tool, in the foreground (do not set run_in_background): node wait.cjs ${tag} ${SECS}\nWhen it finishes, reply with its output and nothing else.`;
const message=w=>`Reply with the single word ${w}, then carry on with what you were doing.`;
function transcriptOf(sessionId){
 const base=process.env.HOME+'/.claude/projects';if(!sessionId||!existsSync(base))return null;
 for(const d of readdirSync(base)){const f=`${base}/${d}/${sessionId}.jsonl`;if(!existsSync(f))continue;
  return readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>{let r;try{r=JSON.parse(l);}catch{return {unparsed:true};}
   const o={type:r.type};for(const k of ['subtype','operation','uuid','parentUuid','isMeta','isSidechain','promptId','toolUseID','level'])if(r[k]!==undefined)o[k]=r[k];
   if(r.type==='queue-operation'||r.type==='system')o.content=String(r.content??'').slice(0,80);
   if(r.attachment)o.attachment=r.attachment.type;
   const c=(r.type==='user'||r.type==='assistant')?r.message?.content:undefined;
   if(typeof c==='string')o.text=c.slice(0,200);
   else if(Array.isArray(c))o.blocks=c.map(b=>b.type==='text'?{text:String(b.text).slice(0,100)}:b.type==='tool_use'?{tool_use:b.name,id:b.id,input:JSON.stringify(b.input).slice(0,100)}:b.type==='tool_result'?{tool_result:b.tool_use_id,is_error:b.is_error,text:(typeof b.content==='string'?b.content:JSON.stringify(b.content)).slice(0,200)}:{type:b.type});
   if(r.toolUseResult&&typeof r.toolUseResult==='object'){const t=r.toolUseResult;o.toolUseResult=Object.fromEntries(['interrupted','backgroundTaskId','backgroundedToDeliverMessage','isAsync','status'].filter(k=>k in t).map(k=>[k,t[k]]));}
   return o;});}
 return null;
}
export default async()=>{
 const cfg=configEnv({});
 writeWaiter(WORK);const pidFile=`${WORK}/wait-${tag}.pid`,doneFile=`${WORK}/wait-${tag}.done`;
 const state=label=>({label,alive:alive(pidFile)});
 await run(`u4b-${CASE}-${RUN}`,async p=>{
  p.note({event:'uxw_case',probe:'U4b send-now early',case:CASE,run:RUN,atMs:AT,featureCache:cfg.feat,permissionMode:'auto',model:process.env.PROBE_MODEL||'haiku',waitSeconds:SECS,mawsEnv:MAWS_ENV,bin:'claude'});
  p.on('can_use_tool',r=>({behavior:'allow',updatedInput:r.input}));
  await handshake(p);
  const first=steer(p,PROMPT,'now');p.note({event:'uxw_prompt',uuid:first});
  const ready=await until(()=>alive(pidFile)?.alive,120000,20);
  const t0=Date.now();
  p.note({event:'uxw_ready',ready,...state('ready')});if(!ready)throw new Error('the call never ran');
  const taskSeen=()=>p.frames.some(r=>r.frame.type==='system'&&r.frame.subtype==='task_started');
  const msgs=[],answers=[];
  const ask=(label,uuid)=>{const sentAt=p.seq+1;const pr=p.request('interrupt',{send_now:true,message_uuid:uuid}).then(r=>{const a={label,uuid,requestSeq:sentAt,answerSeq:p.seq,response:r};answers.push(a);p.note({event:'uxw_answer',...a});return r;},e=>{answers.push({label,error:e.message});return null;});return pr;};
  if(CASE.startsWith('two')){
   await delay(Math.max(0,t0+AT-500-Date.now()));
   const P=steer(p,message('MANGO'),'next');msgs.push(P);p.note({event:'uxw_message',uuid:P,priority:'next',role:'P',taskRegistered:taskSeen()});
   await p.wait(lifecycle(P,'queued'),{timeout:10000}).catch(()=>p.note({event:'uxw_no_queued_lifecycle',uuid:P}));
  }
  await delay(Math.max(0,t0+AT-Date.now()));
  let M,pending;
  const at=Date.now()-t0,reg=taskSeen();
  if(CASE==='reqfirst'){
   const uuid=(await import('node:crypto')).randomUUID();
   pending=ask('first',uuid);
   p.send({type:'user',uuid,message:{role:'user',content:message('PINEAPPLE')},parent_tool_use_id:null,origin:{kind:'human'},priority:'next'});M=uuid;
  }else{
   M=steer(p,message('PINEAPPLE'),'next');pending=ask('first',M);
  }
  msgs.push(M);p.note({event:'uxw_pair',uuid:M,order:CASE==='reqfirst'?'request, frame':'frame, request',msIntoCall:at,taskRegistered:reg});
  await pending;
  if(CASE==='read'){
   const started=await p.wait(lifecycle(M,'started'),{timeout:60000}).then(()=>true,()=>false);
   if(started){
    await ask('at started',M);
    const s=p.seq;const a=await p.wait(f=>f.type==='assistant'&&(f.parent_tool_use_id??null)===null,{after:s,timeout:60000}).then(()=>true,()=>false);
    if(a)await ask('at first assistant frame',M);
    const r=await until(()=>p.frames.some(x=>x.seq>s&&x.frame.type==='result'&&(x.frame.parent_tool_use_id??null)===null),90000,20);
    if(r){await delay(500);await ask('after the turn result',M);}
   }
  }
  const allStarted=await until(()=>msgs.every(u=>p.frames.some(r=>lifecycle(u,'started')(r.frame))),150000,250);
  p.note({event:'uxw_all_started',allStarted,...state('all started')});
  await until(()=>existsSync(doneFile)||alive(pidFile)?.alive===false,(SECS+40)*1000,500);
  let seen=p.seq,quiet=0;for(const t=Date.now()+90000;Date.now()<t&&quiet<12;){await delay(1000);if(p.seq===seen)quiet++;else{quiet=0;seen=p.seq;}}
  p.note({event:'uxw_final',...state('final'),commandDoneAt:existsSync(doneFile)?readFileSync(doneFile,'utf8'):null,answers,
   results:p.frames.filter(r=>r.frame.type==='result').map(r=>({seq:r.seq,subtype:r.frame.subtype,terminal_reason:r.frame.terminal_reason})),
   lifecycles:p.frames.filter(r=>r.frame.type==='command_lifecycle').map(r=>({seq:r.seq,uuid:r.frame.command_uuid,state:r.frame.state})),
   tasks:p.frames.filter(r=>r.frame.type==='system'&&/^task_/.test(r.frame.subtype??'')).map(r=>({seq:r.seq,subtype:r.frame.subtype,task_type:r.frame.task_type,patch:r.frame.patch,status:r.frame.status})),
   requesting:p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='status'&&r.frame.user_message_uuids).map(r=>({seq:r.seq,uuids:r.frame.user_message_uuids})),
   replays:p.frames.filter(r=>r.direction==='in'&&r.frame.type==='user'&&r.frame.isReplay&&typeof r.frame.message?.content==='string').map(r=>({seq:r.seq,uuid:r.frame.uuid,text:r.frame.message.content})),
   messages:msgs,prompt:first});
  p.note({event:'uxw_transcript',lines:transcriptOf(p.sessionId)});
 },{dir:'fixtures/uxwave/',cwd:WORK,settingSources:'user,project,local',strictMcp:false,mode:'auto',flags:[...MAWS_FLAGS],env:{...MAWS_ENV,...cfg.env}});
};
