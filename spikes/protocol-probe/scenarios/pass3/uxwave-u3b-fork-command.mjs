// UX wave U3b, probe 6 (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, "Fork from here": the
// id of what follows an answer): when a typed slash command that runs locally stands between an answer and the next
// prompt, which rows and frames does it leave, and does the engine's rewind take each of their ids? Launched and rewound
// as uxwave-u3b-fork-delivered.mjs is (MAWS's fork launch `--resume <source> --fork-session --session-id <new>`, then
// `rewind_conversation` {target_message_uuid, last_seen_user_message_uuid, interrupt_if_running: false}, then one
// short prompt so the fork writes its file, whose chain is noted whole).
// UXW_PART=source, UXW_KIND=commands: ONE typed; `/rename uxw renamed`; `/cost`; TWO typed.
//                  UXW_KIND=compact: ONE typed; `/compact`; TWO typed.
//   Each step's wire frames and file rows are noted (`uxw_case`), and every id a step left in `uxw_candidates`.
// UXW_PART=fork: UXW_SOURCE, UXW_TARGET, UXW_LABEL, in the source run's HOME (vm-run.sh -e HOME, PROBE_WORK, PROBE_ROOT).
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,prompt,turn,cost,transcriptOf,randomUUID} from './uxwave-common-arrivals.mjs';

const PART=process.env.UXW_PART||'source';
const KIND=process.env.UXW_KIND||'commands';
const TAG=process.env.UXW_TAG||'u3b-forkcmd-'+PART+'-'+KIND;
const isToolResult=r=>Array.isArray(r.message?.content)&&r.message.content.some(b=>b.type==='tool_result');
const textOf=r=>typeof r.message?.content==='string'?r.message.content:Array.isArray(r.message?.content)?r.message.content.filter(b=>b.type==='text').map(b=>b.text).join(' '):typeof r.content==='string'?r.content:undefined;
const brief=({line,row:r})=>Object.fromEntries(Object.entries({line,type:r.type,subtype:r.subtype,uuid:r.uuid,parentUuid:r.parentUuid,logicalParentUuid:r.logicalParentUuid,isMeta:r.isMeta,isCompactSummary:r.isCompactSummary,origin:r.origin,commandRun:r.commandRun,attachment:r.attachment?.type,text:textOf(r)?.slice(0,140)}).filter(([,v])=>v!==undefined));

async function source(){
 const steps=KIND==='compact'?['ONE','/compact','TWO']:['ONE','/rename uxw renamed','/cost','TWO'];
 await mawsLaunch(TAG,{model:'haiku',spendCap:'0.20',provenance:{probe:'U3b probe 6 (fork around a local command): the source',kind:KIND,steps}},async(p,{sessionId,transcript})=>{
  let lastLine=0;const candidates=[];
  for(const step of steps){
   const from=p.seq;
   const text=step.startsWith('/')?step:`Without using any tool, reply with only the word ${step}.`;
   const s=prompt(p,text);
   await waitFor(p,f=>f.type==='result',{after:s.seq,timeout:step==='/compact'?180000:90000});await idle(p,60000,3000);
   const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);
   const newRows=rows.filter(x=>x.line>lastLine&&x.row.uuid).map(brief);lastLine=rows.length;
   const wire=wireArrivals(p,from);
   p.note({event:'uxw_case',case:step,sentUuid:s.uuid,fromSeq:from,toSeq:p.seq,wire,file});
   candidates.push({step,sentUuid:s.uuid,wire:wire.filter(w=>w.uuid&&(w.type==='user'||w.type==='assistant'||w.subtype==='compact_boundary')).map(w=>({seq:w.seq,type:w.type,subtype:w.subtype,uuid:w.uuid,isReplay:w.isReplay,isSynthetic:w.isSynthetic,local_command_run:w.local_command_run,text:w.text?.slice(0,100)})),rows:newRows.filter(r=>r.type==='user'||r.type==='assistant'||r.type==='system')});
   console.log(step,'sent',s.uuid);
  }
  p.note({event:'uxw_candidates',sessionId,kind:KIND,candidates});
  keepTranscript(transcript,TAG);
  console.log(TAG,sessionId,'cost',cost(p));
 });
}

async function fork(){
 const src=process.env.UXW_SOURCE,target=process.env.UXW_TARGET,label=process.env.UXW_LABEL||'case';
 if(!src||!target)throw new Error('UXW_SOURCE and UXW_TARGET');
 const cwd=process.env.PROBE_WORK;
 const srcRows=rowsOf(transcriptOf(cwd,src));
 const lastSeen=srcRows.filter(x=>x.row.type==='user'&&!x.row.isMeta&&!x.row.isCompactSummary&&!isToolResult(x.row)&&/reply with only the word/.test(textOf(x.row)??'')).at(-1)?.row.uuid??target;
 const forkId=randomUUID();
 await mawsLaunch(TAG,{resume:src,flags:['--fork-session','--session-id',forkId],model:'haiku',spendCap:'0.10',provenance:{probe:'U3b probe 6 (fork around a local command)',label,source:src,target,lastSeen,forkId}},async(p)=>{
  p.note({event:'uxw_target',label,target,lastSeen,targetRows:srcRows.filter(x=>x.row.uuid===target).map(brief)});
  const r=await p.request('rewind_conversation',{target_message_uuid:target,last_seen_user_message_uuid:lastSeen,interrupt_if_running:false},60000).catch(e=>({error:e.message}));
  p.note({event:'uxw_rewind',label,response:r});console.log(label,'rewind',JSON.stringify(r.response??r).slice(0,400));
  const accepted=r.response?.rewound===true;
  if(accepted){await turn(p,'Without using any tool, reply with only the word FORKED.');await idle(p,60000,3000);}
  const file=transcriptOf(cwd,forkId);const rows=rowsOf(file);
  const byUuid=new Map(rows.filter(x=>x.row.uuid).map(x=>[x.row.uuid,x]));
  const forked=rows.find(x=>x.row.type==='user'&&(textOf(x.row)??'').includes('FORKED'));
  const chain=[];for(let x=forked,i=0;x&&i<400;i++){chain.push(brief(x));x=byUuid.get(x.row.parentUuid??x.row.logicalParentUuid);}
  p.note({event:'uxw_fork_chain',label,accepted,forkFileRows:rows.length,chainFromForked:chain.filter(c=>c.type!=='attachment')});
  if(rows.length)keepTranscript(file,TAG);
  console.log(label,'accepted',accepted,'chain',JSON.stringify(chain.filter(c=>c.type!=='attachment').map(c=>c.type+(c.subtype?'/'+c.subtype:'')+':'+(c.text??'').slice(0,40))).slice(0,900),'cost',cost(p));
 });
}

export default async()=>{if(PART==='source')await source();else await fork();};
