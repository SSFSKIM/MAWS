// UX wave U3b, probe 3 (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, "Probes" 3; "Engine
// facts" 9): an automatic compaction in a session launched as MAWS launches it (uxwave-common-arrivals.mjs). The
// session is filled with invented, compressible filler (space-separated digits, a repeated block) in plain prompts
// until the context passes the engine's own auto-compact threshold (read with get_context_usage), then a short prompt
// is sent, before whose request the engine compacts by itself. The wire and the transcript file across the compaction
// are noted as `uxw_case` rows, the status frames by seq.
// Knobs: UXW_TAG (fixture name), UXW_MODE=threshold (read the threshold and stop, no model call), UXW_SPEND (cap, USD).
// The engine's own threshold knobs (CLAUDE_CODE_AUTO_COMPACT_WINDOW, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE) pass through -e;
// the recordings that count are made without them.
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,turn,prompt,sys,cost} from './uxwave-common-arrivals.mjs';

const TAG=process.env.UXW_TAG||'u3b-autocompact';
const MODE=process.env.UXW_MODE||'fill';
const BLOCK=(()=>{let x=12345,s='';for(let i=0;i<1000;i++){x=(x*1103515245+12345)%2147483648;s+=(x>>16)%10+(i%25===24?'\n':' ');}return s;})();
const filler=chars=>BLOCK.repeat(Math.ceil(chars/BLOCK.length)).slice(0,chars);
const ENV_KNOBS=['CLAUDE_CODE_AUTO_COMPACT_WINDOW','CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'].filter(k=>process.env[k]).map(k=>`${k}=${process.env[k]}`);

const usageOf=async p=>{const r=await p.request('get_context_usage',{detail:'summary'},60000).catch(e=>({error:e.message}));const u=r.response??{};return {totalTokens:u.totalTokens,maxTokens:u.maxTokens,rawMaxTokens:u.rawMaxTokens,autoCompactThreshold:u.autoCompactThreshold,isAutoCompactEnabled:u.isAutoCompactEnabled,percentage:u.percentage,error:r.error};};

export default async()=>{
 await mawsLaunch(TAG,{resume:process.env.UXW_RESUME||null,model:process.env.UXW_MODEL||'haiku',spendCap:process.env.UXW_SPEND||'1.50',provenance:{probe:'U3b probe 3 (automatic compaction)',mode:MODE,thresholdKnobs:ENV_KNOBS}},async(p,{transcript})=>{
  let lastLine=process.env.UXW_RESUME?rowsOf(transcript).length:0; // a resumed session's history is not this run's
  const record=(name,from,extra={})=>{const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);lastLine=rows.length;p.note({event:'uxw_case',case:name,fromSeq:from,toSeq:p.seq,...extra,wire:wireArrivals(p,from),file});console.log(name,JSON.stringify({wire:wireArrivals(p,from).length,file:file.length}));};
  const start=await usageOf(p);p.note({event:'uxw_context',when:'start',...start});console.log('start',JSON.stringify(start));
  if(MODE==='threshold')return;
  if(MODE==='density'){ // tokens per character of candidate fillers, 20000 characters each
   const rng=(alphabet,sep)=>{let x=777,o='';for(let i=0;i<1000;i++){x=(x*1103515245+12345)%2147483648;o+=alphabet[(x>>16)%alphabet.length]+(i%40===39?'\n':sep);}return o;};
   const cands={digitsSpaced:BLOCK,punctDigits:rng('0123456789.,;:!?*#',''),digitsPunctSpaced:rng('0123456789.,;:!?*#',' ')};
   let before=start.totalTokens;
   for(const [name,block] of Object.entries(cands)){const text=block.repeat(Math.ceil(20000/block.length)).slice(0,20000);await turn(p,'Invented filler for a token count; reply with only the word NOTED.\n'+text);await idle(p,30000,2000);const u=await usageOf(p);p.note({event:'uxw_density',name,chars:20000,tokens:u.totalTokens-before});console.log('density',name,u.totalTokens-before);before=u.totalTokens;}
   return;
  }
  const threshold=start.autoCompactThreshold,windowSize=start.maxTokens;
  if(!threshold||!windowSize)throw new Error('no threshold read: '+JSON.stringify(start));
  const boundary=after=>p.frames.find(r=>r.seq>after&&sys(r.frame,'compact_boundary'));
  let total=start.totalTokens,charsPerToken=0.82,n=0;
  // Three blocks: one to measure (about 100k tokens), one to land just under the threshold, one to pass it, staying
  // well inside the window; the context is read after each turn.
  const targets=process.env.UXW_RESUME?[()=>threshold-total+20000]:[()=>Math.min(100000,Math.floor((threshold-total)/2)),()=>threshold-20000-total,()=>Math.min(threshold-total+20000,windowSize-25000-total)];
  for(const target of targets){
   n++;const from=p.seq;const want=target();if(want<=0)continue;
   const text=`Invented filler block ${n} for a context test; it means nothing. Reply with only the word NOTED.\n`+filler(Math.floor(want*charsPerToken));
   const before=total;
   await turn(p,text,600000);await idle(p,90000,4000);
   const u=await usageOf(p);total=u.totalTokens;if(n===1)charsPerToken=1.0; // this filler is one token a character (u3b-autocompact-r1: 800304 characters, 800279 tokens)
   p.note({event:'uxw_context',when:`after fill ${n}`,chars:text.length,...u,charsPerToken});console.log('fill',n,JSON.stringify(u),'cost',cost(p));
   record(`fill-${n}`,from,{chars:text.length,compactBoundary:boundary(from)?.seq??null});
   if(boundary(from)){p.note({event:'uxw_compacted_during_fill',fill:n});break;}
  }
  const from=p.seq;
  await turn(p,'Reply with only the word AFTER.',900000);await idle(p,90000,5000);
  const u=await usageOf(p);p.note({event:'uxw_context',when:'after the short prompt',...u});
  record('short-prompt',from,{compactBoundary:boundary(from)?.seq??null});
  const from2=p.seq;
  await turn(p,'Reply with only the word LATER.');await idle(p,40000,4000);
  record('next-prompt',from2);
  keepTranscript(transcript,TAG);
  console.log(TAG,'cost',cost(p));
 });
};
