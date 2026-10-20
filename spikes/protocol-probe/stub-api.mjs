// P4-B4 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, M0): a scripted stand-in for the Messages API, so a
// probe records what the engine sends the model (the system prompt, the meta messages it injects, the tool list with
// each tool's deferral, a tool's result as the model reads it) without spending anything. The engine's
// ANTHROPIC_BASE_URL points at it; every POST /v1/messages is recorded (`requests`, each summarised by the scenario's
// `record`), and answered with the scenario's next scripted turn as a server-sent event stream (or one JSON message when
// the request did not ask to stream). count_tokens answers a fixed count; any other path answers 404 and is recorded.
// Kept free of side effects so its test loads it.
import {createServer} from 'node:http';

// One scripted assistant turn: content blocks (text or tool_use) and the stop reason they end with.
export const textTurn=text=>({blocks:[{type:'text',text}],stop:'end_turn'});
export const toolTurn=(id,name,input,text)=>({blocks:[...(text?[{type:'text',text}]:[]),{type:'tool_use',id,name,input}],stop:'tool_use'});

const event=(type,data)=>`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`;

// The SSE body of one turn, as the Messages API streams it: a text block as one text delta, a tool_use block's input as
// one input_json_delta.
export function sseOf(turn,{id='msg_stub',model='claude-stub'}={}){
 let out=event('message_start',{message:{id,type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1,cache_creation_input_tokens:0,cache_read_input_tokens:0}}});
 turn.blocks.forEach((block,index)=>{
  if(block.type==='text'){
   out+=event('content_block_start',{index,content_block:{type:'text',text:''}});
   out+=event('content_block_delta',{index,delta:{type:'text_delta',text:block.text}});
  }else{
   out+=event('content_block_start',{index,content_block:{type:'tool_use',id:block.id,name:block.name,input:{}}});
   out+=event('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
  }
  out+=event('content_block_stop',{index});
 });
 out+=event('message_delta',{delta:{stop_reason:turn.stop,stop_sequence:null},usage:{output_tokens:1}});
 return out+event('message_stop',{});
}

export const jsonOf=(turn,{id='msg_stub',model='claude-stub'}={})=>({id,type:'message',role:'assistant',model,content:turn.blocks,stop_reason:turn.stop,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}});

// The engine's main loop sends the tools; a side request (a title, a classifier) sends none or few. `isMain` tells
// them apart for the script; a side request is answered `side(body)` (a short text by default).
const isMainLoop=body=>Array.isArray(body.tools)&&body.tools.some(t=>t?.name==='Bash'||t?.name==='Read'||String(t?.name).startsWith('mcp__'));

export async function startStubApi({script=[],record=body=>body,side=()=>textTurn('ok')}={}){
 const requests=[];let main=0;
 const server=createServer((req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));
  req.on('end',()=>{
   const raw=Buffer.concat(chunks).toString('utf8');const path=req.url.split('?')[0];
   if(req.method==='POST'&&path==='/v1/messages/count_tokens'){requests.push({n:requests.length+1,path});res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({input_tokens:1000}));}
   if(req.method!=='POST'||path!=='/v1/messages'){requests.push({n:requests.length+1,method:req.method,path,status:404});res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({type:'error',error:{type:'not_found_error',message:'stub'}}));}
   let body;try{body=JSON.parse(raw);}catch{res.writeHead(400);return res.end();}
   const isMain=isMainLoop(body);const turn=isMain?(script[main++]??textTurn('(the stub has no more turns)')):side(body);
   requests.push({n:requests.length+1,path,main:isMain,mainIndex:isMain?main:null,stream:body.stream===true,...record(body,{main:isMain})});
   const id=`msg_stub_${requests.length}`;
   if(body.stream===true){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});return res.end(sseOf(turn,{id,model:body.model}));}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(jsonOf(turn,{id,model:body.model})));
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,requests,mainTurns:()=>main,close:()=>new Promise(r=>server.close(()=>r()))};
}
