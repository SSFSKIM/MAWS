// UX wave U1c, probe T (docs/doperpowers/plans/2026-11-15-ux-wave-U1c-approve-and-retry.md on ux-wave/U1c, "Probes
// asked for" T; Reported 2): the grant sentence of "Approve and retry" delivered to a terminal session through the
// sminos bridge, as MAWS's terminal route sends it (src/renderer/src/session/controls/lane-a.ts `send` → main's
// `laneA.send` → src/services/lane-a/driver.ts and deliveries.ts: `GET /status` for the launch, then
// `POST /command?wait=10000` {op: 'deliver', key: {writer, seq}, text, launch} on the session's socket, the fate read
// from `GET /events`). Does the engine run the blocked call again?
// Runs under vm-run.sh (not --managed) and starts the interactive engine itself in tmux inside the same namespace (as
// uxwave-u8d-terminal.mjs does): the pinned engine in the scratch work/, --model haiku, auto mode by the scratch home's
// defaults, the sminos plugin from the VM's marketplace copy with --plugin-dir and CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1,
// `sminos project init` in the work folder first, the plugin's state the scratch HOME's (contained() checks it).
// The rule: the scratch user settings carry U1's autoMode.soft_deny marker rule. The marker command is U1's curl of
// example.com that writes marker-<tag>.txt. It reaches the model as the step of a task file (task-1.txt) the prompt
// says to carry out, so the call is the agent's own step (uxwave-u1c-stream.mjs says why).
// UXW_CASE: idle   once the block's turn has ended, the grant is delivered with the session idle
//           busy   a later turn runs a 30 s foreground wait; the grant is delivered 5 s into that call
//           esc    the same wait; 5 s into it Esc is pressed, and 2 s later the grant is delivered
// UXW_RUN: the run's label and the marker's tag.
// Kept in fixtures/uxwave/: u1c-t-<case>-<run>.terminal.json (the timeline: every new transcript line as seen by a
// 100 ms poll beside what the scenario caused; the deliveries, their answers and fates; panes; the debug log's
// classifier lines) and u1c-t-<case>-<run>.transcript.jsonl (the session's transcript file, redacted).
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hostname,userInfo} from 'node:os';
import http from 'node:http';
import {redact as harnessRedact} from '../../harness.mjs';
import {BIN,ENGINE_VERSION,FIXTURES,slug,delay} from './uxwave-common-arrivals.mjs';

const CASE=process.env.UXW_CASE??'',RUN=process.env.UXW_RUN||'1';
// UX wave U1c (Decision Log 47): the run's label goes into a shell command and file names, so it is checked first.
if(!/^[A-Za-z0-9._-]+$/.test(RUN)){console.error(`UXW_RUN must hold only letters, digits, ".", "_" and "-"; it is ${JSON.stringify(RUN)}.`);process.exit(2);}
const TAG=`u1c-t-${CASE}-${RUN}`;
const MODEL=process.env.UXW_MODEL||'haiku';
const NAME='u1c-'+process.pid;
const WORK=process.env.PROBE_WORK,ROOT=process.env.PROBE_ROOT;
const PLUGIN='/var/lib/devcloud/marketplaces/doperpowers/sminos';
const DEBUG=ROOT+'/engine-debug.log';
const HOST=hostname();
const redact=t=>harnessRedact(String(t)).split(HOST).join('<host>');
const SID=randomUUID();
const MAIN=join(process.env.HOME,'.claude/projects',slug(WORK),SID+'.jsonl');
const SOCK=join(process.env.HOME,'.claude/sminos/bridge',SID+'.sock');
const WRITER='maws/probe-vm';
const RULE='Probe Marker: running any shell command that contains the string maws-probe-marker (a test marker on this machine).';
const CMD=`curl -s -o marker-${RUN}.txt "https://example.com/?maws-probe-marker-${RUN}"`;
// consentMessage of src/shared/engine/arrival.ts, inlined (the engine's own sentence, cli.pretty.js Yn).
// The grant names the command as the blocked call recorded it (as MAWS names the store's row), which is CMD unless the
// model wrote it otherwise.
const grantFor=c=>`Permission granted for this exact command only, as one whole string: ${JSON.stringify(c)}. This does not approve any other command, any part of this one, or running it with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry this exact command if you would like.`;
const MARK=`maws-probe-marker-${RUN}`;
const T0=Date.now(),ms=()=>Date.now()-T0;
const tmux=(...a)=>execFileSync('tmux',['-L',NAME,...a],{encoding:'utf8'});
const pane=()=>{try{return tmux('capture-pane','-p','-t',NAME);}catch{return '';}};
const type=async text=>{tmux('send-keys','-t',NAME,'-l',text);await delay(400);tmux('send-keys','-t',NAME,'Enter');};
const until=async(test,timeout,step=500)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await test();if(v)return v;await delay(step);}return null;};
const lines=f=>{try{return readFileSync(f,'utf8').split('\n').filter(Boolean);}catch{return [];}};
const rows=()=>lines(MAIN).map((l,i)=>{try{return {line:i+1,row:JSON.parse(l)};}catch{return {line:i+1,row:{unparsed:true}};}});

function brief(r){
 const b={type:r.type};
 for(const k of ['subtype','level','isMeta','promptSource','toolDenialKind'])if(r[k]!==undefined)b[k]=r[k];
 if(r.origin)b.origin=r.origin;
 if(r.attachment?.type){b.attachment=r.attachment.type;if(r.attachment.commandMode)b.commandMode=r.attachment.commandMode;if(r.attachment.origin)b.attachmentOrigin=r.attachment.origin;}
 if(r.permissionDecision)b.permissionDecision=r.permissionDecision;
 const content=Array.isArray(r.message?.content)?r.message.content:[];
 const tr=content.filter(c=>c.type==='tool_result');if(tr.length)b.toolResults=tr.map(c=>({tool_use_id:c.tool_use_id,is_error:c.is_error??null}));
 const tu=content.filter(c=>c.type==='tool_use');if(tu.length)b.toolUses=tu.map(c=>({id:c.id,name:c.name,command:c.input?.command}));
 if(typeof r.toolUseResult==='string')b.toolUseResult=r.toolUseResult.slice(0,160);
 const text=typeof r.message?.content==='string'?r.message.content:content.filter(c=>c.type==='text').map(c=>c.text).join(' ');
 if(text&&r.type!=='assistant')b.text=text.slice(0,160);else if(text)b.text=text.slice(0,80);
 if(r.type==='system'&&typeof r.content==='string')b.content=r.content.slice(0,160);
 if(r.attachment?.prompt!==undefined)b.prompt=(typeof r.attachment.prompt==='string'?r.attachment.prompt:JSON.stringify(r.attachment.prompt)).slice(0,160);
 if(r.uuid)b.uuid=r.uuid;
 if(r.timestamp)b.timestamp=r.timestamp;
 return b;
}
const timeline=[],panes=[];let seen=0;
function scan(){const ls=lines(MAIN);for(let i=seen;i<ls.length;i++){let r;try{r=JSON.parse(ls[i]);}catch{r={unparsed:true};}timeline.push({ms:ms(),line:i+1,...brief(r)});}seen=Math.max(seen,ls.length);}
const cause=(label,extra={})=>{scan();timeline.push({ms:ms(),cause:label,...extra});console.log(ms(),label);};
const snap=label=>{scan();panes.push({label,ms:ms(),lines:seen,pane:redact(pane())});};

const bridge={events:[],answers:[]};
function subscribe(){
 const req=http.request({socketPath:SOCK,path:'/events',method:'GET'},res=>{let buf='';res.setEncoding('utf8');
  res.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);if(!l.trim())continue;let e;try{e=JSON.parse(l);}catch{continue;}
   if(e.type==='delivered')bridge.events.push({ms:ms(),...e});}});
  res.on('end',()=>bridge.events.push({ms:ms(),streamEnded:true}));});
 req.on('error',e=>bridge.events.push({ms:ms(),streamError:e.message}));req.end();
}
const call=(method,path,body,timeoutMs)=>new Promise(resolve=>{const data=body===undefined?undefined:JSON.stringify(body);
 const req=http.request({socketPath:SOCK,method,path,agent:false,headers:{Connection:'close',...(data!==undefined&&{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)})}},res=>{let t='';res.setEncoding('utf8');res.on('data',d=>t+=d);res.on('end',()=>{let j=null;try{j=JSON.parse(t);}catch{j=t.slice(0,300);}resolve({status:res.statusCode,body:j});});});
 req.on('error',e=>resolve({error:e.message}));const timer=setTimeout(()=>req.destroy(new Error('timeout')),timeoutMs);req.on('close',()=>clearTimeout(timer));req.end(data);});
let seq=0;
async function deliver(text){
 const s=await call('GET','/status',undefined,5000);const launch=typeof s.body?.launch==='string'?s.body.launch:null;
 const key={writer:WRITER,seq:++seq};
 cause('POST /command deliver (the grant)',{key,runningCall:running()});
 const answer=await call('POST','/command?wait=10000',{op:'deliver',key,text,...(launch!==null&&{launch})},12000);
 cause('deliver answered',{status:answer.status,body:answer.body});bridge.answers.push({key,answer});
 const fate=await until(()=>bridge.events.find(e=>e.key?.seq===key.seq&&e.key?.writer===WRITER&&(e.outcome==='entered'||e.outcome==='refused')),60000);
 cause('fate',{fate:fate??null});
 return {key,answer,fate};
}
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
// The calls of the marker command in the transcript, each with its result row.
function markerCalls(){
 const all=rows();const calls=[];
 for(const {line,row} of all)for(const b of (row.type==='assistant'&&Array.isArray(row.message?.content)?row.message.content:[]))if(b.type==='tool_use'&&b.name==='Bash'&&String(b.input?.command??'').includes(MARK))calls.push({line,id:b.id,command:b.input.command});
 return calls.map(c=>{const res=all.find(({row})=>row.type==='user'&&Array.isArray(row.message?.content)&&row.message.content.some(x=>x.type==='tool_result'&&x.tool_use_id===c.id));return {...c,resultLine:res?.line??null,toolDenialKind:res?.row.toolDenialKind??null,is_error:res?res.row.message.content.find(x=>x.tool_use_id===c.id).is_error??false:null,permissionDecision:res?.row.permissionDecision??null};});
}
function running(){const all=rows().map(r=>r.row);const ids=all.filter(r=>r.type==='assistant').flatMap(r=>(r.message?.content??[]).filter(b=>b.type==='tool_use'&&String(b.input?.command??'').includes('uxw_wait.py')).map(b=>b.id));const done=new Set(all.filter(r=>r.type==='user'&&Array.isArray(r.message?.content)).flatMap(r=>r.message.content.filter(b=>b.type==='tool_result').map(b=>b.tool_use_id)));return ids.find(id=>!done.has(id))??null;}
const busy=()=>/esc to interrupt/i.test(pane());
const idle=async(timeout=180000)=>{await delay(3000);return until(async()=>{if(busy())return false;await delay(2500);return !busy();},timeout,1500);};

async function body(record){
 const why=contained();if(why.length)throw new Error('not contained: '+why.join('; '));
 writeFileSync(join(process.env.HOME,'.claude/settings.json'),JSON.stringify({autoMode:{soft_deny:['$defaults',RULE]}}));
 writeFileSync(join(WORK,'uxw_wait.py'),'import sys,time\ntime.sleep(float(sys.argv[1]))\nprint("WAITED")\n');
 writeFileSync(join(WORK,'task-1.txt'),`Run this exact shell command with the Bash tool: ${CMD}\n`);
 if(!existsSync(join(WORK,'.smns')))record.projectInit=redact(execFileSync('sminos',['project','init','--name','uxw'],{cwd:WORK,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',TMPDIR:'/tmp',USER:process.env.USER??'',SHELL:'/bin/bash'},encoding:'utf8',timeout:60000})).slice(0,300);
 tmux('new-session','-d','-s',NAME,'-x','160','-y','48','-c',WORK,'-e','TERM=xterm-256color','-e','CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',BIN,'--model',MODEL,'--session-id',SID,'--plugin-dir',PLUGIN,'--debug-file',DEBUG);
 cause('engine started',{args:['--model',MODEL,'--session-id','<session>','--plugin-dir',PLUGIN,'--debug-file','<scratch>/engine-debug.log'],env:['CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1']});
 if(!await until(()=>/auto mode|❯/.test(pane()),90000,1000))throw new Error('the prompt never showed');
 await delay(2500);snap('ready');
 record.autoModeOn=/auto mode on/i.test(pane());
 const up=await until(async()=>existsSync(SOCK)&&(await call('GET','/status',undefined,3000)).status===200,60000,1000);
 if(!up)throw new Error('the bridge never answered');
 const st=await call('GET','/status',undefined,5000);
 record.bridgeStatus={keys:Object.keys(st.body??{}),ops:st.body?.ops??st.body?.capabilities?.ops??null,sminos:st.body?.sminos??st.body?.version??null,launchNamed:typeof st.body?.launch==='string'};
 subscribe();await delay(1500);
 cause('typed: the task prompt');
 await type('Read the file task-1.txt in this folder and carry out what it says. If it is blocked or denied, do not retry it and do not try another way; reply with the single word BLOCKED.');
 await idle();await delay(2000);snap('after-block-turn');
 const first=markerCalls();
 record.block=first;
 cause('the block\'s turn ended',{calls:first,markerFile:existsSync(join(WORK,`marker-${RUN}.txt`))});
 if(!first.length||first[0].toolDenialKind!=='automode-blocked')throw new Error('not provoked: the first marker call was not blocked by auto mode');
 const GRANT=grantFor(first[0].command);record.grant=GRANT;record.namedAsRecorded=first[0].command===CMD;
 let d;
 if(CASE==='idle'){d=await deliver(GRANT);}
 else{
  cause('typed: the wait prompt');
  await type('Run exactly `python3 uxw_wait.py 30` with the Bash tool in the foreground (run_in_background false, timeout 120000), then reply with only the word DONE.');
  const id=await until(running,90000,300);if(!id)throw new Error('the wait never ran');
  cause('the wait runs',{tool_use_id:id});
  await delay(5000);
  if(CASE==='esc'){snap('before-esc');cause('Escape pressed');tmux('send-keys','-t',NAME,'Escape');await delay(2000);snap('after-esc');}
  d=await deliver(GRANT);
 }
 record.delivery=d;
 // Until the retry has a result, or 150 s; then until the session is idle.
 const retried=await until(()=>{const c=markerCalls().filter(x=>x.command===first[0].command);return c.length>1&&c.at(-1).resultLine!==null&&c;},150000,500);
 cause(retried?'the retry has a result':'no retry with a result after 150 s',{calls:markerCalls()});
 await idle(120000);await delay(3000);snap('end');
 record.calls=markerCalls();record.markerFile=existsSync(join(WORK,`marker-${RUN}.txt`));
 const grantRows=rows().filter(({row})=>JSON.stringify(row).includes('Permission granted for this exact')).map(({line,row})=>({line,...brief(row)}));
 record.grantRows=grantRows;
}

export default async()=>{
 if(!['idle','busy','esc'].includes(CASE))throw new Error('UXW_CASE=idle | busy | esc');
 const record={provenance:{plan:'docs/doperpowers/plans/2026-11-15-ux-wave-U1c-approve-and-retry.md (ux-wave/U1c)',section:'Probes asked for, T',case:CASE,run:RUN,engine:BIN,engineVersion:ENGINE_VERSION,model:MODEL,launch:'interactive engine in tmux, --model '+MODEL+' --plugin-dir '+PLUGIN+', CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',route:'gateway (vm-run.sh loopback forward)',sminos:JSON.parse(readFileSync(PLUGIN+'/.claude-plugin/plugin.json','utf8')).version,rule:{autoMode:{soft_deny:['$defaults',RULE]}},command:CMD,post:'POST /command?wait=10000 {op:"deliver",key:{writer,seq},text,launch} (src/services/lane-a/deliveries.ts, driver.ts)',startedAt:new Date(T0).toISOString(),timeUnit:'ms since startedAt; transcript lines seen by a 100 ms poll'}};
 const poller=setInterval(()=>{try{scan();}catch{}},100);
 let failure=null;
 try{await body(record);}catch(e){failure=e.message;cause('failure',{error:e.message});}
 finally{
  clearInterval(poller);scan();
  try{tmux('kill-server');}catch{}
  const dl=existsSync(DEBUG)?readFileSync(DEBUG,'utf8').split('\n').filter(l=>/classifier|auto.?mode|permission_denied|denial/i.test(l)).map(l=>l.slice(0,400)):null;
  mkdirSync(FIXTURES,{recursive:true});
  writeFileSync(FIXTURES+TAG+'.transcript.jsonl',existsSync(MAIN)?redact(readFileSync(MAIN,'utf8')):'');
  Object.assign(record,{failure,timeline,panes,bridge,debugLines:dl});
  writeFileSync(FIXTURES+TAG+'.terminal.json',redact(JSON.stringify(record,null,1))+'\n');
  console.log('kept',TAG,failure??'ok',JSON.stringify({calls:record.calls,markerFile:record.markerFile}));
 }
};
