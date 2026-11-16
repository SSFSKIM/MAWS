// UX wave U2b, check 1: a local stand-in for the Messages API, so the questions whose answer is about the mod's own
// machinery (when its tracker asks for a summary, what it writes, how it replaces its file) can be provoked many times
// and observed exactly, without model calls: the engine is launched with ANTHROPIC_BASE_URL at this server. It answers
// the main loop from a script named in the turn's prompt (`U2B-SCRIPT <name> key=value…`) and every summary request
// (the mod's `$.model.complete`, recognised by its system prompt, folds.tsx LABEL_SYSTEM) with a fixed line, and logs
// every request it receives (kind, model, sizes) so a run can say how many summary requests reached the endpoint.
// Scripts:
//   cycles n=N delay=MS  N responses that each close the run before (a marked text, from the second on) and open a new
//                        one (one Bash call `echo u2b-step-k`), then a last marked text that ends the turn.
//   grow n=N             N responses of one Bash call each (`sleep 2; echo u2b-grow-k`), then a marked text.
//   mark                 one marked text, ending the turn.
// Anything else (a title, an unknown query) is answered with a short text.
import http from 'node:http';
import {randomBytes} from 'node:crypto';

const LABEL='You label folded stretches';
const id=p=>p+randomBytes(12).toString('hex');
const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(b=>b.type==='text'?b.text:'').join('\n'):'';

function script(body){
 const msgs=body.messages??[];
 let at=-1,args=null;
 for(let i=msgs.length-1;i>=0;i--){const m=msgs[i];if(m.role!=='user')continue;const t=textOf(m.content);const x=/U2B-SCRIPT (\w+)((?: \w+=\d+)*)/.exec(t);if(x){at=i;args={name:x[1],...Object.fromEntries([...x[2].matchAll(/(\w+)=(\d+)/g)].map(y=>[y[1],Number(y[2])]))};break;}}
 if(!args)return null;
 const k=msgs.slice(at+1).filter(m=>m.role==='assistant').length;
 return {...args,k};
}
function mainReply(s){
 if(s.name==='cycles'){
  if(s.k<s.n)return {content:[...(s.k>0?[{type:'text',text:`<message>Step ${s.k} done.</message>`}]:[]),{type:'tool_use',id:id('toolu_'),name:'Bash',input:{command:`echo u2b-step-${s.k}`,description:`Step ${s.k} command`}}],stop:'tool_use',delay:s.delay??0};
  return {content:[{type:'text',text:`<message>All ${s.n} steps done.</message>`}],stop:'end_turn',delay:s.delay??0};
 }
 if(s.name==='grow'){
  if(s.k<s.n)return {content:[{type:'tool_use',id:id('toolu_'),name:'Bash',input:{command:`sleep 2; echo u2b-grow-${s.k}`,description:`Grow step ${s.k}`}}],stop:'tool_use'};
  return {content:[{type:'text',text:`<message>Grown by ${s.n} steps.</message>`}],stop:'end_turn'};
 }
 if(s.name==='mark')return {content:[{type:'text',text:'<message>Ready.</message>'}],stop:'end_turn'};
 return null;
}
function sse(res,model,content,stop){
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','request-id':id('req_')});
 const send=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
 send('message_start',{message:{id:id('msg_'),type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1,cache_creation_input_tokens:0,cache_read_input_tokens:0}}});
 content.forEach((b,index)=>{
  if(b.type==='text'){send('content_block_start',{index,content_block:{type:'text',text:''}});send('content_block_delta',{index,delta:{type:'text_delta',text:b.text}});}
  else{send('content_block_start',{index,content_block:{type:'tool_use',id:b.id,name:b.name,input:{}}});send('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:JSON.stringify(b.input)}});}
  send('content_block_stop',{index});
 });
 send('message_delta',{delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:5}});
 send('message_stop',{});
 res.end();
}
function json(res,model,content,stop){
 res.writeHead(200,{'content-type':'application/json','request-id':id('req_')});
 res.end(JSON.stringify({id:id('msg_'),type:'message',role:'assistant',model,content,stop_reason:stop,stop_sequence:null,usage:{input_tokens:10,output_tokens:5,cache_creation_input_tokens:0,cache_read_input_tokens:0}}));
}

export function startMock(){
 const log=[];let summaries=0;
 const server=http.createServer((req,res)=>{
  let raw='';req.on('data',d=>raw+=d);req.on('end',async()=>{
   const url=req.url??'';
   if(req.method==='GET'&&url.startsWith('/v1/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{type:'model',id:'claude-haiku-5-5',display_name:'Haiku'}],has_more:false}));log.push({at:Date.now(),kind:'models'});return;}
   if(!url.startsWith('/v1/messages')){res.writeHead(404);res.end('{}');log.push({at:Date.now(),kind:'other',method:req.method,path:url.split('?')[0]});return;}
   let body={};try{body=JSON.parse(raw||'{}');}catch{}
   if(url.startsWith('/v1/messages/count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({input_tokens:10}));log.push({at:Date.now(),kind:'count_tokens'});return;}
   const system=JSON.stringify(body.system??'');const model=body.model??'claude-haiku-5-5';
   let reply,kind;
   if(system.includes(LABEL)){
    kind='summary';summaries++;
    const prompt=textOf(body.messages?.at(-1)?.content);
    const first=/CALL Bash — ([^\n]*)/.exec(prompt)?.[1]??'a stretch';
    reply={content:[{type:'text',text:`Ran ${first.toLowerCase()} (mock summary ${summaries})`}],stop:'end_turn'};
    log.push({at:Date.now(),kind,model,stream:!!body.stream,maxTokens:body.max_tokens,thinking:body.thinking?.type??null,systemChars:system.length,promptChars:prompt.length,tools:(body.tools??[]).length,messages:(body.messages??[]).length,digest:prompt});
   }else{
    const s=(body.tools??[]).some(t=>t.name==='Bash')?script(body):null;
    reply=s?mainReply(s):null;kind=reply?'main':'aside';
    if(!reply)reply={content:[{type:'text',text:'Mock reply.'}],stop:'end_turn'};
    log.push({at:Date.now(),kind,model,stream:!!body.stream,script:s,tools:(body.tools??[]).length,messages:(body.messages??[]).length,blocks:reply.content.map(b=>b.type==='text'?'text: '+b.text:'tool_use: '+b.input.command)});
   }
   if(reply.delay)await new Promise(r=>setTimeout(r,reply.delay));
   if(body.stream)sse(res,model,reply.content,reply.stop);else json(res,model,reply.content,reply.stop);
  });
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({port:server.address().port,url:`http://127.0.0.1:${server.address().port}`,log,count:kind=>log.filter(x=>x.kind===kind).length,close:()=>new Promise(r=>server.close(()=>r()))})));
}

// A pass-through relay to the real endpoint (the VM's gateway forward), for E6: it forwards each request unchanged
// (headers included, never logged; `accept-encoding` dropped so the answer can be read) and logs, per request, what it
// was (a summary request by the mod's system prompt, or the main loop's or another) and the usage the answer reports.
export function startRelay(target){
 const log=[];const t=new URL(target);
 const server=http.createServer((req,res)=>{
  const chunks=[];req.on('data',d=>chunks.push(d));req.on('end',()=>{
   const raw=Buffer.concat(chunks);let body={};try{body=JSON.parse(raw.toString('utf8')||'{}');}catch{}
   const system=JSON.stringify(body.system??'');
   const entry={at:Date.now(),method:req.method,path:(req.url??'').split('?')[0],kind:system.includes(LABEL)?'summary':(body.tools??[]).length?'main':'aside',model:body.model,maxTokens:body.max_tokens,stream:!!body.stream,thinking:body.thinking?.type??null,systemChars:system.length,tools:(body.tools??[]).length};
   const headers={...req.headers};delete headers['accept-encoding'];headers.host=t.host;
   const up=http.request({host:t.hostname,port:t.port,method:req.method,path:req.url,headers},r=>{
    res.writeHead(r.statusCode,r.headers);entry.status=r.statusCode;const got=[];
    r.on('data',d=>{got.push(d);res.write(d);});
    r.on('end',()=>{res.end();const text=Buffer.concat(got).toString('utf8');
     try{if(/^\s*\{/.test(text)){const j=JSON.parse(text);entry.usage=j.usage??null;entry.model=j.model??entry.model;}
      else{const u={};for(const m of text.matchAll(/^data: (.*)$/gm)){try{const e=JSON.parse(m[1]);if(e.type==='message_start'){Object.assign(u,e.message?.usage??{});entry.model=e.message?.model??entry.model;}if(e.type==='message_delta')Object.assign(u,e.usage??{});}catch{}}entry.usage=u;}}catch{}
     log.push(entry);});
   });
   up.on('error',e=>{entry.error=e.code;log.push(entry);res.writeHead(502);res.end();});
   up.end(raw);
  });
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({url:`http://127.0.0.1:${server.address().port}`,log,close:()=>new Promise(r=>server.close(()=>r()))})));
}
