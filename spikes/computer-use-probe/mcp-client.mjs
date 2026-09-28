// Neutral stdio MCP client for probing Codex's computer-use servers from outside Codex.
// Every frame is journaled to fixtures/<name>.jsonl; image payloads are written beside it and replaced by a reference.
import {spawn} from 'node:child_process';
import {writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {redact,processTree} from '../protocol-probe/harness.mjs';
export const root=fileURLToPath(new URL('.',import.meta.url));
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
const EXT={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
export class McpProbe {
 constructor(name,{command,args=[],env={},cwd=root,capabilities={elicitation:{}},clientInfo={name:'maws-cu-probe',version:'0.0.1'},protocolVersion='2025-06-18',dir='fixtures/'}={}){
  this.dir=root+dir;mkdirSync(this.dir,{recursive:true});this.name=name;this.file=this.dir+name+'.jsonl';writeFileSync(this.file,'');
  this.seq=0;this.nextId=1;this.images=0;this.pending=new Map();this.handlers=new Map();this.notifications=[];this.capabilities=capabilities;this.clientInfo=clientInfo;this.protocolVersion=protocolVersion;
  this.child=spawn(command,args,{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
  this.note({event:'spawn',pid:this.child.pid,command,args,cwd,envKeys:Object.keys(env),capabilities,clientInfo});
  let buffer='';this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',s=>{buffer+=s;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;try{this.receive(JSON.parse(line));}catch(e){this.note({event:'parse_error',line:line.slice(0,2000),error:e.message});}}});
  this.child.stderr.setEncoding('utf8');this.child.stderr.on('data',text=>this.log('stderr',{text}));
  this.child.stdin.on('error',e=>this.note({event:'stdin_error',error:e.message}));
  this.closed=new Promise(resolve=>this.child.on('close',(code,signal)=>{if(buffer)this.note({event:'unterminated_stdout',text:buffer.slice(0,2000)});this.note({event:'exit',code,signal});this.exited=true;for(const p of this.pending.values())p.fail(new Error(`server exited code=${code} signal=${signal}`));resolve({code,signal});}));
  this.on('ping',()=>({}));
  this.on('roots/list',()=>({roots:[{uri:'file://'+root,name:'probe'}]}));
  this.on('elicitation/create',()=>({action:'decline'}));
 }
 // Replace base64 image and audio payloads with files so journals stay readable and diffable.
 strip(frame){return JSON.parse(JSON.stringify(frame,(_k,v)=>{if(v&&typeof v==='object'&&typeof v.data==='string'&&v.data.length>512&&(v.type==='image'||v.type==='audio'||/^image\//.test(v.mimeType||''))){const file=`${this.name}.${++this.images}.${EXT[v.mimeType]||'bin'}`;writeFileSync(this.dir+file,Buffer.from(v.data,'base64'));return {...v,data:`<${v.data.length} base64 chars → ${file}>`};}return v;}));}
 log(direction,frame){const row={seq:++this.seq,direction,at:new Date().toISOString(),frame:this.strip(frame)};appendFileSync(this.file,redact(JSON.stringify(row))+'\n');return row;}
 note(frame){return this.log('meta',frame);}
 on(method,handler){this.handlers.set(method,handler);return this;}
 receive(frame){this.log('in',frame);
  if('id' in frame&&!('method' in frame)){const p=this.pending.get(frame.id);if(p){this.pending.delete(frame.id);'error' in frame?p.fail(Object.assign(new Error(frame.error.message),{rpc:frame.error})):p.done(frame.result);}return;}
  if('id' in frame){const h=this.handlers.get(frame.method);if(!h){this.send({jsonrpc:'2.0',id:frame.id,error:{code:-32601,message:`probe has no handler for ${frame.method}`}});return;}
   Promise.resolve().then(()=>h(frame.params,frame)).then(result=>this.send({jsonrpc:'2.0',id:frame.id,result}),e=>this.send({jsonrpc:'2.0',id:frame.id,error:{code:-32603,message:e.message}}));return;}
  this.notifications.push(frame);}
 send(frame){this.log('out',frame);this.child.stdin.write(JSON.stringify(frame)+'\n');return frame;}
 notify(method,params){return this.send({jsonrpc:'2.0',method,...(params===undefined?{}:{params})});}
 request(method,params={},timeout=60000){const id=this.nextId++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.note({event:'request_timeout',method,id});reject(new Error(`timeout ${method}`));},timeout);this.pending.set(id,{done:r=>{clearTimeout(timer);resolve(r);},fail:e=>{clearTimeout(timer);reject(e);}});this.send({jsonrpc:'2.0',id,method,params});});}
 async init(){const result=await this.request('initialize',{protocolVersion:this.protocolVersion,capabilities:this.capabilities,clientInfo:this.clientInfo});this.notify('notifications/initialized');this.server=result;return result;}
 callTool(name,args={},{meta,timeout=120000}={}){return this.request('tools/call',{name,arguments:args,...(meta?{_meta:meta}:{})},timeout);}
 tree(label){const procs=processTree(this.child.pid);this.note({event:'process_tree',label,procs});return procs;}
 async stop(){if(this.exited)return;this.child.stdin.end();const timer=setTimeout(()=>this.child.kill('SIGTERM'),5000);await this.closed;clearTimeout(timer);}
}
export async function run(name,fn,options){const p=new McpProbe(name,options);try{await fn(p);}catch(e){p.note({event:'scenario_error',error:e.stack});console.error(name,e.message);}finally{await p.stop();}console.log(name,'→',p.file);return p;}
