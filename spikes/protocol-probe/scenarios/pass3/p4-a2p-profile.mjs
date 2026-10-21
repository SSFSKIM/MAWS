// P4-A2P (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2 "The per-session launch profile", acceptance R-7;
// parent pin blob 246354256c404b41189c6cbeb67a7c1157a9f0e6 at master 0b7b9eacb; 2026-10-21): the launch profile MAWS
// applies to every session it launches, only through the launch's own flags (D-1): src/shared/engine/launch-profile.ts
// `profileSettings` (plugins `off` as `enabledPlugins[id] = false`, outputStyle `maws` as `outputStyle: "default"`, hooks
// `none` as `disableAllHooks: true`) in the `--settings` JSON beside MAWS's own (`dialogExpiry`, the lane's env, and while
// hooks are kept MAWS's SessionStart group), `--setting-sources user,project,local` unchanged. Under hooks none MAWS's
// start-time context (contract.ts MESSAGE_TOOL_ALIAS) cannot ride the group, since a non-managed `disableAllHooks` drops
// every settings-file hook, the flag JSON's own included (2.1.304 cli.pretty.js:66776-66789): it is appended after the
// supplement or contract, a blank line between, and a launch reusing a transcript passes `--system-prompt-snapshot off`.
//
// Every launch is MAWS's (src/engine-host/launch.ts): ENGINE_FLAGS, no `--model` (the model and the effort come from the
// user scope), the `--settings` JSON and `--append-system-prompt` mirrored by hand from contract.ts and recorded whole in
// provenance; probe guards `--max-budget-usd` and `--debug-file`. The scratch config home is seeded from read-only copies
// of what the questions need: the owner's `model`, `effortLevel`, per-model efforts and `outputStyle`, three of the owner's
// user-scope plugins copied from ~/.claude/plugins/cache (installed_plugins.json rewritten to the copies, their
// marketplaces' manifests recorded beside them), the owner's migration state in `.claude.json`, and a probe-owned user
// `hooks` block standing for the user's hooks (exec-form printf of a PROBE_USER_HOOK_<event> marker); nothing of the
// owner's own hooks, env or permissions. Every seeded file is made read-only, and the whole home is hashed before the first
// launch and after the last (fixture p4-a2p-home). Fixtures under fixtures/p4/ (findings-p4-a2p-profile.txt):
//   stub-<arm>[-resume|-fork|-user-kept|-user]  against the scripted Messages API (../../stub-api.mjs, nothing spent):
//             plain (the user scope), plugins (two plugins off), style (maws), hooks-group (hooks none with the group
//             still in the settings), hooks (the route: startup, /compact, a turn, /clear, a turn; its --resume and
//             --fork-session with snapshot off; the plain session's --resume without and with snapshot off), full
//   relay-plain, relay-full  on the owner's model through the relay with a recorder between, R7y's QUESTION asked once
// Run: [A2P_ARM=stub,relay] node run-pass3.mjs p4-a2p-profile   (PROBE_ENGINE unset: the installed engine MAWS launches)
import {relayReady,ownerTmpKeys,initPayload,BIN,ENGINE_VERSION,scratchRun,removeRun,transcriptPath,success,check,endAsStop,delay,randomUUID} from './p1-common.mjs';
import {run as harnessRun} from '../../harness.mjs';
import {assertScratch,RELAY_ENV} from './c10-common.mjs';
import {clearEngineEnvironment} from './mods-environment.mjs';
import {startStubApi,textTurn} from '../../stub-api.mjs';
import {startRecorder} from './p4-r7-message-tool.mjs';
import {QUESTION} from './p4-r7y-session-start.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync,cpSync,readdirSync,lstatSync,readlinkSync,chmodSync} from 'node:fs';
import {join,relative,dirname} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const contract=await import('../../../../src/shared/owner/contract.ts');
const launchProfile=await import('../../../../src/shared/engine/launch-profile.ts');
const FIXTURES=fileURLToPath(new URL('../../fixtures/p4/',import.meta.url));
const PROVENANCE={charter:'docs/charter.md',child:'P4-A2P',pin:'246354256c404b41189c6cbeb67a7c1157a9f0e6',master:'0b7b9eacb',document:'docs/doperpowers/plans/2026-10-19-p4-smoothing.md',spike:'the launch profile through the launch\'s own flags (D-1; R-7)',engine:BIN,engineVersion:ENGINE_VERSION};
export const ALIAS=contract.MESSAGE_TOOL_ALIAS;
export const USER_MARKER=event=>`PROBE_USER_HOOK_${event}`;

// ---- the scratch home ------------------------------------------------------------------------------------------
const OWNER_CLAUDE=join(homedir(),'.claude');
const OWNER_CACHE=join(OWNER_CLAUDE,'plugins','cache');
// User-scope plugins of the owner's whose hooks have no outward side effect: doperpowers (its SessionStart kairos.sh
// reads a flag file and prints nothing unless KAIROS is on, its MessageDisplay hook exits at once while
// MAWS_NATIVE_TO_HUMAN is set; its output-styles/to-human.md is the owner's style), eli5 and designer (skills only).
// Never sminos, ptc, ci-kit or cua; and so not to-human, which declares sminos a dependency and does not load without it.
export const PLUGINS=['doperpowers@doperpowers','eli5@claude-community','designer@designer'];
export const OFF=['designer@designer','eli5@claude-community'];
const userHook=event=>({hooks:[{type:'command',command:'/usr/bin/printf',args:['%s',JSON.stringify({hookSpecificOutput:{hookEventName:event,additionalContext:USER_MARKER(event)}})]}]});
export const USER_HOOKS={SessionStart:[userHook('SessionStart')],UserPromptSubmit:[userHook('UserPromptSubmit')]};

// Copies the plugins and writes the user settings and the plugin registry; returns what was seeded.
function seed(run){
 const owner=JSON.parse(readFileSync(join(OWNER_CLAUDE,'settings.json'),'utf8'));
 const installed=JSON.parse(readFileSync(join(OWNER_CLAUDE,'plugins','installed_plugins.json'),'utf8'));
 if(installed.version!==2)throw new Error('installed_plugins.json is not version 2');
 const registry={version:2,plugins:{}};const copied=[];
 for(const id of PLUGINS){
  const entry=(installed.plugins[id]??[]).find(e=>e.scope==='user');
  if(!entry)throw new Error(`no user-scope install of ${id}`);
  const rel=relative(OWNER_CACHE,entry.installPath);
  if(rel.startsWith('..'))throw new Error(`${id} is not under the plugin cache`);
  const dest=join(run.home,'plugins','cache',rel);
  // the owner's in-use markers (.in_use/<pid>, written by the owner's running sessions) are not the plugin's
  cpSync(entry.installPath,dest,{recursive:true,filter:src=>!relative(entry.installPath,src).split('/').includes('.in_use')});
  registry.plugins[id]=[{scope:'user',installPath:dest,version:entry.version,installedAt:entry.installedAt,lastUpdated:entry.lastUpdated,...(entry.gitCommitSha?{gitCommitSha:entry.gitCommitSha}:{})}];
  copied.push({id,version:entry.version,from:'~/.claude/plugins/cache/'+rel,to:'plugins/cache/'+rel});
 }
 writeFileSync(join(run.home,'plugins','installed_plugins.json'),JSON.stringify(registry,null,2)+'\n');
 // The engine loads an installed plugin only when its marketplace is known (recorded in known_marketplaces.json) and
 // its manifest lists it: each marketplace's `.claude-plugin/` is copied, recorded with the owner's source and without
 // autoUpdate, so nothing is fetched.
 const ownerMarkets=JSON.parse(readFileSync(join(OWNER_CLAUDE,'plugins','known_marketplaces.json'),'utf8'));const markets={};
 for(const name of new Set(PLUGINS.map(id=>id.split('@')[1]))){
  const entry=ownerMarkets[name];if(!entry)throw new Error(`no known marketplace ${name}`);
  const dest=join(run.home,'plugins','marketplaces',name);
  cpSync(join(entry.installLocation,'.claude-plugin'),join(dest,'.claude-plugin'),{recursive:true});
  markets[name]={source:entry.source,installLocation:dest,lastUpdated:entry.lastUpdated};
 }
 writeFileSync(join(run.home,'plugins','known_marketplaces.json'),JSON.stringify(markets,null,2)+'\n');
 // The engine's one-time migration set runs in a home whose migrationVersion is behind and rewrites the user settings
 // (2.1.306 turned `opus` into `opus[1m]` through the read-only file); the owner's home has run it, so its state is seeded.
 const ownerGlobal=JSON.parse(readFileSync(join(homedir(),'.claude.json'),'utf8'));
 const migrations=Object.fromEntries(Object.entries(ownerGlobal).filter(([k,v])=>(/MigrationComplete$/.test(k)||k==='migrationVersion'||k==='hasResetAutoModeOptInForDefaultOffer')&&(typeof v==='boolean'||typeof v==='number')));
 const global=JSON.parse(readFileSync(join(run.home,'.claude.json'),'utf8'));
 writeFileSync(join(run.home,'.claude.json'),JSON.stringify({...global,...migrations})+'\n');
 // the owner's effort for the 5.x models is per model (modelSettings[<model>].effortLevel): the engine applies a top-level
 // effortLevel in the user settings to legacy models only (2.1.304 cli.pretty.js:381072, 381132-381139), so each entry's
 // effortLevel is seeded beside it (the Claude model ids' entries), and nothing else of the entries
 const modelSettings=Object.fromEntries(Object.entries(owner.modelSettings??{}).filter(([k,v])=>/^claude-[a-z]+-[0-9-]+$/.test(k)&&v?.effortLevel!==undefined).map(([k,v])=>[k,{effortLevel:v.effortLevel}]));
 const settings={model:owner.model,effortLevel:owner.effortLevel,modelSettings,outputStyle:owner.outputStyle,enabledPlugins:Object.fromEntries(PLUGINS.map(id=>[id,true])),hooks:USER_HOOKS};
 writeFileSync(join(run.home,'settings.json'),JSON.stringify(settings,null,2)+'\n');
 return {settings,registry,markets,migrations,copied};
}

// Every file and link under `root`, by path relative to it: size and sha256, or the link's target; directories by path.
function manifest(root){
 const out={};
 const walk=dir=>{for(const name of readdirSync(dir)){
  const path=join(dir,name);const rel=relative(root,path);const st=lstatSync(path);
  if(st.isSymbolicLink())out[rel]={link:readlinkSync(path)};
  else if(st.isDirectory()){out[rel]={dir:true};walk(path);}
  else out[rel]={size:st.size,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),mode:(st.mode&0o777).toString(8)};
 }};
 walk(root);return out;
}
const digestOf=entries=>createHash('sha256').update(entries.map(([p,e])=>`${p}\0${JSON.stringify(e)}`).join('\n')).digest('hex');
const readOnly=(root,paths)=>{for(const p of paths)chmodSync(join(root,p),lstatSync(join(root,p)).mode&0o555);};

// What a session's run may write under the config home (each class named in the findings); anything else is `other`.
export const SESSION_WRITES=[
 ['auto memory directory','/memory'],['transcript','projects/'],['plugin in-use sweep stamp','plugins/.last_inuse_sweep'],['cleanup stamp','.last-cleanup'],['session environment','session-env/'],['shell snapshot','shell-snapshots/'],['todo list','todos/'],
 ['feature flags cache','statsig/'],['file checkpoints','file-history/'],['global config','.claude.json'],['global config backup','backups/'],
 ['plugin in-use marker','/.in_use'],['plugin data','plugins/data/'],['session registry','sessions/'],['plans','plans/'],['paste cache','paste-cache/'],
];
export const classOf=path=>SESSION_WRITES.find(([,p])=>p.startsWith('/')?path.includes(p):path===p.replace(/\/$/,'')||path.startsWith(p))?.[0]??'other';

// ---- one launch ------------------------------------------------------------------------------------------------
// The flag JSON a lane-on launch carries under `profile` (launch-mapping.ts withOwnerChannel; the profile's keys beside
// MAWS's own), with MAWS's SessionStart group when `group`.
export const LANE_ENV={[contract.NATIVE_TO_HUMAN_ENV]:String(contract.TO_HUMAN_CONTRACT_VERSION)};
export const flagSettingsFor=(profile,{group})=>({dialogExpiry:'never',...launchProfile.profileSettings(profile),env:LANE_ENV,...(group?{hooks:{SessionStart:[contract.messageToolHookGroup()]}}:{})});
// What MAWS appends: beside the owner's message-tool style the supplement, under style `maws` the full contract; under
// hooks none (the route) the alias after it, a blank line between, unless `alias: false` (hooks-group: the route not taken).
export const appendFor=(profile,{alias=profile.hooks==='none'}={})=>{const base=profile.outputStyle==='maws'?contract.TO_HUMAN_CONTRACT:contract.TO_HUMAN_SUPPLEMENT;return alias?`${base}\n\n${ALIAS}`:base;};

const PRODUCT_FLAGS=['--forward-subagent-text','--replay-user-messages','--include-hook-events'];
function engineEnv(home,vars){
 clearEngineEnvironment();
 return {CLAUDE_CONFIG_DIR:home,...RELAY_ENV,ENABLE_TOOL_SEARCH:'true',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',TERM:'dumb',DISABLE_AUTOUPDATER:'1',...vars};
}

// What a request carried: the alias and the user hooks' markers, in the system prompt and in each message block; the
// appended header, whether the exact appended text is in the system prompt, the owner's style, the plugins' skills.
let currentAppend=null;let styleLine=null;
const textOfSystem=s=>typeof s==='string'?s:Array.isArray(s)?s.map(b=>b?.text??'').join('\n'):'';
const blocksOf=m=>typeof m.content==='string'?[{type:'text',text:m.content}]:m.content??[];
const count=(text,needle)=>text.split(needle).length-1;
const HEADER=/# Messages to the human \(MAWS to-human (contract|supplement) (\d+)\)/;
export const NEEDLES={alias:ALIAS,userSessionStart:USER_MARKER('SessionStart'),userPromptSubmit:USER_MARKER('UserPromptSubmit')};
export function record(body){
 const system=textOfSystem(body.system);const raw=JSON.stringify(body);
 const where={};const prompts=[];
 for(const [key,needle] of Object.entries(NEEDLES))where[key]={system:count(system,needle),messages:[]};
 (body.messages??[]).forEach((m,i)=>blocksOf(m).forEach((b,j)=>{
  const text=b.type==='text'?b.text:b.type==='tool_result'?JSON.stringify(b.content):'';
  let hit=false;
  for(const [key,needle] of Object.entries(NEEDLES)){const n=count(text,needle);if(n>0){hit=true;where[key].messages.push({message:i,block:j,role:m.role,copies:n,head:text.slice(0,240)});}}
  if(!hit&&m.role==='user'&&b.type==='text')prompts.push({message:i,block:j,head:b.text.slice(0,160)});
 }));
 return {
  model:body.model,messages:(body.messages??[]).length,tools:(body.tools??[]).length,main:Array.isArray(body.tools)&&body.tools.some(t=>t?.name==='Bash'),
  systemChars:system.length,bodyChars:raw.length,appended:HEADER.exec(system)?.slice(1,3).join(':')??null,appendWhole:currentAppend?system.includes(currentAppend):null,
  style:styleLine?{system:count(system,styleLine),body:count(raw,styleLine.replace(/\n/g,'\\n'))}:null,skills:{eli5:count(raw,'eli5:eli5'),designer:count(raw,'designer:designer'),doperpowers:count(raw,'doperpowers:brainstorming')},
  thinking:body.thinking??null,effort:body.output_config?.effort??null,
  hits:where,prompts,
 };
}
// The text the API streamed back for one exchange (a relay recording).
function answerOf(x){
 const text=x.response?.toString('utf8')??'';
 try{const json=JSON.parse(text);if(Array.isArray(json.content))return json.content.filter(b=>b.type==='text').map(b=>b.text).join('');}catch{}
 return text.split('\n').filter(l=>l.startsWith('data: ')).map(l=>{try{return JSON.parse(l.slice(6));}catch{return null;}}).filter(e=>e?.type==='content_block_delta'&&e.delta?.type==='text_delta').map(e=>e.delta.text).join('');
}

const hookFrames=p=>p.frames.filter(r=>r.frame.type==='system'&&String(r.frame.subtype).startsWith('hook_')).map(r=>({seq:r.seq,subtype:r.frame.subtype,hook_name:r.frame.hook_name??null,hook_event:r.frame.hook_event??null,outcome:r.frame.outcome??null,output:typeof r.frame.output==='string'?r.frame.output.slice(0,200):null}));
const initsOf=p=>p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='init').map(r=>({seq:r.seq,session_id:r.frame.session_id,model:r.frame.model,output_style:r.frame.output_style,plugins:r.frame.plugins,plugin_errors:r.frame.plugin_errors??null,skills:(r.frame.skills??[]).length,slash_commands:(r.frame.slash_commands??[]).length}));
// The transcript's prompt snapshots (what a resume reuses) and hook contexts, for each session the launch wrote.
function diskOf(run,ids){
 return ids.map(id=>{
  const file=transcriptPath(run,id);
  if(!existsSync(file))return {sessionId:id,exists:false};
  const recs=readFileSync(file,'utf8').trim().split('\n').map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
  const snapshots=recs.filter(r=>r.type==='attachment'&&r.attachment?.type==='prompt_snapshot').map(r=>{const text=(r.attachment.systemPrompt??[]).filter(s=>typeof s==='string').join('\n');return {uuid:r.uuid,segments:(r.attachment.systemPrompt??[]).length,alias:count(text,ALIAS),appended:HEADER.exec(text)?.slice(1,3).join(':')??null,style:styleLine?text.includes(styleLine):null};});
  const contexts=recs.filter(r=>r.type==='attachment'&&r.attachment?.type==='hook_additional_context').map(r=>({hookEvent:r.attachment.hookEvent??null,content:String(r.attachment.content).slice(0,200)}));
  const styles=recs.filter(r=>r.type==='attachment'&&r.attachment?.type==='output_style_instructions').map(r=>({owner:styleLine?JSON.stringify(r.attachment).includes(JSON.stringify(styleLine).slice(1,-1)):null,keys:Object.keys(r.attachment).sort()}));
  return {sessionId:id,exists:true,records:recs.length,boundaries:recs.filter(r=>r.type==='system'&&r.subtype==='compact_boundary').length,snapshots,contexts,styles};
 });
}
// The settings the engine reports in force: applied, the profile's keys of the effective settings, each source's keys.
const settingsOf=r=>({applied:r.applied??null,effective:{model:r.effective?.model??null,effortLevel:r.effective?.effortLevel??null,modelSettings:r.effective?.modelSettings??null,outputStyle:r.effective?.outputStyle??null,enabledPlugins:r.effective?.enabledPlugins??null,disableAllHooks:r.effective?.disableAllHooks??null,hooks:r.effective?.hooks?Object.fromEntries(Object.entries(r.effective.hooks).map(([k,v])=>[k,v.length])):null},sources:(r.sources??[]).map(s=>({source:s.source??null,keys:Object.keys(s.settings??{}).sort()}))});
// The engine's debug lines on loading plugins and hooks (not the built-in modules' chatter), copied into the fixture.
const DEBUG_RE=/plugin|marketplace|hook|output.?style|snapshot|disableAllHooks|enabledPlugins/i;
const DEBUG_NOISE=/settled in|cc-plugin-|\$\.\w+ \(|telemetry|Checking first line|Parsed initial|Initial response|Successfully parsed|settings\.read/;

// A recording curated to what the questions read, renumbered: the partial-message stream (`--include-partial-messages`)
// dropped, and the initialize answer reduced to its keys, output styles, command and agent names and models (the account
// to its keys). Idempotent: a curated recording is curated again to the same rows.
export function curateRows(rows){
 const prior=rows.find(r=>r.frame.event==='curated')?.frame.dropped?.stream_event??0;
 const initIds=new Set(rows.filter(r=>r.direction==='out'&&r.frame.type==='control_request'&&r.frame.request?.subtype==='initialize').map(r=>r.frame.request_id));
 let dropped=0;const kept=[];
 for(const r of rows){
  if(r.frame.event==='curated')continue;
  if(r.direction==='in'&&r.frame.type==='stream_event'){dropped++;continue;}
  const a=r.direction==='in'&&r.frame.type==='control_response'&&initIds.has(r.frame.response?.request_id)?r.frame.response.response:null;
  if(a&&!a.curated){
   kept.push({...r,frame:{...r.frame,response:{...r.frame.response,response:{curated:true,keys:Object.keys(a).sort(),output_style:a.output_style??null,available_output_styles:a.available_output_styles??null,commands:(a.commands??[]).map(c=>c.name),agents:(a.agents??[]).map(x=>x?.name??x),models:(a.models??[]).map(m=>({value:m.value,resolvedModel:m.resolvedModel??null})),account:a.account?Object.keys(a.account).sort():null}}}});
   continue;
  }
  kept.push(r);
 }
 kept.push({direction:'meta',at:new Date().toISOString(),frame:{event:'curated',dropped:{stream_event:prior+dropped},initializeAnswer:'reduced to its keys, output styles, command and agent names and models'}});
 return kept.map((r,i)=>({seq:i+1,direction:r.direction,at:r.at,frame:r.frame}));
}
const curate=file=>writeFileSync(file,curateRows(readFileSync(file,'utf8').trim().split('\n').map(JSON.parse)).map(r=>JSON.stringify(r)).join('\n')+'\n');

// One launch as MAWS launches it under `profile`; `steps` sent as turns, each step's requests noted beside it.
async function one(name,run,{api,arm,question,profile,group=profile.hooks!=='none',alias,steps,sessionId=randomUUID(),resume=null,fork=false,snapshotOff=false,relay=false,spendCap='0.01'}){
 const pinned=resume===null||fork;
 const flagSettings=flagSettingsFor(profile,{group});
 const append=appendFor(profile,alias===undefined?{}:{alias});
 currentAppend=append;
 const flags=[...PRODUCT_FLAGS,...(resume?['--resume',resume,...(fork?['--fork-session']:[])]:[]),...(pinned?['--session-id',sessionId]:[]),'--max-budget-usd',spendCap,'--append-system-prompt',append,...(snapshotOff?['--system-prompt-snapshot','off']:[]),'--settings',JSON.stringify(flagSettings),'--debug-file',run.debugFile];
 const env=engineEnv(run.home,{ANTHROPIC_BASE_URL:api.url,...(relay?{}:{ANTHROPIC_AUTH_TOKEN:'stub-token'})});
 const {configHome,globalConfig}=assertScratch(env);
 if(relay)await relayReady();
 const before=ownerTmpKeys();
 const out={sessionId:null,ids:new Set()};let failure;
 const p=await harnessRun(name,async p=>{
  p.note({event:'provenance',...PROVENANCE,arm,question,profile,profileSettings:launchProfile.profileSettings(profile),flagSettings,append,group,snapshotOff,resume,fork,pinnedSessionId:pinned?sessionId:null,configHome,globalConfig,envKeys:Object.keys(env).sort(),settings:JSON.parse(readFileSync(join(run.home,'settings.json'),'utf8')),api:relay?'the relay, through a recorder':'stub-api.mjs (nothing spent)'});
  p.note({event:'owner_file_check',phase:'before',count:before.length});
  p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});
  p.on('elicitation',r=>{p.note({event:'elicitation_seen'});return {action:'decline'};});
  p.on('ui_copy',()=>({copied:false}));p.on('ui_prompt_read',()=>({text:'',cursor:0}));p.on('ui_prompt_fill',()=>({filled:false}));p.on('ui_prompt_suggest',()=>({shown:false}));
  try{
   success(await p.init(initPayload(run.cwd)),'initialize');
   for(const [i,prompt] of steps.entries()){
    const at=api.requests().length;
    const result=await p.turn(prompt);
    await delay(800);
    p.note({event:'step',prompt,result:{subtype:result.subtype,is_error:result.is_error,total_cost_usd:result.total_cost_usd??null},session_id:p.sessionId,requests:api.requests().slice(at)});
    if(p.sessionId)out.ids.add(p.sessionId);
    if(i===0)p.note({event:'settings',...settingsOf(success(await p.request('get_settings',{},15000),'get_settings'))});
   }
   out.sessionId=p.sessionId;out.cost=p.frames.filter(r=>r.frame.type==='result').reduce((n,r)=>n+(r.frame.total_cost_usd??0),0);
   p.note({event:'inits',inits:initsOf(p)});
   p.note({event:'hooks',frames:hookFrames(p)});
   p.note({event:'disk',sessions:diskOf(run,[...out.ids])});
   check(p,'the engine sent a request',api.requests().length>0);
  }catch(e){failure=e;throw e;}
  finally{
   await endAsStop(p);
   const lines=existsSync(run.debugFile)?readFileSync(run.debugFile,'utf8').split('\n').filter(l=>DEBUG_RE.test(l.split(run.root).join(''))&&!DEBUG_NOISE.test(l)).map(l=>l.split(run.root).join('<root>').slice(0,300)):[];
   p.note({event:'debug_lines',count:lines.length,lines:lines.slice(0,160)});
   writeFileSync(run.debugFile,''); // each launch's own lines
   const last=p.frames.filter(r=>r.frame.type==='result').at(-1)?.frame;
   p.note({event:'spend',result:last?{subtype:last.subtype,is_error:last.is_error,num_turns:last.num_turns,total_cost_usd:last.total_cost_usd}:null});
  }
 },{cwd:run.cwd,env,bin:BIN,dir:'fixtures/p4/',noModel:true,settingSources:'user,project,local',strictMcp:false,mode:'default',flags});
 const exit=await p.closed;
 const after=ownerTmpKeys();const same=JSON.stringify(after)===JSON.stringify(before);
 p.note({event:'owner_file_check',phase:'after',count:after.length,same});
 curate(p.file);
 if(!same)throw new Error(name+': the owner\'s ~/.claude.json /tmp project keys changed');
 if(failure)throw failure;
 if(exit.code!==0)throw new Error(name+' exited with '+JSON.stringify(exit));
 return out;
}

// ---- the arms --------------------------------------------------------------------------------------------------
const USER=launchProfile.userScopeProfile();
export const PROFILES={
 plain:USER,
 plugins:{...USER,plugins:{off:OFF}},
 style:{...USER,outputStyle:'maws'},
 hooks:{...USER,hooks:'none'},
 full:{plugins:{off:OFF},outputStyle:'maws',hooks:'none'},
};

async function stubArms(run){
 const stub=await startStubApi({record,side:()=>textTurn('ok')});
 const api={url:stub.url,requests:()=>stub.requests};
 const next=()=>{stub.requests.length=0;};
 const opts={api};
 const ok=['Reply with OK.'];
 try{
  const plain=await one('p4-a2p-stub-plain',run,{...opts,arm:'plain',profile:PROFILES.plain,steps:ok,question:'the user scope: the model, effort, plugins and style the user\'s settings give, the user\'s hooks and MAWS\'s group running'});next();
  await one('p4-a2p-stub-plugins',run,{...opts,arm:'plugins',profile:PROFILES.plugins,steps:ok,question:'plugins off at flag level: the user set less the off ids, nothing else changed'});next();
  await one('p4-a2p-stub-style',run,{...opts,arm:'style',profile:PROFILES.style,steps:ok,question:'style maws: the engine\'s default style, MAWS\'s full contract appended'});next();
  await one('p4-a2p-stub-hooks-group',run,{...opts,arm:'hooks-group',profile:PROFILES.hooks,group:true,alias:false,steps:ok,question:'hooks none with MAWS\'s group still in the flag JSON (the route not taken): does the group run'});next();
  const hooks=await one('p4-a2p-stub-hooks',run,{...opts,arm:'hooks',profile:PROFILES.hooks,steps:['Reply with OK.','/compact','Reply with OK again.','/clear','Reply with OK once more.'],question:'hooks none, the route (the alias appended): the user\'s hooks silent; the alias in the system prompt at startup, after /compact and after /clear'});next();
  await one('p4-a2p-stub-hooks-resume',run,{...opts,arm:'hooks',profile:PROFILES.hooks,resume:hooks.sessionId,snapshotOff:true,steps:['Reply with OK after the resume.'],question:'hooks none: a --resume with snapshot off'});next();
  await one('p4-a2p-stub-hooks-fork',run,{...opts,arm:'hooks',profile:PROFILES.hooks,resume:hooks.sessionId,fork:true,snapshotOff:true,steps:['Reply with OK in the fork.'],question:'hooks none: a --fork-session with snapshot off, pinned as MAWS pins a fork'});next();
  await one('p4-a2p-stub-hooks-user-kept',run,{...opts,arm:'hooks',profile:PROFILES.hooks,resume:plain.sessionId,steps:['Reply with OK after the kept resume.'],question:'hooks none: a --resume of the user-scope session WITHOUT snapshot off: does the recorded snapshot drop the new append'});next();
  await one('p4-a2p-stub-hooks-user',run,{...opts,arm:'hooks',profile:PROFILES.hooks,resume:plain.sessionId,snapshotOff:true,steps:['Reply with OK after the live resume.'],question:'hooks none: a --resume of the user-scope session (no alias in its snapshot) with snapshot off'});next();
  await one('p4-a2p-stub-full',run,{...opts,arm:'full',profile:PROFILES.full,steps:ok,question:'all three fields: plugins off, style maws, hooks none (the contract and the alias appended)'});
 }finally{await stub.close();}
}

const RELAY_STOP=0.45;
async function relayArms(run){
 const recorded=[];
 const {server,port}=await startRecorder(x=>recorded.push(x));
 const api={url:`http://127.0.0.1:${port}`,requests:()=>recorded.filter(x=>x.path?.startsWith('/v1/messages')&&!x.path.includes('count_tokens')&&x.body).map(x=>{let body=null;try{body=JSON.parse(x.body.toString('utf8'));}catch{}return {status:x.status,...(body?record(body):{}),answer:answerOf(x)};})};
 const opts={api,relay:true,spendCap:'0.40',steps:[QUESTION]};
 try{
  const first=await one('p4-a2p-relay-plain',run,{...opts,arm:'plain',profile:PROFILES.plain,question:'the user scope on the owner\'s model: R7y\'s question'});recorded.length=0;
  // the budget: the second launch only while the first left it well under US$1
  if(!(first.cost<RELAY_STOP))throw new Error(`refused: p4-a2p-relay-plain reported US$${first.cost}; the second relay launch would risk the US$1 budget`);
  await one('p4-a2p-relay-full',run,{...opts,arm:'full',profile:PROFILES.full,question:'all three fields on the owner\'s model: R7y\'s question, the alias only in the appended prompt'});
 }finally{server.close();}
}

// The home's fixture: what was seeded, and what changed between the manifest before the first launch and after the last.
function homeFixture(run,seeded,before,after,arms){
 const seededPaths=Object.keys(before).filter(p=>p!=='.claude.json'&&!before[p].dir).sort();
 const changes=[];
 for(const p of new Set([...Object.keys(before),...Object.keys(after)])){
  const a=before[p],b=after[p];
  const kind=!a?'added':!b?'removed':JSON.stringify(a)!==JSON.stringify(b)?'changed':null;
  if(kind)changes.push({path:p,kind,class:classOf(p),...(b&&!b.dir?{size:b.size??null}:{}),...(b?.dir?{dir:true}:{})});
 }
 changes.sort((x,y)=>x.path<y.path?-1:1);
 const seededBefore=seededPaths.map(p=>[p,before[p]]);const seededAfter=seededPaths.map(p=>[p,after[p]??null]);
 const globalKeys=f=>{try{return Object.keys(JSON.parse(readFileSync(f,'utf8'))).sort();}catch{return null;}};
 const classes={};for(const c of changes)classes[c.class]=(classes[c.class]??0)+1;
 const rows=[
  {event:'provenance',...PROVENANCE,arms,home:'the scratch config home (CLAUDE_CONFIG_DIR), hashed before the first launch and after the last'},
  {event:'seeded',settings:seeded.settings,registry:seeded.registry,markets:seeded.markets,migrations:seeded.migrations,copied:seeded.copied,files:seededPaths.length,bytes:seededPaths.reduce((n,p)=>n+(before[p].size??0),0),readOnly:seededPaths.every(p=>before[p].link||!/[2367]/.test(before[p].mode)),globalConfig:'.claude.json: p1-common scratchRun\'s (onboarding and the cwd\'s trust) with the owner\'s migration state; the engine\'s own state file, left writable'},
  {event:'manifest',phase:'before',entries:Object.keys(before).length,seededDigest:digestOf(seededBefore)},
  {event:'manifest',phase:'after',entries:Object.keys(after).length,seededDigest:digestOf(seededAfter),seededSame:digestOf(seededBefore)===digestOf(seededAfter),seededChanged:seededPaths.filter(p=>JSON.stringify(before[p])!==JSON.stringify(after[p]??null)).map(p=>({path:p,before:before[p],after:after[p]??null,...(p.endsWith('.json')&&after[p]?.size<65536?{content:readFileSync(join(run.home,p),'utf8')}:{})}))},
  {event:'changes',count:changes.length,classes,other:changes.filter(c=>c.class==='other').map(c=>c.path),changes},
  {event:'global_config',keysBefore:seeded.globalKeys,keysAfter:globalKeys(join(run.home,'.claude.json'))},
  // after the last launch: each transcript's prompt snapshots (what a later resume without "off" reuses)
  {event:'transcripts',sessions:diskOf(run,readdirSync(dirname(transcriptPath(run,'x'))).filter(f=>f.endsWith('.jsonl')).map(f=>f.slice(0,-6)).sort()).map(({sessionId,records,boundaries,snapshots})=>({sessionId,records,boundaries,snapshots:snapshots.map(({alias,appended})=>({alias,appended}))}))},
 ];
 writeFileSync(FIXTURES+'p4-a2p-home.jsonl',rows.map((frame,i)=>JSON.stringify({seq:i+1,direction:'meta',at:new Date().toISOString(),frame})).join('\n')+'\n');
 return rows;
}

export default async()=>{
 console.log('engine',ENGINE_VERSION,BIN);
 const arms=(process.env.A2P_ARM??'stub').split(','); // read before a launch clears the environment
 const run=scratchRun('a2p');
 try{
  mkdirSync(join(run.home,'plugins'),{recursive:true});
  const seeded=seed(run);
  styleLine=readFileSync(join(run.home,'plugins','cache',seeded.copied[0].to.slice('plugins/cache/'.length),'output-styles','to-human.md'),'utf8').split('\n---\n')[1].trim().split('\n')[0];
  seeded.globalKeys=Object.keys(JSON.parse(readFileSync(join(run.home,'.claude.json'),'utf8'))).sort();
  const files=Object.entries(manifest(run.home)).filter(([p,e])=>p!=='.claude.json'&&!e.dir&&!e.link).map(([p])=>p);
  readOnly(run.home,files);
  const before=manifest(run.home);
  if(arms.includes('stub'))await stubArms(run);
  if(arms.includes('relay'))await relayArms(run);
  const after=manifest(run.home);
  const rows=homeFixture(run,seeded,before,after,arms);
  console.log('p4-a2p-home',JSON.stringify({seededSame:rows[3].seededSame,changes:rows[4].count,classes:rows[4].classes,other:rows[4].other}));
 }finally{
  // the copies are read-only: write permission back on the files so the run's root can be removed
  try{for(const [p,e] of Object.entries(manifest(run.home)))if(!e.dir&&!e.link)chmodSync(join(run.home,p),0o644);}catch{}
  removeRun(run);
 }
};
