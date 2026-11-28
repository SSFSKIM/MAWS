// Question sheet, child C5, M2: the wire sitting (docs/doperpowers/plans/2026-11-27-question-sheet-c5-maws-run.md, §S
// "The wire sitting"; findings-qsheet-c5-carriers.txt, "M1's branch on the wire"). A spike: findings and journals only.
//
// M1's branch of sminos as it is, no patch (QC5_SMINOS), under MAWS's launch line as src/engine-host/launch.ts builds it:
// its fixed flags, --await-initialize (the pinned engine declares it), the direct tell's mod by --plugin-dir before
// sminos's, buildEnvironment's constants (SMNS_MEMBER this process's pid, the engine's parent; MAWS_LANE=B; the sdk-ts
// entrypoint), CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 as the owner's shell passes it, MAWS_QUESTION_SHEET=2:<session id>,
// and the sminos home named in --settings' env (QC5_HOME_VIA=env names it in the process environment instead: P6's
// branch B6). initialize is the app's (probe-initialize.mjs). The stand-in model only (stub-api.mjs): nothing spent.
// Every launch's work folder, HOME, configuration directory, sminos home and debug file are in one scratch root under
// /tmp (F41), and a work folder under the invoking user's home is refused.
//
// Knobs (beside the carriers round's): QC5_CELLS=m1; QC5_ONLY=<cell>[,<cell>...] (default: every cell, in order);
// QC5_SMINOS_OLD, the plugin of doperpowers 40b79a7d1 (p7-old, p8-old); QC5_TELL, the direct tell's mod (default this
// checkout's mods/maws-tell); QC5_SMINOS_REV, the commit QC5_SMINOS is a copy of (recorded); QC5_HOME_VIA=settings|env.
// Each cell writes fixtures/qsheet/qsheet-c5-m1-<cell>.jsonl and prints one line: what it observed.
import {Probe} from '../../harness.mjs';
import {probeInitialize} from '../../probe-initialize.mjs';
import {startStubApi,textTurn,toolTurn} from '../../stub-api.mjs';
import {delay,until,slug,rowsOf,brief,lastUser,textOf,rules} from './qsheet-c5.mjs';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,readdirSync,realpathSync,lstatSync} from 'node:fs';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {homedir,hostname} from 'node:os';
import {fileURLToPath} from 'node:url';

const env0={...process.env};
const BIN=realpathSync(env0.QC5_ENGINE);
const ENGINE_VERSION=execFileSync(BIN,['--version'],{encoding:'utf8',timeout:15000}).trim().split(/\s+/)[0];
const SMINOS=realpathSync(env0.QC5_SMINOS);
const SMINOS_OLD=env0.QC5_SMINOS_OLD?realpathSync(env0.QC5_SMINOS_OLD):null;
const TELL=realpathSync(env0.QC5_TELL||fileURLToPath(new URL('../../../../mods/maws-tell',import.meta.url)));
const HOME_VIA=env0.QC5_HOME_VIA||'settings';
if(!['settings','env'].includes(HOME_VIA))throw new Error('QC5_HOME_VIA=settings|env');
const versionOf=dir=>JSON.parse(readFileSync(join(dir,'.claude-plugin/plugin.json'),'utf8')).version;
const DIR='fixtures/qsheet/';
const RING='The human answered questions on your sheet.'; // MAWS's SHEET_RING, sminos's RING
const RING_DROP='nothing is ready on the sheet';           // MAWS's SHEET_RING_DROP, sminos's RING_DROP
const OWN_HOME=homedir();
const HOST=hostname().split('.')[0]; // sminos names its log files after the machine: scrubbed from each recording at its end

// ---------------------------------------------------------------- the scratch root, all of it under /tmp (F41)
function scratchRoot(label){
 const root=realpathSync(mkdtempSync(`/tmp/qc5m2-${label}-`));
 const r={root,home:join(root,'home'),config:join(root,'config'),sminos:join(root,'sminos-home'),work:join(root,'work'),debug:join(root,'engine-debug.log')};
 for(const k of ['home','config','sminos','work']){mkdirSync(r[k],{recursive:true});if(!r[k].startsWith('/private/tmp/')&&!r[k].startsWith('/tmp/'))throw new Error(`${k} is not under /tmp: refused`);}
 if(r.work===OWN_HOME||r.work.startsWith(OWN_HOME+'/'))throw new Error('a work folder under the invoking user\'s home is refused (F41)');
 execFileSync('git',['init','-q'],{cwd:r.work});writeFileSync(join(r.work,'one.txt'),'ONE\n');
 execFileSync('git',['add','one.txt'],{cwd:r.work});execFileSync('git',['-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','seed'],{cwd:r.work});
 const features=JSON.parse(readFileSync(env0.QC5_FEATURES,'utf8'));
 writeFileSync(join(r.config,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[r.work]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}},...features}));
 return r;
}
// The default place sminos would use with no home named: $HOME/.claude/sminos.
const defaultHome=r=>join(r.home,'.claude/sminos');

// ---------------------------------------------------------------- MAWS's launch line
function clearEnv(){for(const k of Object.keys(process.env))if(!['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG'].includes(k))delete process.env[k];}
// buildEnvironment's constants (src/engine-host/launch.ts) over an environment built from nothing; USER and LOGNAME are a
// neutral name, so no account's name reaches a recording.
function mawsEnv(r,{sheet,stub}){
 return {HOME:r.home,PATH:'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',USER:'probe',LOGNAME:'probe',SHELL:'/bin/bash',TMPDIR:'/tmp',LANG:'en_US.UTF-8',
  CLAUDE_CONFIG_DIR:r.config,CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1',
  CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'false',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',
  CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING:'1',CLAUDE_CODE_QUESTION_PREVIEW_FORMAT:'html',SMNS_MEMBER:String(process.pid),MAWS_LANE:'B',TERM:'dumb',DISABLE_AUTOUPDATER:'1',
  ANTHROPIC_BASE_URL:stub.url,ANTHROPIC_AUTH_TOKEN:'stub-token',ENABLE_TOOL_SEARCH:'true',
  ...(sheet!==null&&{MAWS_QUESTION_SHEET:sheet}),...(HOME_VIA==='env'&&{SMINOS_HOME:r.sminos})};
}
const settingsOf=r=>({dialogExpiry:'never',...(HOME_VIA==='settings'&&{env:{SMINOS_HOME:r.sminos}})});

// The stand-in's record of a request: where an envelope stood, the last user message (raw, so a line break shows), and
// the question tools the request offers, each with its schema's properties and whether it is deferred.
const record=body=>{
 const whole=JSON.stringify(body.messages??[]);const last=lastUser(body);
 const holders=(body.messages??[]).map((m,i)=>({i,role:m.role,types:Array.isArray(m.content)?m.content.map(b=>b.type):['string'],has:JSON.stringify(m.content).includes('sheet-delivery')})).filter(x=>x.has).map(({has,...x})=>x);
 const tools=(body.tools??[]).filter(t=>/AskUserQuestion/.test(t?.name??'')).map(t=>({name:t.name,deferred:t.defer_loading??false,properties:Object.keys(t.input_schema?.properties??{})}));
 return {messages:(body.messages??[]).length,holders,deliveries:[...whole.matchAll(/<sheet-delivery>(.*?)<\/sheet-delivery>/g)].map(x=>x[1].slice(0,300)),tools,toolCount:(body.tools??[]).length,
  last:last?{types:Array.isArray(last.content)?last.content.map(b=>b.type):['string'],text:textOf(last.content).slice(-2500),raw:JSON.stringify(last.content).slice(-400)}:null};
};
const ASK_INPUT=n=>({ask:[{question:`QC5-M2 question ${n}?`,options:[{label:'Alpha'},{label:'Beta'}]}]});
const SCRIPT=rules([
 ['toolu_ask',textTurn('ASKED')],['QC5-ASK',body=>{const n=(JSON.stringify(lastUser(body)).match(/QC5-ASK (\d+)/)||[])[1]||'1';return toolTurn('toolu_ask'+n,'mcp__sminos__AskUserQuestion',ASK_INPUT(n));}],
 ['QC5-HELLO',textTurn('HELLO')],[RING,textTurn('RING READ')],
]);

// One engine process, launched as MAWS launches it. `sheet` is MAWS_QUESTION_SHEET's value (null: unset); `resume` is
// the session id to resume, with `fork` its fork's new id; `plugins` the plugin directories after the tell's.
async function launch(name,r,sid,{sheet=`2:${sid}`,resume=null,fork=false,plugin=SMINOS,firstPlugins=[],cell}={}){
 const stub=await startStubApi({record,respond:SCRIPT,side:()=>textTurn('ok')});
 clearEnv();
 const env=mawsEnv(r,{sheet,stub});
 const session=resume?['--resume',resume,...(fork?['--fork-session','--session-id',sid]:[])]:['--session-id',sid];
 const p=new Probe(name,{cwd:r.work,env,bin:BIN,model:'haiku',dir:DIR,settingSources:'user,project,local',strictMcp:false,mode:'default',
  flags:['--forward-subagent-text','--replay-user-messages','--include-hook-events','--await-initialize',...firstPlugins.flatMap(d=>['--plugin-dir',d]),'--plugin-dir',TELL,'--plugin-dir',plugin,
   ...session,'--debug-file',r.debug,'--max-budget-usd','0.01','--settings',JSON.stringify(settingsOf(r))]});
 p.note({event:'provenance',plan:'docs/doperpowers/plans/2026-11-27-question-sheet-c5-maws-run.md',findings:'spikes/protocol-probe/findings-qsheet-c5-carriers.txt',sitting:'M2',cell,
  engineVersion:ENGINE_VERSION,sminos:`${versionOf(plugin)} (${plugin===SMINOS?`M1's branch${env0.QC5_SMINOS_REV?' at '+env0.QC5_SMINOS_REV:''}, as it is`:'doperpowers 40b79a7d1, before M1'})`,tell:versionOf(TELL),
  model:'stand-in (stub-api.mjs)',route:'stub',permissionMode:'default',homeVia:HOME_VIA,questionSheet:sheet===null?null:sheet.replace(sid,'<session>'),resume:resume!==null,fork,
  probePlugins:firstPlugins.map(d=>d.split('/').pop()),envKeys:Object.keys(env).sort(),root:'<root>'});
 p.on('can_use_tool',q=>{p.note({event:'permission_asked',tool:q.tool_name,input:q.input});return {behavior:'allow',updatedInput:q.input};});
 p.on('request_user_dialog',q=>{p.note({event:'dialog_seen',kind:q.dialog_kind});return {behavior:'completed',result:'continue'};});
 p.on('elicitation',()=>({action:'decline'}));
 for(const k of ['ui_copy','ui_prompt_read','ui_prompt_fill','ui_prompt_suggest'])p.on(k,()=>({}));
 return {p,stub};
}
const init=async(p,r)=>{const res=await p.init(probeInitialize({accepted:true,directory:r.work}));if(res.subtype!=='success')throw new Error('initialize: '+JSON.stringify(res));return res;};
async function stop(p){if(p.exited)return;try{await p.request('end_session',{reason:'stop'},10000);}catch(e){p.note({event:'end_session_error',message:e.message});}const t=setTimeout(()=>{try{p.child.kill('SIGTERM');}catch{}},15000);await p.closed;clearTimeout(t);}
function frame(p,content,priority='next'){const f={type:'user',uuid:randomUUID(),message:{role:'user',content},parent_tool_use_id:null,origin:{kind:'human'}};if(priority)f.priority=priority;p.note({event:'qc5_host_frame',priority,content});p.send(f);return f.uuid;}
async function turn(p,content,{priority='next',timeout=60000}={}){const s=p.seq;const uuid=frame(p,content,priority);const res=await p.wait(f=>f.type==='result',{after:s,timeout}).catch(()=>{p.note({event:'turn_timeout'});return null;});return {uuid,result:res,from:s};}
async function quiet(p,ms=3000,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const s=p.seq;await delay(ms);if(p.seq===s)return true;}return false;}
const wireAfter=(p,from)=>p.frames.filter(x=>x.seq>from).map(x=>({seq:x.seq,type:x.frame.type,subtype:x.frame.subtype,uuid:x.frame.uuid,command_uuid:x.frame.command_uuid,state:x.frame.state,isReplay:x.frame.isReplay,origin:x.frame.origin,priority:x.frame.priority,
 text:x.frame.message?textOf(x.frame.message.content).slice(0,1200):undefined,content:typeof x.frame.content==='string'?x.frame.content.slice(0,400):undefined,level:x.frame.level,prevent_continuation:x.frame.prevent_continuation,prompt_submit_outcome:x.frame.prompt_submit_outcome,
 num_turns:x.frame.num_turns,result:typeof x.frame.result==='string'?x.frame.result.slice(0,200):undefined,hook:x.frame.hook_name??x.frame.hook_event}));
const step=(p,stub,label,from,req)=>{const s={label,wire:wireAfter(p,from),requests:stub.requests.slice(req)};p.note({event:'qc5_step',...s});return s;};

// ---------------------------------------------------------------- the sheet, from outside, under the home the cell names
const cli=(r,args,home=r.sminos)=>{try{return {code:0,out:execFileSync(join(SMINOS,'skills/sminos/scripts/sminos'),args,{env:{HOME:r.home,SMINOS_HOME:home,PATH:'/opt/homebrew/bin:/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:'/tmp'},encoding:'utf8',timeout:30000})};}catch(e){return {code:e.status,out:String(e.stdout??''),err:String(e.stderr??'').slice(0,500)};}};
const show=(r,sid)=>{const x=cli(r,['sheet','show','--session',sid,'--json']);try{return JSON.parse(x.out);}catch{return null;}};
function noteSheet(p,r,sid,label){const m=show(r,sid);p.note({event:'qc5_sheet',label,open:m?.open?.map(q=>({id:q.id,asker:q.asker,question:q.question,options:q.options?.map(o=>o.label)})),pending:m?.pending?.map(o=>({key:o.key,id:o.id,kind:o.kind,recipient:o.recipient,acrossStop:o.acrossStop,picks:o.picks})),closed:m?.closed,sent:m?.sent,seq:m?.seq});return m;}
function answer(p,r,sid,id,pick){const args=['sheet','answer','--session',sid,id,'--pick',pick];const x=cli(r,args);p.note({event:'qc5_answer',args:args.slice(2),code:x.code,out:x.out.slice(0,400),err:x.err});return x;}
async function ask(p,r,sid,n){await turn(p,`QC5-ASK ${n}: ask your question.`);const m=noteSheet(p,r,sid,'asked '+n);return m?.open?.find(x=>x.question===`QC5-M2 question ${n}?`);}
async function waitPending(p,r,sid,timeout=40000){const m=await until(()=>{const s=show(r,sid);return s?.pending?.some(o=>o.recipient==='main')?s:null;},timeout,700);noteSheet(p,r,sid,'pending');return m;}
// A directory's files, relative to it: what the named home and the default place hold.
function tree(dir,max=300){const out=[];const walk=d=>{for(const f of readdirSync(d)){if(out.length>=max)return;const full=join(d,f);const st=lstatSync(full);const rel=relative(dir,full);if(st.isDirectory()){out.push(rel+'/');walk(full);}else out.push(rel+(st.isSocket()?' (socket)':st.isSymbolicLink()?' (link)':''));}};if(existsSync(dir))walk(dir);return existsSync(dir)?out:null;}

// ---------------------------------------------------------------- the transcript, the debug log, the containment note
const transcriptFile=(r,sid)=>join(r.config,'projects',slug(r.work),sid+'.jsonl');
function noteTranscript(p,r,sid,label='transcript'){
 const main=rowsOf(transcriptFile(r,sid)).map(({line,row})=>({line,...brief(row)}));
 p.note({event:'qc5_transcript',label,rows:main});
 const raw=rowsOf(transcriptFile(r,sid)).map(x=>x.row);
 p.note({event:'qc5_containment',label,instructionFiles:[...new Set(raw.filter(x=>x.attachment?.type==='instructions').flatMap(x=>(x.attachment.files??[]).map(f=>f.path)))],skills:[...new Set(raw.filter(x=>x.attachment?.type==='skill_listing').flatMap(x=>String(x.attachment.content??'').split('\n').map(l=>(l.match(/^- ([^:\s]+(?::[^:\s]+)?):/)||[])[1]).filter(Boolean)))]});
 return raw;
}
function noteDebug(p,r,re=/sheet|qc5-probe|maws-tell|prompt\.submit|SessionStart|MAWS_QUESTION_SHEET|dropped|initialize/i){
 if(!existsSync(r.debug))return p.note({event:'qc5_debug',lines:null});
 const lines=readFileSync(r.debug,'utf8').split('\n').map(l=>l.split(r.root).join('<root>')).filter(l=>re.test(l)).map(l=>l.slice(0,500));
 p.note({event:'qc5_debug',count:lines.length,lines:lines.slice(0,400)});return lines;
}
// What of the cell's processes outlived it (the bridge's child, a daemon): logged and ended, so no cell leaves any.
function sweep(p,r){
 const rows=execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().match(/^(\d+)\s+(.*)$/)).filter(Boolean);
 const left=rows.filter(([,pid,cmd])=>Number(pid)!==process.pid&&(cmd.includes(r.root)||cmd.includes(SMINOS)||(SMINOS_OLD&&cmd.includes(SMINOS_OLD))));
 p.note({event:'qc5_sweep',left:left.map(([,pid,cmd])=>({pid:Number(pid),command:cmd.split(r.root).join('<root>').slice(0,160)}))});
 for(const [,pid] of left)try{process.kill(Number(pid),'SIGKILL');}catch{}
}
const initTools=p=>{const f=p.frames.find(x=>x.frame.type==='system'&&x.frame.subtype==='init')?.frame;return f?(f.tools??[]).filter(t=>/AskUserQuestion/.test(t)):null;};
function verdict(p,cell,v){p.note({event:'qc5_verdict',cell,...v});console.log(JSON.stringify({cell,...v}).split(HOST).join('<host>'));writeFileSync(p.file,readFileSync(p.file,'utf8').split(HOST).join('<host>'));return v;}
async function finish(p,stub,r,sid,label='end'){
 await quiet(p,2000,20000);
 p.note({event:'stub_requests',requests:stub.requests});
 if(sid)noteSheet(p,r,sid,label);
 await stop(p);await stub.close();
 const raw=sid?noteTranscript(p,r,sid):[];const debug=noteDebug(p,r);sweep(p,r);
 return {raw,debug};
}

// ---------------------------------------------------------------- P6: the home named in --settings' env
async function p6(){
 const cell='p6',r=scratchRoot(cell),sid=randomUUID();
 const {p,stub}=await launch(`qsheet-c5-m1-${cell}`,r,sid,{cell});
 let out={};
 try{
  await init(p,r);await quiet(p,2000,15000);
  const atStart={named:tree(r.sminos),default:tree(defaultHome(r))};p.note({event:'qc5_homes',label:'after the start, before any prompt',...atStart});
  const q=await ask(p,r,sid,1);
  const asked={named:tree(r.sminos),default:tree(defaultHome(r))};p.note({event:'qc5_homes',label:'after the ask',...asked});
  let delivered=null;
  if(q){answer(p,r,sid,q.id,'Beta');await waitPending(p,r,sid);await delay(6000);const n=stub.requests.length;const t=await turn(p,RING);await quiet(p);
   const s=step(p,stub,'p6: a ring with the answer pending',t.from,n);delivered=s.requests.filter(x=>x.main&&x.deliveries.length).length;}
  const m=noteSheet(p,r,sid,'after the ring');
  out={asked:!!q,recordAtStart:(atStart.named??[]).includes(`sheet/${sid}/state.json`),recordNamed:existsSync(join(r.sminos,'sheet',sid,'state.json')),
   defaultPlace:tree(defaultHome(r)),delivered,deliveredAt:q?m?.closed?.[q.id]?.deliveredAt??null:null,named:tree(r.sminos)};
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 await finish(p,stub,r,sid);
 const ok=out.recordNamed&&out.defaultPlace===null;
 return verdict(p,cell,{answer:ok?'yes':'no',...out});
}

// ---------------------------------------------------------------- P7: the sheet taken under 2:<id>, and only there
// Each start answers one plain prompt so its system/init and its request show the tools it holds.
async function p7Start(name,cell,r,sid,opts){
 const {p,stub}=await launch(name,r,sid,{...opts,cell});
 let out={};
 try{
  await init(p,r);await quiet(p,2000,15000);
  await turn(p,'QC5-HELLO: say hello.');
  const req=stub.requests.find(x=>x.main);
  out={initTools:initTools(p),requestTools:req?.tools??null,record:existsSync(join(r.sminos,'sheet',sid,'state.json'))};
  if(opts.askAfter){const q=await ask(p,r,sid,1);out.asked=!!q;}
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {debug}=await finish(p,stub,r,sid);
 out.choiceLines=debug.filter(l=>/MAWS_QUESTION_SHEET|sheet: the tool|choice|not taken/i.test(l)).map(l=>l.replace(/^\S+\s+/,'')).slice(0,6);
 const tools=out.requestTools??[];
 out.sheet=tools.some(t=>t.name==='mcp__sminos__AskUserQuestion'&&t.properties.includes('ask'));
 // The engine's system/init lists the built-in's name whether or not a plugin withdrew it (the carriers round's b1 too):
 // what the model is offered is the request's list.
 out.builtinOffered=tools.some(t=>t.name==='AskUserQuestion');
 out.sminosListed=(out.initTools??[]).includes('mcp__sminos__AskUserQuestion');
 out.answer=out.sheet&&!out.builtinOffered&&out.sminosListed&&out.record?'sheet':!out.sheet&&out.builtinOffered&&!out.sminosListed&&!out.record?'no sheet':'mixed';
 return verdict(p,cell,out);
}
async function p7(){
 const res={};
 const r=scratchRoot('p7'),sid=randomUUID(),fid=randomUUID();
 res['p7-new']=await p7Start('qsheet-c5-m1-p7-new','p7-new',r,sid,{askAfter:true});
 res['p7-resume']=await p7Start('qsheet-c5-m1-p7-resume','p7-resume',r,sid,{resume:sid});
 res['p7-fork']=await p7Start('qsheet-c5-m1-p7-fork','p7-fork',r,fid,{resume:sid,fork:true});
 const rb=scratchRoot('p7-bare'),bid=randomUUID();
 res['p7-bare']=await p7Start('qsheet-c5-m1-p7-bare','p7-bare',rb,bid,{sheet:bid});
 if(SMINOS_OLD){const ro=scratchRoot('p7-old'),oid=randomUUID();res['p7-old']=await p7Start('qsheet-c5-m1-p7-old','p7-old',ro,oid,{plugin:SMINOS_OLD});}
 return res;
}

// ---------------------------------------------------------------- P8: what shows the tool before any prompt
const NAME='mcp__sminos__AskUserQuestion';
async function p8One(cell,plugin){
 const r=scratchRoot(cell),sid=randomUUID();
 const {p,stub}=await launch(`qsheet-c5-m1-${cell}`,r,sid,{plugin,cell});
 const out={sources:{}};
 try{
  const res=await init(p,r);
  out.sources.initialize=JSON.stringify(res).includes(NAME);
  await quiet(p,2000,15000);
  out.sources.unasked=p.frames.filter(x=>x.frame.type!=='control_response'&&JSON.stringify(x.frame).includes(NAME)).map(x=>({seq:x.seq,type:x.frame.type,subtype:x.frame.subtype}));
  for(const [subtype,payload] of [['mcp_status',{}],['get_context_usage',{}],['get_status',{}],['get_settings',{}],['get_hooks_listing',{}]]){
   try{const a=await p.request(subtype,payload,15000);const text=JSON.stringify(a);out.sources[subtype]={status:a.subtype,names:text.includes(NAME),askUserQuestion:(text.match(/[A-Za-z_]*AskUserQuestion/g)??[]).filter((x,i,l)=>l.indexOf(x)===i),error:a.subtype==='error'?String(a.error).slice(0,200):undefined};
    // mcp_status names a plugin's tools under its server: {name: 'sminos', source: 'plugin', tools: [{name: 'AskUserQuestion'}]}
    if(subtype==='mcp_status')out.sources[subtype].servers=(a.response?.mcpServers??[]).map(x=>({name:x.name,status:x.status,source:x.source,tools:(x.tools??[]).map(t=>t.name)}));
    if(subtype==='get_context_usage')out.sources[subtype].mcpTools=JSON.stringify(a.response?.mcpTools??null).slice(0,600);}
   catch(e){out.sources[subtype]={status:'no answer',error:e.message};}
  }
  out.beforePrompt=stub.requests.filter(x=>x.main).length;
  await turn(p,'QC5-HELLO: say hello.');
  out.initTools=initTools(p);out.requestTools=stub.requests.find(x=>x.main)?.tools??null;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 await finish(p,stub,r,sid);
 return verdict(p,cell,out);
}
async function p8(){
 const a=await p8One('p8',SMINOS);const b=SMINOS_OLD?await p8One('p8-old',SMINOS_OLD):null;
 // A source is evidence when it names sminos's tool under M1, before any prompt, and not under the plugin that took no sheet.
 const lists=x=>Object.entries(x?.sources??{}).filter(([k,v])=>k==='unasked'?v.length>0:k==='mcp_status'?(v.servers??[]).some(s=>s.name==='sminos'&&s.tools.includes('AskUserQuestion')):v===true||v?.names===true).map(([k])=>k);
 const evidence=lists(a).filter(k=>!lists(b).includes(k));
 console.log(JSON.stringify({cell:'p8 (both)',answer:evidence.length?'something does':'nothing does before a prompt',evidence,underOld:lists(b)}));
 return {p8:a,'p8-old':b,evidence};
}

// ---------------------------------------------------------------- P9: the sentence and a line break, to the hook and the file
// A probe mod beside the two (not a patch of either): its prompt hook logs the text and origin each prompt has.
const PROBE_MOD=`export const register=(on)=>{on('prompt.submit',{text:/^/},async($,e,next)=>{$.ui.log('qc5-probe: prompt.submit '+JSON.stringify({text:e.text,origin:e.origin,turnId:e.turnId??null,fields:Object.keys(e).sort(),event:JSON.stringify(e).slice(0,1500)}),{to:'debug'});return next(e);});};\n`;
function probeMod(r){
 const d=join(r.root,'qc5-probe');mkdirSync(join(d,'.claude-plugin'),{recursive:true});mkdirSync(join(d,'hooks'),{recursive:true});
 writeFileSync(join(d,'.claude-plugin/plugin.json'),JSON.stringify({name:'qc5-probe',version:'0.0.1',description:'M2\'s probe: logs each prompt\'s text as a prompt hook sees it.'}));
 writeFileSync(join(d,'hooks/hooks.json'),JSON.stringify({modules:['./register.mjs']}));writeFileSync(join(d,'hooks/register.mjs'),PROBE_MOD);
 return d;
}
// Each frame is sent with nothing ready (so a frame the tool takes for a ring is dropped), and the last of a cell once an
// answer is pending, so that frame enters whatever the hook makes of it and its saved row can be read.
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='; // one white pixel
const P9_FRAMES={
 'p9-string':[['the exact sentence (the control)',RING],['the sentence and a line break',RING+'\n'],['the sentence and a line break, an answer pending',RING+'\n',true]],
 'p9-block':[['the exact sentence (the control)',[{type:'text',text:RING}]],['the sentence and a line break',[{type:'text',text:RING+'\n'}]],
  ['a line break and the sentence',[{type:'text',text:'\n'+RING}]],['the sentence, then a line break as a second block',[{type:'text',text:RING},{type:'text',text:'\n'}]],
  // for the writer's remedy: a character no trim removes, and the sentence beside an image (a person's paste)
  ['the sentence and a zero-width space',[{type:'text',text:RING+'\u200b'}]],['the sentence and an image',[{type:'text',text:RING},{type:'image',source:{type:'base64',media_type:'image/png',data:PNG}}]],
  ['the sentence and a line break, an answer pending',[{type:'text',text:RING+'\n'}],true]],
};
async function p9One(cell){
 const r=scratchRoot(cell),sid=randomUUID();
 // the probe mod's directory first, so its hook sees each prompt before sminos's may drop it
 const {p,stub}=await launch(`qsheet-c5-m1-${cell}`,r,sid,{firstPlugins:[probeMod(r)],cell});
 const sent=[];let seen=0;
 const hookLines=()=>existsSync(r.debug)?readFileSync(r.debug,'utf8').split('\n').filter(l=>l.includes('qc5-probe: prompt.submit')).map(l=>{try{return JSON.parse(l.slice(l.indexOf('{')));}catch{return null;}}):[];
 try{
  await init(p,r);await quiet(p,2000,15000);
  for(const [label,content,pending] of P9_FRAMES[cell]){
   if(pending){const q=await ask(p,r,sid,1);seen=hookLines().length;if(q){answer(p,r,sid,q.id,'Beta');await waitPending(p,r,sid);await delay(6000);}}
   const n=stub.requests.length;const t=await turn(p,content);await quiet(p);const s=step(p,stub,`${cell}: ${label}`,t.from,n);
   const lines=hookLines();const hook=lines.slice(seen);seen=lines.length;
   const req=s.requests.find(x=>x.main);
   sent.push({label,content,uuid:t.uuid,hookText:hook.map(x=>x?.text??null),hookEvent:hook.map(x=>x?{fields:x.fields,event:x.event}:null),dropped:s.wire.some(w=>w.prompt_submit_outcome?.kind==='dropped_by_hook'),modelCalls:s.requests.filter(x=>x.main).length,delivered:!!req?.deliveries?.length,requestLast:req?.last?.raw??null});
  }
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {raw,debug}=await finish(p,stub,r,sid);
 for(const x of sent){const row=raw.find(y=>y.type==='user'&&y.uuid===x.uuid);x.savedRow=row?{content:row.message?.content,entrypoint:row.entrypoint??null}:null;}
 const ringLines=debug.filter(l=>/a ring is (filled|dropped)/.test(l)).map(l=>l.replace(/^.*\$\.ui\.log \(to debug\): /,''));
 const broken=sent.filter(x=>x.label.startsWith('the sentence and a line break'));
 const kept=broken.every(x=>!x.dropped&&x.hookText.length===1&&x.hookText[0]===RING+'\n')&&broken.some(x=>x.savedRow&&JSON.stringify(x.savedRow.content).includes(JSON.stringify(RING+'\n').slice(1,-1)));
 return verdict(p,cell,{answer:kept?'kept':'trimmed',sent:sent.map(({content,...x})=>x),ringLines});
}
async function p9(){return {'p9-string':await p9One('p9-string'),'p9-block':await p9One('p9-block')};}

const CELLS={p6,p7,p8,p9};
export default async()=>{
 const only=(env0.QC5_ONLY||Object.keys(CELLS).join(',')).split(',').filter(Boolean);
 for(const c of only)if(!CELLS[c])throw new Error(`QC5_ONLY: no cell ${c} (${Object.keys(CELLS).join(', ')})`);
 for(const c of only)await CELLS[c]();
};
