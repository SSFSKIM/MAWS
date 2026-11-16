// UX wave U3b, probe 4 (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, "Probes" 4; "Engine
// facts" 11): the web plugin's fetch on the wire and in the transcript file. The session is launched as MAWS launches
// it (uxwave-common-arrivals.mjs) with the plugin loaded by --plugin-dir from the VM's own marketplace copy and
// CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (the plugin's tool is a mod's; the owner's user settings set it). Two fetches of
// a public page that needs no account, one with a prompt and one without; UXW_ORDER=prompt-first|bare-first. The
// plugin's cache is its default, under the scratch HOME, so the first fetch of each run is a real one.
// Noted: the init frame's announcement of the tool (tools, mcp_servers, plugins), and for each case every assistant
// tool_use and user tool_result on the wire, with the transcript rows that carry them.
import {mawsLaunch,rowsOf,keepTranscript,idle,turn,cost,blocks} from './uxwave-common-arrivals.mjs';

const WEB_PLUGIN='/var/lib/devcloud/marketplaces/doperpowers/web';
const TAG=process.env.UXW_TAG||'u3b-webfetch';
const ORDER=process.env.UXW_ORDER||'prompt-first';
const URL='https://example.com';
const CASES={
 prompt:`Call the mcp__web__fetch tool exactly once (load it with ToolSearch first if you need to) with url "${URL}" and prompt "What is the page's main heading?". Then reply with only that heading.`,
 bare:`Call the mcp__web__fetch tool exactly once (load it with ToolSearch first if you need to) with url "${URL}" and no prompt argument. Then reply with only the page's main heading.`,
};

const toolCalls=(p,from)=>p.frames.filter(r=>r.seq>from).flatMap(r=>{const f=r.frame;
 if(f.type==='assistant')return blocks(f.message?.content).filter(b=>b.type==='tool_use').map(b=>({seq:r.seq,type:'assistant',uuid:f.uuid,tool_use:{id:b.id,name:b.name,input:b.input}}));
 if(f.type==='user')return blocks(f.message?.content).filter(b=>b.type==='tool_result').map(b=>({seq:r.seq,type:'user',uuid:f.uuid,isReplay:f.isReplay,tool_use_result:f.tool_use_result,tool_result:{tool_use_id:b.tool_use_id,is_error:b.is_error,content:b.content}}));
 return [];});
const fileCalls=(rows,from)=>rows.filter(x=>x.line>from).flatMap(({line,row})=>{
 if(row.type==='assistant')return blocks(row.message?.content).filter(b=>b.type==='tool_use').map(b=>({line,type:'assistant',uuid:row.uuid,tool_use:{id:b.id,name:b.name,input:b.input}}));
 if(row.type==='user')return blocks(row.message?.content).filter(b=>b.type==='tool_result').map(b=>({line,type:'user',uuid:row.uuid,toolUseResult:row.toolUseResult,tool_result:{tool_use_id:b.tool_use_id,is_error:b.is_error,content:b.content}}));
 return [];});

export default async()=>{
 await mawsLaunch(TAG,{model:process.env.UXW_MODEL||'haiku',spendCap:'0.50',flags:['--plugin-dir',WEB_PLUGIN],env:{CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1'},provenance:{probe:'U3b probe 4 (web fetch)',plugin:WEB_PLUGIN,order:ORDER,url:URL}},async(p,{transcript})=>{
  let lastLine=0;
  const order=ORDER==='bare-first'?['bare','prompt']:['prompt','bare'];
  for(const name of order){
   const from=p.seq;
   await turn(p,CASES[name],300000);await idle(p,60000,4000);
   const init=p.frames.filter(r=>r.seq>from&&r.frame.type==='system'&&r.frame.subtype==='init').map(r=>({seq:r.seq,tools:r.frame.tools?.filter(t=>/web|fetch|ToolSearch/i.test(t)),mcp_servers:r.frame.mcp_servers,plugins:r.frame.plugins}));
   const rows=rowsOf(transcript);
   p.note({event:'uxw_case',case:name,fromSeq:from,toSeq:p.seq,init,wire:toolCalls(p,from),file:fileCalls(rows,lastLine)});lastLine=rows.length;
   console.log(name,JSON.stringify(toolCalls(p,from).map(c=>c.tool_use?.name??(c.tool_result&&'result'))));
  }
  keepTranscript(transcript,TAG);
  console.log(TAG,'cost',cost(p));
 });
};
