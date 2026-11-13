// UX wave U3, probe 4 (U3-transcript-rows.md, "Probes and checks" 4; serves O-18 with #330 and #331's failure rule, and
// UC-2's `command` class): on 2.1.322, which commands' output arrives as the assistant frame with
// `local_command_source`, whether any still arrives as a `user` frame, how an error's text arrives, what
// `local_command_outcome` holds, and what the engine sends when `/compact` fails. Launched as MAWS launches
// (uxwave-common-arrivals.mjs); each command is one step whose wire frames and transcript rows are noted side by side
// (`uxw_case`). UXW_TAG names the fixture; UXW_STEPS picks steps (comma-separated).
//
// Steps: compact-empty (/compact before any message), warm (one short exchange), compact-short (/compact after it),
// cost, context, reload-plugins, rename, effort, model-bad (/model with a model that does not exist), unknown (a
// command that does not exist), compact-interrupt (/compact with an interrupt sent once the engine says it is
// compacting), compact-ok (/compact that succeeds, the control).
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,prompt,turn,sys,delay,cost} from './uxwave-common-arrivals.mjs';

const ALL=['compact-empty','warm','compact-short','cost','context','reload-plugins','rename','effort','model-bad','unknown','warm','warm','compact-interrupt','compact-ok'];
const STEPS=(process.env.UXW_STEPS||ALL.join(',')).split(',').filter(Boolean);
const TAG=process.env.UXW_TAG||'u3-commands';
const BARE=process.env.UXW_BARE==='1';
const COMMAND={'compact-empty':'/compact','compact-short':'/compact','cost':'/cost','context':'/context','reload-plugins':'/reload-plugins','rename':'/rename uxw renamed','effort':'/effort low','model-bad':'/model uxw-no-such-model','unknown':'/uxw-no-such-command','compact-ok':'/compact'};
let warmCount=0;

export default async()=>{
 await mawsLaunch(TAG,{bare:BARE,model:process.env.UXW_MODEL||'haiku',spendCap:'1.50',provenance:{probe:'U3 probe 4',steps:STEPS}},async(p,{transcript})=>{
  let lastLine=0;
  const record=(name,from,extra={})=>{const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);lastLine=rows.length;p.note({event:'uxw_case',case:name,fromSeq:from,toSeq:p.seq,...extra,wire:wireArrivals(p,from),file});console.log(name,JSON.stringify({wire:wireArrivals(p,from).filter(w=>w.type!=='command_lifecycle').length,file:file.length}));};
  for(const name of STEPS){
   p.note({event:'uxw_case_start',case:name});
   const from=p.seq;
   if(name==='warm'){warmCount++;await turn(p,`Without using any tool, write two sentences about the colour number ${warmCount}, then end with the word READY.`);await idle(p,60000,3000);record(name,from);continue;}
   if(name==='compact-interrupt'){
    const s=prompt(p,'/compact');
    const c=await waitFor(p,f=>sys(f,'status')&&f.status==='compacting',{after:s.seq,timeout:30000});
    const r=c?await p.request('interrupt',{},15000).catch(e=>({error:e.message})):{error:'no compacting status'};
    p.note({event:'uxw_interrupt',compactingSeen:!!c,response:r});
    await waitFor(p,f=>f.type==='result',{after:s.seq,timeout:60000});await idle(p,60000,3000);record(name,from,{compactingSeen:!!c});continue;
   }
   const s=prompt(p,COMMAND[name]);
   await waitFor(p,f=>f.type==='result',{after:s.seq,timeout:name.startsWith('compact')?180000:60000});
   await idle(p,60000,3000);record(name,from,{command:COMMAND[name]});
  }
  keepTranscript(transcript,TAG);
  console.log(TAG,'cost',cost(p));
 });
};
