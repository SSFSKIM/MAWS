// UX wave U3b, probe 2 (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, "Probes" 2; "Engine
// facts" 6): a slash command the sminos bridge ran in a terminal session (`$.command.run`, the bridge's `command` op,
// sminos/hooks/mods/bridge.tsx deskCommand), beside the same command typed. The interactive engine runs in tmux inside
// vm-run.sh's namespace (as uxwave-u8d-terminal.mjs starts it), with the sminos plugin from the VM's marketplace copy
// (--plugin-dir) and CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1, its state the scratch HOME's (the containment checks of
// uxwave-u3-sminos.mjs). The op is posted as MAWS's lane A driver posts it (src/services/lane-a/driver.ts `control`:
// `POST /command?wait=…` on the session's socket, `{op: 'command', name, args, launch}`), and the bridge's /events
// stream is kept. A recorder reads the transcript every 100 ms and keeps each new row with the moment it was seen.
// Steps: a warm prompt; `/rename` typed, then by the bridge, then by the bridge, then typed (each with its own name);
// the bridge asked for `cost`, `usage` and `context` (the commands the brief names; their routes are recorded as the
// bridge answers them); and, for probe 5 (findings-uxwave-u3b-fork-delivered.txt), one prompt delivered by
// `sminos send` while idle. Kept: <tag>.terminal.json (the record) and <tag>.transcript.jsonl.
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hostname,userInfo} from 'node:os';
import http from 'node:http';
import {redact as harnessRedact} from '../../harness.mjs';
import {BIN,ENGINE_VERSION,FIXTURES,slug,delay} from './uxwave-common-arrivals.mjs';

const TAG=process.env.UXW_TAG||'u3b-bridge-command-r1';
const MODEL=process.env.UXW_MODEL||'haiku';
const NAME='u3bb-'+process.pid;
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
   if(e.n===undefined)bridge.events.push({ms:ms(),snapshot:true,keys:Object.keys(e)});else if(/run|result|command|deliver|message|inbox/i.test(e.type??''))bridge.events.push({ms:ms(),...e});}});
  res.on('end',()=>bridge.events.push({ms:ms(),streamEnded:true}));});
 req.on('error',e=>bridge.events.push({ms:ms(),streamError:e.message}));req.end();
}
const post=body=>new Promise(resolve=>{const data=JSON.stringify(body);const req=http.request({socketPath:SOCK,path:'/command?wait=30000',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{let t='';res.setEncoding('utf8');res.on('data',d=>t+=d);res.on('end',()=>{let j;try{j=JSON.parse(t);}catch{j=t.slice(0,500);}resolve({ms:ms(),status:res.statusCode,body:j});});});req.on('error',e=>resolve({ms:ms(),error:e.message}));req.end(data);});
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

async function body(record){
 const why=contained();if(why.length)throw new Error('refusing to run, not contained: '+why.join('; '));
 if(!existsSync(join(WORK,'.smns')))record.projectInit=sminos(['project','init','--name','uxw']);
 tmux('new-session','-d','-s',NAME,'-x','160','-y','48','-c',WORK,'-e','TERM=xterm-256color','-e','CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',BIN,'--model',MODEL,'--session-id',SID,'--plugin-dir',PLUGIN);
 cause('engine started',{args:['--model',MODEL,'--session-id','<session>','--plugin-dir',PLUGIN],env:['CLAUDE_CODE_ENABLE_FUNCTION_HOOKS']});
 if(!await until(()=>/auto mode|❯/.test(pane()),90000,1000))throw new Error('the prompt never showed');await delay(2500);
 const up=await until(async()=>existsSync(SOCK)&&(await getJson('/status')).status===200,60000,1000);
 if(!up)throw new Error('the bridge never answered');
 const status=(await getJson('/status')).body;const launch=typeof status?.launch==='string'?status.launch:null;
 record.bridgeStatus={sminos:status?.capabilities?.sminos,protocol:status?.capabilities?.protocol,engine:status?.capabilities?.engine,ops:status?.capabilities?.ops,routes:status?.capabilities?.routes?.measured??null,launch:launch?'(present)':null};
 subscribe();await delay(1500);
 await type('Without using any tool, reply with only the word READY.');await delay(4000);await idle();cause('warm done');
 const typed=async args=>{cause('typed /rename '+args);await type('/rename '+args);await delay(6000);await idle();cause('typed settled');};
 const viaBridge=async(name,args)=>{const b={op:'command',name,args,...(launch&&{launch})};cause('POST /command',{body:{...b,launch:launch?'(present)':undefined}});const a=await post(b);bridge.answers.push({name,args,...a});cause('answered',{answer:a});await delay(6000);await idle();cause('bridge settled');};
 await typed('uxw typed one');
 await viaBridge('rename','uxw bridge one');
 await viaBridge('rename','uxw bridge two');
 await typed('uxw typed two');
 for(const n of ['cost','usage','context'])await viaBridge(n,'');
 // probe 5: a prompt delivered from outside while idle
 cause('sminos send');record.send=sminos(['send',SID,'UXW delivered: reply with only the word DELIVERED.']);
 await delay(6000);await idle();await delay(3000);cause('delivered settled');
 record.pane=redact(pane());
}

export default async()=>{
 const record={provenance:{plan:'docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md',section:'Probes 2 (and 5)',engine:BIN,engineVersion:ENGINE_VERSION,model:MODEL,launch:'interactive engine in tmux, --model '+MODEL+' --session-id <session> --plugin-dir '+PLUGIN,env:'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',sessionId:SID,home:'scratch (vm-run.sh)'}};
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
