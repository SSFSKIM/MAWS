// UX wave U2b, check 1, the live part: questions E1, E2, E3, E4 (the file's shape and ids), E5 and E6
// (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, check 1; §I items 9 to 12; §M).
//
// Fixture u2b-mod-summary.jsonl: a new session at 9 with "after", launched as MAWS launches one, on haiku through the
// VM's gateway. One turn of two stretches of two Bash calls each, each closed by a message-tool call (the second with
// final: true). While the turn runs and for up to 50 s after it, every second or two the head of each stretch (its first
// call's ToolUse, as MAWS asks a run's first row) is asked, and each change of its answer noted (E1, E3), beside every
// ui_invalidate the engine pushes (E2). Then the session's folds file is read (E4: shape, runs, their ids against the ids
// the wire and the transcript file give), and a second turn of one word is run so its `result` shows whether the summary
// calls are counted (E6). The folds file and the transcript's request records are noted; their text is the scenario's
// own invented prompts.
//
// Fixture u2b-mod-summary-resume.jsonl (E5): the same session resumed at 9 with "after" and no prompt, against the local
// stand-in for the Messages API (uxwave-u2b-mock-api.mjs), which counts every request: the stretches' heads are asked,
// and the stand-in's log says whether any summary (or any request at all) was made.
import {scratch,mawsLaunch,render,ASK,removeRun,prompt,waitResult,initFrames,resultFrames,stretches,headAsk,runAsk,messageAsks,labelOf,readFolds,rowKey,transcriptOf,foldsFileOf,delay} from './uxwave-u2b-mod-common.mjs';
import {startMock,startRelay} from './uxwave-u2b-mock-api.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';

const STRETCHES=['This is a test of your tools. Do exactly these steps in order, one tool call per response, and write no text at all.',
 'Step 1: run the Bash command `echo stretch-one-a` with the description "First stretch, first command".',
 'Step 2: run the Bash command `echo stretch-one-b` with the description "First stretch, second command".',
 'Step 3: call the tool mcp__to-human__message with its text exactly `First stretch done.` and final set to false.',
 'Step 4: run the Bash command `echo stretch-two-a` with the description "Second stretch, first command".',
 'Step 5: run the Bash command `echo stretch-two-b` with the description "Second stretch, second command".',
 'Step 6: call the tool mcp__to-human__message with its text exactly `Second stretch done.` and final set to true.'].join(' ');
const ONE_WORD='Reply with only the word OK. Use no tool.';

const SUFFIX=process.env.U2B_SUFFIX||'';
export default async()=>{
 const run=scratch('summary','after');const sid=randomUUID();const debug=join(run.root,'debug.log');
 const relay=await startRelay(process.env.ANTHROPIC_BASE_URL);
 let saved=[],savedMessages=[];
 try{
  await mawsLaunch('u2b-mod-summary'+SUFFIX,run,{advert:'9',sessionId:sid,model:'haiku',debugFile:debug,relay:relay.url,provenance:{part:'live',questions:['E1','E2','E3','E4','E6'],prompts:[STRETCHES,ONE_WORD]}},async p=>{
   const start=p.seq;const timeline=[];const last=new Map();
   const poll=async(phase)=>{
    const rows=[...stretches(p,start).map(s=>({seq:s.seq,s})),...messageAsks(p,start).map(m=>({seq:m.seq,m}))].sort((a,b)=>a.seq-b.seq);
    for(const row of rows){
     if(row.m){const a=await render(p,row.m.ask,`${phase}: the message call ${row.m.ask.instance_id}`);const l=labelOf(a)+(a.brief.markdown.length?' [message: '+a.brief.markdown.join(' / ')+']':'');if(last.get(row.m.ask.instance_id)!==l){last.set(row.m.ask.instance_id,l);timeline.push({seq:p.seq,phase,row:'message call',id:row.m.ask.instance_id,label:l});}continue;}
     const s=row.s;const ask=runAsk(s);const a=await render(p,ask,`${phase}: the stretch at ${s.head} (${ask.component})`);const l=labelOf(a);const key=s.head+':'+ask.component;
     if(last.get(key)!==l){last.set(key,l);timeline.push({seq:p.seq,phase,row:ask.component,head:s.head,calls:s.calls.length,closed:s.closedAt!==undefined,results:s.calls.filter(c=>c.result!==undefined).length,label:l});}
    }};
   const s=prompt(p,STRETCHES);let done=false;
   const turn=waitResult(p,s.seq).then(r=>{done=true;return r;});
   while(!done){await poll('turn running');await delay(1000);}
   const result=await turn;const resultSeq=resultFrames(p).at(-1).seq;
   const end=Date.now()+50000;
   while(Date.now()<end){await poll('after the result');const f=readFolds(run,sid);if(f?.json?.runs?.length>=2&&[...last.entries()].filter(([k])=>k.includes(':Tool')).every(([,l])=>!/Second stretch|First stretch|working record/.test(l)))break;await delay(2000);}
   await delay(3000);await poll('settled');
   for(const st of stretches(p,start))if(st.calls.length>1){const a=await render(p,headAsk(st),`the lone ToolUse of ${st.head}, asked after the switch`);timeline.push({seq:p.seq,phase:'lone ToolUse after the switch',head:st.head,label:labelOf(a)});}
   saved=stretches(p,start);savedMessages=messageAsks(p,start);
   const folds=readFolds(run,sid);
   const pushes=p.frames.filter(r=>r.seq>start&&r.frame.type==='system'&&r.frame.subtype==='ui_invalidate').map(r=>({seq:r.seq,instances:r.frame.instances??null}));
   // The ids MAWS reads for the session's rows: the wire's (assistant and user frames' uuids, tool-use ids) and the transcript file's.
   const wire=new Set(),file=new Set();
   for(const r of p.frames){const f=r.frame;if((f.type==='assistant'||f.type==='user')&&f.uuid)wire.add(rowKey(f.uuid));for(const b of f.message?.content??[])if(b?.type==='tool_use')wire.add(b.id);}
   const rows=existsSync(transcriptOf(run,sid))?readFileSync(transcriptOf(run,sid),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
   for(const r of rows){if(r.uuid)file.add(rowKey(r.uuid));for(const b of (Array.isArray(r.message?.content)?r.message.content:[]))if(b?.type==='tool_use')file.add(b.id);}
   const runs=(folds?.json?.runs??[]).map(([first,last,summary])=>({first,last,summary,firstOnWire:wire.has(rowKey(first)),lastOnWire:wire.has(rowKey(last)),firstInFile:file.has(rowKey(first)),lastInFile:file.has(rowKey(last)),firstIsHead:saved.some(x=>x.head===first),lastIsCall:saved.some(x=>x.calls.some(c=>c.id===last))}));
   const init=initFrames(p).at(-1)?.frame;
   p.note({event:'u2b_summary',resultSeq,result:{subtype:result.subtype,num_turns:result.num_turns,total_cost_usd:result.total_cost_usd,usage:result.usage,modelUsage:result.modelUsage,session_id:result.session_id},initSessionId:init?.session_id,sessionId:sid,
    foldsFile:{name:folds?sid+'.json':null,underConfig:'to-human/folds/',text:folds?.text??null,shape:folds?.json?.shape??null,runs},timeline,pushes,stretches:saved.map(x=>({head:x.head,calls:x.calls.map(c=>({id:c.id,description:c.input?.description})),closedAt:x.closedAt}))});
   // E6: a second turn, after the summaries settled.
   const s2=prompt(p,ONE_WORD);const r2=await waitResult(p,s2.seq);
   const requests=rows.length?null:null;void requests;
   const rows2=existsSync(transcriptOf(run,sid))?readFileSync(transcriptOf(run,sid),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
   const apiRows=rows2.filter(r=>r.type==='api-request').map(r=>({querySource:r.querySource,id:r.id,keys:Object.keys(r).sort(),model:r.params?.model,timestamp:r.timestamp}));
   let debugUsage=[];
   if(existsSync(debug)){const lines=readFileSync(debug,'utf8').split('\n');debugUsage=lines.filter(l=>/hook_prompt|model\.complete|modelComplete/i.test(l)).map(l=>l.replace(/\s+/g,' ').slice(0,300));}
   p.note({event:'u2b_cost',secondTurn:{subtype:r2.subtype,total_cost_usd:r2.total_cost_usd,usage:r2.usage,modelUsage:r2.modelUsage},firstTurn:{total_cost_usd:result.total_cost_usd,modelUsage:result.modelUsage},transcriptApiRequests:apiRows,debugLinesNamingTheSummaryCall:debugUsage.slice(0,40),debugLinesCount:debugUsage.length,relay:relay.log.map(x=>({...x}))});
  });
  // E5: resumed, no prompt, against the counting stand-in.
  const mock=await startMock();
  const before=existsSync(foldsFileOf(run,sid))?createHash('sha256').update(readFileSync(foldsFileOf(run,sid))).digest('hex'):null;
  try{
   await mawsLaunch('u2b-mod-summary'+SUFFIX+'-resume',run,{advert:'9',resume:sid,endpoint:mock.url,provenance:{part:'live (resumed, no prompt)',questions:['E5','E4 (the session id after a resume)'],resumes:'u2b-mod-summary.jsonl'}},async p=>{
    const order=[...saved.map(s=>({seq:s.seq,ask:runAsk(s)})),...savedMessages.map(m=>({seq:m.seq,ask:m.ask}))].sort((a,b)=>a.seq-b.seq);
    for(const o of order)await render(p,o.ask,`resumed: ${o.ask.component} ${o.ask.instance_id}`);
    await render(p,ASK.band(),'resumed: band');
    await delay(8000);
    for(const o of order)await render(p,o.ask,`resumed, 8 s on: ${o.ask.component} ${o.ask.instance_id}`);
    const after=existsSync(foldsFileOf(run,sid))?createHash('sha256').update(readFileSync(foldsFileOf(run,sid))).digest('hex'):null;
    p.note({event:'u2b_resume',requests:mock.log.map(({digest,...x})=>x),summaryRequests:mock.count('summary'),foldsFileUnchanged:before!==null&&before===after,sessionIdsOnTheWire:[...new Set(p.frames.map(r=>r.frame.session_id).filter(Boolean))]});
   });
  }finally{await mock.close();}
 }finally{await relay.close();removeRun(run);}
};
