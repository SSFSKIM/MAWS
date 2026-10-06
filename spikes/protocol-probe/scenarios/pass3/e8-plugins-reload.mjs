// E8 G0 (docs/doperpowers/plans/2026-10-05-p1-extension.md §9 E8, parent pin f11ae359af82c86831f052140683ed620dd25500;
// execution document docs/doperpowers/plans/2026-10-05-e8-plugins.md): what `reload_plugins` and `reload_skills` answer
// on the installed engine, and whether a live session reflects a plugin the CLI disabled, enabled, or installed after
// the session started. One launch as MAWS launches (buildEnvironment's constants, the relay, `--setting-sources
// user,project,local`), no user turn (zero cost), under the scratch CLAUDE_CONFIG_DIR the E8 CLI probe prepared
// (E8_ROOT/claude-config, holding `e8-probe@e8-scratch` installed and enabled from the scratch directory marketplace
// E8_ROOT/market). The CLI runs between control requests, with the same CLAUDE_CONFIG_DIR, as MAWS's runner will.
// Usage: E8_ROOT=/tmp/e8-g0/run1 E8_BIN=/Users/new/.local/share/claude/versions/2.1.290 node run-pass3.mjs e8-plugins-reload
import {run as harnessRun,scratch} from '../../harness.mjs';
import {assertScratch,RELAY_ENV,success,check,endAsStop,initFrame} from './c10-common.mjs';
import {clearEngineEnvironment} from './mods-environment.mjs';
import {appInitialize} from '../../../../src/shared/engine/initialize.ts';
import {existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const ROOT=process.env.E8_ROOT;const BIN=process.env.E8_BIN;
if(!ROOT||!BIN)throw new Error('E8_ROOT and E8_BIN are required');
const HOME=join(ROOT,'claude-config');
if(!existsSync(join(HOME,'plugins','installed_plugins.json')))throw new Error('run probe-cli.sh first: the scratch home holds no installed plugin');
const PRODUCT_FLAGS=['--forward-subagent-text','--replay-user-messages','--include-hook-events','--settings',JSON.stringify({dialogExpiry:'never'})];
const PLUGIN='e8-probe@e8-scratch';

// The CLI as MAWS's runner will call it: the engine binary by absolute path, --json, the same config home.
function cli(env,...args){
 let stdout='',stderr='',code=0;
 try{stdout=execFileSync(BIN,['plugin',...args,'--json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
 catch(e){stdout=e.stdout??'';stderr=e.stderr??'';code=e.status??-1;}
 const last=stdout.trim().split('\n').filter(Boolean).at(-1)??'';
 let json=null;try{json=JSON.parse(stdout);}catch{try{json=JSON.parse(last);}catch{}}
 return {args,code,json,stderr:stderr.trim().slice(0,400)};
}
const settings=()=>JSON.parse(readFileSync(join(HOME,'settings.json'),'utf8'));
const pluginNames=r=>(r.plugins??[]).map(p=>p.name??p);
const pick=(r)=>({keys:Object.keys(r??{}).sort(),commands:(r.commands??[]).map(c=>c.name??c).filter(n=>/e8/.test(String(n))),agents_count:(r.agents??[]).length,plugins:pluginNames(r),mcpServers:r.mcpServers??null,error_count:r.error_count??null,held:r.held??null,cache_impact:r.cache_impact??null,skills:(r.skills??[]).map(s=>s.name??s).filter(n=>/e8/.test(String(n)))});

export default async()=>{
 const cwd=realpathSync(scratch(join(ROOT,'repo-')));
 const gc=join(HOME,'.claude.json');const state=JSON.parse(readFileSync(gc,'utf8'));
 writeFileSync(gc,JSON.stringify({...state,projects:{...(state.projects??{}),[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}})+'\n');
 clearEngineEnvironment();
 const env={CLAUDE_CONFIG_DIR:HOME,...RELAY_ENV,ENABLE_TOOL_SEARCH:'true',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',TERM:'dumb',DISABLE_AUTOUPDATER:'1'};
 const {configHome,globalConfig}=assertScratch(env);
 const cliEnv={...process.env,CLAUDE_CONFIG_DIR:HOME,DISABLE_AUTOUPDATER:'1'};
 delete cliEnv.CLAUDECODE;delete cliEnv.CLAUDE_CODE_ENTRYPOINT;delete cliEnv.CLAUDE_CODE_SSE_PORT;
 const sessionId=randomUUID();
 const p=await harnessRun('e8-plugins-reload',async p=>{
  p.note({event:'provenance',charter:'docs/charter.md',spec:'docs/doperpowers/plans/2026-10-05-p1-extension.md',child:'E8',pin:'f11ae359af82c86831f052140683ed620dd25500',document:'docs/doperpowers/plans/2026-10-05-e8-plugins.md',question:'G0: reload_plugins and reload_skills answers; does a live session reflect CLI disable, enable and install',engine:BIN,configHome,globalConfig,pinnedSessionId:sessionId,envKeys:Object.keys(env).sort(),settings:settings()});
  p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});
  p.on('elicitation',()=>({action:'decline'}));
  const init=success(await p.init(appInitialize({accepted:true,directory:cwd})),'initialize');
  // system/init arrives with the first user message (fixtures/reads.jsonl seq 4 → 7), and again at every later turn
  // (pass2/auto-routed seq 9, 48, 87): one minimal turn on haiku through the relay shows what the session loaded.
  await p.turn('Reply with exactly E8_OK');
  const frame=initFrame(p);
  const initSummary=f=>({plugins:f?.plugins??null,plugin_errors:f?.plugin_errors??null,plugin_warnings:f?.plugin_warnings??null,skills:(f?.skills??[]).filter(s=>/e8/.test(String(s.name??s))),slash_commands:(f?.slash_commands??[]).filter(s=>/e8/.test(String(s)))});
  p.note({event:'init_summary',capabilities:init.capabilities??null,...initSummary(frame)});
  check(p,'init lists e8-probe',(frame?.plugins??[]).some(x=>x.name==='e8-probe'),frame?.plugins);

  // 1. the two reloads as the engine answers them with nothing changed
  const r1=success(await p.request('reload_plugins',{},60000),'reload_plugins');
  p.note({event:'reload_plugins_1',...pick(r1)});
  const s1=success(await p.request('reload_skills',{},60000),'reload_skills');
  p.note({event:'reload_skills_1',keys:Object.keys(s1).sort(),skills_total:(s1.skills??[]).length,e8:(s1.skills??[]).map(s=>s.name??s).filter(n=>/e8/.test(String(n))),sample:(s1.skills??[]).slice(0,2)});
  const d1=success(await p.request('get_skills_dialog',{},30000),'get_skills_dialog');
  p.note({event:'skills_dialog_1',total:(d1.skills??[]).length,e8:(d1.skills??[]).filter(s=>/e8/.test(JSON.stringify(s)))});
  const h1=success(await p.request('reload_plugins',{hold_on_cache_impact:true},60000),'reload_plugins hold');
  p.note({event:'reload_plugins_hold',...pick(h1)});

  // 2. the CLI disables the plugin while the session lives; does a reload drop it?
  const dis=cli(cliEnv,'disable',PLUGIN);p.note({event:'cli',...dis,enabledPlugins:settings().enabledPlugins});
  check(p,'cli disable ok',dis.json?.outcome==='ok',dis);
  const r2=success(await p.request('reload_plugins',{},60000),'reload_plugins after disable');
  p.note({event:'reload_plugins_after_disable',...pick(r2)});
  const d2=success(await p.request('get_skills_dialog',{},30000),'get_skills_dialog');
  p.note({event:'skills_dialog_after_disable',total:(d2.skills??[]).length,e8:(d2.skills??[]).filter(s=>/e8/.test(JSON.stringify(s)))});

  // 3. enable again; does a reload bring it back?
  const en=cli(cliEnv,'enable',PLUGIN);p.note({event:'cli',...en,enabledPlugins:settings().enabledPlugins});
  check(p,'cli enable ok',en.json?.outcome==='ok',en);
  const r3=success(await p.request('reload_plugins',{},60000),'reload_plugins after enable');
  p.note({event:'reload_plugins_after_enable',...pick(r3)});

  // 4. uninstall, reload, install again, reload: the install path a session must reflect
  const un=cli(cliEnv,'uninstall',PLUGIN);p.note({event:'cli',...un,enabledPlugins:settings().enabledPlugins});
  check(p,'cli uninstall ok',un.json?.outcome==='ok',un);
  const r4=success(await p.request('reload_plugins',{},60000),'reload_plugins after uninstall');
  p.note({event:'reload_plugins_after_uninstall',...pick(r4)});
  const ins=cli(cliEnv,'install',PLUGIN);p.note({event:'cli',...ins,enabledPlugins:settings().enabledPlugins});
  check(p,'cli install ok',ins.json?.outcome==='ok',ins);
  const r5=success(await p.request('reload_plugins',{},60000),'reload_plugins after install');
  p.note({event:'reload_plugins_after_install',...pick(r5)});
  const s5=success(await p.request('reload_skills',{},60000),'reload_skills after install');
  p.note({event:'reload_skills_after_install',skills_total:(s5.skills??[]).length,e8:(s5.skills??[]).map(s=>s.name??s).filter(n=>/e8/.test(String(n)))});
  const d5=success(await p.request('get_skills_dialog',{},30000),'get_skills_dialog');
  p.note({event:'skills_dialog_after_install',total:(d5.skills??[]).length,e8:(d5.skills??[]).filter(s=>/e8/.test(JSON.stringify(s)))});

  // a second turn: does the next init frame (what MAWS's status and /plugins list draw from) reflect the reinstall?
  const before=p.seq;
  await p.turn('Reply with exactly E8_OK');
  const frame2=p.frames.find(r=>r.seq>before&&r.frame.type==='system'&&r.frame.subtype==='init')?.frame;
  p.note({event:'init_summary_after_install',...initSummary(frame2)});
  p.note({event:'e8_summary',init_after_install_lists:(frame2?.plugins??[]).some(x=>x.name==='e8-probe'),reflects_disable:!pluginNames(r2).includes('e8-probe'),reflects_enable:pluginNames(r3).includes('e8-probe'),reflects_uninstall:!pluginNames(r4).includes('e8-probe'),reflects_install:pluginNames(r5).includes('e8-probe'),reload_plugins_keys:Object.keys(r1).sort(),reload_skills_keys:Object.keys(s1).sort()});
  await endAsStop(p);
 },{cwd,env,bin:BIN,dir:'fixtures/pass3/',model:'haiku',settingSources:'user,project,local',strictMcp:false,mode:'default',flags:[...PRODUCT_FLAGS,'--session-id',sessionId,'--max-budget-usd','0.10']});
 const exit=await p.closed;
 console.log('exit',JSON.stringify(exit));
};
