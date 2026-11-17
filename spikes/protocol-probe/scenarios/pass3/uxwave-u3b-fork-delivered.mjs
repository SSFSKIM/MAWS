// UX wave U3b, probe 5 (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, "Probes", the premise
// named after item 4: "Fork from here" passes the id of the prompt that follows the answer): does the engine's rewind
// take the id of a prompt that was not typed but delivered? A fork is launched as MAWS launches one
// (src/engine-host/launch.ts: `--resume <source> --fork-session --session-id <new>`, through uxwave-common-arrivals.mjs)
// and rewound as src/services/sessions/setup.ts rewindFork does (`rewind_conversation` {target_message_uuid,
// last_seen_user_message_uuid: the source's newest user message, interrupt_if_running: false}, src/engine-host/rewind.ts),
// then sent one short prompt so the fork writes its file, whose chain shows where it was cut.
// UXW_PART=source: a source session launched as MAWS launches it: ONE typed; TWO typed with a foreground sleep, and
//   THREE sent while that tool runs (MAWS's send while busy: the engine reads it as a queued command); FOUR typed.
//   The candidates are noted as `uxw_candidates` (each prompt's sent uuid and the rows that carry it).
// UXW_PART=fork: UXW_SOURCE (session id), UXW_TARGET (the uuid to rewind to), UXW_LABEL; the source's transcript is
//   read from this HOME (pass the source run's HOME and PROBE_WORK with vm-run.sh -e).
import {mawsLaunch,rowsOf,keepTranscript,waitFor,idle,prompt,turn,delay,cost,transcriptOf,randomUUID} from './uxwave-common-arrivals.mjs';

const PART=process.env.UXW_PART||'source';
const TAG=process.env.UXW_TAG||'u3b-fork-'+PART;

const brief=({line,row:r})=>({line,type:r.type,uuid:r.uuid,parentUuid:r.parentUuid,origin:r.origin,promptSource:r.promptSource,isMeta:r.isMeta,attachment:r.attachment?{type:r.attachment.type,source_uuid:r.attachment.source_uuid,commandMode:r.attachment.commandMode,prompt:typeof r.attachment.prompt==='string'?r.attachment.prompt.slice(0,120):r.attachment.prompt}:undefined,text:typeof r.message?.content==='string'?r.message.content.slice(0,120):Array.isArray(r.message?.content)?r.message.content.filter(b=>b.type==='text').map(b=>b.text).join(' ').slice(0,120):undefined,operation:r.operation,content:typeof r.content==='string'?r.content.slice(0,120):undefined});

async function source(){
 await mawsLaunch(TAG,{model:'haiku',spendCap:'0.30',provenance:{probe:'U3b probe 5 (fork to a delivered prompt): the source'}},async(p,{sessionId,transcript})=>{
  const sent={};
  let s=await turn(p,'Without using any tool, reply with only the word ONE.');sent.one=s.uuid;await idle(p,60000,3000);
  const two=prompt(p,'R'+'un exactly `sleep 12` with the Bash tool in the foreground (description "uxw sleep"), then reply with only the word TWO, and answer any message that reached you meanwhile with its word.');sent.two=two.uuid;
  await waitFor(p,f=>f.type==='assistant'&&JSON.stringify(f.message?.content??'').includes('uxw sleep'),{after:two.seq,timeout:60000});await delay(3000);
  const three=prompt(p,'Also reply with the word THREE.');sent.three=three.uuid;
  await waitFor(p,f=>f.type==='result',{after:two.seq,timeout:120000});await idle(p,90000,4000);
  s=await turn(p,'Without using any tool, reply with only the word FOUR.');sent.four=s.uuid;await idle(p,60000,3000);
  const rows=rowsOf(transcript);
  const carries=Object.fromEntries(Object.entries(sent).map(([k,u])=>[k,{sent:u,rows:rows.filter(x=>JSON.stringify(x.row).includes(u)).map(brief)}]));
  const prompts=rows.filter(x=>x.row.type==='user'&&!(Array.isArray(x.row.message?.content)&&x.row.message.content.some(b=>b.type==='tool_result'))||x.row.attachment?.type==='queued_command').map(brief);
  p.note({event:'uxw_candidates',sessionId,sent:carries,prompts});
  console.log('source',sessionId,JSON.stringify(sent));
  keepTranscript(transcript,TAG);
 });
}

async function fork(){
 const src=process.env.UXW_SOURCE,target=process.env.UXW_TARGET,label=process.env.UXW_LABEL||'case';
 if(!src||!target)throw new Error('UXW_SOURCE and UXW_TARGET');
 const cwd=process.env.PROBE_WORK;
 const srcRows=rowsOf(transcriptOf(cwd,src));
 const users=srcRows.filter(x=>x.row.type==='user'&&!x.row.isMeta&&!(Array.isArray(x.row.message?.content)&&x.row.message.content.some(b=>b.type==='tool_result')));
 const lastSeen=users.at(-1)?.row.uuid??target;
 const targetRows=srcRows.filter(x=>JSON.stringify(x.row).includes(target)).map(brief);
 const forkId=randomUUID();
 await mawsLaunch(TAG,{resume:src,flags:['--fork-session','--session-id',forkId],model:'haiku',spendCap:'0.20',provenance:{probe:'U3b probe 5 (fork to a delivered prompt)',label,source:src,target,lastSeen,forkId}},async(p)=>{
  p.note({event:'uxw_target',label,target,lastSeen,targetRows});
  const r=await p.request('rewind_conversation',{target_message_uuid:target,last_seen_user_message_uuid:lastSeen,interrupt_if_running:false},60000).catch(e=>({error:e.message}));
  p.note({event:'uxw_rewind',label,response:r});console.log(label,'rewind',JSON.stringify(r.response??r).slice(0,400));
  const accepted=r.response?.rewound===true;
  if(accepted){await turn(p,'Without using any tool, reply with only the word FORKED.');await idle(p,60000,3000);}
  const file=transcriptOf(cwd,forkId);const rows=rowsOf(file);
  const chain=[];const byUuid=new Map(rows.filter(x=>x.row.uuid).map(x=>[x.row.uuid,x]));
  const forked=rows.find(x=>x.row.type==='user'&&typeof x.row.message?.content==='string'&&x.row.message.content.includes('FORKED'));
  for(let x=forked,i=0;x&&i<400;i++){chain.push(brief(x));x=byUuid.get(x.row.parentUuid);}
  p.note({event:'uxw_fork_chain',label,accepted,forkFileRows:rows.length,chainFromForked:chain.filter(c=>c.type==='user'||c.type==='assistant'||c.attachment?.type==='queued_command').map(c=>({line:c.line,type:c.type,uuid:c.uuid,text:c.text,attachment:c.attachment}))});
  if(rows.length)keepTranscript(file,TAG);
  console.log(label,'accepted',accepted,'chain',JSON.stringify(chain.filter(c=>c.type==='user'||c.type==='assistant').map(c=>c.text)).slice(0,500),'cost',cost(p));
 });
}

export default async()=>{if(PART==='source')await source();else await fork();};
