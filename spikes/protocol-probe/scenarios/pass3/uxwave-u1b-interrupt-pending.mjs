// UX wave U1b, probe 8: what the engine does when a turn is interrupted while a permission request is pending (U1b's
// acceptance "Stop withdraws the prompt and its card leaves"). A session launched as MAWS launches it
// (uxwave-common-arrivals.mjs) in permission mode default. A prompt makes the model call one Bash command that needs
// permission (`touch` of a marker file in the scratch work folder). The engine's `can_use_tool` request is held
// unanswered, and 2 s after it arrives Stop's interrupt is sent as src/engine-host/session.ts `interrupt` sends it
// ({subtype: 'interrupt', reason: 'user-cancel', cancel_queued: false}). Every frame to the turn's end is in the
// journal; the step is noted (`uxw_case`). Then (b) the held request is answered late with an allow, as the harness
// answers any control request, and the marker is looked for; then (c) a next prompt asks the model what happened to
// the command. UXW_CASE=main (the above) or child (the same with the request raised by a subagent's Bash call).
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,prompt,turn,delay,cost} from './uxwave-common-arrivals.mjs';
import {existsSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';

const CASE=process.env.UXW_CASE||'main';
const TAG=process.env.UXW_TAG||`u1b-intpend-${CASE}`;
const WORK=process.env.PROBE_WORK;
const MARK=`uxw-ran-${CASE}.txt`;
const DELAY=Number(process.env.UXW_DELAY??2000); // ms from the request to the interrupt
const PROMPTS={
 main:`Use the Bash tool once to run exactly \`touch ${MARK}\` in the current folder (description "uxw touch"). Then reply with only the word DONE.`,
 child:`Use the Agent tool once (subagent_type general-purpose, run_in_background false, description "uxw child") with this prompt for the agent: "Use the Bash tool once to run exactly \`touch ${MARK}\` in the current folder (description \\"uxw touch\\"), then reply with only the word DONE." Then reply with only the word DONE.`,
};
const subFiles=transcript=>{const d=transcript.replace(/\.jsonl$/,'')+'/subagents';try{return readdirSync(d).filter(n=>n.endsWith('.jsonl')).map(n=>join(d,n));}catch{return [];}};

export default async()=>{
 await mawsLaunch(TAG,{model:'haiku',mode:'default',spendCap:'0.10',provenance:{probe:'U1b probe 8 (interrupt while a permission request is pending)',case:CASE,mark:MARK}},async(p,{transcript})=>{
  let held=null;
  p.on('can_use_tool',(r,frame)=>{held={request_id:frame.request_id,request:r,seq:p.seq};p.note({event:'uxw_held',request_id:frame.request_id,tool:r.tool_name,agent_id:r.agent_id??null,tool_use_id:r.tool_use_id??null});return new Promise(()=>{});});
  let lastLine=0;
  const record=(name,from,extra={})=>{const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);const fileRows=rows.filter(x=>x.line>lastLine).map(({line,row:r})=>({line,type:r.type,subtype:r.subtype,uuid:r.uuid,toolUse:Array.isArray(r.message?.content)?r.message.content.filter(b=>b.type==='tool_use').map(b=>({id:b.id,name:b.name,input:b.input})):undefined,toolResult:Array.isArray(r.message?.content)?r.message.content.filter(b=>b.type==='tool_result').map(b=>({tool_use_id:b.tool_use_id,is_error:b.is_error,content:b.content})):undefined,toolUseResult:r.toolUseResult,text:typeof r.message?.content==='string'?r.message.content.slice(0,200):undefined,operation:r.operation,attachment:r.attachment?.type})).filter(x=>x.type!=='attachment'||x.attachment==='queued_command');lastLine=rows.length;
   const subs=subFiles(transcript).map(f=>({file:f.split('/').pop(),rows:rowsOf(f).map(({line,row:r})=>({line,type:r.type,toolUse:Array.isArray(r.message?.content)?r.message.content.filter(b=>b.type==='tool_use').map(b=>({id:b.id,name:b.name})):undefined,toolResult:Array.isArray(r.message?.content)?r.message.content.filter(b=>b.type==='tool_result').map(b=>({tool_use_id:b.tool_use_id,is_error:b.is_error,content:b.content})):undefined,text:typeof r.message?.content==='string'?r.message.content.slice(0,200):undefined})).filter(x=>x.toolUse?.length||x.toolResult?.length||x.text)}));
   p.note({event:'uxw_case',case:name,fromSeq:from,toSeq:p.seq,...extra,markerExists:existsSync(join(WORK,MARK)),wire:wireArrivals(p,from),file,fileRows,subagents:subs});
   console.log(name,'marker',existsSync(join(WORK,MARK)),JSON.stringify(extra).slice(0,300));};
  // (a)
  let from=p.seq;
  const s=prompt(p,PROMPTS[CASE]);
  const req=await waitFor(p,f=>f.type==='control_request'&&f.request?.subtype==='can_use_tool',{after:s.seq,timeout:120000});
  if(!req){record('a-no-request',from);throw new Error('no permission request');}
  await delay(DELAY);
  p.note({event:'uxw_turn_open_at_interrupt',resultSince:p.frames.some(r=>r.seq>s.seq&&r.frame.type==='result'),delayMs:DELAY});
  const ir=await p.request('interrupt',{reason:'user-cancel',cancel_queued:false},30000).catch(e=>({error:e.message}));
  p.note({event:'uxw_interrupt',response:ir});
  const res=await waitFor(p,f=>f.type==='result',{after:s.seq,timeout:120000});
  if(CASE==='child')await delay(8000); // a background child's request may still be pending: give the engine time to act on it
  await idle(p,60000,4000);
  record('a-interrupted',from,{interruptAnswer:ir.response??ir,result:res?{subtype:res.subtype,stop_reason:res.stop_reason,is_error:res.is_error,result:res.result}:null,cancelSeen:p.frames.filter(r=>r.seq>from&&r.frame.type==='control_cancel_request').map(r=>({seq:r.seq,request_id:r.frame.request_id}))});
  // (b) the late allow
  from=p.seq;
  if(held){p.send({type:'control_response',response:{subtype:'success',request_id:held.request_id,response:{behavior:'allow',updatedInput:held.request.input}}});}
  await delay(8000);await idle(p,30000,3000);
  record('b-late-allow',from,{answeredRequest:held?.request_id??null});
  // (c) a next prompt
  from=p.seq;
  const t=await turn(p,'Without using any tool: did the command you were asked to run earlier run? Reply in one short sentence.');
  await idle(p,60000,3000);
  record('c-next-prompt',from,{result:t.result?{subtype:t.result.subtype,stop_reason:t.result.stop_reason,result:t.result.result}:null});
  keepTranscript(transcript,TAG);
  for(const f of subFiles(transcript))keepTranscript(f,TAG+'-sub-'+f.split('/').pop().replace(/\.jsonl$/,''));
  console.log(TAG,'cost',cost(p));
 });
};
