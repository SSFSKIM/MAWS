// Ticket 704, probes 1 to 3 (docs/doperpowers/plans/2026-11-15-envelope-split.md on ux-wave/704-envelope-split,
// "Probes"): an async ask's answer envelope waiting at the engine's next step beside a person's prompt (or a second
// envelope), with a REAL ask in the session and the engine's file kept whole.
// The launch, environment and permission mode are U4b's second probes' (uxwave-common-send-permission.mjs; the
// scripts uxwave-u4b-envelope-end.mjs and -early.mjs), with the `maws` SDK server declared (appInitialize's
// sdkMcpServers) and served here: its tools are MAWS's (p4-maws-tools.json), and `ask` answers as MAWS's host answers a
// non-blocking ask, one text block {"status": "asked", "askId": <the call's tool-use id>} with the id taken from the
// request's `_meta["claudecode/toolUseId"]` (fixtures/pass3/p1-maws-ask-async.jsonl seq 104, 105). Each answer is the
// envelope built at run time by the repository's askSteerText (src/shared/maws/ask.ts at this checkout's head, bundled
// with esbuild into the scratch root at start) for that id, written as answerAsk writes it (a `user` frame, origin
// human, priority next), followed by a meta row `maws_ask_answered` of the host's form (the same fixture, seq 122).
// Kept: the journal, and <name>.transcript.jsonl, the engine's file as the engine wrote it (the harness's redaction
// only). UXW_CASE:
//   end-env-first, end-prompt-first  the model calls ask (non-blocking) and then only writes; the envelope and a
//                                    prompt are written at `next` while it writes; the turn ends by itself
//   end-two-envelopes                the same with two asks (two calls), both answered, no prompt
//   two-late-env-first               the control: the model calls ask, then a 30 s foreground shell call; 9.5 s in the
//                                    envelope at `next`, 0.5 s later the prompt at `next` named by interrupt {send_now}
//                                    (U4b's two-late timing: the call long a task, read at the tool boundary)
//   rewind                           end-prompt-first, then rewind_conversation to the joined message's uuid as
//                                    src/engine-host/rewind.ts writes it, then one short prompt (the anchor) (probe 2)
//   end-image                        end-env-first with the prompt carrying an invented 1x1 PNG image block (probe 3)
//   pasted                           no ask at all: the session's one prompt is a whole literal envelope (askSteerText)
//                                    for an id no ask of the session has, sent as an ordinary prompt (the review's case)
// UXW_RUN labels repeats; UXW_ESBUILD names the esbuild binary.
import {run,delay,configEnv,steer,lifecycle,alive,until,writeWaiter,MAWS_FLAGS,WORK,ROOT,SURFACE,randomUUID} from './uxwave-common-send-permission.mjs';
import {SdkServer,sdkMcpAnswer} from '../../sdk-mcp.mjs';
import {keepTranscript} from './uxwave-common-arrivals.mjs';
import {probeInitialize} from '../../probe-initialize.mjs';
import {appInitialize} from '../../../../src/shared/engine/initialize.ts';
import {existsSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';

const CASE=process.env.UXW_CASE,RUN=process.env.UXW_RUN||'1',SECS=30;
const CASES=['end-env-first','end-prompt-first','end-two-envelopes','two-late-env-first','rewind','end-image','pasted'];
if(!CASES.includes(CASE))throw new Error('UXW_CASE='+CASES.join('|'));
const HERE=dirname(fileURLToPath(import.meta.url));const REPO=join(HERE,'../../../..');
const MAWS_ENV={CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'false',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',CLAUDE_CODE_QUESTION_PREVIEW_FORMAT:'html'};
const NAME=`u704-${CASE}-${RUN}`;
const tag=(CASE+RUN).replace(/[^a-z0-9]/g,'');
const TWO=CASE==='end-two-envelopes';
const SHELL=CASE==='two-late-env-first';
const Q=[{id:'q1',question:'Which fruit should the demo use?',header:'Fruit',modality:'choice',options:[{label:'Apple'},{label:'Mango'}]},
 {id:'q1',question:'Which colour should the banner be?',header:'Colour',modality:'choice',options:[{label:'Teal'},{label:'Amber'}]}];
const ANSWER=[['Mango'],['Teal']];
const askCall=q=>`call the mcp__maws__ask tool with blocking false and exactly this one question: id "q1", question "${q.question}", header "${q.header}", modality "choice", options ${q.options.map(o=>o.label).join(' and ')}`;
const PROMPT=(TWO?`First, load mcp__maws__ask with ToolSearch if you need to. Then ${askCall(Q[0])}; then, as a separate second call, ${askCall(Q[1])}. Do not wait for any answer.`
 :`First, load mcp__maws__ask with ToolSearch if you need to. Then ${askCall(Q[0])}. Do not wait for the answer.`)
 +(SHELL?` Then run this exact shell command with the Bash tool, in the foreground (do not set run_in_background): node wait.cjs ${tag} ${SECS}\nWhen it finishes, reply with its output and nothing else.`
 :' Then, without using any more tools, write a story of about 900 words about a lighthouse keeper who collects sea glass.');
// The prompt member asks for one tool call, so that the joined turn's first response is a tool use, after which the
// engine writes its `last-prompt` row (seen at u704-end-env-first-1's first take: no `last-prompt` follows a turn of text).
const KIWI='Run the shell command `echo KIWI` with the Bash tool, then reply with its output and carry on with what you were doing.';
// a 1x1 PNG, invented
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMAGE_PROMPT=[{type:'text',text:'Run the shell command `echo KIWI` with the Bash tool, then reply with its output and name the colour of this tiny image, then carry on with what you were doing.'},{type:'image',source:{type:'base64',media_type:'image/png',data:PNG}}];

function bundleAsk(){
 const out=join(ROOT,'u704-ask.mjs');const entry=join(ROOT,'u704-ask-entry.ts');
 writeFileSync(entry,`export {askSteerText} from ${JSON.stringify(join(REPO,'src/shared/maws/ask.ts'))};\n`);
 execFileSync(process.env.UXW_ESBUILD,[entry,'--bundle','--platform=node','--format=esm','--outfile='+out,'--log-level=warning','--tsconfig='+join(REPO,'tsconfig.json')]);
 let head=null;try{head=execFileSync('git',['-C',REPO,'rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{}
 return {out,head};
}

export default async()=>{
 const cfg=configEnv({});
 const built=bundleAsk();const {askSteerText}=await import(built.out);
 if(SHELL)writeWaiter(WORK);const pidFile=`${WORK}/wait-${tag}.pid`;
 await run(NAME,async p=>{
  p.note({event:'uxw_case',probe:'ticket 704 probes',case:CASE,run:RUN,askSteerTextFrom:{file:'src/shared/maws/ask.ts',head:built.head},featureCache:cfg.feat,permissionMode:'auto',model:process.env.PROBE_MODEL||'haiku',mawsEnv:MAWS_ENV,bin:'claude'});
  p.on('can_use_tool',r=>({behavior:'allow',updatedInput:r.input}));
  // the maws server: MAWS's tools, `ask` answering as the host answers a non-blocking ask
  const tools=JSON.parse(readFileSync(join(HERE,'p4-maws-tools.json'),'utf8')).tools.map(t=>({...t,call:()=>({content:[{type:'text',text:'probe: not served'}],isError:true})}));
  const server=new SdkServer('maws',tools);p.serve('maws',server);
  const asks=[];
  p.on('mcp_message',r=>{const m=r.message;
   if(m?.method==='tools/call'&&m.params?.name==='ask'){const askId=m.params?._meta?.['claudecode/toolUseId'];asks.push({askId,arguments:m.params.arguments});p.note({event:'uxw_ask_called',askId,mcpId:m.id});
    return {mcp_response:{jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify({status:'asked',askId},null,2)}]}}};}
   return sdkMcpAnswer(p.servers,r);});
  const init=await p.request('initialize',{...probeInitialize(),sdkMcpServers:appInitialize().sdkMcpServers},60000);
  const caps=init.response?.capabilities??[];p.note({event:'uxw_handshake',capabilities:caps});
  if(caps.includes('ui_surface_v1')){try{await p.request('ui_attach',SURFACE);await p.request('ui_panes',{client_id:SURFACE.client_id});}catch(e){p.note({event:'uxw_surface_error',error:e.message});}}
  p.request('set_max_thinking_tokens',{max_thinking_tokens:null,thinking_display:'summarized'}).catch(()=>{});
  if(CASE==='pasted'){
   const fakeId='toolu_01UXWNoSuchAskInThisSession';
   const text=askSteerText(fakeId,[Q[0]],[{id:'q1',question:Q[0].question,status:'answered',value:ANSWER[0]}]);
   const uuid=steer(p,text,'now');p.note({event:'uxw_pasted_prompt',uuid,askId:fakeId});
   await p.wait(f=>f.type==='result',{after:p.seq,timeout:120000}).catch(()=>{});
   let seen=p.seq,q=0;for(const t=Date.now()+60000;Date.now()<t&&q<8;){await delay(1000);if(p.seq===seen)q++;else{q=0;seen=p.seq;}}
   p.note({event:'uxw_final',results:p.frames.filter(r=>r.frame.type==='result').map(r=>({seq:r.seq,subtype:r.frame.subtype,terminal_reason:r.frame.terminal_reason})),
    replays:p.frames.filter(r=>r.direction==='in'&&r.frame.type==='user'&&r.frame.isReplay).map(r=>({seq:r.seq,uuid:r.frame.uuid,origin:r.frame.origin,content:r.frame.message?.content})),asks,messages:[uuid],prompt:null});
   const base=process.env.HOME+'/.claude/projects';let file=null;
   for(const d of existsSync(base)?readdirSync(base):[]){const f=`${base}/${d}/${p.sessionId}.jsonl`;if(existsSync(f))file=f;}
   if(file)keepTranscript(file,NAME);p.note({event:'uxw_transcript_kept',kept:!!file});
   return;
  }
  const first=steer(p,PROMPT,'now');p.note({event:'uxw_prompt',uuid:first});
  const want=TWO?2:1;
  const asked=await until(()=>asks.length>=want,120000,100);if(!asked)throw new Error('the ask was not called');
  const answer=(i,priority='next')=>{const a=asks[i];const answers=[{id:'q1',question:Q[i].question,status:'answered',value:ANSWER[i]}];
   const uuid=steer(p,askSteerText(a.askId,[Q[i]],answers),priority);p.note({event:'maws_ask_answered',askId:a.askId,toolUseId:a.askId,answers});return uuid;};
  const put=async(make)=>{const uuid=make();await p.wait(lifecycle(uuid,'queued'),{timeout:10000}).catch(()=>p.note({event:'uxw_no_queued_lifecycle',uuid}));return uuid;};
  const msgs=[];let answers=[];
  if(SHELL){
   const ready=await until(()=>alive(pidFile)?.alive,120000,20);const t0=Date.now();if(!ready)throw new Error('the call never ran');
   await delay(Math.max(0,t0+9500-Date.now()));msgs.push(await put(()=>answer(0)));
   await delay(Math.max(0,t0+10000-Date.now()));const M=steer(p,KIWI,'next');msgs.push(M);
   const r=await p.request('interrupt',{send_now:true,message_uuid:M}).catch(e=>({error:e.message}));answers.push(r);p.note({event:'uxw_answer',response:r});
  }else{
   const ready=await p.wait(f=>f.type==='stream_event'&&f.event?.delta?.type==='text_delta',{after:p.seq,timeout:120000}).then(()=>true,()=>false);
   if(!ready)throw new Error('no text after the ask');await delay(800);
   const prompt=CASE==='end-image'?()=>{const uuid=randomUUID();p.send({type:'user',uuid,message:{role:'user',content:IMAGE_PROMPT},parent_tool_use_id:null,origin:{kind:'human'},priority:'next'});return uuid;}:()=>steer(p,KIWI,'next');
   const order=TWO?[()=>answer(0),()=>answer(1)]:CASE==='end-prompt-first'||CASE==='rewind'?[prompt,()=>answer(0)]:[()=>answer(0),prompt];
   for(const make of order)msgs.push(await put(make));
  }
  p.note({event:'uxw_messages_written',messages:msgs});
  await until(()=>msgs.every(u=>p.frames.some(r=>lifecycle(u,'started')(r.frame))),180000,250);
  const quiet=async()=>{let seen=p.seq,q=0;for(const t=Date.now()+120000;Date.now()<t&&q<10;){await delay(1000);if(p.seq===seen)q++;else{q=0;seen=p.seq;}}};
  await quiet();
  if(CASE==='rewind'){
   const target=msgs.at(-1);
   const r=await p.request('rewind_conversation',{target_message_uuid:target,last_seen_user_message_uuid:target,interrupt_if_running:false},60000).catch(e=>({error:e.message}));
   p.note({event:'uxw_rewind',target,response:r});
   await delay(2000);
   const a=steer(p,'Without using any tool, reply with only the word ANCHOR.','now');p.note({event:'uxw_anchor_prompt',uuid:a});
   await p.wait(f=>f.type==='result',{after:p.seq,timeout:120000}).catch(()=>{});await quiet();
  }
  p.note({event:'uxw_final',results:p.frames.filter(r=>r.frame.type==='result').map(r=>({seq:r.seq,subtype:r.frame.subtype,terminal_reason:r.frame.terminal_reason})),
   lifecycles:p.frames.filter(r=>r.frame.type==='command_lifecycle').map(r=>({seq:r.seq,uuid:r.frame.command_uuid,state:r.frame.state})),
   requesting:p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='status'&&r.frame.user_message_uuids).map(r=>({seq:r.seq,uuids:r.frame.user_message_uuids})),
   replays:p.frames.filter(r=>r.direction==='in'&&r.frame.type==='user'&&r.frame.isReplay).map(r=>({seq:r.seq,uuid:r.frame.uuid,origin:r.frame.origin,content:r.frame.message?.content})),
   asks,messages:msgs,prompt:first,sendNowAnswers:answers});
  const base=process.env.HOME+'/.claude/projects';let file=null;
  for(const d of existsSync(base)?readdirSync(base):[]){const f=`${base}/${d}/${p.sessionId}.jsonl`;if(existsSync(f))file=f;}
  if(file)keepTranscript(file,NAME);p.note({event:'uxw_transcript_kept',kept:!!file});
 },{dir:'fixtures/uxwave/',cwd:WORK,settingSources:'user,project,local',strictMcp:false,mode:'auto',flags:[...MAWS_FLAGS],env:{...MAWS_ENV,...cfg.env}});
};
