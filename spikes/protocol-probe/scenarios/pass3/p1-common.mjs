// E0a, the P1 engine probes (docs/doperpowers/plans/2026-10-05-p1-extension.md §9 E0a, §4 S3 and S4; parent pin
// f11ae359af82c86831f052140683ed620dd25500). The helpers the p1-* scenarios share.
//
// Every launch runs the installed engine (the realpath of ~/.local/bin/claude at module load, recorded in the
// provenance row with its --version) by absolute path with MAWS's launch line (src/engine-host/launch.ts: ENGINE_FLAGS,
// `--settings {"dialogExpiry":"never"}`, buildEnvironment's constants, the relay and its marker token) and MAWS's
// initialize payload (src/shared/engine/initialize.ts plus the workspace trust attestation for the cwd), under a
// scratch CLAUDE_CONFIG_DIR under /tmp that the run creates and deletes. The environment is built from nothing, so
// neither this shell's Claude session variables nor the owner's settings reach the engine; DISABLE_AUTOUPDATER=1.
// Probe guards that MAWS does not pass: `--max-budget-usd` and `--debug-file`.
//
// Standing rules (the E0a brief): the relay must answer GET /api/hello with 200 before a launch (a 503 is transient:
// wait two minutes, retry once); the owner's ~/.claude.json is read-only and its /tmp project keys must be the same
// set before and after every live run (spec A-15: a delta, never an empty set); every process is stopped.
import {run as harnessRun,scratch,delay} from '../../harness.mjs';
import {assertScratch,RELAY_ENV,records,slug,success,check,endAsStop,initFrame,answer,stat} from './c10-common.mjs';
import {clearEngineEnvironment} from './mods-environment.mjs';
import {appInitialize} from '../../../../src/shared/engine/initialize.ts';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export {delay,randomUUID,join,existsSync,writeFileSync,mkdirSync,records,slug,success,check,endAsStop,initFrame,answer,stat};

export const BIN=realpathSync(join(homedir(),'.local/bin/claude'));
export const ENGINE_VERSION=execFileSync(BIN,['--version'],{encoding:'utf8',timeout:15000}).trim().split(/\s+/)[0];
export const PROVENANCE={charter:'docs/charter.md',child:'E0a',pin:'f11ae359af82c86831f052140683ed620dd25500',document:'docs/doperpowers/plans/2026-10-05-p1-extension.md',spike:'E0a',engine:BIN,engineVersion:ENGINE_VERSION};
// MAWS's flags beyond the harness's own (launch.ts ENGINE_FLAGS less what harness.mjs already passes), and its --settings.
const PRODUCT_FLAGS=['--forward-subagent-text','--replay-user-messages','--include-hook-events','--settings',JSON.stringify({dialogExpiry:'never'})];
const SPEND_CAP='0.30';
export const initPayload=cwd=>appInitialize({accepted:true,directory:cwd});
const RELAY_HELLO='http://127.0.0.1:8641/api/hello';
const OWNER_GLOBAL_CONFIG=join(homedir(),'.claude.json');

// The relay gate: 200, or one retry after two minutes on a 503.
export async function relayReady(){
 for(let attempt=0;attempt<2;attempt++){
  let status;try{status=(await fetch(RELAY_HELLO)).status;}catch(e){status=e.message;}
  if(status===200)return;
  if(status===503&&attempt===0){console.error('relay answered 503; waiting two minutes before the one retry');await delay(120000);continue;}
  throw new Error('relay not ready: GET /api/hello answered '+status);
 }
}

// The owner-file delta (spec A-15): the /tmp and /private/tmp project keys of the owner's ~/.claude.json.
export function ownerTmpKeys(){const d=JSON.parse(readFileSync(OWNER_GLOBAL_CONFIG,'utf8'));return Object.keys(d.projects||{}).filter(k=>k.startsWith('/tmp')||k.startsWith('/private/tmp')).sort();}
const digest=keys=>createHash('sha1').update(keys.join('\n')).digest('hex').slice(0,12);

// A scratch run: its root under /tmp holding the config home, the repository the session runs in and the debug log.
export function scratchRun(label,{settings={},globalConfig={}}={}){
 const root=realpathSync(mkdtempSync(`/tmp/maws-e0a-${label}-`));
 const home=join(root,'config');mkdirSync(home);
 const cwd=realpathSync(scratch(join(root,'repo-')));
 writeFileSync(join(home,'settings.json'),JSON.stringify(settings)+'\n');
 writeFileSync(join(home,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}},...globalConfig})+'\n');
 return {root,home,cwd,debugFile:join(root,'debug.log')};
}
export const removeRun=run=>rmSync(run.root,{recursive:true,force:true});
export const transcriptPath=(run,id)=>join(run.home,'projects',slug(run.cwd),id+'.jsonl');
export const projectFiles=run=>{const dir=join(run.home,'projects',slug(run.cwd));return existsSync(dir)?readdirSync(dir).sort():[];};

// Clears this process's environment to the base keys (the harness copies process.env), then builds MAWS's.
function engineEnv(home,vars){
 clearEngineEnvironment();
 return {CLAUDE_CONFIG_DIR:home,...RELAY_ENV,ENABLE_TOOL_SEARCH:'true',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',TERM:'dumb',DISABLE_AUTOUPDATER:'1',...vars};
}

// The engine's debug lines about the probed features, copied into the fixture (redacted by the harness).
const DEBUG_RE=/mcp|sdk|side.?question|fork|preview|AskUserQuestion|question/i;
function noteDebug(p,file){
 if(!existsSync(file))return p.note({event:'debug_lines',file:null});
 const lines=readFileSync(file,'utf8').split('\n').filter(l=>DEBUG_RE.test(l)).map(l=>l.slice(0,400));
 p.note({event:'debug_lines',count:lines.length,lines:lines.slice(0,120)});
}

// A one-line summary of a transcript record (the lineage and threading keys the questions ask about, plus a text head).
export function summarise(r){
 const c=r.message?.content;
 const text=typeof c==='string'?c.slice(0,80):Array.isArray(c)?c.map(b=>b.type==='text'?b.text.slice(0,80):b.type==='tool_use'?'tool_use:'+b.name:b.type==='tool_result'?'tool_result:'+(b.is_error?'error':'ok'):b.type).join('|'):undefined;
 const out={type:r.type,subtype:r.subtype,uuid:r.uuid,parentUuid:r.parentUuid,sessionId:r.sessionId,isSidechain:r.isSidechain,text};
 for(const k of ['forkedFrom','forkedFromSessionId','parentSessionId','logicalParentUuid','forkOrigin','querySource','agentId','isMeta','isReplay','sourceToolAssistantUUID','version','userType','entrypoint'])if(r[k]!==undefined)out[k]=r[k];
 return out;
}
export const topLevelKeys=recs=>[...new Set(recs.flatMap(r=>Object.keys(r)))].sort();
// The tool_result blocks the engine echoed back as user frames (what the model saw), with the engine's meta.
export const toolResults=p=>p.frames.filter(r=>r.frame.type==='user'&&Array.isArray(r.frame.message?.content)).flatMap(r=>r.frame.message.content.filter(b=>b.type==='tool_result').map(b=>({seq:r.seq,tool_use_id:b.tool_use_id,is_error:b.is_error??false,content:b.content,meta:r.frame.tool_result_meta??null})));
export const toolUses=p=>p.frames.filter(r=>r.frame.type==='assistant'&&!r.frame.parent_tool_use_id).flatMap(r=>(r.frame.message?.content||[]).filter(b=>b.type==='tool_use').map(b=>({seq:r.seq,id:b.id,name:b.name,input:b.input})));
export const lastResult=p=>p.frames.filter(r=>r.frame.type==='result').at(-1)?.frame??null;
export const resultSummary=r=>r?{subtype:r.subtype,is_error:r.is_error,num_turns:r.num_turns,total_cost_usd:r.total_cost_usd,terminal_reason:r.terminal_reason??null}:null;

// One launch as MAWS launches, with `vars` added to the environment and `flags` after MAWS's; the body gets the probe.
// Handlers answer every engine→host request the protocol can send besides the ones a scenario registers itself, so a
// recording never leaves one open. Throws when the scenario body failed, the engine exited non-zero or the owner-file
// delta is not empty.
export async function launch(name,run,{vars={},sessionId=randomUUID(),provenance={},model='haiku',flags=[],debugFile=run.debugFile}={},body){
 const env=engineEnv(run.home,vars);
 const {configHome,globalConfig}=assertScratch(env);
 await relayReady();
 const before=ownerTmpKeys();
 let failure;
 const p=await harnessRun(name,async p=>{
  p.note({event:'provenance',...PROVENANCE,...provenance,model,configHome,globalConfig,pinnedSessionId:sessionId,envKeys:Object.keys(env).sort(),extraFlags:flags,settings:JSON.parse(readFileSync(join(run.home,'settings.json'),'utf8'))});
  p.note({event:'owner_file_check',phase:'before',count:before.length,digest:digest(before)});
  p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});
  p.on('elicitation',r=>{p.note({event:'elicitation_seen',request:r});return {action:'decline'};});
  p.on('ui_copy',()=>({copied:false}));
  p.on('ui_prompt_read',()=>({text:'',cursor:0}));
  p.on('ui_prompt_fill',()=>({filled:false}));
  p.on('ui_prompt_suggest',()=>({shown:false}));
  try{await body(p,{sessionId,run});}catch(e){failure=e;throw e;}
  finally{noteDebug(p,debugFile);p.note({event:'spend',result:resultSummary(lastResult(p))});}
 },{cwd:run.cwd,env,bin:BIN,dir:'fixtures/pass3/',model,settingSources:'user,project,local',strictMcp:false,mode:'default',flags:[...PRODUCT_FLAGS,'--session-id',sessionId,'--max-budget-usd',SPEND_CAP,'--debug-file',debugFile,...flags]});
 const exit=await p.closed;
 const after=ownerTmpKeys();
 const same=JSON.stringify(after)===JSON.stringify(before);
 p.note({event:'owner_file_check',phase:'after',count:after.length,digest:digest(after),same});
 if(!same)throw new Error(name+': the owner\'s ~/.claude.json /tmp project keys changed: '+JSON.stringify({before,after}));
 if(failure)throw failure;
 if(exit.code!==0)throw new Error(name+' exited with '+JSON.stringify(exit));
 return p;
}
