// UX wave U5, P4 (docs/doperpowers/specs/2026-11-12-ux-wave/U5-review-comments-source-control.md, Probes and checks; the
// item l6-artifacts-20): one comment answered by an edit on a scratch document. Does the agent give `artifact_edit`'s
// proposed `reply` from the tool's description alone?
//
// The tools are the repository's own (`mawsToolList()` at the setup branch, dumped to uxwave-p4-maws-tools.json beside
// this file: name, title, description, input schema, annotations and _meta as `tools/list` serves them), five of them
// (artifact_read, artifact_edit, artifact_comments, artifact_reply, artifact_resolve), served from the harness's in-process
// MCP server named `maws` and declared in initialize's sdkMcpServers as MAWS declares it. artifact_edit carries the U5
// change: the optional `reply` (1 to 2,000 characters) and the description's one added sentence, placed after the
// `answering` sentence. The document behind them is the scenario's own (a four-block plan with one open thread); the tool
// answers keep the real tools' shapes. The comment reaches the agent as MAWS sends a document comment: X10's anchored
// text (src/shared/anchor/message.ts, `anchoredMessage`, built here byte for byte), to the main conversation or, with the
// side-thread preamble, as a side thread's first message (here a fresh session: the preamble is the only difference the
// agent can see, as the probe has no parent conversation to fork).
//
// Launch: MAWS's line (as in uxwave-p1-images.mjs) plus what MAWS adds when it serves `maws`: --disallowedTools
// AskUserQuestion --allowedTools mcp__maws__ask. Model: the owner's default, `opus`, with the owner's alias for it
// (ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5-5[1m]) and CLAUDE_CODE_SUBAGENT_MODEL=opus, as the owner's settings set
// them (VM.md: user settings are not applied on the VM, so they are passed here).
// Run: ./vm-run.sh --prefix <p> --out <dir> -e UXP4_RUNS=<n> run run-pass3.mjs uxwave-p4-reply
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {run,scratch} from '../../harness.mjs';
import {probeInitialize} from '../../probe-initialize.mjs';
import {SdkServer} from '../../sdk-mcp.mjs';

const RUNS=Number(process.env.UXP4_RUNS??4);
const BIN=process.env.PROBE_ENGINE;
const ALL=JSON.parse(readFileSync(new URL('./uxwave-p4-maws-tools.json',import.meta.url),'utf8'));
const ANSWERING_SENTENCE='answering: a comment thread id posts the result into that thread (not on a suggested batch: reply with artifact_reply after it).';
const REPLY_SENTENCE='With answering, give reply: one or two sentences in your own words saying what you changed; it is posted as your reply in the thread.';
function toolDefs(){
 const pick=['artifact_read','artifact_edit','artifact_comments','artifact_reply','artifact_resolve'];
 return ALL.filter(t=>pick.includes(t.name)).map(t=>{
  if(t.name!=='artifact_edit')return structuredClone(t);
  if(!t.description.includes(ANSWERING_SENTENCE))throw new Error('artifact_edit\'s answering sentence moved; re-place the reply sentence');
  const edit=structuredClone(t);
  edit.description=t.description.replace(ANSWERING_SENTENCE,ANSWERING_SENTENCE+' '+REPLY_SENTENCE);
  edit.inputSchema.properties.reply={type:'string',minLength:1,maxLength:2000};
  return edit;
 });
}

// ---- the scratch document
const ID='5b0e8a2c-7c1d-4f7e-9d2a-1f3c6e9b8a40';
const COMMENT='Only customers who opted in to product news should get this email. Please change it.';
const QUOTE='we email all customers';
function documentState(){
 return {revision:7,blocks:[['h1','# Launch plan'],['p1','The public launch is on Friday, March 14.'],['p2','On launch morning we email all customers about the new plan tiers.'],['p3','Support doubles its staffing for the first week.']],
  thread:{threadId:'t1',status:'open',orphaned:false,tab:'tab1',block:'p2',quote:QUOTE,createdBy:{by:'user'},createdAt:'2026-11-12T07:00:00.000Z',messages:[{id:'t1:m1',at:'2026-11-12T07:00:00.000Z',body:COMMENT,by:'user'}]}};
}
const markdownOf=s=>s.blocks.map(([id,text])=>`${text} ^${id}`).join('\n\n')+'\n';
const ok=v=>({content:[{type:'text',text:JSON.stringify(v,null,2)}]});
const refused=t=>({content:[{type:'text',text:t}],isError:true});
function server(state,calls){
 const known=a=>a===ID||a==='launch-plan';
 const impl={
  artifact_read:a=>known(a.artifact)?ok({status:'read',artifactId:ID,kind:'document',title:'Launch plan',handle:'launch-plan',versions:[],revision:state.revision,tabs:[{id:'tab1',title:'Launch plan',blocks:state.blocks.length}],tab:'tab1',markdown:markdownOf(state)}):refused('artifact_read: no artifact '+a.artifact),
  artifact_comments:a=>known(a.artifact)?ok({status:'listed',artifactId:ID,revision:state.revision,threads:(a.status==='resolved')===(state.thread.status==='resolved')||a.status==='all'?[state.thread]:[]}):refused('artifact_comments: no artifact '+a.artifact),
  artifact_edit:a=>{
   if(!known(a.artifact))return refused('artifact_edit: no artifact '+a.artifact);
   if(a.baseRevision>state.revision)return refused(`artifact_edit: baseRevision ${a.baseRevision} is newer than the live revision ${state.revision}`);
   const results=[];
   for(const op of a.ops??[]){
    if(op.op==='replace_text'){const b=state.blocks.find(([id,t])=>(op.block?id===op.block:true)&&t.includes(op.old));if(!b)return refused(`artifact_edit: op ${results.length}: "${op.old}" not found`);b[1]=b[1].replace(op.old,op.new);results.push({line:`replaced 1 occurrence(s) in ^${b[0]}`,target:b[0],newIds:[]});}
    else if(op.op==='replace_block'){const b=state.blocks.find(([id])=>id===op.id);if(!b)return refused(`artifact_edit: op ${results.length}: no block ^${op.id}`);b[1]=String(op.markdown).replace(/\s*\^[a-z0-9]+\s*$/,'');results.push({line:`replaced ^${b[0]}`,target:b[0],newIds:[]});}
    else results.push({line:`${op.op} applied`,target:op.id??op.after??'',newIds:[]});
   }
   state.revision+=1;
   let answered;
   if(a.answering!==undefined){
    if(a.answering!==state.thread.threadId)return refused('artifact_edit: no thread '+a.answering);
    const messageId=`t1:m${state.thread.messages.length+1}`;
    state.thread.messages.push({id:messageId,at:new Date().toISOString(),body:a.reply??'Edited this passage.',by:'this session'}); // the U5 rule
    answered={threadId:'t1',messageId};
   }
   return ok({status:'edited',artifactId:ID,revision:state.revision,results,orphaned:[],...(answered&&{answered})});
  },
  artifact_reply:a=>{if(a.threadId!==state.thread.threadId)return refused('artifact_reply: no thread '+a.threadId);const messageId=`t1:m${state.thread.messages.length+1}`;state.thread.messages.push({id:messageId,at:new Date().toISOString(),body:a.body,by:'this session'});return ok({status:'replied',artifactId:ID,threadId:'t1',messageId});},
  artifact_resolve:a=>{if(a.threadId!==state.thread.threadId)return refused('artifact_resolve: no thread '+a.threadId);state.thread.status='resolved';return ok({status:'resolved',artifactId:ID,threadId:'t1'});},
 };
 return new SdkServer('maws',toolDefs().map(t=>({...t,call:args=>{calls.push({name:t.name,arguments:args});return impl[t.name](args);}})));
}
// SdkServer's tools/list keeps name, description and inputSchema; MAWS's also carries title, annotations and _meta
// (anthropic/alwaysLoad keeps artifact_edit out of tool search's deferral), so the list is served whole here.
class FullServer extends SdkServer{handle(m){if(m?.method==='tools/list'&&m.id!==undefined){this.seen.push({method:'tools/list',id:m.id,kind:'request'});return {jsonrpc:'2.0',id:m.id,result:{tools:this.tools.map(({call,...t})=>t)}};}return super.handle(m);}}

// ---- X10's anchored text for a document comment (src/shared/anchor/message.ts)
const SIDE_THREAD_PREAMBLE='You are in a side thread forked from the main conversation to handle this one comment. Address it here; the main conversation continues separately and is not waiting on you.';
const esc=v=>String(v).replace(/[&"<>]/g,c=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'})[c]);
function anchoredMessage(destination){
 const anchor={kind:'artifact-comment',label:'Launch plan',locator:QUOTE,artifactId:ID,threadId:'t1'};
 const lead=`Comment on "${anchor.label}" (passage "${anchor.locator}" in document ${anchor.artifactId}, thread ${anchor.threadId}):`;
 const tag='<maws_anchor'+['kind','label','locator','artifactId','threadId'].map(k=>` ${k}="${esc(anchor[k])}"`).join('')+'/>';
 return `${lead}\n${COMMENT}${destination==='thread'?`\n\n${SIDE_THREAD_PREAMBLE}`:''}\n\n${tag}`;
}

function classify(calls){
 const edits=calls.filter(c=>c.name==='artifact_edit'&&!String(JSON.stringify(c.arguments)).includes('"mode":"suggest"'));
 const answered=edits.filter(c=>c.arguments.answering!==undefined);
 const withReply=answered.filter(c=>typeof c.arguments.reply==='string'&&c.arguments.reply.trim()!=='');
 const replies=calls.filter(c=>c.name==='artifact_reply');
 if(withReply.length)return 'edit+answering+reply';
 if(answered.length)return replies.length?'edit+answering, then artifact_reply':'edit+answering, no reply';
 if(edits.length)return replies.length?'edit without answering, then artifact_reply':'edit without answering';
 return 'no edit';
}

export default async()=>{
 const tally={};
 for(const destination of ['main','thread']){
  for(let n=1;n<=RUNS;n++){
   const cwd=scratch(`${process.env.PROBE_ROOT??'/tmp'}/repo-`);
   const sessionId=randomUUID();
   const state=documentState();const calls=[];
   const maws=new FullServer('maws',server(state,calls).tools);
   await run(`uxwave-p4-reply-${destination}-${n}`,async p=>{
    p.serve('maws',maws);
    p.on('can_use_tool',r=>{p.note({event:'permission_asked',tool:r.tool_name});return r.tool_name.startsWith('mcp__maws__')?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only the maws tools are in scope.'};});
    p.note({event:'provenance',spec:'docs/doperpowers/specs/2026-11-12-ux-wave/U5-review-comments-source-control.md',probe:'P4',destination,run:n,engine:BIN,editDescription:maws.tools.find(t=>t.name==='artifact_edit').description,replySchema:maws.tools.find(t=>t.name==='artifact_edit').inputSchema.properties.reply});
    const init=await p.request('initialize',{...probeInitialize({accepted:true,directory:cwd}),sdkMcpServers:['maws']});
    if(init.subtype!=='success')throw new Error('initialize: '+JSON.stringify(init));
    await p.request('set_max_thinking_tokens',{max_thinking_tokens:null,thinking_display:'summarized'}).catch(e=>p.note({event:'set_max_thinking_tokens_failed',error:e.message}));
    const after=p.seq;
    p.send({type:'user',uuid:randomUUID(),message:{role:'user',content:anchoredMessage(destination)},parent_tool_use_id:null,origin:{kind:'human'},priority:'now'});
    const r=await p.wait(f=>f.type==='result',{after,timeout:300000});
    const outcome=classify(calls);
    tally[`${destination}: ${outcome}`]=(tally[`${destination}: ${outcome}`]??0)+1;
    const init2=p.frames.find(x=>x.frame.type==='system'&&x.frame.subtype==='init')?.frame;
    p.note({event:'outcome',destination,run:n,outcome,calls,thread:state.thread,markdown:markdownOf(state),result:{subtype:r.subtype,is_error:r.is_error,answer:r.result,cost:r.total_cost_usd},model:init2?.model,version:init2?.claude_code_version,toolsListed:(init2?.tools??[]).filter(t=>t.startsWith('mcp__maws__'))});
    console.log(JSON.stringify({destination,run:n,outcome,model:init2?.model,reply:calls.find(c=>c.name==='artifact_edit')?.arguments?.reply??null,cost:r.total_cost_usd}));
   },{cwd,bin:BIN,dir:'fixtures/uxwave/',model:'opus',settingSources:'user,project,local',strictMcp:false,mode:'default',
    env:{ENABLE_TOOL_SEARCH:'true',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',TERM:'dumb',DISABLE_AUTOUPDATER:'1',ANTHROPIC_DEFAULT_OPUS_MODEL:'claude-opus-5-5[1m]',CLAUDE_CODE_SUBAGENT_MODEL:'opus'},
    flags:['--forward-subagent-text','--replay-user-messages','--include-hook-events','--disallowedTools','AskUserQuestion','--allowedTools','mcp__maws__ask','--settings',JSON.stringify({dialogExpiry:'never'}),'--session-id',sessionId,'--max-budget-usd','1.50']});
  }
 }
 console.log('TALLY',JSON.stringify(tally));
};
