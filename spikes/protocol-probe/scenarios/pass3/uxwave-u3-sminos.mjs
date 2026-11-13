// UX wave U3, probe 3 (U3-transcript-rows.md, "Probes and checks" 3; serves O-41, X-032 and UC-2's `peer`, `own` and
// `answer` classes): what the 2.1.322 wire and the transcript file carry when sminos delivers into a session that loads
// the sminos plugin, by each of its routes. Contained: run only under spikes/protocol-probe/vm-run.sh (without
// --managed), whose scratch HOME gives sminos a private, unenrolled state of its own (SMINOS_HOME defaults to
// $HOME/.claude/sminos: sminos.py root(); the hub is reached only through mawsd's endpoint file under ~/.config, which
// the namespace masks, and an uplink a daemon starts only with daemon/identity.json: sminos_rl10.py path() and its
// head comment). The scenario refuses to run unless those conditions hold, and records `sminos list` before and after.
// The plugin is loaded with --plugin-dir from the VM's marketplace copy, with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (its
// mods, the bridge among them, run only under it; the owner's user settings set it).
//
// Two arms (UXW_ARMS, comma-separated):
//   maws   the target launched as MAWS launches, MAWS_LANE=B and SMNS_MEMBER naming the engine's parent: the bridge
//          observes only, and refuses deliver and steer (bridge.tsx), so sminos falls back to the engine's inbox
//   bridge the same launch without MAWS_LANE: the bridge controls, as in a terminal session or any headless run
// In each arm: the owner's send while idle and while a turn runs (`sminos send` with no CLAUDE_CODE_SESSION_ID: the
// sender is `human`), a peer's send while idle and while busy (the same verb with a session id of its own), and the
// owner's steer while busy and while idle (`sminos steer`).
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,prompt,turn,delay,cost,randomUUID,BIN,ENGINE_VERSION,FIXTURES,slug,U3} from './uxwave-common-arrivals.mjs';
import {redact} from '../../harness.mjs';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,readdirSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {userInfo} from 'node:os';

const SMINOS_PLUGIN='/var/lib/devcloud/marketplaces/doperpowers/sminos';
const ARMS=(process.env.UXW_ARMS||'maws,bridge').split(',').filter(Boolean);
const TAG=process.env.UXW_TAG||'u3-sminos';
const WORK=process.env.PROBE_WORK;
const OWNER_HOME=userInfo().homedir;
const sminosHome=()=>join(process.env.HOME,'.claude/sminos');

// Containment: every condition is checked before any sminos verb runs, and again before each.
function contained(){
 const why=[];
 if(!process.env.HOME?.startsWith('/tmp/')||process.env.HOME.startsWith(OWNER_HOME))why.push('HOME is not a scratch folder');
 for(const k of ['SMINOS_HOME','DAEMON_HOME','AGORA_HOME','SMINOS_RL10','MAWS_USER_DATA','XDG_CONFIG_HOME','MAWS_HOLDER_SOCKET'])if(process.env[k])why.push(k+' is set');
 if(existsSync(join(OWNER_HOME,'.config/MAWS/mawsd/endpoint/rl10.json')))why.push("the owner's mawsd endpoint file is visible (not in vm-run.sh's namespace?)");
 if(existsSync(join(OWNER_HOME,'.claude/sminos')))why.push("the owner's sminos state is visible");
 if(existsSync(join(sminosHome(),'daemon/identity.json')))why.push('the scratch sminos state is enrolled');
 if(existsSync('/etc/claude-code/managed-settings.json'))why.push('managed settings are visible (--managed)');
 return why;
}
const baseEnv=()=>({PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG??'C.UTF-8',TMPDIR:'/tmp',USER:process.env.USER??'',SHELL:'/bin/bash'});
function sminos(p,args,{session=null}={}){
 const why=contained();if(why.length)throw new Error('not contained: '+why.join('; '));
 const env={...baseEnv(),...(session?{CLAUDE_CODE_SESSION_ID:session}:{})};
 let out,code=0;try{out=execFileSync('sminos',args,{cwd:WORK,env,encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});}catch(e){code=e.status??-1;out=(e.stdout??'')+(e.stderr?'\n[stderr] '+e.stderr:'');}
 p.note({event:'sminos',args:args.map(a=>a.length>80?a.slice(0,80)+'…':a),asSession:session,code,output:redact(String(out)).slice(0,3000)});
 return {code,out:String(out)};
}


// The terminal arm (UXW_ARMS=terminal): an interactive engine in tmux with the plugin, as a terminal session on the
// owner's machines runs, for the file route's rows and for the one form a headless target cannot show: an answer to
// sminos's asynchronous question, which rides a later tool result as a hook's added context (ask.tsx). The question
// tool registers only in an interactive session. The request id is read from `sminos watch <session> --json`.
async function terminalArm(){
 const name='py-sminos-'+process.pid;
 const tmux=(...a)=>execFileSync('tmux',['-L',name,...a],{encoding:'utf8'});
 const pane=()=>tmux('capture-pane','-p','-t',name);
 const type=async text=>{tmux('send-keys','-t',name,'-l',text);await delay(400);tmux('send-keys','-t',name,'Enter');};
 const until=async(test,timeout,step=2000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await test();if(v)return v;await delay(step);}return null;};
 const dir=join(process.env.HOME,'.claude/projects',slug(WORK));
 const transcript=()=>existsSync(dir)?readdirSync(dir).filter(n=>n.endsWith('.jsonl')).map(n=>join(dir,n)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0]??null:null;
 const notes=[];const p={note:x=>notes.push({at:new Date().toISOString(),...x})};
 const record={provenance:{...U3,probe:'U3 probe 3 (terminal arm)',engine:BIN,engineVersion:ENGINE_VERSION,launch:'interactive engine in tmux, --model haiku --plugin-dir '+SMINOS_PLUGIN,env:'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',sminosHome:sminosHome()},steps:[],notes};
 if(!existsSync(join(WORK,'.smns')))sminos(p,['project','init','--name','uxw']);
 tmux('new-session','-d','-s',name,'-x','160','-y','48','-c',WORK,'-e','TERM=xterm-256color','-e','CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',BIN,'--model','haiku','--plugin-dir',SMINOS_PLUGIN);
 let lastLine=0,session=null;
 const step=(label,extra={})=>{const t=transcript();const rows=t?rowsOf(t):[];const file=fileArrivals(rows,lastLine);lastLine=rows.length;record.steps.push({step:label,at:new Date().toISOString(),...extra,pane:redact(pane()),file:JSON.parse(redact(JSON.stringify(file)))});console.log('terminal',label,file.length);};
 const busy=()=>/esc to interrupt/i.test(pane());
 const quiet=()=>until(async()=>{if(busy())return false;await delay(3000);return !busy();},180000,2000);
 const FG='R'+'un exactly `python3 -c "import time; time.sleep(25); print(\'UXW-FG-DONE\')"` with the Bash tool in the foreground (run_in_background false), description "uxw foreground". Then reply with only the word DONE, and answer any message that reached you meanwhile in one short sentence.';
 try{
  await until(()=>/auto mode|❯/.test(pane()),60000);await delay(3000);
  await type('Without using any tool, reply with only the word READY.');await delay(5000);await quiet();
  session=transcript()?.split('/').pop().replace('.jsonl','')??null;step('warm',{session});
  sminos(p,['list','--json']);
  sminos(p,['send',session,'UXW owner idle: reply with only the word ONE.']);await delay(6000);await quiet();step('owner-idle');
  sminos(p,['send',session,'UXW peer idle: reply with only the word TWO.'],{session:randomUUID()});await delay(6000);await quiet();step('peer-idle');
  await type(FG);await until(busy,30000,1000);await delay(6000);sminos(p,['send',session,'UXW owner busy: also say THREE.']);await delay(5000);await quiet();step('owner-busy');
  await type(FG);await until(busy,30000,1000);await delay(6000);sminos(p,['steer',session,'UXW steer busy: also say FIVE.']);await delay(5000);await quiet();step('steer-busy');
  // the asynchronous question, answered while a later foreground command runs
  const watch=spawn('sminos',['watch',session,'--json'],{cwd:WORK,env:baseEnv(),stdio:['ignore','pipe','pipe']});
  let buf='',events=[];watch.stdout.setEncoding('utf8');watch.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);try{events.push(JSON.parse(l));}catch{}}});
  await type('Ask me with your question tool, async true (do not wait for the answer), which fruit I prefer, options Apple and Mango. Then r'+FG.slice(1)+' If my answer reached you, say which fruit I chose.');
  const asked=await until(()=>events.find(e=>JSON.stringify(e.input??'').includes('questions')&&e.request),90000,1000);
  p.note({event:'ask_raised',request:asked?.request??null,tool:asked?.tool??null});
  await until(busy,60000,1000);await until(()=>/UXW-FG|python3/.test(pane()),60000,1000);await delay(4000);
  if(asked)sminos(p,['answer',session,asked.request,'mango']);
  await delay(8000);await quiet();step('ask-async-answered',{request:asked?.request??null});
  watch.kill();
  sminos(p,['list','--json']);
 }finally{
  const t=transcript();record.transcript=t?keepTranscript(t,TAG+'-terminal').replace(FIXTURES,'fixtures/uxwave/'):null;
  mkdirSync(FIXTURES,{recursive:true});writeFileSync(FIXTURES+TAG+'-terminal.terminal.json',redact(JSON.stringify(record,null,1))+'\n');
  try{tmux('kill-server');}catch{}
 }
}

export default async()=>{
 const why=contained();if(why.length)throw new Error('refusing to run, not contained: '+why.join('; '));
 for(const arm of ARMS){
  if(arm==='terminal'){await terminalArm();continue;}
  await mawsLaunch(TAG+'-'+arm,{model:process.env.UXW_MODEL||'haiku',spendCap:'1.50',lane:arm==='maws',flags:['--plugin-dir',SMINOS_PLUGIN],env:{CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1'},provenance:{probe:'U3 probe 3',arm,plugin:SMINOS_PLUGIN,sminosHome:sminosHome()}},async(p,{sessionId,transcript})=>{
   let lastLine=0;
   const record=(name,from,extra={})=>{const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);lastLine=rows.length;const wire=wireArrivals(p,from);p.note({event:'uxw_case',case:name,arm,fromSeq:from,toSeq:p.seq,...extra,wire,file});console.log(arm,name,JSON.stringify({wireUser:wire.filter(w=>w.type==='user'&&!w.isReplay||w.type==='user'&&w.origin?.kind!=='human').map(w=>[w.seq,w.origin?.kind]),file:file.length}));};
   const peer=randomUUID();
   if(!existsSync(join(WORK,'.smns')))sminos(p,['project','init','--name','uxw']);
   let from=p.seq;await turn(p,'Without using any tool, reply with only the word READY.');await idle(p,60000,3000);record('warm',from);
   sminos(p,['list','--json']);
   const send=(text,session)=>sminos(p,['send',sessionId,text],{session});
   const idleCase=async(name,act)=>{const from=p.seq;act();await waitFor(p,f=>f.type==='result',{after:from,timeout:60000});await idle(p,60000,4000);record(name,from);};
   const busyCase=async(name,act)=>{const from=p.seq;prompt(p,'R'+'un exactly `python3 -c "import time; time.sleep(25); print(\'UXW-FG-DONE\')"` with the Bash tool in the foreground (run_in_background false), description "uxw foreground"'+'. Then reply with only the word DONE, and answer any message that reached you meanwhile in one short sentence.');
    await waitFor(p,f=>f.type==='system'&&f.subtype==='task_started'||f.type==='assistant'&&JSON.stringify(f.message?.content??'').includes('uxw foreground'),{after:from,timeout:60000});await delay(5000);act();
    await waitFor(p,f=>f.type==='result',{after:from,timeout:120000});await idle(p,90000,4000);record(name,from);};
   await idleCase('owner-idle',()=>send('UXW owner idle: reply with only the word ONE.',null));
   await idleCase('peer-idle',()=>send('UXW peer idle: reply with only the word TWO.',peer));
   await busyCase('owner-busy',()=>send('UXW owner busy: also say THREE.',null));
   await busyCase('peer-busy',()=>send('UXW peer busy: also say FOUR.',peer));
   await busyCase('steer-busy',()=>sminos(p,['steer',sessionId,'UXW steer busy: also say FIVE.']));
   await idleCase('steer-idle',()=>sminos(p,['steer',sessionId,'UXW steer idle: reply with only the word SIX.']));
   sminos(p,['list','--json']);
   keepTranscript(transcript,TAG+'-'+arm);
   console.log(arm,'cost',cost(p));
  });
 }
};
