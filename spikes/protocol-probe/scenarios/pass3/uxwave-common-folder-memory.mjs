// UX wave probes (docs/doperpowers/specs/2026-11-12-ux-wave/, children U2 and U8, "Probes and checks"): an engine
// launched as MAWS launches it, on the VM's gateway route (spikes/protocol-probe/VM.md), so that a frame whose presence
// depends on the launch is seen as a session MAWS runs sees it.
//  - Flags: the harness's set plus what src/engine-host/launch.ts (ENGINE_FLAGS, buildLaunchPlan) adds: the three
//    product flags, setting sources user,project,local, no --strict-mcp-config, the AskUserQuestion swap and the host's
//    --settings object (protectedSettings: dialogExpiry, no effort override on a spec without one).
//  - Environment: buildEnvironment's constants (launch.ts); the sminos marks are left out (no sminos member here).
//  - After initialize (src/engine-host/session.ts, the handshake): ui_attach and ui_panes as the desktop surface when
//    the engine advertises ui_surface_v1 (surface.ts), then set_max_thinking_tokens { null, 'summarized' }.
//  - User settings: the scratch HOME's ~/.claude/settings.json carries the owner's user settings on the axes these
//    probes read (model aliases and their context switches, the subagent model, effort per model, auto memory off,
//    the worktree base); nothing else of the owner's.
import {run as harnessRun} from '../../harness.mjs';
import {probeInitialize} from '../../probe-initialize.mjs';
import {readFileSync,writeFileSync,existsSync,readdirSync,mkdirSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const ENGINE=process.env.PROBE_ENGINE;
export const WORK=process.env.PROBE_WORK; // vm-run.sh's trusted scratch repository
export const DIR='fixtures/pass3/uxwave/';
export const MAWS_SETTINGS={dialogExpiry:'never'};
export const mawsFlags=(settings=MAWS_SETTINGS)=>['--forward-subagent-text','--replay-user-messages','--include-hook-events','--disallowedTools','AskUserQuestion','--allowedTools','mcp__maws__ask','--settings',JSON.stringify(settings)];
export const MAWS_FLAGS=mawsFlags();
export const MAWS_ENV={CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'false',CLAUDE_CODE_ENTRYPOINT:'sdk-ts',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING:'1',CLAUDE_CODE_QUESTION_PREVIEW_FORMAT:'html',TERM:'dumb',DISABLE_AUTOUPDATER:'1',ENABLE_TOOL_SEARCH:'true'};
// The owner's user settings (2026-11-12) on the axes these probes read.
export const OWNER_USER_SETTINGS={
 env:{ANTHROPIC_DEFAULT_OPUS_MODEL:'claude-opus-5-5[1m]',ANTHROPIC_DEFAULT_FABLE_MODEL:'claude-fable-5-2[1m]',ANTHROPIC_DEFAULT_SONNET_MODEL:'claude-sonnet-5-5[1m]',ANTHROPIC_DEFAULT_HAIKU_MODEL:'claude-haiku-5-5[1m]',CLAUDE_CODE_DISABLE_1M_CONTEXT:'0',CLAUDE_CODE_MAX_CONTEXT_TOKENS:'500000',CLAUDE_CODE_SUBAGENT_MODEL:'opus'},
 effortLevel:'high',
 modelSettings:{'claude-fable-5-2':{effortLevel:'xhigh'},'claude-opus-5-5':{effortLevel:'high'},'claude-sonnet-5-5':{effortLevel:'high'},'claude-haiku-5-5':{effortLevel:'low'}},
 autoMemoryEnabled:false,
 worktree:{baseRef:'fresh'},
};
export function writeUserSettings(over={}){const file=homedir()+'/.claude/settings.json';const s={...OWNER_USER_SETTINGS,...over,env:{...OWNER_USER_SETTINGS.env,...(over.env||{})}};writeFileSync(file,JSON.stringify(s,null,1));return s;}

export const SURFACE={surface:'desktop',client_id:'maws-main',viewport:{columns:100,rows:30,isFullscreen:true},answers:['ui_copy','ui_prompt_read','ui_prompt_fill','ui_prompt_suggest']};
export const THINKING={max_thinking_tokens:null,thinking_display:'summarized'};

// One launch as MAWS's. `thinking: false` leaves out set_max_thinking_tokens (probe Z3's other half); `hooks` joins the
// initialize payload (MAWS registers none; the folder probe registers CwdChanged); `allow` answers every permission
// request (each one is noted); `userSettings` overrides keys of the owner's settings above; `flagSettings` replaces the
// --settings object (a control only; MAWS's is MAWS_SETTINGS).
export async function mawsLaunch(name,{cwd=WORK,model='haiku',mode='default',flags=[],env={},thinking=true,hooks,allow=true,userSettings={},sessionId,flagSettings=MAWS_SETTINGS},body){
 const settings=writeUserSettings(userSettings);
 const allFlags=[...mawsFlags(flagSettings),...(sessionId?['--session-id',sessionId]:[]),...flags];
 return harnessRun(name,async p=>{
  p.note({event:'provenance',spec:'docs/doperpowers/specs/2026-11-12-ux-wave/',launch:'maws',engine:ENGINE,launchFlags:allFlags,launchEnv:MAWS_ENV,userSettings:settings,model,mode,thinkingRequest:thinking?THINKING:null,hooks:hooks??null});
  p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});
  p.on('can_use_tool',async r=>{p.note({event:'permission_request',tool:r.tool_name,tool_use_id:r.tool_use_id,agent_id:r.agent_id,decision_reason_type:r.decision_reason_type});if(p.permissionDelayMs)await new Promise(res=>setTimeout(res,p.permissionDelayMs));return allow?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Probe denies.'};});
  p.on('hook_callback',r=>{p.note({event:'hook_callback_seen',callback_id:r.callback_id,input:r.input});return {continue:true};});
  const init=await p.request('initialize',{...probeInitialize(),...(hooks?{hooks}:{})});
  p.note({event:'initialize_answer',subtype:init.subtype,hooks_applied:init.response?.hooks_applied,capabilities:init.response?.capabilities,models:(init.response?.models||[]).map(m=>m.value??m)});
  if(init.response?.capabilities?.includes('ui_surface_v1')){const a=await p.request('ui_attach',SURFACE);p.note({event:'ui_attach_answer',subtype:a.subtype});await p.request('ui_panes',{client_id:SURFACE.client_id});}
  if(thinking){const t=await p.request('set_max_thinking_tokens',THINKING);p.note({event:'thinking_request_answer',response:t});}
  await body(p,{init});
  try{await p.request('end_session',{reason:'stop'},10000);}catch(e){p.note({event:'end_session_error',message:e.message});}
 },{cwd,bin:ENGINE,dir:DIR,model,settingSources:'user,project,local',strictMcp:false,mode,flags:allFlags,env:{...MAWS_ENV,...env}});
}

// The engine's transcript files for a session id, under every project folder (a relocation can move one).
export function transcriptFiles(sessionId,home=homedir()){const base=join(home,'.claude/projects');if(!existsSync(base))return [];return readdirSync(base).map(d=>join(base,d,sessionId+'.jsonl')).filter(existsSync);}
export const rows=file=>existsSync(file)?readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return {unparsed:l.slice(0,80)};}}):[];
export function listTree(dir){if(!existsSync(dir))return [];const out=[];const visit=(d,rel)=>{for(const n of readdirSync(d)){const f=join(d,n),r=rel?rel+'/'+n:n;out.push(r);if(statSync(f).isDirectory())visit(f,r);}};visit(dir,'');return out;}
export const answer=p=>p.frames.filter(r=>r.frame.type==='assistant').flatMap(r=>r.frame.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).at(-1)??null;
export {randomUUID,join,existsSync,readFileSync,mkdirSync,writeFileSync};
