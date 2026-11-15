// UX wave U8d, probes P1 to P4 (docs/doperpowers/plans/2026-11-15-ux-wave-U8d-terminal-subagents.md, "Probes to
// arrange"; they serve the derivation of a terminal session's subagents' statuses and its "Engine facts" 5, 9, 10, 11):
// what engine 2.1.322 writes to a terminal session's main transcript, to an agent's own file and to its meta when the
// process ends while a background agent runs (P3), when the session is then resumed with orphans (P1), when an agent
// the loop waits for completes, fails or is interrupted (P4), and when the sminos bridge's stop-agent stops one (P2).
// Runs under vm-run.sh like any scenario and starts the interactive engine itself in tmux inside the same namespace (as
// `vm-run.sh term` does: the pinned engine in the scratch work/, auto mode by the scratch home's defaults), typing with
// send-keys. A recorder reads the session's folder every 100 ms and keeps, for each new line of the main transcript and
// of each agent's file and for each change of a meta, the moment it was seen, beside the moments of what the scenario
// caused (the timeline). P2 also keeps the bridge's /events stream (its snapshot's agents and its agent events).
// p5-late, p5-fail: a background parent P launches a nested background agent N (a 20 s sleep; p5-fail: the command
// exits 3 and N reports FAILED) and hands back at once; recorded until N has ended and 15 s more. p5-stopped: P launches N
// (a 51 s sleep) and in the same message runs a 301 s sleep itself; once N's file holds its sleep's call the main loop is told to stop P
// with TaskStop; recorded until N's sleep has ended (or 90 s) and 15 s more, with N's sleep process counted.
// UXW_CASE (p4p-*, p2p-fg: the P4 cases and P2's waited-for agent in print mode, `-p <prompt> --permission-mode auto`, run in the same pane; the
// interrupt there is SIGINT to the engine): p3-hup | p3-term | p3-nested (a background agent waiting for a nested one; the terminal closed) | p1-two | p1-one | p1-shells | p1-shell (two or one background shell commands) | p4-done | p4-fail | p4-interrupt | p2-bg | p2-fg.
// UXW_STALE=1 (P1): the agents' files' mtimes are set 72 h back before the resume (the engine restarts an orphan only
// when its file is younger than 48 h, B:941133 `yi`). UXW_TAG names the fixtures (u8d-<case>[-stale]-r1 by default).
// Kept in fixtures/uxwave/: <tag>.terminal.json (the record), <tag>.transcript.jsonl (the main transcript), and
// <tag>-subagents/ (each agent's file and meta as they stood at the end; each meta's successive contents are in the record).
import {execFileSync} from 'node:child_process';
import {readdirSync,writeFileSync,mkdirSync,existsSync,readFileSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hostname,userInfo} from 'node:os';
import http from 'node:http';
import {redact as harnessRedact} from '../../harness.mjs';
import {BIN,ENGINE_VERSION,FIXTURES,slug,delay} from './uxwave-common-arrivals.mjs';

const CASE=process.env.UXW_CASE??'';
const CASES=['p3-hup','p3-term','p3-nested','p1-two','p1-one','p1-shells','p1-shell','p4-done','p4-fail','p4-interrupt','p4p-done','p4p-fail','p4p-interrupt','p2-bg','p2-fg','p2p-fg','p5-late','p5-fail','p5-stopped'];
const STALE=process.env.UXW_STALE==='1';
const TAG=process.env.UXW_TAG||`u8d-${CASE}${STALE?'-stale':''}-r1`;
const MODEL=process.env.UXW_MODEL||'haiku';
const NAME='u8d-'+process.pid;
const WORK=process.env.PROBE_WORK;
const PLUGIN='/var/lib/devcloud/marketplaces/doperpowers/sminos';
const HOST=hostname();
const redact=t=>harnessRedact(String(t)).split(HOST).join('<host>');
const SID=randomUUID();
const DIR=join(process.env.HOME,'.claude/projects',slug(WORK));
const MAIN=join(DIR,SID+'.jsonl');
const SUB=join(DIR,SID,'subagents');
const SOCK=join(process.env.HOME,'.claude/sminos/bridge',SID+'.sock');
const T0=Date.now();
const ms=()=>Date.now()-T0;
const tmux=(...a)=>execFileSync('tmux',['-L',NAME,...a],{encoding:'utf8'});
const pane=()=>{try{return tmux('capture-pane','-p','-t',NAME);}catch{return '';}};
const type=async text=>{tmux('send-keys','-t',NAME,'-l',text);await delay(400);tmux('send-keys','-t',NAME,'Enter');};
const until=async(test,timeout,step=500)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await test();if(v)return v;await delay(step);}return null;};
const lines=f=>{try{return readFileSync(f,'utf8').split('\n').filter(Boolean);}catch{return [];}};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};

// What a row says about an agent, in brief (the fixture keeps the row whole).
const tags=(s,t)=>[...new Set([...s.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`,'g'))].map(m=>m[1]))];
function brief(r){
 const s=JSON.stringify(r),b={type:r.type};
 for(const k of ['subtype','operation','isMeta','isSidechain','agentId','promptSource','turnOrigin'])if(r[k]!==undefined)b[k]=r[k];
 if(r.attachment?.type)b.attachment=r.attachment.type;
 if(r.attachment?.commandMode)b.commandMode=r.attachment.commandMode;
 if(r.origin)b.origin=r.origin.kind+(r.origin.name?':'+r.origin.name:'');
 const content=Array.isArray(r.message?.content)?r.message.content:[];
 const tr=content.filter(c=>c.type==='tool_result');if(tr.length)b.toolResults=tr.map(c=>({tool_use_id:c.tool_use_id,is_error:c.is_error??null}));
 const tu=content.filter(c=>c.type==='tool_use');if(tu.length)b.toolUses=tu.map(c=>({id:c.id,name:c.name,...(c.input?.run_in_background!==undefined&&{bg:c.input.run_in_background}),...(c.input?.description&&{description:c.input.description}),...(c.input?.task_id&&{task_id:c.input.task_id})}));
 if(r.toolUseResult&&typeof r.toolUseResult==='object')b.toolUseResult={status:r.toolUseResult.status,agentId:r.toolUseResult.agentId,isAsync:r.toolUseResult.isAsync,backgroundTaskId:r.toolUseResult.backgroundTaskId};
 else if(typeof r.toolUseResult==='string')b.toolUseResult=r.toolUseResult.slice(0,200);
 if(s.includes('task-notification')&&s.includes('task-id')){b.taskIds=tags(s,'task-id');b.statuses=tags(s,'status');b.summaries=tags(s,'summary').map(x=>x.slice(0,200));}
 if(r.type==='user'&&typeof r.message?.content==='string')b.text=r.message.content.slice(0,200);
 else if(r.type==='user'){const t=content.filter(c=>c.type==='text').map(c=>c.text).join(' ');if(t)b.text=t.slice(0,200);}
 if(r.timestamp)b.timestamp=r.timestamp;
 return b;
}

// The recorder.
const timeline=[],seen=new Map(),metas={},snapshots=[],panes=[];
function scan(){
 const files=[MAIN];
 try{for(const n of readdirSync(SUB).sort())files.push(join(SUB,n));}catch{}
 for(const f of files){
  const rel=f===MAIN?'main':'subagents/'+f.slice(SUB.length+1);
  if(f.endsWith('.meta.json')){let t;try{t=readFileSync(f,'utf8');}catch{continue;}if(seen.get(f)!==t){seen.set(f,t);let m;try{m=JSON.parse(t);}catch{m={unparsed:t.slice(0,200)};}(metas[rel]??=[]).push({ms:ms(),meta:m});timeline.push({ms:ms(),file:rel,meta:'written',version:metas[rel].length});}continue;}
  if(!f.endsWith('.jsonl')){if(!seen.has(f)){seen.set(f,1);timeline.push({ms:ms(),file:rel,other:'appeared'});}continue;}
  const ls=lines(f),before=seen.get(f)??0;
  if(ls.length>before){for(let i=before;i<ls.length;i++){let r;try{r=JSON.parse(ls[i]);}catch{r={unparsed:true};}timeline.push({ms:ms(),file:rel,line:i+1,...brief(r)});}seen.set(f,ls.length);}
 }
}
const cause=(label,extra={})=>{scan();timeline.push({ms:ms(),cause:label,...extra});console.log(ms(),label);};
const snap=label=>{scan();snapshots.push({label,ms:ms(),lines:Object.fromEntries([...seen].filter(([f])=>f.endsWith('.jsonl')).map(([f,n])=>[f===MAIN?'main':'subagents/'+f.slice(SUB.length+1),n])),metas:Object.fromEntries(Object.entries(metas).map(([k,v])=>[k,v.at(-1).meta]))});panes.push({label,ms:ms(),pane:redact(pane())});};

// The engine.
let enginePid=null;
function start(args,env={}){
 const e=Object.entries(env).flatMap(([k,v])=>['-e',`${k}=${v}`]);
 tmux('new-session','-d','-s',NAME,'-x','160','-y','48','-c',WORK,'-e','TERM=xterm-256color',...e,BIN,'--model',MODEL,...args);
 enginePid=Number(tmux('display-message','-p','-t',NAME,'#{pane_pid}').trim());
 const cmd=readFileSync(`/proc/${enginePid}/cmdline`,'utf8').split('\0')[0];
 if(cmd!==BIN)throw new Error('the pane runs '+cmd+', not the engine');
 timeline.push({ms:ms(),cause:'engine started',args:['--model',MODEL,...args.map(a=>a===SID?'<session>':a)],env:Object.keys(env)});
}
const ready=async()=>{const ok=await until(()=>/auto mode|❯/.test(pane()),90000,1000);await delay(2500);snap('ready');if(!ok)throw new Error('the prompt never showed');};
const idle=async(timeout=180000)=>{await delay(3000);return until(()=>!/esc to interrupt/i.test(pane()),timeout,1500);};
async function end(how){
 const pid=enginePid;
 if(how==='hup'){cause('the terminal closed: tmux kill-server (SIGHUP to the engine)',{pid:'<engine>'});try{tmux('kill-server');}catch{}}
 else{cause('SIGTERM to the engine',{pid:'<engine>'});process.kill(pid,'SIGTERM');}
 const gone=await until(()=>!alive(pid),30000,50);
 cause(gone?'engine gone':'engine still alive after 30 s');
 if(!gone){process.kill(pid,'SIGKILL');await until(()=>!alive(pid),10000,50);cause('engine killed (SIGKILL)');}
 try{tmux('kill-server');}catch{}
}
const waiters=()=>{try{return execFileSync('pgrep',['-f','uxw8d_wait.py'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(Number).filter(p=>{try{return execFileSync('readlink',[`/proc/${p}/cwd`],{encoding:'utf8'}).trim().startsWith(WORK);}catch{return false;}});}catch{return [];}};

// The agents, from their metas.
const agents=()=>{try{return readdirSync(SUB).filter(n=>n.endsWith('.meta.json')).map(n=>{const id=n.slice(6,-10);let m={};try{m=JSON.parse(readFileSync(join(SUB,n),'utf8'));}catch{}return {id,description:m.description,file:join(SUB,'agent-'+id+'.jsonl'),meta:join(SUB,n)};});}catch{return [];}};
const byDesc=d=>agents().find(a=>a.description===d);
const waiting=d=>{const a=byDesc(d);return a&&lines(a.file).some(l=>l.includes('"name":"Bash"')&&l.includes('uxw8d_wait'))&&a;};
const mainHas=s=>lines(MAIN).some(l=>l.includes(s));
const slow=n=>`Run exactly \`python3 uxw8d_wait.py ${n}\` with the Bash tool in the foreground (run_in_background false, timeout 600000), then reply with only the word DONE.`;
const QUICK='Reply with only the word PONG. Use no tools.';
const launch=(calls,bg=true)=>`Call the Agent tool ${calls.length===1?'once':calls.length+' times in one message'}, ${calls.map(([d,p,t])=>`with subagent_type "${t??'general-purpose'}", run_in_background ${bg}, description "${d}" and prompt "${p}"`).join('; and ')}. ${bg?'After the calls return, reply with only the word LAUNCHED and do nothing else; do not wait for the agents.':'When it returns, whatever it says, reply with only the word OK.'}`;

// The bridge (P2): its /events stream, and a command posted as MAWS's lane A driver posts it (driver.ts stopAgent).
const bridge={events:[],otherTypes:{},answers:[]};
function subscribe(){
 const req=http.request({socketPath:SOCK,path:'/events',method:'GET'},res=>{
  let buf='';res.setEncoding('utf8');
  res.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);if(!l.trim())continue;let e;try{e=JSON.parse(l);}catch{continue;}
   if(e.n===undefined)bridge.events.push({ms:ms(),snapshot:true,keys:Object.keys(e),agents:e.agents??null});
   else if(/agent|result|task|stop/i.test(e.type??''))bridge.events.push({ms:ms(),...e});
   else bridge.otherTypes[e.type]=(bridge.otherTypes[e.type]??0)+1;}});
  res.on('end',()=>{bridge.events.push({ms:ms(),streamEnded:true});});
 });
 req.on('error',e=>bridge.events.push({ms:ms(),streamError:e.message}));req.end();
}
const post=(body,path='/command?wait=30000')=>new Promise(resolve=>{const data=JSON.stringify(body);const req=http.request({socketPath:SOCK,path,method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{let t='';res.setEncoding('utf8');res.on('data',d=>t+=d);res.on('end',()=>{let j=null;try{j=JSON.parse(t);}catch{j=t;}resolve({status:res.statusCode,body:j});});});req.on('error',e=>resolve({error:e.message}));req.end(data);});
const getJson=path=>new Promise(resolve=>{const req=http.request({socketPath:SOCK,path,method:'GET'},res=>{let t='';res.setEncoding('utf8');res.on('data',d=>t+=d);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(t)});}catch{resolve({status:res.statusCode,body:t.slice(0,500)});}});});req.on('error',e=>resolve({error:e.message}));req.end();});
// Containment for the plugin's state (uxwave-u3-sminos.mjs's checks).
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

async function body(record){
 writeFileSync(join(WORK,'uxw8d_wait.py'),'import sys,time\ntime.sleep(float(sys.argv[1]))\nprint("WAITED")\n');
 if(CASE==='p3-hup'||CASE==='p3-term'){
  start(['--session-id',SID]);await ready();
  await type(launch([['uxw slow A',slow(100)]]));
  const a=await until(()=>waiting('uxw slow A'),150000);if(!a)throw new Error('the agent never ran its command');
  cause('agent A runs its command',{agent:a.id});
  await idle(60000);await delay(3000);snap('before');
  record.waitersBefore=waiters().length;
  await end(CASE==='p3-hup'?'hup':'term');
  await delay(10000);snap('after');record.waitersAfter=waiters().length;
 }else if(CASE==='p3-nested'){
  start(['--session-id',SID]);await ready();
  const inner=`Call the Agent tool once, in the foreground (run_in_background false), with subagent_type 'general-purpose', description 'uxw nested N' and prompt '${slow(100)}'. When it returns, reply with only the word DONE.`;
  await type(launch([['uxw parent P',inner]]));
  const a=await until(()=>waiting('uxw nested N'),180000);if(!a)throw new Error('the nested agent never ran its command');
  cause('nested agent N runs its command',{parent:byDesc('uxw parent P')?.id,nested:a.id});
  await idle(60000);await delay(3000);snap('before');record.waitersBefore=waiters().length;
  await end('hup');
  await delay(10000);snap('after');record.waitersAfter=waiters().length;
 }else if(CASE.startsWith('p1-')){
  start(['--session-id',SID]);await ready();
  if(CASE==='p1-two'){
   await type(launch([['uxw slow A',slow(60)],['uxw slow B',slow(60)]]));
   const ok=await until(()=>waiting('uxw slow A')&&waiting('uxw slow B'),150000);if(!ok)throw new Error('the agents never ran their commands');
   cause('agents A and B run their commands',{agents:[byDesc('uxw slow A').id,byDesc('uxw slow B').id]});
  }else if(CASE==='p1-shells'||CASE==='p1-shell'){
   const n=CASE==='p1-shells'?2:1;
   await type(`Run ${n===2?'these two commands with the Bash tool, in two calls in one message':'this command with the Bash tool'}, each with run_in_background true: ${['S1','S2'].slice(0,n).map(x=>`\`python3 uxw8d_wait.py 300\` with description "uxw shell ${x}"`).join(', and ')}. Then reply with only the word STARTED and do nothing else.`);
   const ok=await until(()=>{const ids=lines(MAIN).map(l=>{try{return JSON.parse(l).toolUseResult?.backgroundTaskId;}catch{return null;}}).filter(Boolean);return ids.length>=n&&ids;},150000);if(!ok)throw new Error('the shells never started');
   cause('the background shells run',{shells:ok});
  }else{
   await type(launch([['uxw quick Q',QUICK],['uxw slow B',slow(90)]]));
   const ok=await until(()=>{const q=byDesc('uxw quick Q');return waiting('uxw slow B')&&q&&lines(MAIN).some(l=>l.includes(`<task-id>${q.id}</task-id>`));},150000);if(!ok)throw new Error('Q never ended or B never ran');
   cause('Q ended (its notification is in the main transcript) and B runs its command',{agents:[byDesc('uxw quick Q').id,byDesc('uxw slow B').id]});
  }
  await idle(60000);await delay(2000);snap('before');
  await end('term');await delay(5000);snap('ended');
  if(STALE){const t=new Date(Date.now()-72*3600*1000);for(const a of agents()){utimesSync(a.file,t,t);utimesSync(a.meta,t,t);}cause('the agents\' files and metas set to 72 h ago');}
  start(['--resume',SID]);await ready();
  // Until nothing new for 75 s (a restarted agent sleeps 60 to 90 s between its rows), bounded at 360 s.
  const t1=Date.now();let last=timeline.length,quietSince=Date.now();
  while(Date.now()-t1<360000){await delay(1000);scan();if(timeline.length!==last){last=timeline.length;quietSince=Date.now();}else if(Date.now()-quietSince>75000)break;}
  snap('after-resume');
  await type('Reply with only the word AFTER.');await idle(90000);await delay(3000);snap('after-prompt');
  await end('hup');
 }else if(CASE==='p4-done'||CASE==='p4-fail'||CASE==='p4-interrupt'){
  if(CASE==='p4-fail'){mkdirSync(join(WORK,'.claude/agents'),{recursive:true});writeFileSync(join(WORK,'.claude/agents/uxw-broken.md'),'---\nname: uxw-broken\ndescription: A probe\'s agent whose model does not exist.\nmodel: claude-uxw-no-such-model-1\n---\nReply with only the word PONG.\n');}
  start(['--session-id',SID]);await ready();
  if(CASE==='p4-done'){await type(launch([['uxw fg ok',QUICK]],false));await idle(180000);}
  else if(CASE==='p4-fail'){await type(launch([['uxw fg broken','Reply with only the word PONG.','uxw-broken']],false));await idle(240000);}
  else{
   await type(launch([['uxw fg slow',slow(90)]],false));
   const a=await until(()=>waiting('uxw fg slow'),150000);if(!a)throw new Error('the agent never ran its command');
   cause('agent runs its command',{agent:a.id});await delay(3000);snap('before');
   cause('Escape pressed (the person interrupts)');tmux('send-keys','-t',NAME,'Escape');
   await delay(15000);snap('after-escape');await idle(60000);
  }
  await delay(5000);snap('after');
  await type('Reply with only the word AFTER.');await idle(90000);await delay(3000);snap('after-prompt');
  await end('hup');
 }else if(CASE.startsWith('p4p-')){
  if(CASE==='p4p-fail'){mkdirSync(join(WORK,'.claude/agents'),{recursive:true});writeFileSync(join(WORK,'.claude/agents/uxw-broken.md'),'---\nname: uxw-broken\ndescription: A probe\'s agent whose model does not exist.\nmodel: claude-uxw-no-such-model-1\n---\nReply with only the word PONG.\n');}
  const text=CASE==='p4p-done'?launch([['uxw fg ok',QUICK]],false):CASE==='p4p-fail'?launch([['uxw fg broken','Reply with only the word PONG.','uxw-broken']],false):launch([['uxw fg slow',slow(90)]],false);
  start(['-p',text,'--permission-mode','auto','--session-id',SID]);
  const pid=enginePid;
  if(CASE==='p4p-interrupt'){
   const a=await until(()=>waiting('uxw fg slow'),150000);if(!a)throw new Error('the agent never ran its command');
   cause('agent runs its command',{agent:a.id});await delay(3000);snap('before');
   cause('SIGINT to the engine (the interrupt of a print-mode run)');process.kill(pid,'SIGINT');
  }
  const gone=await until(()=>!alive(pid),240000,100);cause(gone?'engine exited':'engine still running after 240 s');
  await delay(5000);snap('after');
  if(!gone)await end('term');
 }else if(CASE==='p5-late'||CASE==='p5-fail'){
  writeFileSync(join(WORK,'uxw8d_fail.py'),'import sys,time\ntime.sleep(float(sys.argv[1]))\nprint("FAILING")\nsys.exit(3)\n');
  const nested=CASE==='p5-late'?`Run exactly \`python3 uxw8d_wait.py 20\` with the Bash tool in the foreground (timeout 600000), then reply with only the word DONE.`:`Run exactly \`python3 uxw8d_fail.py 20\` with the Bash tool in the foreground (timeout 600000). It exits non-zero: then report the failure, replying with only the word FAILED.`;
  const inner=`Call the Agent tool once, with subagent_type 'general-purpose', run_in_background true, description 'uxw nested N' and prompt '${nested}'. As soon as that call returns, hand back at once with only the word LAUNCHED; do not wait for the nested agent and do nothing else.`;
  start(['--session-id',SID]);await ready();
  await type(launch([['uxw parent P',inner]]));
  const n=await until(()=>waiting('uxw nested N')||(byDesc('uxw nested N')&&lines(byDesc('uxw nested N').file).some(l=>l.includes(CASE==='p5-late'?'uxw8d_wait':'uxw8d_fail'))&&byDesc('uxw nested N')),150000);if(!n)throw new Error('N never ran its command');
  cause('N runs its command',{parent:byDesc('uxw parent P')?.id,nested:n.id});
  const metaOf=a=>{try{return JSON.parse(readFileSync(a.meta,'utf8'));}catch{return {};}};
  const pEnded=await until(()=>{const p=byDesc('uxw parent P');return p&&metaOf(p).finished===true;},120000);
  cause(pEnded?'P ended (its meta finished: true)':'P not ended after 120 s');
  const nEnded=await until(()=>metaOf(n).finished===true||lines(n.file).some(l=>l.includes('"type":"assistant"')&&/\b(DONE|FAILED)\b/.test(l)&&!l.includes('tool_use')),150000);
  cause(nEnded?'N ended (meta finished or its final reply)':'N not ended after 150 s');
  await delay(15000);snap('after');
  await end('hup');
 }else if(CASE==='p5-stopped'){
  const nested=`Run exactly \`python3 uxw8d_wait.py 51\` with the Bash tool in the foreground (timeout 600000), then reply with only the word DONE.`;
  const inner=`In ONE message make two tool calls together: the Agent tool with subagent_type 'general-purpose', run_in_background true, description 'uxw nested N' and prompt '${nested}'; and the Bash tool running exactly \`python3 uxw8d_wait.py 301\` in the foreground (timeout 600000). Do not hand back or reply until that Bash call has returned; then reply with only the word DONE.`;
  start(['--session-id',SID]);await ready();
  await type(launch([['uxw parent P',inner]]));
  const has=(d,s)=>{const a=byDesc(d);return a&&lines(a.file).some(l=>l.includes('"name":"Bash"')&&l.includes(s))&&a;};
  const ok=await until(()=>has('uxw nested N','uxw8d_wait.py 51')&&has('uxw parent P','uxw8d_wait.py 301'),180000);if(!ok)throw new Error('N or P never ran its sleep');
  {const m=(()=>{try{return JSON.parse(readFileSync(byDesc('uxw parent P').meta,'utf8'));}catch{return {};}})();if(m.finished)throw new Error('P had already ended before the stop');}
  const P=byDesc('uxw parent P'),N=byDesc('uxw nested N');
  const sleeps=()=>{try{return execFileSync('pgrep',['-af','uxw8d_wait.py'],{encoding:'utf8'}).trim().split('\n').filter(l=>/uxw8d_wait\.py (51|301)\b/.test(l)).map(l=>l.replace(/^\d+\s+/,'').replace(/.*uxw8d_wait\.py /,'sleep '));}catch{return [];}};
  cause('N and P run their sleeps',{parent:P.id,nested:N.id,sleeps:sleeps()});
  await idle(60000);await delay(2000);snap('before');
  cause('typed: stop P with TaskStop');
  await type(`Stop the background agent with id ${P.id} using the TaskStop tool (find it with ToolSearch if it is not loaded). Stop only that one. Then reply with only the word STOPPED.`);
  const t1=Date.now();
  const nFinished=()=>{try{return JSON.parse(readFileSync(N.meta,'utf8')).finished===true;}catch{return false;}};
  while(Date.now()-t1<120000){await delay(5000);timeline.push({ms:ms(),cause:'sleeps alive',sleeps:sleeps()});if(nFinished())break;}
  cause(nFinished()?'N ended (its meta finished: true)':'N not ended 120 s after the stop',{sleeps:sleeps()});
  await delay(15000);snap('after');
  await end('hup');
 }else if(CASE==='p2p-fg'){
  const why=contained();if(why.length)throw new Error('not contained: '+why.join('; '));
  if(!existsSync(join(WORK,'.smns')))record.projectInit=redact(execFileSync('sminos',['project','init','--name','uxw'],{cwd:WORK,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',TMPDIR:'/tmp',USER:process.env.USER??'',SHELL:'/bin/bash'},encoding:'utf8',timeout:60000})).slice(0,500);
  start(['-p',launch([['uxw fg slow',slow(120)]],false),'--permission-mode','auto','--session-id',SID,'--plugin-dir',PLUGIN],{CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1'});
  const pid=enginePid;
  const up=await until(async()=>existsSync(SOCK)&&(await getJson('/status')).status===200,60000,500);
  record.bridgeStatus=up?redact(JSON.stringify((await getJson('/status')).body)).slice(0,2000):'no bridge';
  if(!up)throw new Error('the bridge never answered');
  subscribe();
  const a=await until(()=>waiting('uxw fg slow'),150000);if(!a)throw new Error('the agent never ran its command');
  cause('agent runs its command',{agent:a.id});await delay(3000);
  record.agentsBefore=JSON.parse(redact(JSON.stringify((await getJson('/agents')).body??null)));snap('before');
  cause('POST /command stop-agent',{body:{op:'stop-agent',agentId:a.id}});
  const answer=await post({op:'stop-agent',agentId:a.id});
  cause('stop-agent answered',{answer});bridge.answers.push(answer);
  record.agentsAfter=JSON.parse(redact(JSON.stringify((await getJson('/agents')).body??null)));
  const gone=await until(()=>!alive(pid),180000,100);cause(gone?'engine exited':'engine still running after 180 s');
  await delay(5000);snap('after');if(!gone)await end('term');
 }else if(CASE==='p2-bg'||CASE==='p2-fg'){
  const why=contained();if(why.length)throw new Error('not contained: '+why.join('; '));
  if(!existsSync(join(WORK,'.smns')))record.projectInit=redact(execFileSync('sminos',['project','init','--name','uxw'],{cwd:WORK,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',TMPDIR:'/tmp',USER:process.env.USER??'',SHELL:'/bin/bash'},encoding:'utf8',timeout:60000})).slice(0,500);
  start(['--session-id',SID,'--plugin-dir',PLUGIN],{CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1'});await ready();
  const up=await until(async()=>existsSync(SOCK)&&(await getJson('/status')).status===200,60000,1000);
  record.bridgeStatus=up?redact(JSON.stringify((await getJson('/status')).body)).slice(0,2000):'no bridge';
  if(!up)throw new Error('the bridge never answered');
  subscribe();await delay(1500);
  const desc=CASE==='p2-bg'?'uxw slow A':'uxw fg slow';
  await type(launch([[desc,slow(120)]],CASE==='p2-bg'));
  const a=await until(()=>waiting(desc),150000);if(!a)throw new Error('the agent never ran its command');
  cause('agent runs its command',{agent:a.id});
  if(CASE==='p2-bg')await idle(60000);
  await delay(3000);record.agentsBefore=JSON.parse(redact(JSON.stringify((await getJson('/agents')).body??null)));snap('before');
  cause('POST /command stop-agent',{body:{op:'stop-agent',agentId:a.id}});
  const answer=await post({op:'stop-agent',agentId:a.id});
  cause('stop-agent answered',{answer});bridge.answers.push(answer);
  await delay(20000);snap('after-20s');await idle(120000);await delay(10000);
  record.agentsAfter=JSON.parse(redact(JSON.stringify((await getJson('/agents')).body??null)));snap('after');
  await type('Reply with only the word AFTER.');await idle(90000);await delay(3000);snap('after-prompt');
  await end('hup');
 }
}

export default async()=>{
 if(!CASES.includes(CASE))throw new Error('UXW_CASE='+CASES.join(' | '));
 const record={provenance:{plan:'docs/doperpowers/plans/2026-11-15-ux-wave-U8d-terminal-subagents.md',section:'Probes to arrange',case:CASE,stale:STALE,engine:BIN,engineVersion:ENGINE_VERSION,model:MODEL,launch:'interactive engine in tmux (vm-run.sh term\'s launch), --model '+MODEL+(CASE.startsWith('p2')?' --plugin-dir '+PLUGIN+', CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1':''),route:'gateway (vm-run.sh loopback forward)',startedAt:new Date(T0).toISOString(),timeUnit:'ms since startedAt; file lines seen by a 100 ms poll'}};
 const poller=setInterval(()=>{try{scan();}catch{}},100);
 let failure=null;
 try{await body(record);}catch(e){failure=e.message;cause('failure',{error:e.message});}
 finally{
  clearInterval(poller);scan();
  try{tmux('kill-server');}catch{}
  for(const p of waiters())try{process.kill(p,'SIGTERM');}catch{}
  mkdirSync(FIXTURES,{recursive:true});
  writeFileSync(FIXTURES+TAG+'.transcript.jsonl',existsSync(MAIN)?redact(readFileSync(MAIN,'utf8')):'');
  const subOut=FIXTURES+TAG+'-subagents/';
  if(existsSync(SUB)){mkdirSync(subOut,{recursive:true});for(const n of readdirSync(SUB))writeFileSync(subOut+n,redact(readFileSync(join(SUB,n),'utf8')));}
  Object.assign(record,{failure,agents:agents().map(a=>({id:a.id,description:a.description})),timeline,metas,snapshots,panes,...(CASE.startsWith('p2')&&{bridge})});
  writeFileSync(FIXTURES+TAG+'.terminal.json',redact(JSON.stringify(record,null,1))+'\n');
  console.log('kept',TAG,failure??'ok');
 }
};
