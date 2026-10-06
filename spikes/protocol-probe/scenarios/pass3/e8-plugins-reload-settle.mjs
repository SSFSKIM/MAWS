// E8 G0, second question (docs/doperpowers/plans/2026-10-05-e8-plugins.md, G0): `e8-plugins-reload` showed a
// `reload_plugins` issued right after a CLI write answering from the engine's previous settings snapshot (disable →
// still listed; enable → gone; install → never back, even at the next turn's init). Two questions decide MAWS's reload
// design: (Q1) does a `reload_plugins` issued after a settling delay reflect the CLI's write, and does a second reload
// right after the first agree with it; (Q2) does the engine apply a settings change on its own at the next turn, with
// no reload at all. Same launch line and scratch home as the first probe; the engine's debug log is kept in the scratch
// and its plugin and settings lines are copied into the fixture as notes.
// Usage: E8_ROOT=/tmp/e8-g0/run1 E8_BIN=/Users/new/.local/share/claude/versions/2.1.290 E8_SETTLE_MS=4000 node run-pass3.mjs e8-plugins-reload-settle
import {run as harnessRun,scratch,delay} from '../../harness.mjs';
import {assertScratch,RELAY_ENV,success,check,endAsStop,initFrame} from './c10-common.mjs';
import {clearEngineEnvironment} from './mods-environment.mjs';
import {appInitialize} from '../../../../src/shared/engine/initialize.ts';
import {existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const ROOT=process.env.E8_ROOT;const BIN=process.env.E8_BIN;const SETTLE=Number(process.env.E8_SETTLE_MS??'4000');
if(!ROOT||!BIN)throw new Error('E8_ROOT and E8_BIN are required');
const HOME=join(ROOT,'claude-config');
if(!existsSync(join(HOME,'plugins','installed_plugins.json')))throw new Error('run probe-cli.sh first: the scratch home holds no installed plugin');
const PRODUCT_FLAGS=['--forward-subagent-text','--replay-user-messages','--include-hook-events','--settings',JSON.stringify({dialogExpiry:'never'})];
const PLUGIN='e8-probe@e8-scratch';

function cli(env,...args){
 let stdout='',stderr='',code=0;
 try{stdout=execFileSync(BIN,['plugin',...args,'--json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
 catch(e){stdout=e.stdout??'';stderr=e.stderr??'';code=e.status??-1;}
 const last=stdout.trim().split('\n').filter(Boolean).at(-1)??'';
 let json=null;try{json=JSON.parse(stdout);}catch{try{json=JSON.parse(last);}catch{}}
 return {args,code,json,stderr:stderr.trim().slice(0,400)};
}
const settings=()=>JSON.parse(readFileSync(join(HOME,'settings.json'),'utf8'));
const names=r=>(r.plugins??[]).map(p=>p.name??p);
const pick=r=>({plugins:names(r),commands:(r.commands??[]).map(c=>c.name??c).filter(n=>/e8/.test(String(n))),error_count:r.error_count??null});
const has=r=>names(r).includes('e8-probe');
const DEBUG_LINES=/plugin|enabledPlugins|settings\.json|setting(s)? (changed|reload|watch)|marketplace/i;

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
 const debugFile=join(ROOT,`debug-settle-${Date.now()}.log`);
 // the plugin starts enabled and installed, as probe-cli.sh left it (the first probe reinstalled it at its end)
 const pre=cli(cliEnv,'list');const preRow=(pre.json??[]).find(r=>r.id===PLUGIN);
 if(!preRow)throw new Error('e8-probe is not installed: '+JSON.stringify(pre));
 if(!preRow.enabled){const en=cli(cliEnv,'enable',PLUGIN);if(en.json?.outcome!=='ok')throw new Error('could not enable: '+JSON.stringify(en));}
 const p=await harnessRun('e8-plugins-reload-settle',async p=>{
  p.note({event:'provenance',charter:'docs/charter.md',spec:'docs/doperpowers/plans/2026-10-05-p1-extension.md',child:'E8',pin:'f11ae359af82c86831f052140683ed620dd25500',document:'docs/doperpowers/plans/2026-10-05-e8-plugins.md',question:'G0 Q1: reload after a settling delay reflects the CLI write; Q2: the engine applies a settings change at the next turn without a reload',settleMs:SETTLE,engine:BIN,configHome,globalConfig,pinnedSessionId:sessionId,envKeys:Object.keys(env).sort(),settings:settings()});
  p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});
  p.on('elicitation',()=>({action:'decline'}));
  success(await p.init(appInitialize({accepted:true,directory:cwd})),'initialize');
  const initAfterTurn=async label=>{const before=p.seq;await p.turn('Reply with exactly E8_OK');const f=p.frames.find(r=>r.seq>before&&r.frame.type==='system'&&r.frame.subtype==='init')?.frame;p.note({event:'init',label,plugins:(f?.plugins??[]).map(x=>x.name),e8:(f?.plugins??[]).some(x=>x.name==='e8-probe')});return f;};
  const reload=async label=>{const r=success(await p.request('reload_plugins',{},60000),'reload_plugins '+label);p.note({event:'reload',label,...pick(r)});return r;};
  const step=async(label,...args)=>{const c=cli(cliEnv,...args);p.note({event:'cli',label,...c,enabledPlugins:settings().enabledPlugins});check(p,'cli '+label+' ok',c.json?.outcome==='ok',c);};

  const f0=await initAfterTurn('start');
  check(p,'init lists e8-probe at start',(f0?.plugins??[]).some(x=>x.name==='e8-probe'));
  const r0=await reload('baseline');

  // Q2: disable, wait, no reload, a turn: does init reflect the disable on its own?
  await step('disable',  'disable',PLUGIN);
  await delay(SETTLE);
  const f1=await initAfterTurn('after disable, no reload');
  // Q1: now the reload, and a second one right after
  const r1a=await reload('after disable, settled');
  const r1b=await reload('after disable, second');

  await step('enable','enable',PLUGIN);
  await delay(SETTLE);
  const r2a=await reload('after enable, settled');
  const r2b=await reload('after enable, second');

  await step('uninstall','uninstall',PLUGIN);
  await delay(SETTLE);
  const r3a=await reload('after uninstall, settled');
  const r3b=await reload('after uninstall, second');

  await step('install','install',PLUGIN);
  await delay(SETTLE);
  const r4a=await reload('after install, settled');
  const r4b=await reload('after install, second');
  const f4=await initAfterTurn('after install and reload');

  p.note({event:'e8_summary',settleMs:SETTLE,baseline:has(r0),
   q2_init_applies_disable_without_reload:!(f1?.plugins??[]).some(x=>x.name==='e8-probe'),
   q1_disable:{first:!has(r1a),second:!has(r1b)},q1_enable:{first:has(r2a),second:has(r2b)},q1_uninstall:{first:!has(r3a),second:!has(r3b)},q1_install:{first:has(r4a),second:has(r4b)},
   init_after_install:(f4?.plugins??[]).some(x=>x.name==='e8-probe')});
  if(existsSync(debugFile)){const lines=readFileSync(debugFile,'utf8').split('\n').filter(l=>DEBUG_LINES.test(l)).map(l=>l.slice(0,400));p.note({event:'debug_lines',count:lines.length,lines:lines.slice(0,200)});}
  await endAsStop(p);
 },{cwd,env,bin:BIN,dir:'fixtures/pass3/',model:'haiku',settingSources:'user,project,local',strictMcp:false,mode:'default',flags:[...PRODUCT_FLAGS,'--session-id',sessionId,'--max-budget-usd','0.25','--debug-file',debugFile]});
 const exit=await p.closed;
 console.log('exit',JSON.stringify(exit));
};
