// E0a question 3 (spec §4 S4, §9 E0a; SPEC 45 §45.22.11, SPEC 11 §11.9.2 and §11.11.6): `side_question`, the control
// request behind `/btw`, with no published schema. One fixture, p1-side-question-session: a turn that plants a word;
// an idle side question (the request and answer shapes, every frame between them, so that streaming or progress
// frames show); a second with `history`; then a side question sent while a 20 s Bash tool runs in the main turn
// (does the answer arrive before the tool result, does the turn go on); then the session JSONL, for what the side
// questions left (SPEC 11 says skipTranscript).
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,answer,records,transcriptPath,summarise,topLevelKeys,toolResults,resultSummary,delay} from './p1-common.mjs';

const REMEMBER='Remember the word ZEBRA. Reply with exactly OK.';
const Q1='What word did I ask you to remember? Answer with just the word.';
const Q2='Repeat that word in lowercase letters, nothing else.';
const Q3='While the main conversation works: what word did I ask you to remember? Answer with just the word.';
const SLOW='Run exactly this bash command and nothing else: sleep 20; echo SLEPT_OK. When it finishes, reply with exactly the command output.';
const between=(p,from,to)=>p.frames.filter(r=>r.seq>from&&r.seq<to).map(r=>({seq:r.seq,direction:r.direction,type:r.frame.type,subtype:r.frame.subtype??r.frame.request?.subtype??r.frame.event??null,event:r.frame.type==='stream_event'?r.frame.event?.type:undefined}));

export default async()=>{
 const run=scratchRun('side-question');
 try{
  await launch('p1-side-question-session',run,{provenance:{question:'Q3: side_question shapes, streaming, blocking of the main turn, transcript records'}},async(p,{sessionId})=>{
   p.on('can_use_tool',r=>{p.note({event:'permission_asked',tool:r.tool_name,command:r.input?.command??null});return r.tool_name==='Bash'?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only Bash is in scope.'};});
   success(await p.init(initPayload(run.cwd)),'initialize');
   const r0=await p.turn(REMEMBER);
   check(p,'the planting turn answered',r0.subtype==='success'&&!r0.is_error);

   // 1. Idle: the shapes, and every frame between request and answer.
   const idleFrom=p.seq;const t0=Date.now();
   const sq1=await p.request('side_question',{question:Q1},180000);
   const idleTo=p.seq+1;
   p.note({event:'side_question_idle',ms:Date.now()-t0,request:{question:Q1},answer:sq1,framesBetween:between(p,idleFrom+1,idleTo),resultFramesSince:p.frames.filter(r=>r.seq>idleFrom&&r.frame.type==='result').length});
   check(p,'the idle side question answered from the shared context',sq1.subtype==='success'&&/ZEBRA/i.test(sq1.response?.response??sq1.response?.text??''),sq1);

   // 2. With history (the bridge's documented shape: an array of {question, response} strings).
   const history=[{question:Q1,response:sq1.response?.response??''}];
   const sq2=await p.request('side_question',{question:Q2,history},180000);
   p.note({event:'side_question_history',request:{question:Q2,history},answer:sq2});

   // 3. Mid-turn: a 20 s Bash in the main turn, the side question sent once the tool is running. (`sleep` and `echo`
   // pass the engine's safe-command analysis, so no can_use_tool arrives: the cue is the assistant's Bash tool_use.)
   const turnFrom=p.seq;
   p.user(SLOW);
   const bashUse=await p.wait(f=>f.type==='assistant'&&!f.parent_tool_use_id&&(f.message?.content||[]).some(b=>b.type==='tool_use'&&b.name==='Bash'),{after:turnFrom,timeout:90000});
   p.note({event:'bash_started',tool_use:bashUse.message.content.find(b=>b.type==='tool_use'),permissionAsked:p.frames.some(r=>r.seq>turnFrom&&r.frame.type==='control_request'&&r.frame.request?.subtype==='can_use_tool')});
   await delay(1500);
   const sqFrom=p.seq;const t1=Date.now();
   const sq3=await p.request('side_question',{question:Q3},180000);
   const sqTo=p.seq;const ms=Date.now()-t1;
   const result=await p.wait(f=>f.type==='result',{after:turnFrom,timeout:180000});
   const resultSeq=p.frames.find(r=>r.seq>turnFrom&&r.frame.type==='result').seq;
   const toolResultSeq=toolResults(p).find(t=>t.seq>turnFrom)?.seq??null;
   p.note({event:'side_question_mid_turn',ms,requestSeq:sqFrom+1,answeredSeq:sqTo,toolResultSeq,resultSeq,answeredBeforeToolResult:toolResultSeq!==null&&sqTo<toolResultSeq,answer:sq3,framesBetween:between(p,sqFrom+1,sqTo),mainTurn:{answer:answer(p),result:resultSummary(result)}});
   check(p,'the side question answered while the Bash tool was still running',toolResultSeq!==null&&sqTo<toolResultSeq,{answeredSeq:sqTo,toolResultSeq});
   check(p,'the main turn finished after the side question',result.subtype==='success'&&/SLEPT_OK/.test(answer(p)??''),{result:resultSummary(result),answer:answer(p)});
   await endAsStop(p);

   // 4. The transcript.
   const recs=records(transcriptPath(run,sessionId));
   // every side question's own words (the planting prompt and its answers also say ZEBRA, so the questions' phrasings
   // are the marks), plus the keys SPEC 11 names for the terminal's /btw fork
   const marks=recs.filter(r=>{const s=JSON.stringify(r);return /side_question|forkOrigin|btw|Answer with just the word|lowercase letters|While the main conversation/i.test(s);});
   const querySources=[...new Set(recs.map(r=>r.querySource??null))],forkOrigins=[...new Set(recs.map(r=>r.forkOrigin??null))];
   p.note({event:'jsonl_side_question_records',path:transcriptPath(run,sessionId),count:recs.length,keys:topLevelKeys(recs),querySources,forkOrigins,matches:marks.map(summarise),summaries:recs.map(summarise)});
   check(p,'the transcript holds no record of the three side questions',marks.length===0&&querySources.every(v=>v===null)&&forkOrigins.every(v=>v===null),{matches:marks.map(summarise),querySources,forkOrigins});
  });
 }finally{removeRun(run);}
};
