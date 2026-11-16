// UX wave U3b, probe 7 (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md; master's Edit under the
// owner's message rewinds the session in place, src/engine-host/rewind.ts): an IN-PLACE rewind (no fork) onto a
// message from before a compaction. A short session launched as MAWS launches it (uxwave-common-arrivals.mjs): ONE
// typed; `/compact`; TWO typed. Then, in that same live session, `rewind_conversation` {target_message_uuid,
// last_seen_user_message_uuid: TWO, interrupt_if_running: false} as rewind.ts asks, onto UXW_TARGET: one (before the
// boundary), compact (the /compact command's row, which is the uuid it was sent with) or two (the control). The answer
// is noted whole, then the wire and the file for 3 s, then one short prompt ("… AFTER.") with its answer and the file's
// chain from it. UXW_RESUMED=1: the session is ended after TWO and launched again with `--resume <id>` (MAWS after a
// restart), and the rewind is issued in the resumed process.
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,prompt,turn,delay,cost,randomUUID} from './uxwave-common-arrivals.mjs';

const TARGET=process.env.UXW_TARGET||'one';
const RESUMED=process.env.UXW_RESUMED==='1';
// UXW_SHAPE=above (probe 7b): ONE, TWO, /compact, THREE, so a target before the boundary is not the first prompt; the
// next prompt then asks the model, without a tool, for the words it was asked to reply with before.
const SHAPE=process.env.UXW_SHAPE||'first';
const TAG=process.env.UXW_TAG||`u3b-editcmp-${TARGET}${SHAPE==='above'?'-above':''}${RESUMED?'-resumed':''}`;
const AFTER=SHAPE==='above'?'Without using any tool: list, in order, the words you were asked to reply with earlier in this conversation, separated by spaces, then the word AFTER. If there were none, reply with only the word AFTER.':'Without using any tool, reply with only the word AFTER.';
const textOf=r=>typeof r.message?.content==='string'?r.message.content:Array.isArray(r.message?.content)?r.message.content.filter(b=>b.type==='text').map(b=>b.text).join(' '):typeof r.content==='string'?r.content:undefined;
const brief=({line,row:r})=>Object.fromEntries(Object.entries({line,type:r.type,subtype:r.subtype,uuid:r.uuid,parentUuid:r.parentUuid,logicalParentUuid:r.logicalParentUuid,isMeta:r.isMeta,isCompactSummary:r.isCompactSummary,attachment:r.attachment?.type,text:textOf(r)?.slice(0,120)}).filter(([,v])=>v!==undefined));

async function rewindAndAfter(p,transcript,sent,label){
 const target=sent[TARGET];
 let lastLine=rowsOf(transcript).length;
 const from=p.seq;
 const r=await p.request('rewind_conversation',{target_message_uuid:target,last_seen_user_message_uuid:sent.last,interrupt_if_running:false},60000).catch(e=>({error:e.message}));
 p.note({event:'uxw_rewind',label,target:TARGET,targetUuid:target,lastSeen:sent.last,response:r});
 console.log(label,'rewind',JSON.stringify(r.response??r).slice(0,500));
 await delay(3000);
 let rows=rowsOf(transcript);
 p.note({event:'uxw_case',case:'after rewind',fromSeq:from,toSeq:p.seq,wire:wireArrivals(p,from),file:fileArrivals(rows,lastLine),fileRows:rows.filter(x=>x.line>lastLine).map(brief)});lastLine=rows.length;
 const from2=p.seq;
 const t=await turn(p,AFTER,120000);await idle(p,60000,3000);
 rows=rowsOf(transcript);
 const answered=p.frames.some(x=>x.seq>from2&&x.frame.type==='assistant'&&/AFTER/.test(JSON.stringify(x.frame.message?.content??'')));
 const byUuid=new Map(rows.filter(x=>x.row.uuid).map(x=>[x.row.uuid,x]));
 const after=[...rows].reverse().find(x=>x.row.type==='user'&&(textOf(x.row)??'').includes('word AFTER'));
 const chain=[];for(let x=after,i=0;x&&i<400;i++){chain.push(brief(x));x=byUuid.get(x.row.parentUuid??x.row.logicalParentUuid);}
 p.note({event:'uxw_case',case:'after prompt',fromSeq:from2,toSeq:p.seq,answered,result:t.result?{subtype:t.result.subtype,is_error:t.result.is_error,result:t.result.result}:null,wire:wireArrivals(p,from2),file:fileArrivals(rows,lastLine),chainFromAfter:chain.filter(c=>c.type!=='attachment')});
 console.log(label,'answered',answered,'chain',JSON.stringify(chain.filter(c=>c.type!=='attachment').map(c=>c.type+(c.subtype?'/'+c.subtype:'')+':'+(c.text??'').slice(0,30))).slice(0,800));
}

export default async()=>{
 const sent={};let sid=null;
 await mawsLaunch(TAG+(RESUMED?'-first':''),{model:'haiku',spendCap:'0.10',provenance:{probe:'U3b probe 7 (in-place rewind above a compaction)',target:TARGET,resumed:RESUMED}},async(p,{sessionId,transcript})=>{
  sid=sessionId;
  const steps=SHAPE==='above'?['ONE','TWO','/compact','THREE']:['ONE','/compact','TWO'];
  for(const step of steps){
   const text=step.startsWith('/')?step:`Without using any tool, reply with only the word ${step}.`;
   const x=prompt(p,text);sent[step.startsWith('/')?step.slice(1):step.toLowerCase()]=x.uuid;if(!step.startsWith('/'))sent.last=x.uuid;
   await waitFor(p,f=>f.type==='result',{after:x.seq,timeout:180000});await idle(p,60000,3000);
  }
  p.note({event:'uxw_sent',sent});
  if(!RESUMED)await rewindAndAfter(p,transcript,sent,TARGET);
  keepTranscript(transcript,TAG+(RESUMED?'-first':''));
  console.log(TAG,'first cost',cost(p));
 });
 if(!RESUMED)return;
 await mawsLaunch(TAG,{resume:sid,model:'haiku',spendCap:'0.10',provenance:{probe:'U3b probe 7 (in-place rewind above a compaction), resumed',target:TARGET,resumed:true,source:sid}},async(p,{transcript})=>{
  p.note({event:'uxw_sent',sent});
  await rewindAndAfter(p,transcript,sent,TARGET+'-resumed');
  keepTranscript(transcript,TAG);
  console.log(TAG,'cost',cost(p));
 });
};
