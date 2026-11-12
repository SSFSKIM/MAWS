// UX wave, child U3 (docs/doperpowers/specs/2026-11-12-ux-wave/U3-transcript-rows.md, "Probes and checks" 1 to 4; the
// contract UC-2 in the root, docs/doperpowers/specs/2026-11-12-ux-wave-design.md): what the 2.1.322 wire and the
// session's transcript file carry for each arrival. What the uxwave-u3-* scenarios share.
//
// The launch is MAWS's own, not the harness's defaults, because MAWS's flags decide which frames the wire carries
// (`--replay-user-messages` which `user` frames, `--include-hook-events` which hook frames):
//   - flags: src/engine-host/launch.ts ENGINE_FLAGS (the harness passes the first seven itself; added here
//     `--forward-subagent-text --replay-user-messages --include-hook-events`, setting sources `user,project,local`, no
//     `--strict-mcp-config`), then buildLaunch's `--await-initialize` (2.1.322 declares it), `--model`,
//     `--permission-mode auto` (the owner's sessions), `--session-id`, the maws server's
//     `--disallowedTools AskUserQuestion --allowedTools mcp__maws__ask`, and `--settings {"dialogExpiry":"never"}`;
//   - environment: buildEnvironment's constants (below), over the environment vm-run.sh built (spikes/protocol-probe/
//     VM.md): the gateway through the loopback forward, its token in the environment where MAWS's relay substitutes
//     it, the managed settings' engine switches;
//   - initialize: src/shared/engine/initialize.ts appInitialize with the cwd's trust, declaring the `maws` SDK server,
//     served here with the tool list of p4-maws-tools.json (no call is expected); then, as src/engine-host/session.ts
//     does after initialize, `ui_attach` as surface "desktop" (client `maws-main`, the viewport and answers of
//     src/shared/engine/surface.ts) and `ui_panes` when the engine lists `ui_surface_v1`, and
//     `set_max_thinking_tokens {max_thinking_tokens: null, thinking_display: 'summarized'}`.
// Probe guards MAWS does not pass: `--max-budget-usd`. `bare: true` drops the three product flags alone, so a case
// recorded both ways shows what they change.
import {run as harnessRun,redact,delay} from '../../harness.mjs';
import {SdkServer} from '../../sdk-mcp.mjs';
import {appInitialize} from '../../../../src/shared/engine/initialize.ts';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export {delay,randomUUID};

export const U3={spec:'docs/doperpowers/specs/2026-11-12-ux-wave/U3-transcript-rows.md',section:'Probes and checks',contract:'UC-2 (docs/doperpowers/specs/2026-11-12-ux-wave-design.md)'};
export const BIN=process.env.PROBE_ENGINE;
if(!BIN)throw new Error('run under spikes/protocol-probe/vm-run.sh, which names the pinned engine (VM.md)');
export const ENGINE_VERSION=execFileSync(BIN,['--version'],{encoding:'utf8',timeout:15000}).trim().split(/\s+/)[0];
export const PRODUCT_FLAGS=['--forward-subagent-text','--replay-user-messages','--include-hook-events'];
const HERE=dirname(fileURLToPath(import.meta.url));
const MAWS_TOOLS=JSON.parse(readFileSync(join(HERE,'p4-maws-tools.json'),'utf8')).tools;
const SURFACE={surface:'desktop',client_id:'maws-main',viewport:{columns:100,rows:30,isFullscreen:true},answers:['ui_copy','ui_prompt_read','ui_prompt_fill','ui_prompt_suggest']};
export const FIXTURES=(process.env.PROBE_FIXTURE_ROOT?process.env.PROBE_FIXTURE_ROOT.replace(/\/?$/,'/'):join(HERE,'../../')+'/')+'fixtures/uxwave/';

export const sys=(f,s)=>f.type==='system'&&f.subtype===s;
export const blocks=c=>Array.isArray(c)?c:[];
export const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(b=>typeof b==='string'?b:b.type==='text'?b.text:b.type==='tool_result'?textOf(b.content):'').join('\n'):'';
const isToolResult=m=>blocks(m?.content).some(b=>b.type==='tool_result');
export const slug=p=>p.replace(/[^a-zA-Z0-9]/g,'-');

// MAWS's environment constants (buildEnvironment), over what vm-run.sh exported.
function mawsEnv(extra,lane=true){
 return {CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'false',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',
  CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING:process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING??'1',CLAUDE_CODE_QUESTION_PREVIEW_FORMAT:'html',
  SMNS_MEMBER:String(process.pid),...(lane?{MAWS_LANE:'B'}:{}),TERM:'dumb',DISABLE_AUTOUPDATER:'1',ENABLE_TOOL_SEARCH:'true',...extra};
}

// The transcript file of a session under the scratch HOME (MAWS sets no CLAUDE_CONFIG_DIR).
export const transcriptOf=(cwd,id)=>join(process.env.HOME,'.claude/projects',slug(cwd),id+'.jsonl');
export const rowsOf=file=>existsSync(file)?readFileSync(file,'utf8').split('\n').filter(Boolean).map((l,i)=>{try{return {line:i+1,row:JSON.parse(l)};}catch{return {line:i+1,row:{unparsed:l.slice(0,200)}};}}):[];

// One wire frame in brief: what a finding cites. `full` keeps the text whole (an arrival's carrier).
export function wireBrief(r,{full=true}={}){
 const f=r.frame,o={seq:r.seq,at:r.at,type:f.type};
 if(f.subtype)o.subtype=f.subtype;
 for(const k of ['uuid','origin','isReplay','isSynthetic','priority','parent_tool_use_id','task_id','tool_use_id','status','summary','output_file','usage','task_type','description','state','command_uuid','compact_result','compact_error','compact_metadata','local_command_source','local_command_run','local_command_outcome','user_message_uuids','is_error','result','error','model','stop_reason','handback','handback_report','patch','skipped_transcript','tasks'])if(f[k]!==undefined)o[k]=f[k];
 if(f.message){o.role=f.message.role;o.messageModel=f.message.model;const t=textOf(f.message.content);o.text=full?t:t.slice(0,300);o.contentTypes=blocks(f.message.content).map(b=>b.type);}
 if(f.type==='system'&&f.subtype==='status')o.statusValue=f.status;
 return o;
}
// One transcript row in brief.
export function fileBrief({line,row:r}){
 const o={line,type:r.type};
 for(const k of ['subtype','uuid','parentUuid','origin','isMeta','isSidechain','isCompactSummary','promptId','promptSource','turnOrigin','content','level','toolUseResult','isApiErrorMessage','error','compactMetadata','agentId','queueSkipAttachments'])if(r[k]!==undefined)o[k]=k==='toolUseResult'?'(present)':r[k];
 if(r.message){o.role=r.message.role;o.messageModel=r.message.model;o.text=textOf(r.message.content);o.contentTypes=blocks(r.message.content).map(b=>b.type);}
 if(r.attachment){const a=r.attachment;o.attachment={type:a.type};for(const k of ['commandMode','origin','prompt','content','source_uuid','taskDelivery','isMeta','mode'])if(a[k]!==undefined)o.attachment[k]=a[k];}
 return o;
}
// The wire frames that can carry or announce an arrival: every inbound `user` frame that is not a tool result (with
// the replays of the probe's own prompts marked), every `assistant` frame the engine wrote itself, the task, status and
// lifecycle frames, and the results.
export function wireArrivals(p,from=0,to=Infinity){
 return p.frames.filter(r=>r.seq>from&&r.seq<to).filter(r=>{const f=r.frame;
  if(f.type==='user')return !isToolResult(f.message);
  if(f.type==='assistant')return f.message?.model==='<synthetic>'||f.local_command_source!==undefined;
  if(f.type==='system')return /^task_|^status$|^compact|^local_command|^scheduled|^informational|^notification|^init$|^hook_/.test(f.subtype)||f.subtype==='command_lifecycle';
  return f.type==='result'||f.type==='command_lifecycle';
 }).map(r=>wireBrief(r));
}
// The transcript rows that can carry an arrival: `user` rows that are not tool results, attachments, `system` rows.
// Attachment types that carry no arrival (the turn's context the engine adds to every prompt), left out of the briefs.
const CONTEXT_ATTACHMENTS=new Set(['environment','model','deferred_tools_delta','agent_listing_delta','skill_listing','budget_usd','session_context','date','remote_session_change','prompt_snapshot','mcp_instructions_delta','output_style','plan_mode','auto_mode','todo_reminder','critical_system_reminder','token_usage','current_session_memory','nested_memory','instructions','tool_search_hint','task_status','hook_success']);
export function fileArrivals(rows,fromLine=0){
 return rows.filter(x=>x.line>fromLine).filter(({row:r})=>(r.type==='user'&&!isToolResult(r.message))||(r.type==='attachment'&&!CONTEXT_ATTACHMENTS.has(r.attachment?.type))||r.type==='system'||(r.type==='assistant'&&r.message?.model==='<synthetic>')).map(fileBrief);
}

// Waits for an inbound frame matching `test` (null on timeout).
export const waitFor=(p,test,{after=p.seq,timeout=90000}={})=>p.wait(test,{after,timeout}).catch(()=>null);
export const turnOpen=p=>{let open=0;for(const r of p.frames){const f=r.frame;if(f.type==='system'&&f.subtype==='init')open++;else if(f.type==='result')open=Math.max(0,open-1);}return open>0;};
// Until no turn is open and none opens for `quiet` ms (bounded).
export async function idle(p,timeout=180000,quiet=4000){
 const end=Date.now()+timeout;
 while(Date.now()<end){const last=p.seq;await delay(quiet);if(p.seq===last&&!p.frames.slice(-50).some(r=>r.frame.type==='stream_event'&&Date.now()-Date.parse(r.at)<quiet)){const lastResult=[...p.frames].reverse().find(r=>r.frame.type==='result');const lastInit=[...p.frames].reverse().find(r=>sys(r.frame,'init'));if(!lastInit||(lastResult&&lastResult.seq>lastInit.seq))return true;}}
 p.note({event:'idle_timeout'});return false;
}
export function prompt(p,content){const uuid=randomUUID();p.send({type:'user',uuid,message:{role:'user',content},parent_tool_use_id:null,origin:{kind:'human'}});return {seq:p.seq,uuid};}
export async function turn(p,content,timeout=240000){const s=prompt(p,content);const r=await waitFor(p,f=>f.type==='result',{after:s.seq,timeout});return {...s,result:r};}
export const cost=p=>Math.max(0,...p.frames.filter(r=>r.frame.type==='result').map(r=>r.frame.total_cost_usd??0));

// Copies a transcript into the fixtures, redacted as the harness redacts journals.
export function keepTranscript(file,name){mkdirSync(FIXTURES,{recursive:true});const out=FIXTURES+name+'.transcript.jsonl';writeFileSync(out,existsSync(file)?redact(readFileSync(file,'utf8')):'');return out;}

// One launch as MAWS launches. `body(p, ctx)` runs after MAWS's post-initialize requests.
export async function mawsLaunch(name,{cwd=process.env.PROBE_WORK,model='haiku',mode='auto',bare=false,flags=[],env={},sessionId=randomUUID(),resume=null,spendCap='1.00',lane=true,provenance={}}={},body){
 const args=[...(bare?[]:PRODUCT_FLAGS),'--await-initialize',...(resume?['--resume',resume]:['--session-id',sessionId]),'--disallowedTools','AskUserQuestion','--allowedTools','mcp__maws__ask','--settings',JSON.stringify({dialogExpiry:'never'}),'--max-budget-usd',spendCap,...flags];
 const id=resume??sessionId;
 let failure=null;
 const p=await harnessRun(name,async p=>{
  p.note({event:'provenance',...U3,...provenance,engine:BIN,engineVersion:ENGINE_VERSION,launch:(bare?'MAWS launch without --forward-subagent-text --replay-user-messages --include-hook-events':'MAWS launch (src/engine-host/launch.ts)')+(lane?'':', without MAWS_LANE=B'),args,model,mode,sessionId:id,route:'gateway (vm-run.sh loopback forward)'});
  p.serve('maws',new SdkServer('maws',MAWS_TOOLS.map(t=>({...t,call:()=>({content:[{type:'text',text:'probe: not served'}],isError:true})}))));
  p.on('can_use_tool',r=>{p.note({event:'permission_asked',tool:r.tool_name,decision_reason_type:r.decision_reason_type??null});return {behavior:'allow',updatedInput:r.input};});
  p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});
  p.on('elicitation',()=>({action:'decline'}));
  p.on('ui_copy',()=>({copied:false}));p.on('ui_prompt_read',()=>({text:'',cursor:0}));p.on('ui_prompt_fill',()=>({filled:false}));p.on('ui_prompt_suggest',()=>({shown:false}));
  const init=await p.request('initialize',appInitialize({accepted:true,directory:cwd}),60000);
  if(init.subtype!=='success')throw new Error('initialize: '+JSON.stringify(init));
  const caps=init.response?.capabilities??[];
  if(caps.includes('ui_surface_v1')){await p.request('ui_attach',SURFACE).catch(e=>p.note({event:'ui_attach_failed',error:e.message}));await p.request('ui_panes',{client_id:SURFACE.client_id}).catch(()=>{});}
  p.request('set_max_thinking_tokens',{max_thinking_tokens:null,thinking_display:'summarized'}).catch(e=>p.note({event:'thinking_display_failed',error:e.message}));
  p.note({event:'maws_post_initialize',surfaceAttached:caps.includes('ui_surface_v1'),capabilities:caps});
  try{await body(p,{sessionId:id,cwd,transcript:transcriptOf(cwd,id)});}catch(e){failure=e;throw e;}
  finally{p.note({event:'spend',total_cost_usd:cost(p)});try{await p.request('end_session',{reason:'stop'},10000);}catch{}}
 },{cwd,bin:BIN,model,mode,settingSources:'user,project,local',strictMcp:false,dir:'fixtures/uxwave/',env:mawsEnv(env,lane),flags:args});
 await p.closed;
 if(failure)throw failure;
 return {p,sessionId:id,cwd,transcript:transcriptOf(cwd,id)};
}
