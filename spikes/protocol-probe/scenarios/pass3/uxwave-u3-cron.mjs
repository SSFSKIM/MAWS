// UX wave U3, probe 2 (U3-transcript-rows.md, "Probes and checks" 2; serves UC-2's `schedule` class): what the 2.1.322
// wire and the transcript file carry when a scheduled prompt fires in a session MAWS runs. Launched as MAWS launches
// (uxwave-common-arrivals.mjs). One prompt schedules a session-only recurring job every minute; the scenario records each fire
// while the model is idle (UXW_FIRES of them, 3 by default), then one fire that falls due while a foreground command of
// a running turn is under way, then deletes the job. A fire is a turn the probe did not start: noted with the frames
// around it and the transcript rows it wrote (`uxw_case`). The terminal half is uxwave-u3-terminal.mjs (UXW_TERM=cron).
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,turn,sys,delay,cost} from './uxwave-common-arrivals.mjs';
import {readFileSync} from 'node:fs';

const TAG=process.env.UXW_TAG||'u3-cron';
const FIRES=Number(process.env.UXW_FIRES||3);
const TICK='UXW tick: reply with only the word TOCK.';
const BARE=process.env.UXW_BARE==='1';

export default async()=>{
 await mawsLaunch(TAG,{bare:BARE,model:process.env.UXW_MODEL||'haiku',spendCap:'1.50',provenance:{probe:'U3 probe 2',fires:FIRES,tick:TICK}},async(p,{transcript})=>{
  let lastLine=0;
  const record=(name,from,extra={})=>{const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);lastLine=rows.length;p.note({event:'uxw_case',case:name,fromSeq:from,toSeq:p.seq,...extra,wire:wireArrivals(p,from),file});console.log(name,JSON.stringify({wire:wireArrivals(p,from).filter(w=>w.type==='user').map(w=>w.seq),file:file.length}));};
  const sent=()=>new Set(readFileSync(p.file,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.direction==='out'&&r.frame.type==='user').map(r=>r.frame.uuid));
  // a turn the probe did not start: an init whose user_message_uuids name none of the probe's prompts (or none at all)
  const isFire=f=>sys(f,'init')&&!(f.user_message_uuids??[]).some(u=>sent().has(u));
  let from=p.seq;
  const setup=await turn(p,`Use CronCreate (find it with ToolSearch if it is not loaded) to schedule a recurring, session-only job with cron "* * * * *" and prompt "${TICK}". Then reply with only the job's id.`);
  await idle(p,60000,3000);record('setup',from,{answer:setup.result?.result??null});
  for(let i=1;i<=FIRES;i++){
   from=p.seq;const f=await waitFor(p,isFire,{after:from,timeout:150000});
   await waitFor(p,x=>x.type==='result',{after:from,timeout:90000});await idle(p,60000,3000);
   record('idle-fire-'+i,from,{fireSeen:!!f,fireInitSeq:f?p.frames.find(r=>r.frame===f)?.seq:null});
  }
  // a fire that falls due during a foreground command
  from=p.seq;await turn(p,'R'+'un exactly `python3 -c "import time; time.sleep(75); print(\'UXW-FG-DONE\')"` with the Bash tool in the foreground (run_in_background false), description "uxw foreground". Then reply with only the word DONE.',200000);
  await delay(5000);await idle(p,120000,4000);record('busy-fire',from);
  from=p.seq;await turn(p,'Use CronDelete to delete every job you created (CronList first if you need the ids). Then reply with only the word DELETED.');
  await idle(p,60000,3000);record('delete',from);
  keepTranscript(transcript,TAG);
  console.log(TAG,'cost',cost(p));
 });
};
