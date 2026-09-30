// C12 M5 (docs/doperpowers/plans/2026-09-29-c12-finish.md, M5 task 2 and Concrete Steps "M5 probe"; child C12 of
// docs/charter.md): the launch-environment probe. It asks whether MAWS's print-mode launch behaves as the owner's
// terminal does with and without CLAUDE_CODE_FORK_SUBAGENT and CLAUDE_CODE_ENABLE_TODO_TOOLS, and whether
// CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS changes anything but the session_state_changed frames.
//
// Every launch runs the pinned binary by absolute path under the scratch config home the shell exported
// (CLAUDE_CONFIG_DIR under /private/tmp/maws-c12-probe-*, `{}` settings), with the owner's default model (PROBE_MODEL,
// read from ~/.claude/settings.json by the caller) and no subagent-model override on both halves. The environment is
// built from nothing, the way X6's buildEnvironment builds it (src/engine-host/launch.ts), so neither this shell's
// Claude session variables nor the owner's settings reach the engine: the base keys, the relay and its marker token,
// the owner's model aliases (their settings set them; without them `opus` resolves to another model and the task-tool
// allowlist answers differently), and the variable under test. The print half adds the product's own constants
// (CLAUDE_CODE_ENTRYPOINT sdk-ts from the harness, file checkpointing, TERM dumb); the terminal half is an interactive
// PTY, as the owner's terminal is.
//
// The instrument both halves share is a loopback forwarder in front of the relay: the engine's ANTHROPIC_BASE_URL points
// at it, and it records, per API request, the model, the tool names (with their deferral), the Agent tool's input
// schema, the system prompt's lines about forking, and the token usage the response reports. Nothing else is kept: no
// headers, no message bodies. It forwards the request unchanged except for `accept-encoding`, dropped so the usage in
// the event stream can be read.
import {createServer,request as httpRequest} from 'node:http';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync,appendFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {root,scratch,redact,delay} from '../../harness.mjs';
import {launch,initPayload,assertScratch,RELAY_ENV,records,slug,BIN,endAsStop} from './c10-common.mjs';

export const PROVENANCE={charter:'docs/charter.md',child:'C12',document:'docs/doperpowers/plans/2026-09-29-c12-finish.md',pin:'ec7eb8091c3344f7c28a53f0f7800ad9f67df211',milestone:'M5'};
export const PROMPT='Use a subagent to list the files here, then make a two-item task list';
export const MODEL=process.env.PROBE_MODEL;
export const RELAY=RELAY_ENV.ANTHROPIC_BASE_URL;
const REPO_ROOT=realpathSync(root+'../..');
// The launch flags X6 adds to the harness's (`ENGINE_FLAGS`): the harness already passes the rest of the set.
export const PRODUCT_FLAGS=['--forward-subagent-text','--replay-user-messages','--include-hook-events','--settings',JSON.stringify({dialogExpiry:'never'})];
export const SPEND_CAP_PER_LAUNCH='0.60'; // the probe's own guard (D3 keeps the flag off the product's launch); M5's budget is US$3
export const VARIABLES=['CLAUDE_CODE_FORK_SUBAGENT','CLAUDE_CODE_ENABLE_TODO_TOOLS','CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS'];

// The scratch root the shell exported, checked before anything spawns; read once, before clearEnvironment() drops it.
let scratchCache=null;
export function scratchRoot(){
 if(scratchCache)return scratchCache;
 const home=process.env.CLAUDE_CONFIG_DIR??'';const base=process.env.C12??'';
 if(!/^\/private\/tmp\/maws-c12-probe-[0-9]+$/.test(base)||home!==base+'/config')throw new Error('export C12=/private/tmp/maws-c12-probe-<stamp> and CLAUDE_CONFIG_DIR=$C12/config first (Concrete Steps, M5 probe)');
 if(readFileSync(home+'/settings.json','utf8').trim()!=='{}')throw new Error('the scratch settings.json must be {}');
 if(!MODEL)throw new Error('PROBE_MODEL is the owner\'s default model, read from ~/.claude/settings.json');
 assertScratch({CLAUDE_CONFIG_DIR:home});
 return scratchCache={base,home};
}

// The owner's model aliases, captured once before the environment is cleared.
const ALIASES=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>/^ANTHROPIC_DEFAULT_[A-Z]+_MODEL$/.test(k)&&v));
const BASE_KEYS=['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG'];
// Clears this process's environment to the base keys, so the harness (which copies process.env) adds only what a
// scenario names; called before every launch.
export function clearEnvironment(){for(const k of Object.keys(process.env))if(!BASE_KEYS.includes(k)&&!k.startsWith('LC_'))delete process.env[k];}
export function engineEnv({home,forwarder,vars,terminal=false}){
 const env={CLAUDE_CONFIG_DIR:home,...ALIASES,ANTHROPIC_BASE_URL:forwarder,ANTHROPIC_AUTH_TOKEN:RELAY_ENV.ANTHROPIC_AUTH_TOKEN,ENABLE_TOOL_SEARCH:'true',...vars};
 if(terminal)return {...Object.fromEntries(BASE_KEYS.filter(k=>process.env[k]).map(k=>[k,process.env[k]])),TERM:'xterm-256color',...env};
 return {...env,CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',TERM:'dumb'};
}

// ---------------------------------------------------------------------------------------------------------------------
// The forwarder

const FORK_LINE=/\bfork/i;
const textOfSystem=s=>typeof s==='string'?s:Array.isArray(s)?s.map(b=>b?.text??'').join('\n'):'';
function summarizeRequest(body){
 let j;try{j=JSON.parse(body);}catch{return {parsed:false};}
 const tools=Array.isArray(j.tools)?j.tools:[];
 const agent=tools.find(t=>t.name==='Agent'||t.name==='Task');
 const system=textOfSystem(j.system);
 return {parsed:true,model:j.model??null,tools:tools.map(t=>t.defer_loading?t.name+' (deferred)':t.name),toolsSha256:createHash('sha256').update(JSON.stringify(tools)).digest('hex'),agentToolName:agent?.name??null,agentSchema:agent?.input_schema??null,forkLines:system.split('\n').filter(l=>FORK_LINE.test(l)).map(l=>l.slice(0,400)).slice(0,8),systemChars:system.length,messages:Array.isArray(j.messages)?j.messages.length:0};
}
function usageOf(text){
 const u={};for(const line of text.split('\n')){if(!line.startsWith('data: '))continue;let d;try{d=JSON.parse(line.slice(6));}catch{continue;}
  if(d.type==='message_start'&&d.message?.usage)Object.assign(u,d.message.usage);
  if(d.type==='message_delta'&&d.usage)Object.assign(u,d.usage);}
 if(Object.keys(u).length===0){try{const j=JSON.parse(text);if(j.usage)Object.assign(u,j.usage);}catch{}}
 const pick=k=>typeof u[k]==='number'?u[k]:0;
 return {input:pick('input_tokens'),cacheWrite:pick('cache_creation_input_tokens'),cacheRead:pick('cache_read_input_tokens'),output:pick('output_tokens')};
}
export async function startForwarder(){
 const target=new URL(RELAY);const requests=[];let inFlight=0;let lastActivity=Date.now();
 const server=createServer((req,res)=>{
  inFlight+=1;lastActivity=Date.now();const chunks=[];
  req.on('data',c=>chunks.push(c));
  req.on('end',()=>{
   const body=Buffer.concat(chunks);const isMessages=req.method==='POST'&&/\/v1\/messages(\?|$)/.test(req.url);
   const entry={n:requests.length+1,at:new Date().toISOString(),method:req.method,path:req.url.split('?')[0],...(isMessages?summarizeRequest(body.toString('utf8')):{})};
   requests.push(entry);
   const headers={...req.headers,host:target.host,'content-length':String(body.length)};delete headers['accept-encoding'];
   const up=httpRequest({host:target.hostname,port:target.port,method:req.method,path:req.url,headers},upRes=>{
    res.writeHead(upRes.statusCode??502,upRes.headers);entry.status=upRes.statusCode;let text='';
    upRes.on('data',c=>{if(isMessages&&text.length<4_000_000)text+=c.toString('utf8');res.write(c);lastActivity=Date.now();});
    upRes.on('end',()=>{res.end();if(isMessages)entry.usage=usageOf(text);inFlight-=1;lastActivity=Date.now();});
    upRes.on('error',()=>{res.end();inFlight-=1;});
   });
   up.on('error',e=>{entry.error=e.message;res.writeHead(502);res.end();inFlight-=1;lastActivity=Date.now();});
   up.end(body);
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,requests,quietFor:()=>inFlight>0?0:Date.now()-lastActivity,close:()=>new Promise(r=>server.close(()=>r()))};
}
// What the forwarder saw, as notes: every request in brief, and the Agent schema and fork lines once per distinct value.
export function noteRequests(note,requests){
 const seen=new Set();
 for(const r of requests){
  const {agentSchema,forkLines,...rest}=r;const key=JSON.stringify([agentSchema,forkLines]);
  note({event:'api_request',...rest,...(seen.has(key)?{agentSchemaAsBefore:true}:{agentSchema,forkLines})});seen.add(key);
 }
}

// ---------------------------------------------------------------------------------------------------------------------
// The print half

const blocks=f=>Array.isArray(f.message?.content)?f.message.content:[];
const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(b=>typeof b==='string'?b:b.type==='text'?b.text:b.type==='tool_result'?textOf(b.content):'').join('\n'):'';
const TASK_TOOLS=['TaskCreate','TaskUpdate','TaskList','TaskGet','TodoWrite'];
// What a transcript's (or a stream's) main-thread records say about the Agent dispatches and the task list.
export function observe(messages){
 const uses=messages.filter(m=>m.type==='assistant'&&!m.parent_tool_use_id&&!m.isSidechain).flatMap(m=>blocks(m).filter(b=>b.type==='tool_use'));
 const results=new Map(messages.filter(m=>m.type==='user'&&!m.isSidechain).flatMap(m=>blocks(m).filter(b=>b.type==='tool_result')).map(b=>[b.tool_use_id,textOf(b.content)]));
 const agents=uses.filter(b=>b.name==='Agent'||b.name==='Task').map(b=>{const r=results.get(b.id)??null;return {tool:b.name,inputKeys:Object.keys(b.input??{}).sort(),subagent_type:b.input?.subagent_type??null,run_in_background:b.input?.run_in_background??null,ranInBackground:r===null?null:/Async agent launched|working in the background/i.test(r),resultHead:r===null?null:r.slice(0,160)};});
 return {agents,taskTools:uses.filter(b=>TASK_TOOLS.includes(b.name)).map(b=>b.name),toolsUsed:[...new Set(uses.map(b=>b.name))]};
}

const sys=(f,subtype)=>f.type==='system'&&f.subtype===subtype;
async function settle(p,{timeout=300_000,quiet=10_000}={}){
 const opened=()=>p.frames.filter(r=>sys(r.frame,'init')).length>p.frames.filter(r=>r.frame.type==='result').length;
 const running=()=>{const started=new Set(p.frames.filter(r=>sys(r.frame,'task_started')).map(r=>r.frame.task_id));for(const r of p.frames)if(sys(r.frame,'task_notification'))started.delete(r.frame.task_id);return started.size;};
 const end=Date.now()+timeout;
 while(Date.now()<end){if(!opened()&&running()===0){await delay(quiet);if(!opened()&&running()===0)return true;}else await delay(1000);}
 p.note({event:'settle_timeout',open:opened(),running:running()});return false;
}

// One print-mode arm: the product's launch with `vars` added, one turn of PROMPT, allowed tools, settle, then stop.
export async function printArm(name,vars){
 const {base,home}=scratchRoot();clearEnvironment();
 const forwarder=await startForwarder();
 const cwd=realpathSync(scratch(`${base}/repo-${name}-`));
 const env=engineEnv({home,forwarder:forwarder.url,vars});
 let summary;
 try{
  const {p}=await launch(name,{cwd,env,model:MODEL,flags:[...PRODUCT_FLAGS,'--max-budget-usd',SPEND_CAP_PER_LAUNCH],provenance:{...PROVENANCE,arm:vars,envKeys:Object.keys(env).sort()}},async p=>{
   p.on('can_use_tool',r=>{p.note({event:'allowed',tool:r.tool_name});return {behavior:'allow',updatedInput:r.input};});
   await p.init(initPayload());
   await p.turn(PROMPT);
   await settle(p);
   const init=p.frames.find(r=>sys(r.frame,'init'))?.frame;
   const cost=Math.max(0,...p.frames.filter(r=>r.frame.type==='result').map(r=>r.frame.total_cost_usd??0));
   summary={arm:vars,model:init?.model,tools:init?.tools,agents:init?.agents,...observe(p.frames.filter(r=>r.direction==='in').map(r=>r.frame)),backgroundedStarts:p.frames.filter(r=>sys(r.frame,'task_started')&&r.frame.task_type==='local_agent').map(r=>({subagent_type:r.frame.subagent_type,is_backgrounded:r.frame.is_backgrounded})),total_cost_usd:cost,modelUsage:p.frames.filter(r=>r.frame.type==='result').at(-1)?.frame.modelUsage??null};
   noteRequests(e=>p.note(e),forwarder.requests);
   p.note({event:'launch_env_observation',...summary});
   await endAsStop(p);
  });
 }finally{await forwarder.close();}
 console.log(name,JSON.stringify({model:summary?.model,agents:summary?.agents,taskTools:summary?.taskTools,cost:summary?.total_cost_usd}));
 return summary;
}

// ---------------------------------------------------------------------------------------------------------------------
// The terminal half

// eslint-disable-next-line no-control-regex -- the terminal's escape sequences are what this strips
const ANSI=/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g;
// The pinned binary run interactively in a PTY under the same scratch home, with the same model, the same prompt and no
// subagent-model override, as the owner's terminal runs it (neither variable: the owner's shell sets neither, checked
// separately). Onboarding and the folder's trust are answered in the scratch home's `.claude.json` first, as C7's
// terminalSession does. The run is recorded as a meta-only fixture in the probe's row format: its provenance, the spawn,
// what the forwarder saw, what the transcript the terminal wrote says, and the PTY's exit.
export async function terminalArm(name){
 const {base,home}=scratchRoot();clearEnvironment();
 const forwarder=await startForwarder();
 const cwd=realpathSync(scratch(`${base}/repo-${name}-`));
 const claudeJson=join(home,'.claude.json');
 const state=existsSync(claudeJson)?JSON.parse(readFileSync(claudeJson,'utf8')):{};
 writeFileSync(claudeJson,JSON.stringify({...state,hasCompletedOnboarding:true,theme:'light',projects:{...state.projects,[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}},null,2));
 const env=engineEnv({home,forwarder:forwarder.url,vars:{},terminal:true});
 const file=root+'fixtures/pass3/'+name+'.jsonl';writeFileSync(file,'');let seq=0;
 const note=frame=>appendFileSync(file,redact(JSON.stringify({seq:++seq,direction:'meta',at:new Date().toISOString(),frame}))+'\n');
 note({event:'provenance',...PROVENANCE,arm:'terminal',envKeys:Object.keys(env).sort(),configHome:home});
 const args=['--model',MODEL];
 const pty=createRequire(join(REPO_ROOT,'package.json'))('node-pty');
 const term=pty.spawn(BIN,args,{name:'xterm-256color',cols:140,rows:45,cwd,env});
 note({event:'spawn',pid:term.pid,cwd,bin:BIN,args,interactive:true});
 let screen='';term.onData(d=>{screen+=d;});
 const exited=new Promise(resolve=>term.onExit(e=>resolve(e)));
 const plain=()=>screen.replace(ANSI,'');
 const waitFor=async(re,ms,what)=>{for(const until=Date.now()+ms;Date.now()<until;await delay(250))if(re.test(plain()))return;throw new Error(`the terminal never showed ${what}`);};
 const approvals=[];let exit=null;
 try{
  await waitFor(/for shortcuts|❯/,60_000,'its prompt');
  await delay(1500);term.write(PROMPT);await delay(500);term.write('\r');
  // Done when the forwarder has been quiet for 25 s after the main loop answered at least twice (the dispatch and the
  // turn after it); a permission question, if one appears, is answered with its default (Yes) and recorded.
  const until=Date.now()+8*60_000;let answered=0;
  while(Date.now()<until){
   await delay(1000);
   const asks=(plain().match(/Do you want to (proceed|make this edit|create)/g)??[]).length;
   if(asks>answered){answered=asks;approvals.push(plain().slice(-600));term.write('\r');continue;}
   const main=forwarder.requests.filter(r=>r.agentToolName!==null&&r.agentToolName!==undefined&&r.status===200).length;
   if(main>=2&&forwarder.quietFor()>25_000)break;
  }
  term.write('/exit');await delay(500);term.write('\r');
  exit=await Promise.race([exited,delay(20_000).then(()=>null)]);
 }finally{
  if(exit===null){term.kill();exit=await Promise.race([exited,delay(5000).then(()=>({exitCode:null,signal:'killed'}))]);}
  await forwarder.close();
 }
 const dir=join(home,'projects',slug(cwd));
 const newest=existsSync(dir)?readdirSync(dir).filter(f=>f.endsWith('.jsonl')).sort((a,b)=>statSync(join(dir,b)).mtimeMs-statSync(join(dir,a)).mtimeMs)[0]:undefined;
 const transcript=newest?records(join(dir,newest)):[];
 noteRequests(note,forwarder.requests);
 const summary={arm:'terminal',sessionId:newest?.replace(/\.jsonl$/,'')??null,models:[...new Set(transcript.filter(r=>r.type==='assistant').map(r=>r.message?.model))],...observe(transcript.map(r=>({...r,parent_tool_use_id:null}))),approvals:approvals.length,usage:forwarder.requests.map(r=>({model:r.model,...r.usage}))};
 note({event:'launch_env_observation',...summary});
 note({event:'screen_tail',text:plain().slice(-3000)});
 note({event:'exit',code:exit?.exitCode??null,signal:exit?.signal??null});
 console.log(name,JSON.stringify({agents:summary.agents,taskTools:summary.taskTools,exit}));
 return summary;
}
export {randomUUID,mkdirSync};
