// C10 M1 (docs/doperpowers/plans/2026-09-28-c10-sessions-worktrees-trust.md, child C10 of docs/charter.md): the helpers
// every C10 pass-3 scenario recorded from M1 on shares. Each one runs under a scratch config home (charter §19, the
// live-acceptance rule): a fresh CLAUDE_CONFIG_DIR holding `settings.json` `{}` (C3's scratchConfigHome() shape), a
// refusal to spawn when the resolved config home or global config file is the owner's, and trust read from that home's
// own `.claude.json`. The launch mirrors C3's (`--setting-sources user,project,local`, no `--strict-mcp-config`), pins
// `--session-id` so a no-turn launch still names its session in the spawn row, and ends the way C3's `session.stop`
// ends one (`end_session { reason: 'stop' }`).
import {run as harnessRun} from '../../harness.mjs';
import {BIN,DIALOGS,SCRUB} from '../pass2/common.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,statSync,realpathSync} from 'node:fs';
import {userInfo} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export {BIN,DIALOGS};

export const PROVENANCE={charter:'docs/charter.md',child:'C10',document:'docs/doperpowers/plans/2026-09-28-c10-sessions-worktrees-trust.md',pin:'5380097c7e684d1a0d20b2def1fc8ec3ceefdfd9',milestone:'M1'};
// The owner's real locations, from the passwd entry rather than HOME (a scenario may run under a temporary HOME).
export const OWNER_HOME=realpathSync(userInfo().homedir);
export const OWNER_CONFIG_HOME=join(OWNER_HOME,'.claude');
export const OWNER_GLOBAL_CONFIG=join(OWNER_HOME,'.claude.json');
// C3's buildEnvironment for a gateway launch (src/engine-host/launch.ts): the relay and its non-secret marker token.
export const RELAY_ENV={ANTHROPIC_BASE_URL:'http://127.0.0.1:8641',ANTHROPIC_AUTH_TOKEN:'claudeusage-local-gateway'};

const real=p=>{try{return realpathSync(p);}catch{return p;}};
export const tempDir=prefix=>realpathSync(mkdtempSync(prefix));
export const slug=path=>path.replace(/[^a-zA-Z0-9]/g,'-');

// A scratch config home: settings.json `{}`, and a `.claude.json` holding `projects` when the scenario seeds trust.
export function scratchConfigHome(projects){const dir=tempDir('/tmp/maws-probe3-config-');writeFileSync(join(dir,'settings.json'),'{}\n');if(projects)writeFileSync(join(dir,'.claude.json'),JSON.stringify({projects})+'\n');return dir;}

// The config home and global config file the engine will resolve for `env` (SPEC §3 16.1, production suffix); throws
// before any spawn when either is the owner's.
export function assertScratch(env){
 const home=env.HOME||OWNER_HOME;const configHome=env.CLAUDE_CONFIG_DIR||join(home,'.claude');const globalConfig=join(env.CLAUDE_CONFIG_DIR||home,'.claude.json');
 if(real(configHome)===OWNER_CONFIG_HOME||real(globalConfig)===OWNER_GLOBAL_CONFIG)throw new Error(`refused before spawning: config home ${configHome} (global config ${globalConfig}) is the owner's; C10 probes run under a scratch CLAUDE_CONFIG_DIR`);
 return {configHome,globalConfig};
}

export const trustOf=(globalConfig,keys)=>{let store={};try{store=JSON.parse(readFileSync(globalConfig,'utf8'));}catch{}return Object.fromEntries(keys.map(k=>[k,store.projects?.[k]?.hasTrustDialogAccepted??null]));};
export const projectListing=(configHome,cwd)=>{const dir=join(configHome,'projects',slug(cwd));return {dir,exists:existsSync(dir),entries:existsSync(dir)?readdirSync(dir).sort():[]};};
export const stat=file=>existsSync(file)?{size:statSync(file).size,mtimeMs:statSync(file).mtimeMs}:null;
export const records=file=>existsSync(file)?readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];
export const stderrText=p=>readFileSync(p.file,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.direction==='stderr').map(r=>r.frame.text).join('\n');
export const initFrame=p=>p.frames.find(r=>r.frame.type==='system'&&r.frame.subtype==='init')?.frame;
export const answer=p=>p.frames.filter(r=>r.frame.type==='assistant').flatMap(r=>r.frame.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).at(-1)??null;
export function success(response,operation){if(response.subtype!=='success')throw new Error(operation+' returned '+JSON.stringify(response));return response.response??{};}
export function check(p,label,ok,detail){p.note({event:'check',label,ok,...(detail===undefined?{}:{detail})});if(!ok)throw new Error('check failed: '+label+(detail===undefined?'':' '+JSON.stringify(detail)));}

// Ends the launch as C3's session.stop does, then waits for the process to exit.
export async function endAsStop(p){try{await p.request('end_session',{reason:'stop'},10000);}catch(e){p.note({event:'end_session_error',message:e.message});}return p.closed;}

// One launch: C3's setting sources, no strict MCP config, default mode, the pinned id, the scratch env; throws when
// the scenario body failed or the engine exited non-zero, so a recording that did not assert what it claims fails loudly.
// `provenance` overrides the row's fields for a scenario another child records with these helpers (debt wave 3).
export async function launch(name,{cwd,env,sessionId=randomUUID(),flags=[],model='haiku',provenance={}},body){
 const {configHome,globalConfig}=assertScratch({...process.env,...env});
 for(const k of SCRUB)delete process.env[k];
 let failure;
 const p=await harnessRun(name,async p=>{
  p.note({event:'provenance',...PROVENANCE,...provenance,scrubbedEnv:SCRUB,configHome,globalConfig,pinnedSessionId:sessionId});
  p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});
  try{await body(p,{configHome,globalConfig,sessionId});}catch(e){failure=e;throw e;}
 },{cwd,env,bin:BIN,dir:'fixtures/pass3/',model,settingSources:'user,project,local',strictMcp:false,mode:'default',flags:['--session-id',sessionId,...flags]});
 const exit=await p.closed;
 if(failure)throw failure;
 if(exit.code!==0)throw new Error(name+' exited with '+JSON.stringify(exit));
 return {p,configHome,globalConfig,sessionId};
}

import {probeInitialize} from '../../probe-initialize.mjs';
export const initPayload=(extra={})=>({...probeInitialize(),...extra});
export {mkdirSync,writeFileSync,existsSync,join,randomUUID};
