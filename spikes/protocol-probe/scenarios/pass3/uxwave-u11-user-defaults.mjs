// UX wave U11, l8-settings-11 (the U11 draft's "Probes and checks": does the engine take `model` and
// `permissions.defaultMode` from the user settings file, under MAWS's launch and in a terminal): engine 2.1.322 under
// vm-run.sh's scratch HOME (no --managed), whose config home is $HOME/.claude (MAWS sets no CLAUDE_CONFIG_DIR, as the
// owner's sessions do not). Run as ./vm-run.sh --prefix <p> run run-pass3.mjs uxwave-u11-user-defaults.
//
// Each case writes $HOME/.claude/settings.json (and, where it says, the work folder's .claude/settings.json) before the
// engine starts, then reads what the engine reports and what the file holds afterwards:
//   maws-*  the launch as MAWS launches (uxwave-common-arrivals.mjs mawsLaunch: src/engine-host/launch.ts's flags, setting
//           sources user,project,local, MAWS's environment and initialize), with no --model and no --permission-mode
//           unless the case names one; one turn ("reply with only OK"), so `system/init` is sent; init's `model` and
//           `permissionMode`, the assistant frames' model, the result.
//   term-*  an interactive engine in tmux, plain (no --model, no --permission-mode unless named): the banner and the
//           footer as drawn, one turn, and the assistant rows' model and the user rows' permissionMode in its
//           transcript file.
//   write-* the file's bytes before and after the engine's own write (the terminal's /model), and whether the engine
//           rewrites the file at start (a hand-laid file; legacy model names, with the once-per-version migrations
//           re-armed by removing migrationVersion from $HOME/.claude.json).
// Written: fixtures/uxwave/<tag>.json (every case's record) and the MAWS cases' journals fixtures/uxwave/<tag>-<case>.jsonl.
import {mawsLaunch,turn,idle,delay,BIN,ENGINE_VERSION,FIXTURES,slug} from './uxwave-common-arrivals.mjs';
import {redact} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const TAG=process.env.UXW_TAG||'u11-user-defaults';
const ONLY=(process.env.UXW_CASES||'').split(',').filter(Boolean);
const HOME=process.env.HOME, WORK=process.env.PROBE_WORK;
const USER_FILE=join(HOME,'.claude/settings.json'), PROJECT_FILE=join(WORK,'.claude/settings.json'), GLOBAL=join(HOME,'.claude.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytesOf=f=>existsSync(f)?readFileSync(f):null;
const fileState=f=>{const b=bytesOf(f);if(b===null)return {exists:false};const t=b.toString('utf8');let parsed=null;try{parsed=JSON.parse(t);}catch{}return {exists:true,bytes:b.length,sha256:sha(b),text:t,parsed,twoSpaceFinalNewline:parsed!==null&&t===JSON.stringify(parsed,null,2)+'\n'};};
const put=(f,v)=>{if(v===undefined){rmSync(f,{force:true});return;}mkdirSync(join(f,'..'),{recursive:true});writeFileSync(f,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');};
const migrationVersion=()=>{try{return JSON.parse(readFileSync(GLOBAL,'utf8')).migrationVersion??null;}catch{return null;}};
const rearmMigrations=()=>{const d=JSON.parse(readFileSync(GLOBAL,'utf8'));delete d.migrationVersion;writeFileSync(GLOBAL,JSON.stringify(d));};
const record={provenance:{probe:'U11 l8-settings-11 (spec draft U11-answered.md, Probes and checks)',engineVersion:ENGINE_VERSION,engine:BIN,route:'gateway (vm-run.sh loopback forward)',configHome:'$HOME/.claude (scratch)'},cases:[]};
const want=name=>ONLY.length===0||ONLY.includes(name);

async function maws(name,{user,project,model=null,mode=null,rearm=false,after=null}){
 if(!want(name))return;
 put(USER_FILE,user);put(PROJECT_FILE,project);if(rearm)rearmMigrations();
 const entry={case:name,route:'maws',flags:{model,mode},user:fileState(USER_FILE),project:project===undefined?null:fileState(PROJECT_FILE),migrationVersionBefore:migrationVersion()};
 try{
  await mawsLaunch(TAG+'-'+name,{model,mode,spendCap:'0.50',provenance:{probe:'U11 l8-settings-11',case:name}},async p=>{
   const t=await turn(p,'Without using any tool, reply with only the word OK.',120000);
   const init=p.frames.map(r=>r.frame).find(f=>f.type==='system'&&f.subtype==='init');
   const assistants=p.frames.filter(r=>r.frame.type==='assistant').map(r=>r.frame.message?.model);
   entry.init=init?{seq:p.frames.find(r=>r.frame===init).seq,model:init.model,permissionMode:init.permissionMode}:null;
   entry.assistantModels=[...new Set(assistants)];
   entry.result=t.result?{subtype:t.result.subtype,is_error:t.result.is_error,text:String(t.result.result??'').slice(0,300),errors:t.result.errors??null}:null;
   entry.stderr=p.frames.length?undefined:undefined;
   entry.fixture='fixtures/uxwave/'+TAG+'-'+name+'.jsonl';
   const stat=await p.request('get_settings',{},10000).catch(()=>null);
   if(stat?.subtype==='success'){const s=stat.response??{};entry.getSettings={model:s.effective?.model??s.model??null,defaultMode:s.effective?.permissions?.defaultMode??null,keys:Object.keys(s),...(s.errors?{errors:s.errors}:{})};}
   if(after){entry.after=await after(p);await delay(2000);}
  });
 }catch(e){entry.error=e.message;}
 entry.userAfter=fileState(USER_FILE);entry.userChanged=entry.user.sha256!==entry.userAfter.sha256;entry.migrationVersionAfter=migrationVersion();
 if(!entry.userChanged)delete entry.userAfter.text;
 record.cases.push(entry);console.log(name,JSON.stringify({init:entry.init,assistantModels:entry.assistantModels,result:entry.result?.subtype,error:entry.error,userChanged:entry.userChanged}));
}

const transcripts=()=>{const dir=join(HOME,'.claude/projects',slug(WORK));return existsSync(dir)?readdirSync(dir).filter(n=>n.endsWith('.jsonl')).map(n=>join(dir,n)):[];};
async function term(name,{user,project,flags=[],commands=[],rearm=false}){
 if(!want(name))return;
 put(USER_FILE,user);put(PROJECT_FILE,project);if(rearm)rearmMigrations();
 const entry={case:name,route:'terminal',flags,user:fileState(USER_FILE),project:project===undefined?null:fileState(PROJECT_FILE),migrationVersionBefore:migrationVersion()};
 const sock='p2b-u11-'+process.pid+'-'+name;
 const tmux=(...a)=>execFileSync('tmux',['-L',sock,...a],{encoding:'utf8'});
 const pane=()=>tmux('capture-pane','-p','-t',sock);
 const type=async text=>{tmux('send-keys','-t',sock,'-l',text);await delay(500);tmux('send-keys','-t',sock,'Enter');};
 const until=async(test,timeout,step=1000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await test();if(v)return v;await delay(step);}return null;};
 const busy=()=>/esc to interrupt/i.test(pane());
 const quiet=()=>until(async()=>{if(busy())return false;await delay(3000);return !busy();},120000,2000);
 const trim=s=>s.split('\n').map(l=>l.trimEnd()).filter(Boolean);
 const before=new Set(transcripts());
 try{
  tmux('new-session','-d','-s',sock,'-x','160','-y','48','-c',WORK,'-e','TERM=xterm-256color',BIN,...flags);
  await until(()=>/❯|auto mode|for shortcuts/.test(pane()),60000);await delay(4000);
  entry.paneAtStart=trim(pane());
  entry.userAtStart=fileState(USER_FILE);entry.userChangedAtStart=entry.user.sha256!==entry.userAtStart.sha256;if(!entry.userChangedAtStart)delete entry.userAtStart.text;
  await type('Without using any tool, reply with only the word OK.');await delay(5000);await quiet();
  entry.paneAfterTurn=trim(pane()).slice(-8);
  for(const c of commands){await type(c);await delay(4000);await quiet();entry.panes=[...(entry.panes??[]),{command:c,pane:trim(pane()).slice(-10)}];}
  const t=transcripts().find(f=>!before.has(f))??null;
  const rows=t?readFileSync(t,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return {};}}):[];
  entry.assistantModels=[...new Set(rows.filter(r=>r.type==='assistant').map(r=>r.message?.model))];
  entry.userRowModes=[...new Set(rows.filter(r=>r.type==='user'&&r.permissionMode!==undefined).map(r=>r.permissionMode))];
  entry.assistantText=rows.filter(r=>r.type==='assistant').flatMap(r=>(r.message?.content??[]).filter(b=>b.type==='text').map(b=>b.text)).slice(-3);
 }catch(e){entry.error=e.message;entry.pane=(()=>{try{return trim(pane());}catch{return null;}})();}
 finally{try{tmux('kill-server');}catch{}}
 await delay(1500);
 entry.userAfter=fileState(USER_FILE);entry.userChanged=entry.user.sha256!==entry.userAfter.sha256;entry.migrationVersionAfter=migrationVersion();
 if(!entry.userChanged)delete entry.userAfter.text;
 record.cases.push(entry);console.log(name,JSON.stringify({assistantModels:entry.assistantModels,modes:entry.userRowModes,footer:entry.paneAtStart?.slice(-3),userChanged:entry.userChanged,error:entry.error}));
}

export default async()=>{
 if(!HOME?.startsWith('/tmp/'))throw new Error('HOME is not a scratch folder');
 mkdirSync(FIXTURES,{recursive:true});
 const HAND='{\n    "zzUnknownKey": [1, 2],\n    "model": "claude-haiku-5-5",\n    "permissions": {"allow": ["Bash(ls:*)"], "defaultMode": "acceptEdits"}\n}';
 try{
  // MAWS's launch: the model
  await maws('maws-none',{user:{}});
  await maws('maws-model-alias',{user:{model:'haiku'}});
  await maws('maws-model-id',{user:{model:'claude-haiku-5-5'}});
  await maws('maws-model-flag',{user:{model:'sonnet'},model:'haiku'});
  await maws('maws-model-unknown',{user:{model:'no-such-model-p2b'}});
  await maws('maws-model-project',{user:{model:'sonnet'},project:{model:'haiku'}});
  // MAWS's launch: the mode (model by flag, to keep every turn on haiku)
  for(const m of ['acceptEdits','plan','default','auto'])await maws('maws-mode-'+m,{user:{permissions:{defaultMode:m}},model:'haiku'});
  await maws('maws-mode-flag',{user:{permissions:{defaultMode:'plan'}},model:'haiku',mode:'acceptEdits'});
  await maws('maws-mode-unknown',{user:{permissions:{defaultMode:'bogus'}},model:'haiku'});
  await maws('maws-mode-bypass',{user:{permissions:{defaultMode:'bypassPermissions'}},model:'haiku'});
  await maws('maws-mode-project',{user:{permissions:{defaultMode:'acceptEdits'}},project:{permissions:{defaultMode:'plan'}},model:'haiku'});
  // the terminal
  await term('term-none',{user:{}});
  await term('term-alias-acceptEdits',{user:{model:'haiku',permissions:{defaultMode:'acceptEdits'}}});
  await term('term-id-plan',{user:{model:'claude-haiku-5-5',permissions:{defaultMode:'plan'}}});
  await term('term-alias-default',{user:{model:'haiku',permissions:{defaultMode:'default'}}});
  await term('term-alias-auto',{user:{model:'haiku',permissions:{defaultMode:'auto'}}});
  await term('term-flags',{user:{model:'sonnet',permissions:{defaultMode:'plan'}},flags:['--model','haiku','--permission-mode','default']});
  await term('term-unknown',{user:{model:'no-such-model-p2b',permissions:{defaultMode:'bogus'}}});
  await term('term-project',{user:{model:'sonnet',permissions:{defaultMode:'acceptEdits'}},project:{model:'haiku',permissions:{defaultMode:'plan'}}});
  // the engine's own writes: at start (a hand-laid file, migrations re-armed), then /model
  await term('write-hand-model-command',{user:HAND,rearm:true,commands:['/model haiku']});
  await maws('write-legacy-opus',{user:{model:'claude-opus-4-1'},rearm:true});
  await maws('write-legacy-fable51',{user:{model:'claude-fable-5-1'},rearm:true});
  // second pass (UXW_CASES names them): a bad key's reach, an unknown model in a terminal, the engine's key order, set_model
  await maws('maws-mode-unknown-with-model',{user:{model:'haiku',permissions:{defaultMode:'bogus'}}});
  await term('term-model-unknown',{user:{model:'no-such-model-p2b'}});
  await term('write-order-model-command',{user:'{"zz": 1, "model": "claude-haiku-5-5", "env": {"P2B_PROBE": "1"}, "alpha": true, "permissions": {"defaultMode": "acceptEdits"}, "effortLevel": "low"}',commands:['/model haiku']});
  await maws('maws-set-model',{user:{model:'claude-haiku-5-5'},after:async p=>{const r=await p.request('set_model',{model:'haiku'},15000).catch(e=>({error:e.message}));return {setModel:{subtype:r.subtype??null,error:r.error??null},userAfterSetModel:fileState(USER_FILE).text};}});
  put(PROJECT_FILE,undefined);
 }finally{
  writeFileSync(FIXTURES+TAG+'.json',redact(JSON.stringify(record,null,1))+'\n');
  console.log(TAG,FIXTURES+TAG+'.json');
 }
};
