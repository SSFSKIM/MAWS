// UX wave U1b, probe 9a: a message sent from the composer while a blocking question waits. A session launched as MAWS
// launches it (uxwave-common-arrivals.mjs). The model asks one question, and the probe holds it unanswered:
//   UXW_KIND=engine  the engine's own AskUserQuestion, held as an unanswered `can_use_tool` request. MAWS's launch
//                    disallows that tool, so this kind launches with `engineAsk: true`, which drops
//                    `--disallowedTools AskUserQuestion` and nothing else.
//   UXW_KIND=mcp     MAWS's blocking ask, `mcp__maws__ask` with blocking true, held as an unanswered `tools/call` on
//                    the `maws` SDK server (the probe's stand-in; the answer is shaped as
//                    fixtures/pass3/p1-maws-ask-blocking.jsonl seq 137 records MAWS's).
// 2 s after the question arrives, a user frame is written on stdin as MAWS's composer writes it, and the wire is
// watched for 6 s. Then UXW_END=answer answers the question ("Mango"), and UXW_END=interrupt sends Stop's interrupt
// (src/engine-host/session.ts: {reason: 'user-cancel', cancel_queued: false}) with the question never answered; the
// session is then watched until it has been idle for a while. Each phase is noted as `uxw_case`.
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,prompt,delay,cost} from './uxwave-common-arrivals.mjs';
import {sdkMcpAnswer} from '../../sdk-mcp.mjs';

const KIND=process.env.UXW_KIND||'engine';
const END=process.env.UXW_END||'answer';
const TAG=process.env.UXW_TAG||`u1b-askwait-${KIND}-${END}`;
const ASK={
 engine:'Use the AskUserQuestion tool once to ask me "Which fruit do you prefer?" with the options Apple and Mango. When I have answered, reply with only the fruit I chose, then follow any later instruction I gave.',
 mcp:'Call the mcp__maws__ask tool once (load it with ToolSearch first if you need to) with blocking true and one question: id "q1", question "Which fruit do you prefer?", modality "choice", options Apple and Mango. When I have answered, reply with only the fruit I chose, then follow any later instruction I gave.',
};
const MESSAGE='Also: end your reply with the word KIWI.';

export default async()=>{
 await mawsLaunch(TAG,{model:'haiku',engineAsk:KIND==='engine',spendCap:'0.15',provenance:{probe:'U1b probe 9a (a message while a blocking question waits)',kind:KIND,end:END}},async(p,{transcript})=>{
  let held=null,release=null;
  if(KIND==='engine')p.on('can_use_tool',(r,frame)=>{
   if(r.tool_name!=='AskUserQuestion'){p.note({event:'permission_asked',tool:r.tool_name});return {behavior:'allow',updatedInput:r.input};}
   held={request_id:frame.request_id,input:r.input,tool_use_id:r.tool_use_id};p.note({event:'uxw_held',kind:KIND,request_id:frame.request_id,tool_use_id:r.tool_use_id??null});
   return new Promise(res=>{release=answer=>{const qs=r.input?.questions??[];const answers=Object.fromEntries(qs.map(q=>[q.question,answer]));res({behavior:'allow',updatedInput:{...r.input,answers}});};});
  });
  else p.on('mcp_message',r=>{
   const m=r.message;
   if(m?.method==='tools/call'&&m.params?.name==='ask'){
    held={mcp_id:m.id,arguments:m.params.arguments,tool_use_id:m.params?._meta?.['claudecode/toolUseId']??null};p.note({event:'uxw_held',kind:KIND,mcp_id:m.id,tool_use_id:held.tool_use_id});
    return new Promise(res=>{release=answer=>{const qs=m.params.arguments?.questions??[];res({mcp_response:{jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify({status:'answered',askId:held.tool_use_id,answers:qs.map(q=>({id:q.id,question:q.question,status:'answered',value:[answer]}))},null,2)}]}}});};});
   }
   return sdkMcpAnswer(p.servers,r);
  });
  let lastLine=0;
  const record=(name,from,extra={})=>{const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);
   const tools=rows.filter(x=>x.line>lastLine).flatMap(({line,row:r})=>Array.isArray(r.message?.content)?r.message.content.filter(b=>b.type==='tool_use'||b.type==='tool_result').map(b=>({line,type:r.type,uuid:r.uuid,parentUuid:r.parentUuid,block:b.type,id:b.id??b.tool_use_id,name:b.name,is_error:b.is_error,content:typeof b.content==='string'?b.content.slice(0,300):JSON.stringify(b.content??b.input).slice(0,300)})):[]);
   const queue=rows.filter(x=>x.line>lastLine&&(x.row.type==='queue-operation'||x.row.attachment?.type==='queued_command')).map(({line,row:r})=>({line,type:r.type,operation:r.operation,content:typeof r.content==='string'?r.content.slice(0,120):undefined,uuid:r.uuid,parentUuid:r.parentUuid,attachment:r.attachment?{type:r.attachment.type,source_uuid:r.attachment.source_uuid,prompt:r.attachment.prompt}:undefined}));
   lastLine=rows.length;
   p.note({event:'uxw_case',case:name,fromSeq:from,toSeq:p.seq,...extra,wire:wireArrivals(p,from),wireOther:p.frames.filter(r=>r.seq>from&&(r.frame.type==='control_cancel_request'||(r.frame.type==='control_request'&&r.frame.request?.subtype==='mcp_message'&&r.frame.request?.message?.method!=='tools/list'))).map(r=>({seq:r.seq,type:r.frame.type,request_id:r.frame.request_id,method:r.frame.request?.message?.method,params:r.frame.request?.message?.params})),file,tools,queue});
   console.log(name,JSON.stringify(extra).slice(0,300));};
  let from=p.seq;
  const s=prompt(p,ASK[KIND]);
  const asked=await waitFor(p,()=>held!==null,{after:s.seq,timeout:120000}).catch(()=>null);
  for(let i=0;i<120&&!held;i++)await delay(500);
  if(!held){record('no-question',from);throw new Error('the question never arrived');}
  record('asked',from,{held});
  await delay(2000);
  from=p.seq;
  const m=prompt(p,MESSAGE);
  await delay(6000);
  record('message-while-waiting',from,{messageUuid:m.uuid,turnEnded:p.frames.some(r=>r.seq>s.seq&&r.frame.type==='result')});
  from=p.seq;
  if(END==='answer'){release('Mango');await waitFor(p,f=>f.type==='result',{after:from,timeout:120000});await idle(p,90000,5000);}
  else{const ir=await p.request('interrupt',{reason:'user-cancel',cancel_queued:false},30000).catch(e=>({error:e.message}));p.note({event:'uxw_interrupt',response:ir});await waitFor(p,f=>f.type==='result',{after:from,timeout:60000});await idle(p,90000,8000);}
  const results=p.frames.filter(r=>r.seq>s.seq&&r.frame.type==='result').map(r=>({seq:r.seq,subtype:r.frame.subtype,stop_reason:r.frame.stop_reason,result:r.frame.result}));
  record(END==='answer'?'answered':'interrupted',from,{results,messageReplays:p.frames.filter(r=>r.frame.type==='user'&&r.frame.uuid===m.uuid).map(r=>({seq:r.seq,isReplay:r.frame.isReplay})),messageLifecycle:p.frames.filter(r=>r.frame.type==='command_lifecycle'&&r.frame.command_uuid===m.uuid).map(r=>({seq:r.seq,state:r.frame.state}))});
  keepTranscript(transcript,TAG);
  console.log(TAG,'cost',cost(p));
 });
};
