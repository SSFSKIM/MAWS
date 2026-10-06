// E7 M0 step 5 (docs/doperpowers/plans/2026-10-06-e7-orchestration.md, Interfaces "Probe scenarios and fixtures",
// Design §7; SPEC 22 §22.5, §22.7, §22.9, §22.10): CronCreate under MAWS's print-mode launch. One prompt schedules a
// session-only recurring job (`*/2 * * * *`) and a one-shot two minutes past the next minute, then lists them; the
// scenario waits (bounded) for the fires and records the frame that carries a job's prompt (type, origin, text) and the
// JSONL record behind it; CronDelete cancels the recurring job; a durable job is created and the project's
// .claude/scheduled_tasks.json copied to e7-cron-durable/; one more session-only job (`0 3 * * *`) is left for the resume.
// A second launch (`--resume <id>`, e7-cron-resume) asks CronList whether the engine resurrected it from the transcript.
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,records,transcriptPath,join,existsSync} from './p1-common.mjs';
import {E7,E7_DEBUG,allowAll,blocks,textOf,pairsAfter,resultsAfter,framesBetween,idle,cost,copyRedacted,snapshotDir} from './e7-common.mjs';
import {root} from '../../harness.mjs';
import {rmSync,readFileSync} from 'node:fs';

const TICK='E7 cron tick',ONE='E7 one-shot',DURABLE='E7 durable weekly',NIGHTLY='E7 nightly';
const CRON_TOOLS=['CronCreate','CronList','CronDelete','ToolSearch'];
const cronPairs=(p,from)=>CRON_TOOLS.flatMap(n=>pairsAfter(p,from,n)).sort((a,b)=>a.use.seq-b.use.seq);
// A fire, as the wire shows it (2.1.291, the first take of this scenario): no user frame carries the job's prompt; the
// turn opens with `command_lifecycle started` for a command uuid the host never sent, and the JSONL's `user` record
// under that uuid holds the prompt (turnOrigin 'scheduled'). So a fire is a started lifecycle the probe did not cause,
// attributed to its job from the transcript after the session ends.
// (the probe keeps only inbound frames in memory; what it sent is read back from its journal)
const sentUuids=p=>new Set(readFileSync(p.file,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.direction==='out'&&r.frame.type==='user').map(r=>r.frame.uuid));
const isFireStart=(p,f)=>f.type==='command_lifecycle'&&f.state==='started'&&!sentUuids(p).has(f.command_uuid);
const fireStarts=(p,from)=>p.frames.filter(r=>r.seq>from&&isFireStart(p,r.frame)).map(r=>{const end=p.frames.find(x=>x.seq>r.seq&&x.frame.type==='result');const userFrame=p.frames.find(x=>x.seq>r.seq&&(!end||x.seq<end.seq)&&x.frame.type==='user'&&!blocks(x.frame).some(b=>b.type==='tool_result'));return {seq:r.seq,at:r.at,commandUuid:r.frame.command_uuid,userFrameInTurn:userFrame?{seq:userFrame.seq,text:textOf(userFrame.frame.message?.content)}:null,result:end?{seq:end.seq,user_message_uuids:end.frame.user_message_uuids??null,result:end.frame.result??null}:null};});

export default async()=>{
 const run=scratchRun('e7-cron');
 const durableOut=join(root,'fixtures/pass3/e7-cron-durable');rmSync(durableOut,{recursive:true,force:true});
 let sessionId=null,tickId=null,oneId=null;
 try{
  await launch('e7-cron',run,{spendCap:'0.80',debugPattern:E7_DEBUG,provenance:{...E7,question:'Design §7: CronCreate/CronList/CronDelete results, the fire frame under -p, the durable file, resurrection on resume'}},async(p,ctx)=>{
   sessionId=ctx.sessionId;
   allowAll(p);
   success(await p.init(initPayload(run.cwd)),'initialize');
   // the one-shot: local time, the next minute plus two (never on :00 or :30, so no early fire, §22.7)
   const at=new Date(Date.now()+3*60000);at.setSeconds(0,0);if(at.getMinutes()%30===0)at.setMinutes(at.getMinutes()+1);
   const oneShotCron=`${at.getMinutes()} ${at.getHours()} ${at.getDate()} ${at.getMonth()+1} *`;
   const SETUP=`Use CronCreate (find it with ToolSearch) to schedule a recurring job "*/2 * * * *" with prompt "${TICK}", then a one-shot at "${oneShotCron}" with prompt "${ONE}", then call CronList and reply with its output.`;
   let from=p.seq;const r0=await p.turn(SETUP);
   const setup=cronPairs(p,from);
   p.note({event:'e7_cron_setup',prompt:SETUP,oneShotAt:at.toISOString(),oneShotCron,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,result:resultsAfter(p,from),pairs:setup});
   check(p,'the setup turn answered',r0.subtype==='success',r0.subtype);
   const created=setup.filter(x=>x.use.name==='CronCreate'&&x.result&&!x.result.isError);
   const idOf=prompt=>created.find(x=>x.use.input?.prompt===prompt)?.result?.structured?.id??null;
   tickId=idOf(TICK);oneId=idOf(ONE);
   check(p,'both jobs were created',!!tickId&&!!oneId,{tickId,oneId});
   await idle(p,120000,3000);

   // The fires: bounded waits (the recurring one within 2 min plus up to half its period; the one-shot at its minute).
   const fireFrom=p.seq;const t0=Date.now();
   const first=await p.wait(f=>isFireStart(p,f),{after:fireFrom,timeout:5*60000}).catch(()=>null);
   const firstWaitMs=Date.now()-t0;
   await idle(p,120000,3000);
   // past the one-shot's minute (plus a margin), the probe's own bounded wait; any fire in it is recorded
   const pastOneShot=at.getTime()+75000-Date.now();
   if(pastOneShot>0)await p.wait(()=>false,{after:p.seq,timeout:pastOneShot}).catch(()=>null);
   await idle(p,120000,3000);
   p.note({event:'e7_cron_fires',firstFireSeen:!!first,firstWaitMs,fires:fireStarts(p,fireFrom),frames:framesBetween(p,fireFrom),results:resultsAfter(p,fireFrom)});

   // CronDelete the recurring job; a durable job; one more session-only job left for the resume.
   from=p.seq;await p.turn(`Use CronDelete to cancel the job with id ${tickId}. Then call CronList and reply with its output.`);
   p.note({event:'e7_cron_delete',id:tickId,result:resultsAfter(p,from),pairs:cronPairs(p,from)});
   from=p.seq;await p.turn(`Use CronCreate to schedule a recurring job "0 9 * * 1" with prompt "${DURABLE}" and durable set to true. Then use CronCreate again to schedule a recurring job "0 3 * * *" with prompt "${NIGHTLY}" (not durable). Then call CronList and reply with its output.`);
   const file=join(run.cwd,'.claude/scheduled_tasks.json');
   p.note({event:'e7_cron_durable',result:resultsAfter(p,from),pairs:cronPairs(p,from),file,exists:existsSync(file),projectClaudeDir:snapshotDir(join(run.cwd,'.claude'))});
   if(existsSync(file))copyRedacted(file,join(durableOut,'scheduled_tasks.json'));
   await idle(p,60000,3000);
   p.note({event:'e7_spend',total_cost_usd:cost(p)});
   await endAsStop(p);
   // the disk form of every record that carries a job's prompt or a cron tool pair
   const recs=records(transcriptPath(run,sessionId));
   const match=recs.filter(r=>{const s=JSON.stringify(r);return s.includes(TICK)||s.includes(ONE)||/Cron(Create|Delete|List)/.test(s)||/scheduled|cron/i.test(r.attachment?.type??'')||r.origin!==undefined;});
   // each fire's record (the user record under the fire's command uuid), and its job by prompt
   const fires=fireStarts(p,0).map(f=>{const rec=recs.find(r=>r.uuid===f.commandUuid)??null;const text=rec?textOf(rec.message?.content):null;return {...f,job:text===TICK?tickId:text===ONE?oneId:null,record:rec};});
   p.note({event:'e7_cron_jsonl',count:recs.length,fires,records:match});
  });

  // The resume: does the engine resurrect the session-only job from the transcript (§22.5)?
  await launch('e7-cron-resume',run,{sessionId:null,flags:['--resume',sessionId],spendCap:'0.80',debugPattern:E7_DEBUG,debugFile:join(run.root,'debug-resume.log'),provenance:{...E7,question:'Design §7: resurrection of session-only jobs on --resume (SPEC 22 §22.5)',resumed:sessionId}},async p=>{
   allowAll(p);
   success(await p.init(initPayload(run.cwd)),'initialize');
   const from=p.seq;await p.turn('Call CronList (find it with ToolSearch) and reply with its output verbatim.');
   p.note({event:'e7_cron_resume',result:resultsAfter(p,from),pairs:cronPairs(p,from),frames:framesBetween(p,from)});
   // the engine rewrites the durable file when it resumes (the first take's debug log); what it wrote
   const file=join(run.cwd,'.claude/scheduled_tasks.json');
   p.note({event:'e7_cron_durable_after_resume',projectClaudeDir:snapshotDir(join(run.cwd,'.claude'))});
   if(existsSync(file))copyRedacted(file,join(durableOut,'scheduled_tasks.after-resume.json'));
   p.note({event:'e7_spend',total_cost_usd:cost(p)});
   await endAsStop(p);
  });
 }finally{removeRun(run);}
};
