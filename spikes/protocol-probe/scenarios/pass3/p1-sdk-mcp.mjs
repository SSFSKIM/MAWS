// E0a question 1 (spec §4 S3, §9 E0a): the SDK MCP round trip under MAWS's launch. The probe is the host of an
// in-process MCP server named `maws` (one tool, `echo_file {path}`), declared with `initialize.sdkMcpServers` and served
// by answering the engine's `mcp_message` control requests with a minimal JSON-RPC implementation (initialize,
// notifications, tools/list, tools/call; SPEC 45 §45.21). Recorded: does system/init.tools list mcp__maws__echo_file;
// does the model call it and what does it see; does a client-sent `notifications/tools/list_changed` make the engine
// re-list (the `sdk_mcp_tools_list_changed` capability); does `mcp_set_servers` add a second server mid-session and
// what the tool list becomes; what the session JSONL records for the call. One fixture: p1-sdk-mcp-roundtrip.
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,initFrame,answer,records,transcriptPath,summarise,toolResults,toolUses,resultSummary,writeFileSync,join,delay} from './p1-common.mjs';
import {readFileSync} from 'node:fs';

const FILE_TEXT='MCP_ECHO_7731';
const isRequest=m=>typeof m==='object'&&m!==null&&'method' in m&&m.id!==undefined&&m.id!==null;

// A minimal MCP server: tools with a `call(args)` returning a tools/call result.
class SdkServer{
 constructor(name,tools){this.name=name;this.tools=tools;this.seen=[];this.calls=[];}
 handle(message){
  this.seen.push({method:message.method??null,id:message.id??null,kind:isRequest(message)?'request':'method' in message?'notification':'response'});
  if(!isRequest(message))return null;
  const {id,method,params}=message;
  switch(method){
   case 'initialize':return {jsonrpc:'2.0',id,result:{protocolVersion:params?.protocolVersion??'2025-11-25',capabilities:{tools:{listChanged:true}},serverInfo:{name:this.name,version:'0.0.1'}}};
   case 'ping':return {jsonrpc:'2.0',id,result:{}};
   case 'tools/list':return {jsonrpc:'2.0',id,result:{tools:this.tools.map(({name,description,inputSchema})=>({name,description,inputSchema}))}};
   case 'tools/call':{
    const tool=this.tools.find(t=>t.name===params?.name);
    this.calls.push({name:params?.name,arguments:params?.arguments??null});
    if(!tool)return {jsonrpc:'2.0',id,error:{code:-32602,message:'unknown tool '+params?.name}};
    try{return {jsonrpc:'2.0',id,result:tool.call(params.arguments??{})};}catch(e){return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:String(e.message)}],isError:true}};}
   }
   default:return {jsonrpc:'2.0',id,error:{code:-32601,message:'method not found: '+method}};
  }
 }
}
const echoFile=cwd=>({name:'echo_file',description:'Return the text of a file in the working directory (MAWS probe). If this tool is unavailable, use Read instead.',inputSchema:{type:'object',properties:{path:{type:'string',description:'Path relative to the working directory'}},required:['path']},call:({path})=>({content:[{type:'text',text:readFileSync(join(cwd,path),'utf8')}]})});
const echoUpper={name:'echo_upper',description:'Return the text uppercased (MAWS probe, added mid-session).',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']},call:({text})=>({content:[{type:'text',text:String(text).toUpperCase()}]})};
const shout={name:'shout',description:'Return the text followed by three exclamation marks (MAWS probe, second server).',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']},call:({text})=>({content:[{type:'text',text:String(text)+'!!!'}]})};

const mcpFrames=(p,after=0)=>p.frames.filter(r=>r.seq>after&&r.frame.type==='control_request'&&r.frame.request?.subtype==='mcp_message').map(r=>({seq:r.seq,server:r.frame.request.server_name,method:r.frame.request.message?.method??null,id:r.frame.request.message?.id??null}));
const waitToolsList=(p,server,after)=>p.wait(f=>f.type==='control_request'&&f.request?.subtype==='mcp_message'&&f.request.server_name===server&&f.request.message?.method==='tools/list',{after,timeout:30000});
const initCount=p=>p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='init').length;

export default async()=>{
 const run=scratchRun('sdk-mcp');
 writeFileSync(join(run.cwd,'probe.txt'),FILE_TEXT+'\n');
 const servers={maws:new SdkServer('maws',[echoFile(run.cwd)]),maws2:new SdkServer('maws2',[shout])};
 try{
  await launch('p1-sdk-mcp-roundtrip',run,{provenance:{question:'Q1: the SDK MCP round trip (initialize.sdkMcpServers, mcp_message both ways, tools/list_changed, mcp_set_servers)'}},async(p,{sessionId})=>{
   p.on('mcp_message',r=>{
    const server=servers[r.server_name];
    if(!server)throw new Error('SDK MCP server not hosted here: '+r.server_name);
    const response=server.handle(r.message);
    // the official SDK's answer to a notification: an empty result under id 0 (S287 chunk-j0381q8k.js:591107)
    return {mcp_response:response??{jsonrpc:'2.0',result:{},id:0}};
   });
   p.on('can_use_tool',r=>{
    p.note({event:'permission_asked',tool:r.tool_name,mcp_server:r.mcp_server??null,tool_kind:r.tool_kind??null,input:r.input});
    return r.tool_name.startsWith('mcp__maws')?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only the probe servers are in scope.'};
   });

   // 1. Declare the server at initialize and record the handshake the engine drives.
   const init=success(await p.init({...initPayload(run.cwd),sdkMcpServers:['maws']}),'initialize');
   p.note({event:'initialize_answer',keys:Object.keys(init).sort(),sdk_mcp_manifests_parked:init.sdk_mcp_manifests_parked??null,capabilities:init.capabilities??null});
   await waitToolsList(p,'maws',0);
   await delay(500);
   p.note({event:'handshake_frames',server:'maws',frames:mcpFrames(p),seen:servers.maws.seen});

   // 2. The model calls the tool.
   const r1=await p.turn('Call the tool mcp__maws__echo_file with {"path":"probe.txt"} and reply with exactly the text it returned, nothing else.');
   const sysInit=initFrame(p);
   p.note({event:'init_tools',session_id:sysInit?.session_id,tools:sysInit?.tools??null,mcp_servers:sysInit?.mcp_servers??null,hasEchoFile:!!sysInit?.tools?.includes('mcp__maws__echo_file'),capabilities:sysInit?.capabilities??null});
   check(p,'system/init.tools lists mcp__maws__echo_file',!!sysInit?.tools?.includes('mcp__maws__echo_file'),sysInit?.tools);
   p.note({event:'turn_one',answer:answer(p),serverCalls:servers.maws.calls,toolUses:toolUses(p),toolResults:toolResults(p),result:resultSummary(r1)});
   check(p,'the server received tools/call echo_file',servers.maws.calls.some(c=>c.name==='echo_file'),servers.maws.calls);
   check(p,'the model read the file through the SDK server',(answer(p)??'').includes(FILE_TEXT),answer(p));

   // 3. A tool added to the running server, announced with the MCP notification over the client→CLI direction.
   servers.maws.tools.push(echoUpper);
   const beforeNotice=p.seq;
   const ack=await p.request('mcp_message',{server_name:'maws',message:{jsonrpc:'2.0',method:'notifications/tools/list_changed'}});
   p.note({event:'tools_list_changed_ack',response:ack});
   let relisted=null;
   try{relisted=await waitToolsList(p,'maws',beforeNotice);}catch{relisted=null;}
   await delay(500);
   const usageA=success(await p.request('get_context_usage',{detail:'summary'}),'get_context_usage');
   p.note({event:'after_tools_list_changed',relisted:!!relisted,frames:mcpFrames(p,beforeNotice),mcpTools:usageA.mcpTools??null,systemFramesSince:p.frames.filter(r=>r.seq>beforeNotice&&r.frame.type==='system').map(r=>({seq:r.seq,subtype:r.frame.subtype}))});
   const r2=await p.turn('Call the tool mcp__maws__echo_upper with {"text":"quiet"} and reply with exactly the text it returned, nothing else. If the tool does not exist, reply with exactly NO_SUCH_TOOL.');
   p.note({event:'turn_two',answer:answer(p),serverCalls:servers.maws.calls,toolUses:toolUses(p).filter(t=>t.name.includes('echo_upper')),result:resultSummary(r2),initFrames:initCount(p)});

   // 4. A second SDK server added mid-session with mcp_set_servers.
   const beforeSet=p.seq;
   let set=await p.request('mcp_set_servers',{servers:{maws2:{type:'sdk',name:'maws2'}}});
   p.note({event:'mcp_set_servers_answer',request:{servers:{maws2:{type:'sdk',name:'maws2'}}},response:set});
   if(set.response?.removed?.includes('maws')){
    // the request is authoritative for the SDK lane: the map is the whole set, so re-add both
    set=await p.request('mcp_set_servers',{servers:{maws:{type:'sdk',name:'maws'},maws2:{type:'sdk',name:'maws2'}}});
    p.note({event:'mcp_set_servers_readd',response:set});
   }
   try{await waitToolsList(p,'maws2',beforeSet);}catch{}
   await delay(500);
   const status=success(await p.request('mcp_status',{}),'mcp_status');
   const usageB=success(await p.request('get_context_usage',{detail:'summary'}),'get_context_usage');
   p.note({event:'after_mcp_set_servers',frames:mcpFrames(p,beforeSet),seen:servers.maws2.seen,mcpServers:status.mcpServers??null,mcpTools:usageB.mcpTools??null,systemFramesSince:p.frames.filter(r=>r.seq>beforeSet&&r.frame.type==='system').map(r=>({seq:r.seq,subtype:r.frame.subtype}))});
   const r3=await p.turn('Call the tool mcp__maws2__shout with {"text":"hello"} and reply with exactly the text it returned, nothing else. If the tool does not exist, reply with exactly NO_SUCH_TOOL.');
   p.note({event:'turn_three',answer:answer(p),serverCalls:servers.maws2.calls,toolUses:toolUses(p).filter(t=>t.name.includes('shout')),toolResults:toolResults(p).slice(-1),result:resultSummary(r3),initFrames:initCount(p),initToolsPerFrame:p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='init').map(r=>({seq:r.seq,mcpTools:(r.frame.tools||[]).filter(t=>t.startsWith('mcp__'))}))});
   check(p,'the model called the second server after mcp_set_servers',servers.maws2.calls.some(c=>c.name==='shout'),servers.maws2.calls);
   await endAsStop(p);

   // 5. What the session JSONL records for the calls.
   const recs=records(transcriptPath(run,sessionId));
   const blocks=r=>Array.isArray(r.message?.content)?r.message.content:[];
   const mcpUseIds=new Set(recs.flatMap(r=>blocks(r).filter(b=>b.type==='tool_use'&&String(b.name).startsWith('mcp__maws')).map(b=>b.id)));
   const mcp=recs.filter(r=>JSON.stringify(r).includes('mcp__maws')||blocks(r).some(b=>b.type==='tool_result'&&mcpUseIds.has(b.tool_use_id)));
   p.note({event:'jsonl_mcp_records',path:transcriptPath(run,sessionId),count:recs.length,keys:[...new Set(recs.flatMap(r=>Object.keys(r)))].sort(),mcpToolUseIds:[...mcpUseIds],summaries:mcp.map(summarise),records:mcp});
  });
 }finally{removeRun(run);}
};
