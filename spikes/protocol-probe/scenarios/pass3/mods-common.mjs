// R0, the mods probe (docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md §2 K; study
// docs/doperpowers/evidence/ux-2026-10-01/r6-claude-mods.txt; child C2 of docs/charter.md, pin = the charter's blob at
// 4ba7f198). The helpers the mods-* scenarios share.
//
// Every launch runs the installed engine (the realpath of ~/.local/bin/claude, 2.1.287) by absolute path with MAWS's
// launch line (src/engine-host/launch.ts: ENGINE_FLAGS, `--settings {"dialogExpiry":"never"}`, the constant
// environment of buildEnvironment, the relay and its marker token) and MAWS's initialize payload
// (src/engine-host/session.ts:524: the declared dialog kinds, perTaskStopAffordance, the workspace trust attestation),
// under a scratch CLAUDE_CONFIG_DIR under /tmp that the run creates and deletes. The environment is built from nothing,
// so neither this shell's Claude session variables nor the owner's settings reach the engine; DISABLE_AUTOUPDATER=1.
// Probe guards that MAWS does not pass: `--max-budget-usd` and `--debug-file` (the engine's debug log, in the scratch
// directory; the lines about mods are copied into the fixture as notes, redacted).
//
// The probe mod is written into the scratch config home's skills folder (`<config>/skills/mods-probe/`): a plugin
// auto-loaded from a skills folder (reference.md, "--plugin-dir and CLAUDE_CODE_PLUGIN_DIRS"), the one plugin location
// MAWS's unchanged launch reads with no flag or variable of its own. The consent scenario writes it into the session's
// dev-mods folder instead.
import {run as harnessRun,scratch,delay} from '../../harness.mjs';
import {assertScratch,RELAY_ENV,records,slug} from './c10-common.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export {delay,randomUUID,join,existsSync,writeFileSync,mkdirSync};

export const BIN='/Users/new/.local/share/claude/versions/2.1.287';
export const PROVENANCE={charter:'docs/charter.md',child:'C2',pin:'ab44b41100d1cbe421ebba9a02710457714cce8d',spike:'R0',document:'docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md',study:'docs/doperpowers/evidence/ux-2026-10-01/r6-claude-mods.txt'};
export const PROMPT='Reply with exactly MODS_PROBE_OK';
export const GATE='CLAUDE_CODE_ENABLE_FUNCTION_HOOKS';
// MAWS's flags beyond the harness's own (launch.ts ENGINE_FLAGS less what harness.mjs already passes), and its --settings.
const PRODUCT_FLAGS=['--forward-subagent-text','--replay-user-messages','--include-hook-events','--settings',JSON.stringify({dialogExpiry:'never'})];
const SPEND_CAP='0.30';
const DIALOGS=['auto_mode_server_fallback','refusal_fallback_prompt'];
export const initPayload=cwd=>({supportedDialogKinds:DIALOGS,perTaskStopAffordance:true,workspaceTrust:{accepted:true,directory:cwd}});

// The probe mod: three pushes when the session starts and again when a turn completes, and a one-line band.
export const MOD_NAME='mods-probe';
const MOD_FILES={
 '.claude-plugin/plugin.json':JSON.stringify({name:MOD_NAME,version:'0.1.0',description:'MAWS R0 probe: a toast, a status line and a log line at session start and turn end; one line above the prompt'},null,1)+'\n',
 'hooks/hooks.json':JSON.stringify({modules:['./register.tsx']})+'\n',
 'hooks/register.tsx':`// MAWS R0 probe mod (spikes/protocol-probe/scenarios/pass3/mods-common.mjs)
export const register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.log(\`MODS_PROBE_LOG start surface=\${e.surface} interactive=\${e.isInteractive}\`)
    $.ui.status('MODS_PROBE_STATUS start')
    $.ui.toast('MODS_PROBE_TOAST start')
    return result
  })
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    $.ui.log('MODS_PROBE_LOG turn')
    $.ui.status('MODS_PROBE_STATUS turn')
    $.ui.toast('MODS_PROBE_TOAST turn')
    return result
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{\`MODS_PROBE_BAND surface=\${e.surface}\`}</Text>
  })
}
`,
};
export function writeMod(dir){for(const [rel,text] of Object.entries(MOD_FILES)){mkdirSync(join(dir,rel,'..'),{recursive:true});writeFileSync(join(dir,rel),text);}return dir;}

// A scratch run: its root under /tmp holding the config home, the repository the session runs in and the debug log.
// `settings` is the config home's settings.json; `globalConfig` extra keys for its .claude.json (the cwd is trusted there,
// as a MAWS project folder is); `mod` installs the probe mod in the skills folder.
export function scratchRun(label,{settings={},globalConfig={},mod=true}={}){
 const root=realpathSync(mkdtempSync(`/tmp/maws-r0-${label}-`));
 const home=join(root,'config');mkdirSync(home);
 const cwd=realpathSync(scratch(join(root,'repo-')));
 writeFileSync(join(home,'settings.json'),JSON.stringify(settings)+'\n');
 writeFileSync(join(home,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}},...globalConfig})+'\n');
 if(mod)writeMod(join(home,'skills',MOD_NAME));
 return {root,home,cwd,debugFile:join(root,'debug.log')};
}
export const removeRun=run=>rmSync(run.root,{recursive:true,force:true});

const BASE_KEYS=['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG'];
// Clears this process's environment to the base keys (the harness copies process.env), then builds MAWS's.
function engineEnv(home,vars){
 for(const k of Object.keys(process.env))if(!BASE_KEYS.includes(k)&&!k.startsWith('LC_'))delete process.env[k];
 return {CLAUDE_CONFIG_DIR:home,...RELAY_ENV,ENABLE_TOOL_SEARCH:'true',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',TERM:'dumb',DISABLE_AUTOUPDATER:'1',...vars};
}

// What a run saw, for the summary notes and the findings.
export const sys=(f,subtype)=>f.type==='system'&&f.subtype===subtype;
export const initFrame=p=>p.frames.find(r=>sys(r.frame,'init'))?.frame;
export const uiPushes=p=>p.frames.filter(r=>r.frame.type==='system'&&String(r.frame.subtype).startsWith('ui_')).map(r=>({seq:r.seq,...r.frame}));
export const uiRequestsIn=p=>p.frames.filter(r=>r.frame.type==='control_request'&&String(r.frame.request?.subtype).startsWith('ui_')).map(r=>({seq:r.seq,...r.frame}));
export const answerText=p=>p.frames.filter(r=>r.frame.type==='result').map(r=>r.frame.result).at(-1)??null;
export const cost=p=>Math.max(0,...p.frames.filter(r=>r.frame.type==='result').map(r=>r.frame.total_cost_usd??0));
export function success(response,operation){if(response.subtype!=='success')throw new Error(operation+' returned '+JSON.stringify(response));return response.response??{};}
export function check(p,label,ok,detail){p.note({event:'check',label,ok,...(detail===undefined?{}:{detail})});if(!ok)throw new Error('check failed: '+label+(detail===undefined?'':' '+JSON.stringify(detail)));}
export async function endAsStop(p){try{await p.request('end_session',{reason:'stop'},10000);}catch(e){p.note({event:'end_session_error',message:e.message});}return p.closed;}

// The engine's debug-log lines about mods, plugins and the ui_* protocol, copied as one note (the log stays in scratch).
const DEBUG_LINES=/dev mods|plugin_dev_mods|mods-probe|hooks module|hooks modules|function hooks|functionHooks|ui\.render|ui_attach|ui_render|ui_toast|ui_status|ui_log|ui_invalidate|ui_panes|session\.start|mod_hot_reload|confirmWithUser|tengu_plugin_hooks_modules/i;
export function noteDebug(p,file){
 if(!existsSync(file))return p.note({event:'debug_lines',file:null});
 const lines=readFileSync(file,'utf8').split('\n').filter(l=>DEBUG_LINES.test(l)).map(l=>l.slice(0,500));
 p.note({event:'debug_lines',count:lines.length,lines:lines.slice(0,120)});
}
// The scratch .claude.json's cached value of the function-hooks rollout switch after the run (the engine may write it).
export const servedSwitch=home=>{try{const v=JSON.parse(readFileSync(join(home,'.claude.json'),'utf8')).cachedGrowthBookFeatures?.tengu_plugin_hooks_modules;return v===undefined?'absent':v;}catch{return 'unreadable';}};

// One launch as MAWS launches, with `vars` added to the environment; the body gets the probe and the run. Handlers
// answer every engine→host request the protocol can send, so a recording never leaves one open.
export async function launch(name,run,{vars={},sessionId=randomUUID(),provenance={}},body){
 const env=engineEnv(run.home,vars);
 const {configHome,globalConfig}=assertScratch(env);
 let failure;
 const p=await harnessRun(name,async p=>{
  p.note({event:'provenance',...PROVENANCE,...provenance,engine:BIN,configHome,globalConfig,pinnedSessionId:sessionId,envKeys:Object.keys(env).sort(),gate:Object.hasOwn(env,GATE)?env[GATE]:'unset',settings:JSON.parse(readFileSync(join(run.home,'settings.json'),'utf8'))});
  p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});
  p.on('elicitation',r=>{p.note({event:'elicitation_seen',request:r});return {action:'decline'};});
  p.on('ui_copy',r=>{p.note({event:'ui_request_seen',subtype:'ui_copy'});return {copied:false};});
  p.on('ui_prompt_read',()=>{p.note({event:'ui_request_seen',subtype:'ui_prompt_read'});return {text:'',cursor:0};});
  p.on('ui_prompt_fill',()=>{p.note({event:'ui_request_seen',subtype:'ui_prompt_fill'});return {filled:false};});
  p.on('ui_prompt_suggest',()=>{p.note({event:'ui_request_seen',subtype:'ui_prompt_suggest'});return {shown:false};});
  try{await body(p,{sessionId});}catch(e){failure=e;throw e;}
  finally{noteDebug(p,run.debugFile);p.note({event:'served_switch_after',tengu_plugin_hooks_modules:servedSwitch(run.home)});}
 },{cwd:run.cwd,env,bin:BIN,dir:'fixtures/pass3/',model:'haiku',settingSources:'user,project,local',strictMcp:false,mode:'default',flags:[...PRODUCT_FLAGS,'--session-id',sessionId,'--max-budget-usd',SPEND_CAP,'--debug-file',run.debugFile]});
 const exit=await p.closed;
 if(failure)throw failure;
 if(exit.code!==0)throw new Error(name+' exited with '+JSON.stringify(exit));
 return p;
}

// The summary every pushes-and-init run notes: the init's capabilities, the pushes in order, the reply and the cost.
export function summarize(p,label){
 const init=initFrame(p);
 const s={label,capabilities:init?.capabilities??null,hasUiSurface:!!init?.capabilities?.includes('ui_surface_v1'),plugins:init?.plugins??null,plugin_errors:init?.plugin_errors??null,plugin_warnings:init?.plugin_warnings??null,claude_code_version:init?.claude_code_version??null,pushes:uiPushes(p).map(f=>({seq:f.seq,subtype:f.subtype,plugin:f.plugin,text:f.text,timeout_ms:f.timeout_ms})),uiRequestsIn:uiRequestsIn(p).map(f=>({seq:f.seq,subtype:f.request.subtype})),answer:answerText(p),total_cost_usd:cost(p)};
 p.note({event:'mods_summary',...s});
 console.log(label,JSON.stringify({capabilities:s.capabilities,pushes:s.pushes.map(x=>x.subtype+':'+(x.text??'')),answer:s.answer,cost:s.total_cost_usd}));
 return s;
}

// One turn of the no-tools prompt, then a quiet wait for pushes that trail the result (turn.complete's, spaced toasts).
export async function promptTurn(p,ms=6000){const result=await p.turn(PROMPT);await delay(ms);return result;}
export {records,slug,execFileSync};
