// UX wave, U2 O-27 / check 9 "which models return thinking text": per model alias the owner's sessions use (the
// owner's user settings map each, uxwave-common.mjs), one launch as MAWS's with set_max_thinking_tokens
// { max_thinking_tokens: null, thinking_display: 'summarized' } after initialize and one without, each with one turn
// that asks for reasoning before a tool call. A `thinking_record` note per launch reads the stream's thinking blocks
// (start, deltas), the final assistant frames' thinking blocks and their thinking_duration_ms / thinking_display, and
// the transcript rows holding a thinking block (their thinkingDurationMs / thinkingDisplay).
// PZ_PLAN: alias:count,... (default haiku:3,sonnet:3,opus:2,fable:1); PZ_HALVES: with,without.
import {mawsLaunch,transcriptFiles,rows} from './uxwave-common.mjs';
const PLAN=(process.env.PZ_PLAN||'haiku:3,sonnet:3,opus:2,fable:1').split(',').map(x=>x.split(':')).map(([a,n])=>[a,+n]);
const HALVES=(process.env.PZ_HALVES||'with,without').split(',');
const TAG=process.env.PZ_TAG||'';
const PROMPT='Before you use any tool, reason it through: of the numbers 48, 17, 93, 62 and 5, which two have a product closest to 1000? Then use Bash to run touch with a file named after the pair (for example 17-62.txt), and reply with only the file name.';
const len=s=>typeof s==='string'?s.length:null;
function read(p){
 const stream=[];const open=new Map();
 for(const x of p.frames){const f=x.frame;if(f.type!=='stream_event')continue;const e=f.event;
  if(e?.type==='content_block_start'&&(e.content_block?.type==='thinking'||e.content_block?.type==='redacted_thinking')){const b={seq:x.seq,index:e.index,type:e.content_block.type,startKeys:Object.keys(e.content_block),startTextChars:len(e.content_block.thinking),frameKeys:Object.keys(f).filter(k=>!['event','uuid','session_id'].includes(k)),thinking_display:f.thinking_display,parent_tool_use_id:f.parent_tool_use_id,thinkingDeltas:0,nonEmptyThinkingDeltas:0,deltaChars:0,signatureDeltas:0,otherDeltas:[]};open.set(e.index,b);stream.push(b);}
  else if(e?.type==='content_block_delta'&&open.has(e.index)){const b=open.get(e.index);if(e.delta.type==='thinking_delta'){b.thinkingDeltas++;if(e.delta.thinking)b.nonEmptyThinkingDeltas++;b.deltaChars+=len(e.delta.thinking)||0;}else if(e.delta.type==='signature_delta')b.signatureDeltas++;else b.otherDeltas.push(e.delta.type);}
  else if(e?.type==='content_block_stop'&&open.has(e.index)){open.get(e.index).stopSeq=x.seq;open.delete(e.index);}
  else if(e?.type==='message_start')open.clear();}
 const assistant=p.frames.filter(x=>x.frame.type==='assistant'&&(x.frame.message?.content||[]).some(b=>/thinking/.test(b.type))).map(x=>({seq:x.seq,model:x.frame.message?.model,thinking_duration_ms:x.frame.thinking_duration_ms,thinking_display:x.frame.thinking_display,frameKeys:Object.keys(x.frame),blocks:x.frame.message.content.filter(b=>/thinking/.test(b.type)).map(b=>({type:b.type,keys:Object.keys(b),textChars:len(b.thinking),hasSignature:!!b.signature,dataChars:len(b.data)}))}));
 const file=transcriptFiles(p.sessionId)[0];
 const transcript=file?rows(file).map((r,i)=>({i,r})).filter(({r})=>Array.isArray(r.message?.content)&&r.message.content.some(b=>/thinking/.test(b.type))).map(({i,r})=>({row:i,type:r.type,model:r.message?.model,thinkingDurationMs:r.thinkingDurationMs,thinkingDisplay:r.thinkingDisplay,rowKeys:Object.keys(r).filter(k=>/think/i.test(k)),blocks:r.message.content.filter(b=>/thinking/.test(b.type)).map(b=>({type:b.type,keys:Object.keys(b),textChars:len(b.thinking),hasSignature:!!b.signature}))})):null;
 return {stream,assistant,transcript,transcriptFound:!!file};
}
export default async()=>{for(const [alias,n] of PLAN)for(let k=1;k<=n;k++)for(const half of HALVES){
 const name=`uxwave-thinking-${alias}-${half}-${TAG}${k}`;
 await mawsLaunch(name,{model:alias,thinking:half==='with'},async p=>{
  const r=await p.turn(PROMPT);
  const init=p.frames.find(x=>x.frame.type==='system'&&x.frame.subtype==='init');
  const rec={alias,half,run:k,initModel:init?.frame.model,answerModels:[...new Set(p.frames.filter(x=>x.frame.type==='assistant').map(x=>x.frame.message?.model))],result:{subtype:r.subtype,is_error:r.is_error,text:String(r.result).slice(0,80)},thinkingTokens:Object.fromEntries(Object.entries(r.modelUsage||{}).map(([m,u])=>[m,u.thinkingTokens])),...read(p)};
  p.note({event:'thinking_record',...rec});
  const s=rec.stream,a=rec.assistant.flatMap(x=>x.blocks.map(b=>({...b,dur:x.thinking_duration_ms,disp:x.thinking_display}))),t=(rec.transcript||[]).flatMap(x=>x.blocks.map(b=>({...b,dur:x.thinkingDurationMs,disp:x.thinkingDisplay})));
  console.log(JSON.stringify({name,model:rec.answerModels,blocks:s.length,streamText:s.map(b=>b.deltaChars),streamDisp:s.map(b=>b.thinking_display),asst:a.map(b=>[b.textChars,b.dur,b.disp]),file:t.map(b=>[b.textChars,b.dur,b.disp]),answer:rec.result.text}));
 });
}};
