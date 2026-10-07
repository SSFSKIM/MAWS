import {spawn,execFileSync,execFile} from 'node:child_process';
import {probeInitialize} from './probe-initialize.mjs';
import {sdkMcpAnswer} from './sdk-mcp.mjs';
import {mkdtempSync,writeFileSync,appendFileSync,readFileSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('.',import.meta.url));
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function scratch(prefix='/tmp/maws-probe-'){const p=mkdtempSync(prefix);writeFileSync(p+'/one.txt','ONE\n');execFileSync('git',['init','-q'],{cwd:p});execFileSync('git',['add','one.txt'],{cwd:p});execFileSync('git',['-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','seed'],{cwd:p});return p;}
const secrets=(()=>{const vals=new Set();const add=(k,v)=>{if(typeof v==='string'&&v.length>=8&&/TOKEN|KEY|SECRET|PASSWORD/i.test(k))vals.add(v);};for(const [k,v] of Object.entries(process.env))add(k,v);try{for(const [k,v] of Object.entries(JSON.parse(readFileSync(homedir()+'/.claude/settings.json','utf8')).env||{}))add(k,v);}catch{}return [...vals].sort((a,b)=>b.length-a.length);})();
export function redact(text){for(const v of secrets)text=text.split(v).join('[REDACTED]');return text.replace(/sk-ant-[A-Za-z0-9_-]+/g,'sk-ant-[REDACTED]').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g,m=>/@(localhost|redacted\.invalid)$/.test(m)?m:'owner@redacted.invalid');}
export const GATEWAY_ENV=/^(ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_DEFAULT_[A-Z_]*_MODEL)$/;
export function processTree(root){const rows=execFileSync('ps',['-axo','pid=,ppid=,rss=,command='],{encoding:'utf8'}).trim().split('\n').map(l=>{const m=l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);return m&&{pid:+m[1],ppid:+m[2],rssKiB:+m[3],command:m[4]};}).filter(Boolean);const out=[];const walk=pid=>{for(const r of rows)if(r.ppid===pid){out.push(r);walk(r.pid);}};const self=rows.find(r=>r.pid===root);if(self)out.push(self);walk(root);return out.map(r=>({...r,command:redact(r.command).slice(0,140)}));}
export class Probe {
 constructor(name,{cwd=scratch(),flags=[],model=process.env.PROBE_MODEL||'haiku',dir='fixtures/',bin='claude',unrouted=false,settingSources='',strictMcp=true,mode='default',env:extra={},noModel=false}={}){
 mkdirSync(root+dir,{recursive:true});this.cwd=cwd;this.file=root+dir+name+'.jsonl';this.peakTreeRSSKiB=0;this.frames=[];this.handlers=new Map();this.pending=new Map();this.waiters=new Set();this.seq=0;this.peakRSSKiB=0;
 writeFileSync(this.file,'');
 const env={...process.env};for(const k of ['CLAUDECODE','CLAUDE_CODE_ENTRYPOINT','CLAUDE_CODE_SSE_PORT'])delete env[k];env.CLAUDE_CODE_ENTRYPOINT='sdk-ts';if(unrouted)for(const k of Object.keys(env))if(GATEWAY_ENV.test(k))delete env[k];Object.assign(env,extra);
 const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--permission-prompt-tool','stdio','--include-partial-messages',...(noModel?[]:['--model',model]),'--setting-sources',settingSources,...(strictMcp?['--strict-mcp-config']:[]),'--permission-mode',mode,...flags];
 this.child=spawn(bin,args,{cwd,env,stdio:['pipe','pipe','pipe']});this.note({event:'spawn',pid:this.child.pid,cwd,bin,args,routed:!unrouted&&!!env.ANTHROPIC_BASE_URL,extraEnv:Object.keys(extra),node:process.version});
 let buffer='';this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',s=>{buffer+=s;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;try{this.receive(JSON.parse(line));}catch(e){this.note({event:'parse_error',line,error:e.message});}}});
 this.child.stderr.setEncoding('utf8');this.child.stderr.on('data',text=>this.log('stderr',{text}));
 this.child.stdin.on('error',e=>this.note({event:'stdin_error',error:e.message}));
 this.closed=new Promise(resolve=>this.child.on('close',(code,signal)=>{clearInterval(this.sampler);if(buffer)this.note({event:'unterminated_stdout',text:buffer});this.note({event:'exit',code,signal,peakRSSKiB:this.peakRSSKiB,peakTreeRSSKiB:this.peakTreeRSSKiB});this.exited=true;for(const w of this.waiters)w.fail(new Error('child exited'));for(const p of this.pending.values())p.fail(new Error('child exited'));resolve({code,signal});}));
 this.sampler=setInterval(()=>execFile('ps',['-o','rss=','-p',String(this.child.pid)],(e,s)=>{if(!e)this.peakRSSKiB=Math.max(this.peakRSSKiB,Number(s.trim())||0);try{if(!this.exited)this.peakTreeRSSKiB=Math.max(this.peakTreeRSSKiB,processTree(this.child.pid).reduce((a,r)=>a+r.rssKiB,0));}catch{}}),1000);
 this.on('can_use_tool',r=>({behavior:'deny',message:'Probe has no handler for this tool.'}));
 this.servers={};this.on('mcp_message',r=>sdkMcpAnswer(this.servers,r)); // E11 W-E: serves what `serve` registered, refuses any other server
 }
 log(direction,frame){const row={seq:++this.seq,direction,at:new Date().toISOString(),frame};appendFileSync(this.file,redact(JSON.stringify(row))+'\n');return row;}
 tree(label){const procs=processTree(this.child.pid);const total=procs.reduce((a,r)=>a+r.rssKiB,0);this.note({event:'process_tree',label,totalRSSKiB:total,count:procs.length,procs});return total;}
 note(frame){this.log('meta',frame);}
 on(subtype,handler){this.handlers.set(subtype,handler);return this;}
 serve(name,server){this.servers[name]=server;return this;} // an SDK MCP server the scenario hosts (sdk-mcp.mjs)
 receive(frame){const row=this.log('in',frame);this.frames.push(row);if(frame.session_id)this.sessionId=frame.session_id;
 if(frame.type==='control_response'){const p=this.pending.get(frame.response.request_id);if(p){this.pending.delete(frame.response.request_id);p.done(frame.response);}}
 for(const w of [...this.waiters])if(row.seq>w.after&&w.test(frame))w.done(frame);
 if(frame.type==='control_request'){const h=this.handlers.get(frame.request.subtype);if(h)Promise.resolve().then(()=>h(frame.request,frame)).then(response=>this.send({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response}})).catch(e=>this.send({type:'control_response',response:{subtype:'error',request_id:frame.request_id,error:e.message}}));else this.note({event:'unhandled_control',subtype:frame.request.subtype});}
 }
 send(frame){this.log('out',frame);this.child.stdin.write(JSON.stringify(frame)+'\n');return frame;}
 request(subtype,payload={},timeout=30000){const request_id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(request_id);this.note({event:'request_timeout',subtype,request_id});reject(new Error('request timeout '+subtype));},timeout);this.pending.set(request_id,{done:r=>{clearTimeout(timer);resolve(r);},fail:e=>{clearTimeout(timer);reject(e);}});this.send({type:'control_request',request_id,request:{subtype,...payload}});});}
 wait(test,{after=0,timeout=120000}={}){const old=this.frames.find(r=>r.seq>after&&test(r.frame));if(old)return Promise.resolve(old.frame);return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);this.waiters.delete(w);};const w={test,after,done:f=>{cleanup();resolve(f);},fail:e=>{cleanup();reject(e);}};const timer=setTimeout(()=>w.fail(new Error('frame timeout')),timeout);this.waiters.add(w);});}
 user(content){return this.send({type:'user',uuid:randomUUID(),message:{role:'user',content},parent_tool_use_id:null,origin:{kind:'human'}});}
 async turn(content){const after=this.seq;this.user(content);return this.wait(f=>f.type==='result',{after});}
 async init(payload={}){return this.request('initialize',{...probeInitialize(),...payload});}
 async stop(){if(this.exited)return;this.child.stdin.end();const timer=setTimeout(()=>this.child.kill('SIGTERM'),5000);await this.closed;clearTimeout(timer);}
}
export async function run(name,fn,options={}){const p=new Probe(name,options);try{await fn(p);}catch(e){p.note({event:'scenario_error',error:e.stack});console.error(name,e.message);}finally{await p.stop();}console.log(name,JSON.stringify({sessionId:p.sessionId,peakRSSKiB:p.peakRSSKiB,peakTreeRSSKiB:p.peakTreeRSSKiB,fixture:p.file}));return p;}
