// UX wave U2b, check 1, the live part's mechanical questions, against a local stand-in for the Messages API
// (uxwave-u2b-mock-api.mjs) so that each case can be provoked many times, observed exactly, and costs no model call:
// E1's negatives and its positive control, E3, E4 (the file replaced in one step; two processes on one session id).
// The engine, the launch and the mod are exactly those of the other u2b scenarios; only the endpoint differs, and the
// stand-in logs every request it receives (a summary request is known by the mod's system prompt, LABEL_SYSTEM).
//
// Parts (U2B_MOCK, comma-separated; default all):
//   e1      three launches of 3 closed stretches each (script `cycles n=3`): at 8 with "after", at 9 with "after" and
//           TO_HUMAN_FOLD_SUMMARIES=off in the settings env, at 9 with "after" (the positive control). Fixtures
//           u2b-mod-mock-8-after, u2b-mod-mock-9-after-off, u2b-mod-mock-9-after.
//   e3      turn 1 a marked text (`mark`), turn 2 a stretch of three Bash calls (`grow n=3`, each `sleep 2`), the head of
//           the stretch asked after each call arrives and after the turn: with no advertisement and "before", with no
//           advertisement and "after", and at 9 with "after". Fixtures u2b-mod-mock-grow-<none-before|none-after|9-after>.
//   stress  one launch at 9 with "after", script `cycles n=55` (55 stretches, each closed by a marked text, so 55
//           summaries and 55 writes of the folds file), while uxwave-u2b-folds-reader.mjs reads the file in a loop.
//           Fixture u2b-mod-folds-stress.jsonl, the reader's account u2b-mod-folds-stress.reader.json.
//   two     two processes on one session id: A a new session (`cycles n=25 delay=400`), B the same session resumed 6 s
//           later (`cycles n=25 delay=400`), both at 9 with "after", the reader reading throughout. Fixtures
//           u2b-mod-folds-two-a, u2b-mod-folds-two-b, u2b-mod-folds-two.reader.json.
//   control the reader against a writer of the probe's own (no engine), 60 writes of a 200 kB file in place
//           (writeFileSync) and then 60 by a temporary and a rename: the reader's sensitivity to a partial file.
//           u2b-mod-folds-control.json.
import {scratch,mawsLaunch,render,removeRun,prompt,waitResult,resultFrames,stretches,headAsk,runAsk,labelOf,readFolds,foldsFileOf,rowKey,transcriptOf,FIXTURES,delay} from './uxwave-u2b-mod-common.mjs';
import {startMock} from './uxwave-u2b-mock-api.mjs';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const PARTS=(process.env.U2B_MOCK||'e1,e3,stress,two,control').split(',');
// U2B_SUFFIX names a re-recording (`-fix`: the second round, on the branch's joinGroup head).
const SUFFIX=process.env.U2B_SUFFIX||'';
const READER=join(dirname(fileURLToPath(import.meta.url)),'uxwave-u2b-folds-reader.mjs');
const summaryLog=mock=>mock.log.filter(x=>x.kind==='summary').map(({digest,...x})=>({...x,digestHead:digest.slice(0,160)}));

async function cycles(name,which,advert,n,{settingsEnv={},sid=randomUUID(),resume=null,run,mock,delayMs=0,note={}}={}){
 return mawsLaunch(name,run,{advert,sessionId:resume?null:sid,resume,model:'haiku',endpoint:mock.url,settingsEnv,provenance:{part:'stand-in',script:`cycles n=${n}${delayMs?` delay=${delayMs}`:''}`,...note}},async p=>{
  const s=prompt(p,`U2B-SCRIPT cycles n=${n}${delayMs?` delay=${delayMs}`:''} (an invented exercise)`);
  const r=await waitResult(p,s.seq,600000);
  await delay(6000);
  const st=stretches(p,s.seq);
  p.note({event:'u2b_mock',result:{subtype:r.subtype,num_turns:r.num_turns,session_id:r.session_id},stretches:st.length,summaryRequests:mock.count('summary'),summaries:summaryLog(mock).slice(-60),requestsByKind:Object.fromEntries(['main','summary','aside','models','count_tokens','other'].map(k=>[k,mock.count(k)])),foldsFile:readFolds(run,resume??sid)?.json??null,sessionIdsOnTheWire:[...new Set(p.frames.map(r=>r.frame.session_id).filter(Boolean))]});
 });
}

async function e1(){
 for(const [name,advert,env] of [['u2b-mod-mock-8-after','8',{}],['u2b-mod-mock-9-after-off','9',{TO_HUMAN_FOLD_SUMMARIES:'off'}],['u2b-mod-mock-9-after','9',{}]]){
  const run=scratch(name.replace('u2b-mod-',''),'after');const mock=await startMock();const sid=randomUUID();
  try{await cycles(name,'after',advert,3,{settingsEnv:env,sid,run,mock,note:{questions:['E1']}});}finally{await mock.close();removeRun(run);}
 }
}

async function e3(){
 for(const [tag,which,advert,mode] of [['none-before','before',null,'maws'],['none-after','after',null,'maws'],['9-after','after','9','maws'],['9-after-head','after','9','head'],['9-after-group','after','9','group']]){
  const name='u2b-mod-mock-grow-'+tag+SUFFIX;const run=scratch('grow-'+tag,which);const mock=await startMock();
  // How the stretch is asked: as MAWS does (one call ToolUse, two or more the group), always by its first call's ToolUse, or always as a group (of one, at first).
  const askOf=st=>mode==='head'?headAsk(st):mode==='group'?{...runAsk({...st,calls:[st.calls[0],st.calls[0]]}),props:{...runAsk({...st,calls:[st.calls[0],st.calls[0]]}).props,calls:runAsk({...st,calls:[...st.calls,st.calls[0]]}).props.calls.slice(0,st.calls.length)}}:runAsk(st);
  try{
   await mawsLaunch(name,run,{advert,sessionId:randomUUID(),model:'haiku',endpoint:mock.url,provenance:{part:'stand-in',questions:['E3','E1 (no advertisement)','E2'],script:'mark, then grow n=3',askedAs:mode}},async p=>{
    let s=prompt(p,'U2B-SCRIPT mark (an invented exercise)');await waitResult(p,s.seq);await delay(2000);
    // The marked reply's row, as MAWS asks it: the view folds once it has drawn a mark.
    for(const r of p.frames.filter(r=>r.seq>s.seq&&r.frame.type==='assistant'))for(const b of r.frame.message?.content??[])if(b.type==='text')await render(p,{component:'AssistantMessage',instance_id:r.frame.uuid,props:{text:b.text,isFirstOfReply:true}},'the marked reply of turn 1');
    await delay(1000);
    s=prompt(p,'U2B-SCRIPT grow n=3 (an invented exercise)');let done=false;const turn=waitResult(p,s.seq).then(()=>done=true);
    const timeline=[];let last=null;
    while(!done){const st=stretches(p,s.seq);if(st.length){const a=await render(p,askOf(st[0]),'growing: the stretch ('+askOf(st[0]).component+')');const l=labelOf(a);if(l!==last){last=l;timeline.push({seq:p.seq,ask:askOf(st[0]).component,calls:st[0].calls.length,results:st[0].calls.filter(c=>c.result!==undefined).length,label:l});}}await delay(500);}
    await turn;
    for(const wait of [1000,4000,8000]){await delay(wait);const st=stretches(p,s.seq);const a=await render(p,askOf(st[0]),`after the turn (+${wait} ms step)`);timeline.push({seq:p.seq,phase:'after the turn',label:labelOf(a)});}
    // The lone ToolUse asked once more after the stretch is a group (a client that still mounts it).
    {const st=stretches(p,s.seq);if(mode==='maws'&&st[0]?.calls.length>1){const a=await render(p,headAsk(st[0]),'the lone ToolUse of the first call, asked after the switch');timeline.push({seq:p.seq,phase:'lone ToolUse after the switch',label:labelOf(a)});}}
    p.note({event:'u2b_grow',mode,timeline,pushes:p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='ui_invalidate').map(r=>({seq:r.seq,instances:r.frame.instances??null})),summaryRequests:mock.count('summary'),summaries:summaryLog(mock)});
   });
  }finally{await mock.close();removeRun(run);}
 }
}

function startReader(file,out){rmSync(out+'.stop',{force:true});rmSync(out,{force:true});mkdirSync(dirname(file),{recursive:true});const child=spawn(process.execPath,[READER,file,out],{stdio:'ignore'});return {stop:async()=>{writeFileSync(out+'.stop','');await new Promise(r=>child.on('exit',r));rmSync(out+'.stop',{force:true});return JSON.parse(readFileSync(out,'utf8'));}};}

async function stress(){
 const run=scratch('stress','after');const mock=await startMock();const sid=randomUUID();
 const out=join(FIXTURES,'u2b-mod-folds-stress.reader.json');mkdirSync(FIXTURES,{recursive:true});
 const reader=startReader(foldsFileOf(run,sid),out);
 try{await cycles('u2b-mod-folds-stress','after','9',55,{sid,run,mock,note:{questions:['E4'],reader:'uxwave-u2b-folds-reader.mjs, a separate process reading the folds file in a loop'}});}
 finally{const seen=await reader.stop();seen.summaryRequests=mock.count('summary');seen.finalRuns=readFolds(run,sid)?.json?.runs?.length??null;writeFileSync(out,JSON.stringify(seen,null,1));await mock.close();removeRun(run);}
}

async function two(){
 const run=scratch('two','after');const mock=await startMock();const sid=randomUUID();
 const out=join(FIXTURES,'u2b-mod-folds-two.reader.json');mkdirSync(FIXTURES,{recursive:true});
 const reader=startReader(foldsFileOf(run,sid),out);
 let a,b;
 try{
  [a,b]=await Promise.all([
   cycles('u2b-mod-folds-two-a','after','9',25,{sid,run,mock,delayMs:400,note:{questions:['E4 (two processes)'],process:'A, a new session'}}),
   delay(6000).then(()=>cycles('u2b-mod-folds-two-b','after','9',25,{resume:sid,run,mock,delayMs:400,note:{questions:['E4 (two processes)','E4 (the session id after a resume)'],process:'B, the same session resumed while A runs'}})),
  ]);
 }finally{
  const seen=await reader.stop();
  const ids=p=>new Set(stretches(p,0).map(s=>s.head));
  const runs=readFolds(run,sid)?.json?.runs??[];
  const [ia,ib]=[a?ids(a):new Set(),b?ids(b):new Set()];
  seen.summaryRequests=mock.count('summary');
  seen.final={shape:readFolds(run,sid)?.json?.shape??null,runs:runs.length,ofA:runs.filter(r=>ia.has(r[0])).length,ofB:runs.filter(r=>ib.has(r[0])).length,ofNeither:runs.filter(r=>!ia.has(r[0])&&!ib.has(r[0])).length,headsA:ia.size,headsB:ib.size,missingA:[...ia].filter(h=>!runs.some(r=>r[0]===h)),missingB:[...ib].filter(h=>!runs.some(r=>r[0]===h))};
  // How the runs of each process lie in the versions the reader saw: whether a version ever lost a run an earlier one had.
  let lost=0;let prev=new Set();for(const v of seen.versions){if(!v.firsts)continue;const cur=new Set(v.firsts);for(const f of prev)if(!cur.has(f)){lost++;}prev=cur;}
  seen.runsLostBetweenSuccessiveVersions=lost;
  writeFileSync(out,JSON.stringify(seen,null,1));
  await mock.close();removeRun(run);
 }
}

async function control(){
 const dir='/tmp/u2bmod-control';rmSync(dir,{recursive:true,force:true});mkdirSync(dir);
 const file=join(dir,'folds.json');const body=n=>JSON.stringify({shape:2,runs:Array.from({length:2000},(_,i)=>[`toolu_${n}_${i}`,`toolu_${n}_${i}`,'An invented summary line of some length for the control write.'])})+'\n';
 const result={};
 for(const mode of ['in place','temporary and rename']){
  writeFileSync(file,body(0));
  const out=join(dir,'reader.json');const reader=startReader(file,out);await delay(300);
  for(let n=1;n<=60;n++){if(mode==='in place')writeFileSync(file,body(n));else{writeFileSync(file+'.tmp',body(n));renameSync(file+'.tmp',file);}await delay(30);}
  await delay(300);const seen=await reader.stop();
  result[mode]={writes:60,bytesPerWrite:body(1).length,reads:seen.reads,readsThatDidNotParse:seen.notParsed,distinctVersions:seen.distinctVersions,distinctInodes:seen.distinctInodes,badSamples:seen.badSamples.slice(0,5).map(b=>({size:b.size}))};
 }
 mkdirSync(FIXTURES,{recursive:true});writeFileSync(join(FIXTURES,'u2b-mod-folds-control.json'),JSON.stringify({what:'the E4 reader against a writer of the probe\'s own, no engine',result},null,1)+'\n');
 rmSync(dir,{recursive:true,force:true});
}

export default async()=>{
 if(PARTS.includes('control'))await control();
 if(PARTS.includes('e1'))await e1();
 if(PARTS.includes('e3'))await e3();
 if(PARTS.includes('stress'))await stress();
 if(PARTS.includes('two'))await two();
};
