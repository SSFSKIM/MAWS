// P4-R7's live eval of the wording (the P4 spec's Decision Log 46): MAWS's launch on claude-opus-5-5 at high effort
// through the relay, the probe's recorder between (p4-r7-message-tool.mjs), on two tasks whose work makes the model send
// the human something between two tool calls, in two arms:
//   before  contract 5 appended, no message tool: MAWS as it was
//   after   contract 7 appended, `mcp__maws__message` listed and allowed as MAWS launches it
// Counted per message, as the doperpowers spec's acceptance 6 counts them. A mid-turn message is a `<message>` span in
// a text block before a tool call in the same response (delivered), a call of the message tool (delivered), or a
// non-empty progress note before a tool call that the judge rules addressed to the human (lost: the engine requests
// `display: "updates"`, so a note arrives as the API's paraphrase, which no reader shows). A final message is a span in
// the response that ends the turn. The judge is doperpowers-f7's criterion, word for word, at claude-opus-5-5 low effort
// through the relay. The launches' journals go to a scratch directory and are not kept; the counts and every judged
// note are printed and written to R7_EVAL_OUT when set.
// Run: PROBE_ENGINE=~/.local/share/claude/versions/<pinned> [R7_EVAL_REPS=stages:3,deploy:2] [R7_EVAL_OUT=…] \
//        node run-pass3.mjs p4-r7-eval
import {scratchRun,removeRun} from './p1-common.mjs';
import {arm,PROMPTS,seedCheck,resetTree} from './p4-r7-message-tool.mjs';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const contract=await import('../../../../src/shared/owner/contract.ts');
const served=JSON.parse(readFileSync(HERE+'p4-maws-tools.json','utf8'));
const listed=name=>served.tools.find(t=>t.name===name);
const {MESSAGE_TOOLS}=await import('../../../../src/shared/owner/message-call.ts'); // MAWS's reading: its own tool alone
const DIR='fixtures/p4-r7-eval/'; // removed at the end

const JUDGE=`A coding agent works for a human who is away from the screen; the human reads only what the agent wraps in <message> tags. The API returned the text below as a short summary of a note the agent wrote between two tool calls; the summary may have dropped any <message> tags.

<note>
{note}
</note>

Is the original most likely a message to the human (it reports to them, asks them to do or decide something, warns them, answers them, or says what they should expect: addressed to the human, in the second person or as a report written for them), or the agent's own working narration (what it is checking or doing next, for itself)? Answer JSON only: {"addressed_to_human": true|false, "needs_action_from_human": true|false, "why": "<one short clause>"}`;

// The relay serves a request shaped as Claude Code's (its beta and system line); a bare one is answered 429.
async function judge(note){
 const res=await fetch('http://127.0.0.1:8641/v1/messages',{method:'POST',headers:{'content-type':'application/json','anthropic-version':'2023-06-01',authorization:'Bearer claudeusage-local-gateway','anthropic-beta':'claude-code-20250219,effort-2025-11-24'},
  body:JSON.stringify({model:'claude-opus-5-5',max_tokens:2048,output_config:{effort:'low'},system:[{type:'text',text:'You are Claude Code, Anthropic\'s official CLI for Claude.'}],messages:[{role:'user',content:JUDGE.replace('{note}',note)}]})});
 const body=await res.json();
 const text=(body.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('');
 const json=/\{[\s\S]*\}/.exec(text);
 try{return {...JSON.parse(json[0]),usage:body.usage};}catch{return {addressed_to_human:null,raw:(text||JSON.stringify(body)).slice(0,300),usage:body.usage??null};}
}

// One run's responses, in order, read for its messages.
function countsOf(exchanges){
 const c={midTool:0,midSpan:0,notes:[],finalSpan:0,finalNone:0,messageCalls:0,responses:exchanges.length};
 for(const {response} of exchanges){
  const blocks=response.blocks??[];
  const lastTool=blocks.map(b=>b.type==='tool_use').lastIndexOf(true);
  blocks.forEach((b,i)=>{
   if(b.type==='tool_use'&&MESSAGE_TOOLS.includes(b.name)){c.midTool++;c.messageCalls++;}
   else if(b.type==='text'&&b.text.includes('<message>')){if(i<lastTool)c.midSpan++;else c.finalSpan++;}
   else if(b.type==='thinking'&&b.text.trim()!==''&&i<lastTool)c.notes.push(b.text.trim());
  });
  if(response.stop==='end_turn'&&!blocks.some(b=>b.type==='text'&&b.text.includes('<message>')))c.finalNone++;
 }
 return c;
}

const ARMS={
 before:{appended:contract.LEGACY_CONTRACT_5,tools:[listed('ask')],allowed:[]},
 after:{appended:contract.FULL_CONTRACT,tools:[listed('ask'),listed('message')],allowed:['mcp__maws__message']},
};

// Read at load: the first launch clears this process's environment to the engine's base keys (p1-common).
const OUT=process.env.R7_EVAL_OUT??null;
const REJUDGE=process.env.R7_EVAL_REJUDGE??null; // a file of the runs a previous eval printed: judged again, not relaunched

export default async()=>{
 const reps=Object.fromEntries((process.env.R7_EVAL_REPS??'stages:3,deploy:2').split(',').map(s=>s.split(':')).map(([k,v])=>[k,Number(v)]));
 const runs=[];
 if(REJUDGE!==null){
  for(const line of readFileSync(REJUDGE,'utf8').trim().split('\n')){
   const run=JSON.parse(line);
   const notes=[];
   for(const {note} of run.notes)notes.push({note,...(await judge(note))});
   runs.push({...run,notes});
   console.log(JSON.stringify(runs.at(-1)));
  }
  return summarise(runs);
 }
 try{
  for(const [armName,a] of Object.entries(ARMS)){
   // one scratch run per arm: the same cwd and appended text, so the system prompt's cache prefix repeats in the arm
   const run=scratchRun('r7e-'+armName);
   seedCheck(run.cwd,{deploy:true});
   try{
    for(const [scenario,n] of Object.entries(reps))for(let rep=0;rep<n;rep++){
     const recorded=await arm(`p4-r7-eval-${armName}-${scenario}-${rep}`,{run,...a,prompt:PROMPTS[scenario],question:`the eval: ${armName}, ${scenario}, repetition ${rep}`,dir:DIR});
     resetTree(run.cwd);
     const counts=countsOf(recorded.exchanges);
     const judged=[];
     for(const note of counts.notes)judged.push({note,...(await judge(note))});
     runs.push({arm:armName,scenario,rep,cost:recorded.result?.total_cost_usd??null,...counts,notes:judged});
     console.log(JSON.stringify(runs.at(-1)));
    }
   }finally{removeRun(run);}
  }
 }finally{rmSync(new URL('../../'+DIR,import.meta.url),{recursive:true,force:true});}
 summarise(runs);
};

// Per arm: the launches' cost (the judge's is apart), the mid-turn messages by form, the notes the judge ruled
// messages (lost) or narration, any it could not rule, the final spans and the message tool's calls.
function summarise(runs){
 const summary={};
 for(const r of runs){
  const s=(summary[r.arm]??={runs:0,cost:0,midTool:0,midSpan:0,lost:0,lostNeedingAction:0,notesNarration:0,notesUnjudged:0,finalSpan:0,finalNone:0,messageCalls:0});
  s.runs++;s.cost+=r.cost??0;s.midTool+=r.midTool;s.midSpan+=r.midSpan;s.finalSpan+=r.finalSpan;s.finalNone+=r.finalNone;s.messageCalls+=r.messageCalls;
  for(const n of r.notes){
   if(n.addressed_to_human===true){s.lost++;if(n.needs_action_from_human===true)s.lostNeedingAction++;}
   else if(n.addressed_to_human===false)s.notesNarration++;
   else s.notesUnjudged++;
  }
 }
 for(const s of Object.values(summary)){const mid=s.midTool+s.midSpan+s.lost;s.midTurnMessages=mid;s.lostShare=mid?+(s.lost/mid).toFixed(3):null;s.cost=+s.cost.toFixed(4);}
 console.log('SUMMARY',JSON.stringify(summary));
 if(OUT!==null)writeFileSync(OUT,JSON.stringify({summary,runs},null,1)+'\n');
 return summary;
}
