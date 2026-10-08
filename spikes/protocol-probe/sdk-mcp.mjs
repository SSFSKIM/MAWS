// The probes' one SDK MCP handshake (E11 W-E). The engine is the MCP client of every server a session's initialize
// declares in `sdkMcpServers`, and sends each JSON-RPC message as a `control_request {subtype: 'mcp_message',
// server_name, message}` answered `{mcp_response}` (SPEC 45 §45.21; E0a's pass3/p1-sdk-mcp-roundtrip). Every Probe
// answers them through `sdkMcpAnswer` (harness.mjs): a server the scenario registered with `probe.serve(name, server)`
// is served, and any other is refused with the JSON-RPC error MAWS's host gives a server it does not serve
// (src/engine-host/tool-server/server.ts), so a probe whose payload declares a server it never serves gets the
// handshake answered with a refusal instead of an engine left waiting. Kept free of side effects so its test loads it.

const METHOD_NOT_FOUND=-32601;
const isRequest=m=>typeof m==='object'&&m!==null&&'method' in m&&m.id!==undefined&&m.id!==null;

// A minimal MCP server: tools with a `call(args)` returning a tools/call result. `handle` answers a request, or null
// for a notification (or a response), which `sdkMcpAnswer` acknowledges as the official SDK does.
export class SdkServer{
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
   default:return {jsonrpc:'2.0',id,error:{code:METHOD_NOT_FOUND,message:'method not found: '+method}};
  }
 }
}

// The answer to one `mcp_message` control request, given the servers the probe serves by name (each with a
// `handle(message)` as SdkServer's).
export function sdkMcpAnswer(servers,request){
 const server=Object.hasOwn(servers,request.server_name)?servers[request.server_name]:null;
 if(!server)return {mcp_response:{jsonrpc:'2.0',id:request.message?.id??0,error:{code:METHOD_NOT_FOUND,message:`the probe serves no MCP server named "${request.server_name}"`}}};
 // the official SDK's answer to a notification: an empty result under id 0 (S287 chunk-j0381q8k.js:591107)
 return {mcp_response:server.handle(request.message)??{jsonrpc:'2.0',result:{},id:0}};
}
