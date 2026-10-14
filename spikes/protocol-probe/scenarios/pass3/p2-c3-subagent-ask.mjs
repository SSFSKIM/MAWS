// P2-C3 item 3 (docs/doperpowers/plans/2026-10-08-p2-daily-driver.md, Decision Log 35; parent pin ca5c4c37): how a
// subagent's `mcp__maws__ask` call reaches the host. The question: does the subagent's `tool_use` block arrive in an
// assistant frame whose `parent_tool_use_id` is set, on the same stdout, before the `maws` server receives the
// `tools/call` carrying that block's id as `_meta["claudecode/toolUseId"]`? If so, the host can tell a subagent's ask
// from the main conversation's by the call's tool-use id alone. Recorded under MAWS's launch line with the tool allowed
// by a permission rule (no `can_use_tool` round trip between the frame and the call: the tightest ordering), for a
// foreground subagent and a background one, with `--disallowedTools AskUserQuestion` as every MAWS launch passes. The
// probe's `ask` answers `{status: "asked"}` at once, as an async ask does. One fixture: p2-c3-subagent-ask.
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,resultSummary,delay} from './p1-common.mjs';
import {SdkServer} from '../../sdk-mcp.mjs';

const askTool={
 name:'ask',
 description:'Ask the user questions through a MAWS sheet (probe stand-in). With blocking false it returns {status: "asked", askId} at once.',
 inputSchema:{type:'object',properties:{blocking:{type:'boolean'},questions:{type:'array',items:{type:'object',properties:{question:{type:'string'},modality:{type:'string',enum:['text']}},required:['question','modality']}}},required:['questions']},
 call:()=>({content:[{type:'text',text:JSON.stringify({status:'asked',askId:'probe'})}]}),
};

// Every tool_use the stream showed (main and subagents) and every tools/call the server got, by seq.
const toolUseFrames=p=>p.frames.filter(r=>r.frame.type==='assistant').flatMap(r=>(r.frame.message?.content||[]).filter(b=>b.type==='tool_use').map(b=>({seq:r.seq,id:b.id,name:b.name,parent_tool_use_id:r.frame.parent_tool_use_id??null})));
const callFrames=p=>p.frames.filter(r=>r.frame.type==='control_request'&&r.frame.request?.subtype==='mcp_message'&&r.frame.request.message?.method==='tools/call').map(r=>({seq:r.seq,name:r.frame.request.message.params?.name,toolUseId:r.frame.request.message.params?._meta?.['claudecode/toolUseId']??null,meta:r.frame.request.message.params?._meta??null}));
const permissionFrames=p=>p.frames.filter(r=>r.frame.type==='control_request'&&r.frame.request?.subtype==='can_use_tool').map(r=>({seq:r.seq,tool:r.frame.request.tool_name,tool_use_id:r.frame.request.tool_use_id??null,agent_id:r.frame.request.agent_id??null}));

// Each call matched to the frame that announced its tool use: the ordering the host can rely on.
function ordering(p){
 const uses=toolUseFrames(p);
 return callFrames(p).map(call=>{const use=uses.find(u=>u.id===call.toolUseId)??null;return {call,use,frameFirst:use!==null&&use.seq<call.seq,fromSubagent:use?.parent_tool_use_id!=null};});
}

const PROMPT=background=>`Use the Agent tool exactly once${background?' with run_in_background set to true':' with run_in_background set to false (wait for it)'}. Give the agent this task, verbatim: "Call the tool mcp__maws__ask (load it with ToolSearch first if needed) with {\\"blocking\\": false, \\"questions\\": [{\\"question\\": \\"Which name?\\", \\"modality\\": \\"text\\"}]}, then reply DONE." Do not call mcp__maws__ask yourself. When the agent has finished, reply OK.`;

export default async()=>{
 const run=scratchRun('subagent-ask',{settings:{permissions:{allow:['mcp__maws__ask','Agent','ToolSearch']}}});
 const maws=new SdkServer('maws',[askTool]);
 try{
  await launch('p2-c3-subagent-ask',run,{flags:['--disallowedTools','AskUserQuestion'],spendCap:'0.50',provenance:{child:'P2-C3',pin:'ca5c4c378af5c0db179e88c080b1e805f6d930f7',document:'docs/doperpowers/plans/2026-10-08-p2-daily-driver.md',question:'Decision Log 35: is a subagent\'s mcp__maws__ask tool_use framed with parent_tool_use_id before the server receives its tools/call'}},async p=>{
   p.serve('maws',maws);
   p.on('can_use_tool',r=>{p.note({event:'permission_asked',tool:r.tool_name,tool_use_id:r.tool_use_id??null,agent_id:r.agent_id??null});return {behavior:'allow',updatedInput:r.input};});
   success(await p.init({...initPayload(run.cwd),sdkMcpServers:['maws']}),'initialize');
   for(const background of [false,true]){
    const before=maws.calls.length;
    const r=await p.turn(PROMPT(background));
    // a background agent may still be running when the main turn ends: wait for its call (bounded)
    for(let i=0;i<60&&maws.calls.length===before;i++)await delay(1000);
    await delay(3000);
    p.note({event:'case',background,result:resultSummary(r),calls:maws.calls.length-before});
   }
   const order=ordering(p);
   p.note({event:'ordering',order,toolUses:toolUseFrames(p),calls:callFrames(p),permissions:permissionFrames(p)});
   check(p,'at least one subagent tools/call recorded',order.some(o=>o.fromSubagent),order);
   check(p,'every tools/call was preceded by its tool_use frame',order.length>0&&order.every(o=>o.frameFirst),order);
   await endAsStop(p);
  });
 }finally{removeRun(run);}
};
