// UX wave U1b, probe 9b: Stop while a terminal session's sminos asynchronous question waits. The interactive engine
// in tmux inside vm-run.sh's namespace with the sminos plugin from the VM's marketplace copy (--plugin-dir,
// CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1, the plugin's state the scratch HOME's; the containment checks of
// uxwave-u3-sminos.mjs), as uxwave-u3b-bridge-command.mjs starts it. The model is asked to raise sminos's asynchronous
// question and then run a foreground sleep. While the sleep runs, Stop is posted as MAWS's lane A driver posts it
// (src/services/lane-a/driver.ts `interrupt`: POST /command {op: 'interrupt', launch}). Then the question is answered
// or dismissed as the driver's `answer` posts it (GET /requests/<id>, then POST /requests/<id>/decision with
// {behavior: 'allow', updatedInput: {answers}} or {behavior: 'dismiss'}, by 'maws', launch). The bridge's /events
// stream is kept whole, the request and the /status snapshot are read before and after each step, and a recorder keeps
// each new transcript row with when it was seen. UXW_THEN=answer|dismiss. Kept: <tag>.terminal.json and
// <tag>.transcript.jsonl.
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hostname,userInfo} from 'node:os';
import http from 'node:http';
import {redact as harnessRedact} from '../../harness.mjs';
import {BIN,ENGINE_VERSION,FIXTURES,slug,delay} from './uxwave-common-arrivals.mjs';

const THEN=process.env.UXW_THEN||'answer';
const TAG=process.env.UXW_TAG||`u1b-askwait-stop-${THEN}-r1`;
const MODEL=process.env.UXW_MODEL||'haiku';
const NAME='u1bs-'+process.pid;
const WORK=process.env.PROBE_WORK;
const PLUGIN='/var/lib/devcloud/marketplaces/doperpowers/sminos';
const HOST=hostname();
const redact=t=>harnessRedact(String(t)).split(HOST).join('<host>');
const SID=process.env.UXW_SID||randomUUID();
const MAIN=join(process.env.HOME,'.claude/projects',slug(WORK),SID+'.jsonl');
const SOCK=join(process.env.HOME,'.claude/sminos/bridge',SID+'.sock');
const T0=Date.now();
const ms=()=>Date.now()-T0;
const tmux=(...a)=>execFileSync('tmux',['-L',NAME,...a],{encoding:'utf8'});
const pane=()=>{try{return tmux('capture-pane','-p','-t',NAME);}catch{return '';}};
const type=async text=>{tmux('send-keys','-t',NAME,'-l',text);await delay(400);tmux('send-keys','-t',NAME,'Enter');};
const until=async(test,timeout,step=500)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await test();if(v)return v;await delay(step);}return null;};
const lines=f=>{try{return readFileSync(f,'utf8').split('\n').filter(Boolean);}catch{return [];}};
const busy=()=>/esc to interrupt/i.test(pane());
const idle=async(timeout=120000)=>{await until(async()=>{if(busy())return false;await delay(2500);return !busy();},timeout,1000);};

// The recorder: each new main-transcript row, whole, with when it was seen.
const timeline=[];let seen=0;
function scan(){const ls=lines(MAIN);for(let i=seen;i<ls.length;i++){let r;try{r=JSON.parse(ls[i]);}catch{r={unparsed:ls[i].slice(0,200)};}timeline.push({ms:ms(),line:i+1,row:r});}seen=ls.length;}
const cause=(label,extra={})=>{scan();timeline.push({ms:ms(),cause:label,...extra});console.log(ms(),label);};

const bridge={events:[],answers:[]};
function subscribe(){
 const req=http.request({socketPath:SOCK,path:'/events',method:'GET'},res=>{let buf='';res.setEncoding('utf8');
  res.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l)continue;let e;try{e=JSON.parse(l.replace(/^data:\s*/,''));}catch{continue;}
   if(e.n===undefined)bridge.events.push({ms:ms(),snapshot:true,keys:Object.keys(e),pending:e.pending??null,settled:e.settled??null});else if(!/^(chunk|delta|heartbeat)$/i.test(e.type??''))bridge.events.push({ms:ms(),...e});}});
  res.on('end',()=>bridge.events.push({ms:ms(),streamEnded:true}));});
 req.on('error',e=>bridge.events.push({ms:ms(),streamError:e.message}));req.end();
}
const post=(body,path='/command?wait=30000')=>new Promise(resolve=>{const data=JSON.stringify(body);const req=http.request({socketPath:SOCK,path,method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{let t='';res.setEncoding('utf8');res.on('data',d=>t+=d);res.on('end',()=>{let j;try{j=JSON.parse(t);}catch{j=t.slice(0,500);}resolve({ms:ms(),status:res.statusCode,body:j});});});req.on('error',e=>resolve({ms:ms(),error:e.message}));req.end(data);});
const getJson=path=>new Promise(resolve=>{const req=http.request({socketPath:SOCK,path,method:'GET'},res=>{let t='';res.setEncoding('utf8');res.on('data',d=>t+=d);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(t)});}catch{resolve({status:res.statusCode,body:t.slice(0,500)});}});});req.on('error',e=>resolve({error:e.message}));req.end();});

function contained(){
 const why=[],OWNER_HOME=userInfo().homedir;
 if(!process.env.HOME?.startsWith('/tmp/'))why.push('HOME is not a scratch folder');
 for(const k of ['SMINOS_HOME','DAEMON_HOME','AGORA_HOME','SMINOS_RL10','MAWS_USER_DATA','XDG_CONFIG_HOME','MAWS_HOLDER_SOCKET'])if(process.env[k])why.push(k+' is set');
 if(existsSync(join(OWNER_HOME,'.config/MAWS/mawsd/endpoint/rl10.json')))why.push("the owner's mawsd endpoint file is visible");
 if(existsSync(join(OWNER_HOME,'.claude/sminos')))why.push("the owner's sminos state is visible");
 if(existsSync(join(process.env.HOME,'.claude/sminos/daemon/identity.json')))why.push('the scratch sminos state is enrolled');
 if(existsSync('/etc/claude-code/managed-settings.json'))why.push('managed settings are visible');
 return why;
}
const sminosEnv={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',TMPDIR:'/tmp',USER:process.env.USER??'',SHELL:'/bin/bash'};
const sminos=args=>{const why=contained();if(why.length)throw new Error('not contained: '+why.join('; '));try{return {code:0,out:redact(execFileSync('sminos',args,{cwd:WORK,env:sminosEnv,encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']})).slice(0,2000)};}catch(e){return {code:e.status??-1,out:redact((e.stdout??'')+(e.stderr??'')).slice(0,2000)};}};

const QUESTION='Which fruit do you prefer?';
// The bridge's own list of pending and settled requests: the snapshot that opens a fresh /events stream.
const eventsSnapshot=()=>new Promise(resolve=>{const req=http.request({socketPath:SOCK,path:'/events',method:'GET'},res=>{let buf='';res.setEncoding('utf8');res.on('data',d=>{buf+=d;const i=buf.indexOf('\n');if(i>=0){let e=null;try{e=JSON.parse(buf.slice(0,i).trim().replace(/^data:\s*/,''));}catch{}req.destroy();resolve(e?{pending:e.pending??null,settled:e.settled??null}:{unparsed:buf.slice(0,200)});}});});req.on('error',e=>resolve({error:e.message}));req.setTimeout(5000,()=>{req.destroy();resolve({error:'timeout'});});req.end();});
async function body(record){
 const why=contained();if(why.length)throw new Error('refusing to run, not contained: '+why.join('; '));
 if(!existsSync(join(WORK,'.smns')))record.projectInit=sminos(['project','init','--name','uxw']);
 tmux('new-session','-d','-s',NAME,'-x','160','-y','48','-c',WORK,'-e','TERM=xterm-256color','-e','CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',BIN,'--model',MODEL,'--session-id',SID,'--plugin-dir',PLUGIN);
 cause('engine started',{args:['--model',MODEL,'--session-id','<session>','--plugin-dir',PLUGIN],env:['CLAUDE_CODE_ENABLE_FUNCTION_HOOKS']});
 if(!await until(()=>/auto mode|❯/.test(pane()),90000,1000))throw new Error('the prompt never showed');await delay(2500);
 const up=await until(async()=>existsSync(SOCK)&&(await getJson('/status')).status===200,60000,1000);
 if(!up)throw new Error('the bridge never answered');
 const status=(await getJson('/status')).body;const launch=typeof status?.launch==='string'?status.launch:null;
 record.bridgeStatus={sminos:status?.capabilities?.sminos,protocol:status?.capabilities?.protocol,engine:status?.capabilities?.engine,ops:status?.capabilities?.ops,launch:launch?'(present)':null};
 subscribe();await delay(1500);
 const snap=async label=>{const st=(await getJson('/status')).body;const req=record.request?await getJson('/requests/'+encodeURIComponent(record.request)):null;const s={label,ms:ms(),bridgeLists:await eventsSnapshot(),request:req,busy:busy()};(record.snaps??=[]).push(s);timeline.push({ms:ms(),cause:'snapshot '+label});return s;};
 cause('typed the prompt');
 await type('Ask me with your question tool, async true (do not wait for the answer), "'+QUESTION+'" with the options Apple and Mango. Then r'+'un exactly `python3 -c "import time; time.sleep(45); print(\'UXW-SLEPT\')"` with the Bash tool in the foreground (run_in_background false, description "uxw sleep"), then reply with only the word DONE. If my answer reached you, also say which fruit I chose.');
 const asked=await until(()=>bridge.events.find(e=>e.type==='raised'&&JSON.stringify(e).includes(QUESTION))??null,120000,500);
 const id=asked?.request??null;record.request=id;cause('question raised',{event:asked?{type:asked.type,phase:asked.phase,id}:null});
 if(!id)throw new Error('no question was raised on the bridge');
 const sleeping=await until(()=>/uxw sleep|time\.sleep|UXW-SLEPT/.test(pane())&&busy(),90000,500);cause(sleeping?'the sleep runs':'no sleep seen');
 await delay(3000);await snap('before-stop');
 const b={op:'interrupt',...(launch&&{launch})};cause('POST /command interrupt');const a=await post(b);bridge.answers.push({op:'interrupt',...a});cause('interrupt answered',{answer:a});
 await delay(6000);await idle(30000);await snap('after-stop');
 const current=await getJson('/requests/'+encodeURIComponent(id));cause('GET /requests',{status:current.status});
 const decision=THEN==='dismiss'?{behavior:'dismiss'}:{behavior:'allow',updatedInput:{answers:{[QUESTION]:'Mango'}}};
 cause('POST decision '+THEN);const d=await post({...decision,by:'maws',...(launch&&{launch})},'/requests/'+encodeURIComponent(id)+'/decision');bridge.answers.push({op:'decision',then:THEN,...d});cause('decision answered',{answer:d});
 await delay(8000);await idle(90000);await delay(5000);await snap('after-'+THEN);
 record.pane=redact(pane());
}

export default async()=>{
 const record={provenance:{plan:'U1b (requests drawn in the transcript)',section:'probe 9b (Stop while an async question waits)',then:THEN,engine:BIN,engineVersion:ENGINE_VERSION,model:MODEL,launch:'interactive engine in tmux, --model '+MODEL+' --session-id <session> --plugin-dir '+PLUGIN,env:'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',sessionId:SID,home:'scratch (vm-run.sh)'}};
 const poller=setInterval(()=>{try{scan();}catch{}},100);
 let failure=null;
 try{await body(record);}catch(e){failure=e.message;cause('failure',{error:e.message});}
 finally{
  clearInterval(poller);scan();
  try{tmux('kill-server');}catch{}
  mkdirSync(FIXTURES,{recursive:true});
  writeFileSync(FIXTURES+TAG+'.transcript.jsonl',existsSync(MAIN)?redact(readFileSync(MAIN,'utf8')):'');
  Object.assign(record,{failure,timeline,bridge});
  writeFileSync(FIXTURES+TAG+'.terminal.json',redact(JSON.stringify(record,null,1))+'\n');
  console.log('kept',TAG,SID,failure??'ok');
 }
};
