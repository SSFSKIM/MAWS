// U4 P2, the second pass of the Send now probe (U4's first landing, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-
// composer.md, M1; the first pass is uxwave-u4-send-now.mjs and findings-uxwave-u4-send-now.txt). The cases the engine
// host's new code branches on that the first pass did not run. MAWS's launch as in uxwave-common-send-permission.mjs,
// plus the environment keys MAWS's buildEnvironment sets (src/engine-host/launch.ts), which the first pass left out:
// CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1 among them, so `session_state_changed` is on the wire. One case per process:
//   UXW_CASE  a                 the main case again: send-now for a `next` message behind a running shell command
//             n-never           send-now naming a uuid the engine never received (nothing else waiting)
//             n-started         send-now naming a `next` message the engine already started at a tool boundary of the
//                               same turn (two commands in a row: the message is read after the first, the request is
//                               written while the second runs)
//             n-dropped         send-now naming a `next` message withdrawn first by cancel_async_message (MAWS's
//                               session.steer.cancel)
//             two-1, two-2      two `next` messages waiting; send-now names the first / the second
//             stop-inflight     send-now, then at once (before its answer) MAWS's plain interrupt
//             stop-inflight-hold  the same as MAWS's Stop square writes it: cancel_async_message for the waiting
//                               message (holdAll), then the plain interrupt; both after the send-now, before its answer
//             stop-after, stop-after-hold  the same two, written once the send-now's answer is in, before the turn's end
//             stop-moved, stop-moved-hold  the same two, written once the engine reports the command moved (its
//                               task_updated is_backgrounded), before the cut turn's end
//             k-text, k-agent, k-perm, k-mcp  the main case while the model writes text / behind a foreground Agent call /
//                               with a permission request held (mode default) / inside an MCP tool call (a stdio MCP
//                               server of the probe's own whose tool sleeps)
//             k-hook            the main case while a PreToolUse hook of the user settings holds the shell call for
//                               SECS seconds before it starts (the call is not yet a task the engine can move)
//             later, later0     a message written at the engine's priority `later`, then send-now naming it / no request
//             old               the main case on an engine without the send-now handler (UXW_BIN, 2.1.283)
//   UXW_RUN   a label for repeated runs.
import {run,delay,configEnv,handshake,steer,lifecycle,alive,until,writeWaiter,MAWS_FLAGS,WORK,randomUUID} from './uxwave-common-send-permission.mjs';
import {existsSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
const CASE=process.env.UXW_CASE,RUN=process.env.UXW_RUN||'1',SECS=30;
const KINDS={a:'shell','n-never':'shell','n-started':'shell2','n-dropped':'shell','two-1':'shell','two-2':'shell','stop-inflight':'shell','stop-inflight-hold':'shell','stop-after':'shell','stop-after-hold':'shell','stop-moved':'shell','stop-moved-hold':'shell','k-text':'text','k-agent':'agent','k-perm':'shell','k-mcp':'mcp','k-hook':'hook',later:'shell',later0:'shell',old:'shell'};
const KIND=KINDS[CASE];if(!KIND)throw new Error('UXW_CASE');
const MAWS_ENV={CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'false',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',CLAUDE_CODE_QUESTION_PREVIEW_FORMAT:'html'};
const tag=(CASE+RUN).replace(/[^a-z0-9]/g,'');
const PROMPT={
 shell:`Run this exact shell command with the Bash tool, in the foreground (do not set run_in_background): node wait.cjs ${tag} ${SECS}\nWhen it finishes, reply with its output and nothing else.`,
 shell2:`Run these two exact shell commands with the Bash tool, one after the other as two separate calls, each in the foreground (do not set run_in_background): first node wait.cjs ${tag}a 8 and then node wait.cjs ${tag}b ${SECS}\nWhen both have finished, reply with their output and nothing else.`,
 agent:`Use the Agent tool once, with subagent_type general-purpose and run_in_background set to the JSON boolean false (not the string "false"; a foreground agent), and give it this task: "Run this exact shell command with the Bash tool in the foreground (do not set run_in_background): node wait.cjs ${tag} ${SECS}. Then report its output." Do not run the command yourself. When the agent returns, reply with its report.`,
 mcp:`Call the MCP tool mcp__slow__slow_wait exactly once, with tag "${tag}" and secs ${SECS} (load it with ToolSearch first if it is deferred). When it returns, reply with its result and nothing else.`,
 hook:`Run this exact shell command with the Bash tool, in the foreground (do not set run_in_background): node wait.cjs ${tag} 5\nWhen it finishes, reply with its output and nothing else.`,
 text:'Without using any tools, write a story of about 500 words about a lighthouse keeper who collects sea glass.',
}[KIND];
const MESSAGE='Reply with the single word PINEAPPLE, then carry on with what you were doing.';
const MESSAGE2='Reply with the single word MANGO, then carry on with what you were doing.';
const MCP_SERVER=`const fs=require('fs');const dir=process.argv[2];const calls=new Map();const out=o=>process.stdout.write(JSON.stringify(o)+'\\n');
require('readline').createInterface({input:process.stdin}).on('line',l=>{let m;try{m=JSON.parse(l);}catch{return;}
 if(m.method==='initialize')return out({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params&&m.params.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'slow',version:'1.0.0'}}});
 if(m.method==='tools/list')return out({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'slow_wait',description:'Waits for the given number of seconds, then returns the words finished and the tag.',inputSchema:{type:'object',properties:{tag:{type:'string'},secs:{type:'number'}},required:['tag','secs']}}]}});
 if(m.method==='tools/call'){const a=m.params.arguments||{};calls.set(m.id,a.tag);fs.writeFileSync(dir+'/mcp-'+a.tag+'.start',new Date().toISOString());setTimeout(()=>{fs.writeFileSync(dir+'/mcp-'+a.tag+'.done',new Date().toISOString());out({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'finished '+a.tag}]}});},(+a.secs||30)*1000);return;}
 if(m.method==='notifications/cancelled'){const t=calls.get(m.params&&m.params.requestId);fs.writeFileSync(dir+'/mcp-'+(t||'unknown')+'.cancelled',new Date().toISOString());return;}
 if(m.id!==undefined&&m.method)out({jsonrpc:'2.0',id:m.id,result:{}});});
`;
// The engine's transcript file, reduced to what the U4 readers need (no text beyond a short head of each block).
function transcriptOf(sessionId){
 const base=process.env.HOME+'/.claude/projects';if(!sessionId||!existsSync(base))return null;
 for(const d of readdirSync(base)){const f=`${base}/${d}/${sessionId}.jsonl`;if(!existsSync(f))continue;
  return readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>{let r;try{r=JSON.parse(l);}catch{return {unparsed:true};}
   const o={type:r.type};for(const k of ['subtype','operation','uuid','parentUuid','isMeta','isSidechain','promptId','toolUseID','level'])if(r[k]!==undefined)o[k]=r[k];
   if(r.type==='queue-operation'||r.type==='system')o.content=String(r.content??'').slice(0,80);
   if(r.attachment)o.attachment=r.attachment.type;
   const c=(r.type==='user'||r.type==='assistant')?r.message?.content:undefined;
   if(typeof c==='string')o.text=c.slice(0,100);
   else if(Array.isArray(c))o.blocks=c.map(b=>b.type==='text'?{text:String(b.text).slice(0,100)}:b.type==='tool_use'?{tool_use:b.name,id:b.id,input:JSON.stringify(b.input).slice(0,100)}:b.type==='tool_result'?{tool_result:b.tool_use_id,is_error:b.is_error,text:(typeof b.content==='string'?b.content:JSON.stringify(b.content)).slice(0,200)}:{type:b.type});
   if(r.toolUseResult&&typeof r.toolUseResult==='object'){const t=r.toolUseResult;o.toolUseResult=Object.fromEntries(['interrupted','backgroundTaskId','backgroundedToDeliverMessage','isAsync','status'].filter(k=>k in t).map(k=>[k,t[k]]));}
   return o;});}
 return null;
}
export default async()=>{
 const HOOK_JS=`const fs=require('fs');process.stdin.resume();process.stdin.on('end',()=>{});fs.writeFileSync('${WORK}/hook-${tag}.start',new Date().toISOString());setTimeout(()=>{fs.writeFileSync('${WORK}/hook-${tag}.done',new Date().toISOString());process.exit(0);},${SECS}*1000);`;
 if(KIND==='hook')writeFileSync(WORK+'/hookwait.cjs',HOOK_JS);
 const cfg=configEnv(KIND==='hook'?{hooks:{PreToolUse:[{matcher:'Bash',hooks:[{type:'command',command:`node ${WORK}/hookwait.cjs`,timeout:120}]}]}}:{});const mode=CASE==='k-perm'?'default':'auto';
 writeWaiter(WORK);const pidFile=t=>`${WORK}/wait-${t}.pid`,doneFile=t=>`${WORK}/wait-${t}.done`;
 const last=KIND==='shell2'?tag+'b':tag;
 const flags=[...MAWS_FLAGS];
 if(KIND==='mcp'){writeFileSync(WORK+'/slow-mcp.cjs',MCP_SERVER);flags.push('--mcp-config',JSON.stringify({mcpServers:{slow:{type:'stdio',command:'node',args:[WORK+'/slow-mcp.cjs',WORK]}}}));}
 const bin=CASE==='old'?process.env.UXW_BIN:undefined;if(CASE==='old'&&!bin)throw new Error('UXW_BIN');
 const HF=s=>`${WORK}/hook-${tag}.${s}`;
 const running=()=>KIND==='hook'?existsSync(HF('start'))&&!existsSync(HF('done')):KIND==='mcp'?existsSync(`${WORK}/mcp-${tag}.start`)&&!existsSync(`${WORK}/mcp-${tag}.done`):alive(pidFile(last))?.alive===true;
 const finished=()=>KIND==='hook'?existsSync(HF('done'))&&(existsSync(doneFile(tag))||alive(pidFile(tag))?.alive!==true):KIND==='mcp'?existsSync(`${WORK}/mcp-${tag}.done`)||existsSync(`${WORK}/mcp-${tag}.cancelled`):existsSync(doneFile(last))||alive(pidFile(last))?.alive===false;
 const state=label=>({label,alive:KIND==='hook'?{hookStart:existsSync(HF('start')),hookDone:existsSync(HF('done')),command:alive(pidFile(tag))}:KIND==='mcp'?{start:existsSync(`${WORK}/mcp-${tag}.start`),done:existsSync(`${WORK}/mcp-${tag}.done`),cancelled:existsSync(`${WORK}/mcp-${tag}.cancelled`)}:alive(pidFile(last))});
 await run(`u4p2-${CASE}-${RUN}`,async p=>{
  p.note({event:'uxw_case',probe:'U4 P2',case:CASE,run:RUN,kind:KIND,featureCache:cfg.feat,permissionMode:mode,model:process.env.PROBE_MODEL||'haiku',waitSeconds:SECS,mawsEnv:MAWS_ENV,bin:bin??'claude'});
  let held=null;
  p.on('can_use_tool',r=>{
   if(CASE==='k-perm'&&r.tool_name==='Bash')return new Promise(res=>{held=r;setTimeout(()=>res({behavior:'deny',message:'The probe declined this call.'}),60000);});
   return {behavior:'allow',updatedInput:r.input};
  });
  await handshake(p);
  const first=steer(p,PROMPT,'now');p.note({event:'uxw_prompt',uuid:first});
  const ready=KIND==='text'?await p.wait(f=>f.type==='stream_event'&&f.event?.delta?.type==='text_delta',{timeout:90000}).then(()=>true,()=>false)
   :CASE==='k-perm'?await until(()=>held!==null,90000)
   :KIND==='shell2'?await until(()=>alive(pidFile(tag+'a'))?.alive,120000)
 :KIND==='hook'?await until(()=>existsSync(HF('start')),120000)
   :KIND==='mcp'?await until(()=>existsSync(`${WORK}/mcp-${tag}.start`),120000):await until(()=>alive(pidFile(tag))?.alive,120000);
  p.note({event:'uxw_ready',ready,...state('ready')});if(!ready)throw new Error('the call never ran');
  await delay(1500);
  // the message(s), and the uuid the request names
  let target=null;const msgs=[];
  const put=async(text,priority='next')=>{const uuid=steer(p,text,priority);msgs.push(uuid);p.note({event:'uxw_message',uuid,priority});await p.wait(lifecycle(uuid,'queued'),{timeout:10000}).catch(()=>p.note({event:'uxw_no_queued_lifecycle',uuid}));return uuid;};
  if(CASE==='n-never'){target=randomUUID();p.note({event:'uxw_never_sent',uuid:target});}
  else if(CASE==='n-started'){target=await put(MESSAGE);
   await p.wait(lifecycle(target,'started'),{timeout:60000}).then(()=>p.note({event:'uxw_message_started_in_turn'}),()=>p.note({event:'uxw_message_not_started'}));
   const second=await until(()=>alive(pidFile(tag+'b'))?.alive,90000);p.note({event:'uxw_second_command',running:second});await delay(1500);}
  else if(CASE==='n-dropped'){target=await put(MESSAGE);await delay(500);const c=await p.request('cancel_async_message',{message_uuid:target}).catch(e=>({error:e.message}));p.note({event:'uxw_cancelled_first',response:c});}
  else if(CASE.startsWith('two-')){const m1=await put(MESSAGE);const m2=await put(MESSAGE2);target=CASE==='two-1'?m1:m2;p.note({event:'uxw_two',first:m1,second:m2,named:target});}
  else if(CASE.startsWith('later'))target=await put(MESSAGE,'later');
  else target=await put(MESSAGE);
  await delay(500);
  const actAt=p.seq;const sendNow=()=>p.request('interrupt',{send_now:true,message_uuid:target}).catch(e=>({error:e.message}));
  const stop=()=>p.request('interrupt',{reason:'user-cancel',cancel_queued:false}).catch(e=>({error:e.message}));
  const hold=()=>p.request('cancel_async_message',{message_uuid:target}).catch(e=>({error:e.message}));
  let response=null,stopResponse=null,holdResponse=null;
  if(CASE==='later0'){p.note({event:'uxw_no_request'});}
  else if(CASE==='stop-inflight'){const sn=sendNow();const st=stop();[response,stopResponse]=await Promise.all([sn,st]);}
  else if(CASE==='stop-inflight-hold'){const sn=sendNow();holdResponse=await hold();const st=stop();[response,stopResponse]=await Promise.all([sn,st]);}
  else if(CASE==='stop-after'){response=await sendNow();stopResponse=await stop();}
  else if(CASE==='stop-after-hold'){response=await sendNow();holdResponse=await hold();stopResponse=await stop();}
  else if(CASE.startsWith('stop-moved')){response=await sendNow();const moved=await p.wait(f=>f.type==='system'&&f.subtype==='task_updated'&&f.patch?.is_backgrounded===true,{after:actAt,timeout:15000}).then(()=>true,()=>false);const ended=p.frames.some(r=>r.seq>actAt&&r.frame.type==='result');p.note({event:'uxw_moved_before_stop',moved,turnEndedAlready:ended});if(CASE==='stop-moved-hold')holdResponse=await hold();stopResponse=await stop();}
  else response=await sendNow();
  p.note({event:'uxw_action',case:CASE,target,response,holdResponse,stopResponse,actSeq:actAt});
  await delay(2000);p.note({event:'uxw_alive',...state('2s after the action')});
  const result=await p.wait(f=>f.type==='result',{after:actAt,timeout:150000}).catch(()=>null);
  p.note({event:'uxw_first_result_after_action',subtype:result?.subtype??null,terminal_reason:result?.terminal_reason??null,...state('at the first result')});
  if(KIND!=='text')await until(finished,(SECS+40)*1000,500);
  let seen=p.seq,quiet=0;for(const t=Date.now()+90000;Date.now()<t&&quiet<12;){await delay(1000);if(p.seq===seen)quiet++;else{quiet=0;seen=p.seq;}}
  p.note({event:'uxw_final',...state('final'),results:p.frames.filter(r=>r.frame.type==='result').map(r=>({seq:r.seq,subtype:r.frame.subtype,terminal_reason:r.frame.terminal_reason})),messages:msgs,target});
  p.note({event:'uxw_transcript',lines:transcriptOf(p.sessionId)});
 },{dir:'fixtures/uxwave/',cwd:WORK,settingSources:'user,project,local',strictMcp:false,mode,flags,env:{...MAWS_ENV,...cfg.env},...(bin?{bin}:{})});
};
