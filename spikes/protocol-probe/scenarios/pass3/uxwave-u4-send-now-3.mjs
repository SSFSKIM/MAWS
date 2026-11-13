// U4 P3, the third pass of the Send now probe (U4's first landing, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-
// composer.md on ux-wave/U4a, decision 32 and "Reported to the architect" 23 and 25; the second pass is
// uxwave-u4-send-now-2.mjs and findings-uxwave-u4-send-now-cases.txt). Two cases the second pass did not record, on
// MAWS's launch and environment exactly as the second pass set them. One case per process:
//   UXW_CASE  end2, end3   two / three `next` messages written while the model only writes text (no tool, so no tool
//                          boundary reads them); nothing else is done and the turn ends by itself (Reported 23)
//             promote      a `next` message waits behind a running shell command; Send now on an after-the-turn row
//                          beside it, as MAWS writes it (queue.ts promote: a `now` user frame of the row's content,
//                          a fresh uuid; the engine never held the row) (Reported 25)
//             promote-late the same, with both rows written once the engine has made the running command a task
//                          (its task_started frame, about 2.7 s into the call) rather than 1.5 s into the call
//             mirror       the same two rows; Send now on the `next` one (`interrupt {send_now, message_uuid}`) while
//                          the after-the-turn row waits in the app's queue. The probe stands in for that queue: it
//                          writes the row as queue.ts write() does (a user frame with no priority) at the first
//                          main-lane `result` at which every prompt it wrote has a lifecycle past `queued` (session.ts
//                          turnOpen: no unstarted prompt, no open turn)
//   UXW_RUN   a label for repeated runs.
import {run,delay,configEnv,handshake,steer,lifecycle,alive,until,writeWaiter,MAWS_FLAGS,WORK,randomUUID} from './uxwave-common-send-permission.mjs';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
const CASE=process.env.UXW_CASE,RUN=process.env.UXW_RUN||'1',SECS=30;
const KINDS={end2:'text',end3:'text',promote:'shell','promote-late':'shell',mirror:'shell'};
const KIND=KINDS[CASE];if(!KIND)throw new Error('UXW_CASE');
const MAWS_ENV={CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'false',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',CLAUDE_CODE_QUESTION_PREVIEW_FORMAT:'html'};
const tag=(CASE+RUN).replace(/[^a-z0-9]/g,'');
const PROMPT={
 shell:`Run this exact shell command with the Bash tool, in the foreground (do not set run_in_background): node wait.cjs ${tag} ${SECS}\nWhen it finishes, reply with its output and nothing else.`,
 text:'Without using any tools, write a story of about 900 words about a lighthouse keeper who collects sea glass.',
}[KIND];
const WORDS=['PINEAPPLE','MANGO','KIWI'];
const message=w=>`Reply with the single word ${w}, then carry on with what you were doing.`;
// The engine's transcript file, reduced as the second pass reduces it (no text beyond a short head of each block).
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
 writeWaiter(WORK);const pidFile=t=>`${WORK}/wait-${t}.pid`,doneFile=t=>`${WORK}/wait-${t}.done`;
 const state=label=>({label,alive:KIND==='shell'?alive(pidFile(tag)):null});
 await run(`u4p3-${CASE}-${RUN}`,async p=>{
  p.note({event:'uxw_case',probe:'U4 P3',case:CASE,run:RUN,kind:KIND,featureCache:cfg.feat,permissionMode:'auto',model:process.env.PROBE_MODEL||'haiku',waitSeconds:SECS,mawsEnv:MAWS_ENV,bin:'claude'});
  p.on('can_use_tool',r=>({behavior:'allow',updatedInput:r.input}));
  await handshake(p);
  const first=steer(p,PROMPT,'now');p.note({event:'uxw_prompt',uuid:first});
  const ready=KIND==='text'?await p.wait(f=>f.type==='stream_event'&&f.event?.delta?.type==='text_delta',{timeout:90000}).then(()=>true,()=>false)
   :await until(()=>alive(pidFile(tag))?.alive,120000);
  p.note({event:'uxw_ready',ready,...state('ready')});if(!ready)throw new Error('the call never ran');
  if(CASE==='promote-late'){const t=await p.wait(f=>f.type==='system'&&f.subtype==='task_started',{timeout:30000}).then(()=>true,()=>false);p.note({event:'uxw_task_registered',seen:t});}
  await delay(KIND==='text'?800:1500);
  const written=[first];
  const put=async(text,priority='next')=>{const uuid=steer(p,text,priority);written.push(uuid);p.note({event:'uxw_message',uuid,priority});await p.wait(lifecycle(uuid,'queued'),{timeout:10000}).catch(()=>p.note({event:'uxw_no_queued_lifecycle',uuid}));return uuid;};
  const msgs=[];
  if(KIND==='text'){
   for(const w of WORDS.slice(0,CASE==='end3'?3:2))msgs.push(await put(message(w)));
   const resultBefore=p.frames.some(r=>r.frame.type==='result');
   p.note({event:'uxw_messages_written',messages:msgs,resultAlready:resultBefore,startedAlready:msgs.filter(u=>p.frames.some(r=>lifecycle(u,'started')(r.frame)))});
  }
  let response=null,afterRow=null;const actAt=p.seq;
  if(CASE.startsWith('promote')){
   const nextUuid=await put(message(WORDS[0]));msgs.push(nextUuid);await delay(500);
   // Send now on the after-the-turn row: queue.ts promote() writes the row's content at `now` under a new uuid
   afterRow=steer(p,message(WORDS[1]),'now');written.push(afterRow);msgs.push(afterRow);p.note({event:'uxw_promote',uuid:afterRow,waiting:nextUuid});
  }
  if(CASE==='mirror'){
   const nextUuid=await put(message(WORDS[0]));msgs.push(nextUuid);p.note({event:'uxw_after_row_held_by_app',text:'MANGO'});await delay(500);
   response=await p.request('interrupt',{send_now:true,message_uuid:nextUuid}).catch(e=>({error:e.message}));
   // the app queue's release rule, stood in for: at a main-lane result with no prompt of ours unstarted, the head goes
   let released=false;
   const settled=u=>p.frames.some(r=>r.frame.type==='command_lifecycle'&&r.frame.command_uuid===u&&r.frame.state!=='queued');
   for(const t=Date.now()+150000;Date.now()<t&&!released;await delay(20)){
    const res=p.frames.filter(r=>r.seq>actAt&&r.frame.type==='result'&&(r.frame.parent_tool_use_id??null)===null);
    if(res.length>0&&written.every(settled)){
     const lastResult=res.at(-1).seq;const lastStart=Math.max(...p.frames.filter(r=>r.frame.type==='command_lifecycle'&&r.frame.state==='started').map(r=>r.seq));
     if(lastResult>lastStart){afterRow=randomUUID();p.send({type:'user',uuid:afterRow,message:{role:'user',content:message(WORDS[1])},parent_tool_use_id:null,origin:{kind:'human'}});released=true;written.push(afterRow);msgs.push(afterRow);p.note({event:'uxw_after_row_released',uuid:afterRow,atResultSeq:lastResult});}
    }
   }
  }
  p.note({event:'uxw_action',case:CASE,response,afterRow,actSeq:actAt});
  // the end: every message started and its turn ended, then quiet
  const allStarted=await until(()=>msgs.every(u=>p.frames.some(r=>lifecycle(u,'started')(r.frame))),150000,250);
  p.note({event:'uxw_all_started',allStarted,...state('all started')});
  if(KIND==='shell')await until(()=>existsSync(doneFile(tag))||alive(pidFile(tag))?.alive===false,(SECS+40)*1000,500);
  let seen=p.seq,quiet=0;for(const t=Date.now()+90000;Date.now()<t&&quiet<12;){await delay(1000);if(p.seq===seen)quiet++;else{quiet=0;seen=p.seq;}}
  p.note({event:'uxw_final',...state('final'),results:p.frames.filter(r=>r.frame.type==='result').map(r=>({seq:r.seq,subtype:r.frame.subtype,terminal_reason:r.frame.terminal_reason})),
   lifecycles:p.frames.filter(r=>r.frame.type==='command_lifecycle').map(r=>({seq:r.seq,uuid:r.frame.command_uuid,state:r.frame.state})),
   requesting:p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='status'&&r.frame.user_message_uuids).map(r=>({seq:r.seq,uuids:r.frame.user_message_uuids})),
   replays:p.frames.filter(r=>r.direction==='in'&&r.frame.type==='user'&&r.frame.isReplay&&typeof r.frame.message?.content==='string').map(r=>({seq:r.seq,uuid:r.frame.uuid,text:r.frame.message.content})),
   messages:msgs,prompt:first});
  p.note({event:'uxw_transcript',lines:transcriptOf(p.sessionId)});
 },{dir:'fixtures/uxwave/',cwd:WORK,settingSources:'user,project,local',strictMcp:false,mode:'auto',flags:[...MAWS_FLAGS],env:{...MAWS_ENV,...cfg.env}});
};
