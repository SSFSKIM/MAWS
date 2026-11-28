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
// The ring is the sentence and its mark, U+2060 (F33, as ruled after the first sitting's S9): MAWS's SHEET_RING and
// sminos's RING, written as an escape. SENTENCE alone is a person's words in any form. The first sitting's p9-string and
// p9-block (M1 at 34e1942ca) wrote the plain sentence as the ring; their frames are kept below (QC5_ONLY=p9-first).
const SENTENCE='The human answered questions on your sheet.';
const MARK='\u2060';
const RING=SENTENCE+MARK;
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
 const whole=JSON.stringify(body.messages??[]);const last=lastUser(body);const first=(body.messages??[]).find(m=>m.role==='user');
 const holders=(body.messages??[]).map((m,i)=>({i,role:m.role,types:Array.isArray(m.content)?m.content.map(b=>b.type):['string'],has:JSON.stringify(m.content).includes('sheet-delivery')})).filter(x=>x.has).map(({has,...x})=>x);
 const tools=(body.tools??[]).filter(t=>/AskUserQuestion/.test(t?.name??'')).map(t=>({name:t.name,deferred:t.defer_loading??false,properties:Object.keys(t.input_schema?.properties??{})}));
 return {first:first?textOf(first.content).slice(-300):null,ended:(whole.match(/ended with questions still open/g)||[]).length,messages:(body.messages??[]).length,roles:(body.messages??[]).map(m=>m.role).join(''),holders,deliveries:[...whole.matchAll(/<sheet-delivery>(.*?)<\/sheet-delivery>/g)].map(x=>x[1].slice(0,300)),tools,toolCount:(body.tools??[]).length,
  last:last?{types:Array.isArray(last.content)?last.content.map(b=>b.type):['string'],text:textOf(last.content).slice(-2500),raw:JSON.stringify(last.content).slice(-400)}:null};
};
// W10's: each message that holds an envelope, whole (a subagent's request holds the tool's send as a message of its own,
// whose opening line is the send's; the request's brief keeps only its last user message).
const recordHeld=body=>({...record(body),held:(body.messages??[]).map((m,i)=>({i,role:m.role,content:m.content})).filter(m=>JSON.stringify(m.content).includes('sheet-delivery')).map(m=>({...m,content:JSON.stringify(m.content).slice(0,6000)}))});
const ASK_INPUT=n=>({ask:[{question:`QC5-M2 question ${n}?`,options:[{label:'Alpha'},{label:'Beta'}]}]});
const SCRIPT=rules([
 ['toolu_ask',textTurn('ASKED')],['QC5-ASK',body=>{const n=(JSON.stringify(lastUser(body)).match(/QC5-ASK (\d+)/)||[])[1]||'1';return toolTurn('toolu_ask'+n,'mcp__sminos__AskUserQuestion',ASK_INPUT(n));}],
 ['QC5-HELLO',textTurn('HELLO')],[SENTENCE,textTurn('RING READ')],
]);
// A Bash wait: python's, since the engine refuses a standalone `sleep` (the carriers round's B1).
const sleepTurn=(id,sec)=>toolTurn(id,'Bash',{command:`python3 -c 'import time; time.sleep(${sec})'`,description:'wait'});
const SUB_ASK=x=>({ask:[{question:`QC5-M2 sub question ${x}?`,options:[{label:'Alpha'},{label:'Beta'}]}]});
const agentTurn=x=>toolTurn(`toolu_agent${x.toLowerCase()}`,'Agent',{description:`asker ${x}`,subagent_type:'general-purpose',prompt:`QC5-SUB ${x}: ask your question, then go on.`});
// The W cells' script: the shared one's needles, after the ones that are a tool's id (each matched first, since a later
// message of the same conversation holds both).
const W_SCRIPT=rules([
 ['toolu_sleep',textTurn('SLEPT')],['toolu_ringsleep',textTurn('SLEPT')],
 ['toolu_suba_sleep',textTurn('SUB A DONE')],['toolu_suba_ask',sleepTurn('toolu_suba_sleep',20)],['toolu_subb_ask',textTurn('SUB B DONE')],
 ['toolu_agent',textTurn('AGENT DONE')],
 ['QC5-SUB A',toolTurn('toolu_suba_ask','mcp__sminos__AskUserQuestion',SUB_ASK('A'))],['QC5-SUB B',toolTurn('toolu_subb_ask','mcp__sminos__AskUserQuestion',SUB_ASK('B'))],
 ['QC5-AGENT A',agentTurn('A')],['QC5-AGENT B',agentTurn('B')],
 ['QC5-SLEEP',body=>{const sec=(JSON.stringify(lastUser(body)).match(/QC5-SLEEP (\d+)/)||[])[1]||'8';return sleepTurn('toolu_sleep'+Date.now(),sec);}],
 ['toolu_ask',textTurn('ASKED')],['QC5-ASK',body=>{const n=(JSON.stringify(lastUser(body)).match(/QC5-ASK (\d+)/)||[])[1]||'1';return toolTurn('toolu_ask'+n,'mcp__sminos__AskUserQuestion',ASK_INPUT(n));}],
 ['QC5-HELLO',textTurn('HELLO')],
 // W7's ring opens a turn that runs a wait, so the Stop finds it running
 [SENTENCE,body=>W7_RING_SLEEPS.on?sleepTurn('toolu_ringsleep'+Date.now(),10):textTurn('RING READ')],
]);
const W7_RING_SLEEPS={on:false};

// One engine process, launched as MAWS launches it. `sheet` is MAWS_QUESTION_SHEET's value (null: unset); `resume` is
// the session id to resume, with `fork` its fork's new id; `plugins` the plugin directories after the tell's.
async function launch(name,r,sid,{sheet=`2:${sid}`,resume=null,fork=false,plugin=SMINOS,firstPlugins=[],cell,script=SCRIPT,keepHeld=false}={}){
 const stub=await startStubApi({record:keepHeld?recordHeld:record,respond:script,side:()=>textTurn('ok')});
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
 // the first sitting's (stop S9): the plain sentence was then the ring
 'p9-string':[['the exact sentence (the control)',SENTENCE],['the sentence and a line break',SENTENCE+'\n'],['the sentence and a line break, an answer pending',SENTENCE+'\n',true]],
 'p9-block':[['the exact sentence (the control)',[{type:'text',text:SENTENCE}]],['the sentence and a line break',[{type:'text',text:SENTENCE+'\n'}]],
  ['a line break and the sentence',[{type:'text',text:'\n'+SENTENCE}]],['the sentence, then a line break as a second block',[{type:'text',text:SENTENCE},{type:'text',text:'\n'}]],
  // for the writer's remedy: a character no trim removes, and the sentence beside an image (a person's paste)
  ['the sentence and a zero-width space',[{type:'text',text:SENTENCE+'\u200b'}]],['the sentence and an image',[{type:'text',text:SENTENCE},{type:'image',source:{type:'base64',media_type:'image/png',data:PNG}}]],
  ['the sentence and a line break, an answer pending',[{type:'text',text:SENTENCE+'\n'}],true]],
};

// The second sitting's (F33): the marked ring is dropped with nothing ready and filled with an answer; the plain
// sentence enters in each of the first sitting's forms; two blocks, the sentence then the mark alone, are recorded.
// Each frame: [label, content, expect ('drop' | 'enter' | 'fill' | null: recorded), the hook's text wanted, an answer first].
const IMG={type:'image',source:{type:'base64',media_type:'image/png',data:PNG}};
const txt=text=>({type:'text',text});
const P9_MARK={
 'p9-mark-string':[['the ring, nothing ready',RING,'drop',RING],['the plain sentence',SENTENCE,'enter',SENTENCE],['the sentence and a line break',SENTENCE+'\n','enter'],
  ['a line break and the sentence','\n'+SENTENCE,'enter'],['the ring, an answer pending',RING,'fill',RING,true]],
 'p9-mark-block':[['the ring, nothing ready',[txt(RING)],'drop',RING],['the plain sentence',[txt(SENTENCE)],'enter',SENTENCE],['the sentence and a line break',[txt(SENTENCE+'\n')],'enter'],
  ['a line break and the sentence',[txt('\n'+SENTENCE)],'enter'],['the sentence, then a line break as a second block',[txt(SENTENCE),txt('\n')],'enter'],
  ['the sentence and an image',[txt(SENTENCE),IMG],'enter'],['the sentence, then the mark alone as a second block',[txt(SENTENCE),txt(MARK)],null],
  ['the ring, an answer pending',[txt(RING)],'fill',RING,true]],
};
async function p9One(cell){
 const r=scratchRoot(cell),sid=randomUUID();
 // the probe mod's directory first, so its hook sees each prompt before sminos's may drop it
 const {p,stub}=await launch(`qsheet-c5-m1-${cell}`,r,sid,{firstPlugins:[probeMod(r)],cell});
 const sent=[];let seen=0;
 const hookLines=()=>existsSync(r.debug)?readFileSync(r.debug,'utf8').split('\n').filter(l=>l.includes('qc5-probe: prompt.submit')).map(l=>{try{return JSON.parse(l.slice(l.indexOf('{')));}catch{return null;}}):[];
 try{
  await init(p,r);await quiet(p,2000,15000);
  for(const [label,content,expect,hookWant,pending] of (P9_MARK[cell]??P9_FRAMES[cell].map(([l,c,pd])=>[l,c,undefined,undefined,pd]))){
   if(pending){const q=await ask(p,r,sid,1);seen=hookLines().length;if(q){answer(p,r,sid,q.id,'Beta');await waitPending(p,r,sid);await delay(6000);}}
   const n=stub.requests.length;const t=await turn(p,content);await quiet(p);const s=step(p,stub,`${cell}: ${label}`,t.from,n);
   const lines=hookLines();const hook=lines.slice(seen);seen=lines.length;
   const req=s.requests.find(x=>x.main);
   sent.push({label,content,expect,hookWant,imageInRequest:req?(req.last?.types??[]).includes('image'):null,uuid:t.uuid,hookText:hook.map(x=>x?.text??null),hookEvent:hook.map(x=>x?{fields:x.fields,event:x.event}:null),dropped:s.wire.some(w=>w.prompt_submit_outcome?.kind==='dropped_by_hook'),modelCalls:s.requests.filter(x=>x.main).length,delivered:!!req?.deliveries?.length,requestLast:req?.last?.raw??null});
  }
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {raw,debug}=await finish(p,stub,r,sid);
 for(const x of sent){const row=raw.find(y=>y.type==='user'&&y.uuid===x.uuid);x.savedRow=row?{content:row.message?.content,entrypoint:row.entrypoint??null}:null;}
 const ringLines=debug.filter(l=>/a ring is (filled|dropped)/.test(l)).map(l=>l.replace(/^.*\$\.ui\.log \(to debug\): /,''));
 if(P9_MARK[cell]){
  // each frame as expected: dropped, entered (nothing dropped, an image in the request where one was sent) or filled
  for(const x of sent){
   x.got=x.dropped?'drop':x.delivered?'fill':'enter';
   x.hookExact=x.hookWant===undefined?null:x.hookText.length===1&&x.hookText[0]===x.hookWant;
   x.ok=x.expect===null?null:x.got===x.expect&&x.hookExact!==false&&(!x.label.includes('image')||x.imageInRequest===true);
  }
  const markKept=sent.filter(x=>x.hookWant===RING).every(x=>x.hookExact);
  const answer=sent.every(x=>x.ok!==false)?'the mark is kept and every plain form enters':markKept?'a plain form is still dropped (stop S9)':'the mark is not kept in e.text (the U+200B branch)';
  return verdict(p,cell,{answer,sent:sent.map(({content,...x})=>x),ringLines});
 }
 const broken=sent.filter(x=>x.label.startsWith('the sentence and a line break'));
 const kept=broken.every(x=>!x.dropped&&x.hookText.length===1&&x.hookText[0]===SENTENCE+'\n')&&broken.some(x=>x.savedRow&&JSON.stringify(x.savedRow.content).includes(JSON.stringify(SENTENCE+'\n').slice(1,-1)));
 return verdict(p,cell,{answer:kept?'kept':'trimmed',sent:sent.map(({content,...x})=>x),ringLines});
}
async function p9(){return {'p9-mark-string':await p9One('p9-mark-string'),'p9-mark-block':await p9One('p9-mark-block')};}
async function p9first(){return {'p9-string':await p9One('p9-string'),'p9-block':await p9One('p9-block')};}

// ---------------------------------------------------------------- the W cells: M1's behaviour on the wire
// What a step's frames say of a ring: dropped by the tool (B2's frames, the reason RING_DROP), and how many requests
// reached the model; `deliveries`, how many envelopes the step's last request holds (the history: each once at most).
function ringStep(s){
 const drop=s.wire.find(w=>w.prompt_submit_outcome?.kind==='dropped_by_hook');
 const main=s.requests.filter(x=>x.main);
 return {dropped:!!drop,reason:drop?.prompt_submit_outcome?.reason??null,modelCalls:main.length,deliveries:main.at(-1)?.deliveries?.length??0,
  frames:s.wire.filter(w=>w.type!=='stream_event').map(w=>[w.type,w.subtype??w.state??null].filter(Boolean).join('/'))};
}
const dismiss=(p,r,sid,id)=>{const x=cli(r,['sheet','dismiss','--session',sid,id]);p.note({event:'qc5_dismiss',id,code:x.code,out:x.out.slice(0,300),err:x.err});return x;};
// The transcript's records whole but for its listings (the probe's redact runs on every journal row).
const keepWhole=row=>!(row.type==='attachment'&&!['hook_additional_context','queued_command','edited_text_file'].includes(row.attachment?.type));
function noteWhole(p,raw,label){const rows=raw.filter(keepWhole).map(x=>{const t=JSON.stringify(x);return t.length>6000?{cut:true,uuid:x.uuid,type:x.type,head:t.slice(0,6000)}:x;});p.note({event:'qc5_transcript_whole',label,rows});return rows;}
// A ring's record in the file, and the hook context attached to it: the attachment row that names it as its parent, or
// the one the ring's record names as its own.
function ringRecords(raw,uuid){
 const rec=raw.find(x=>x.type==='user'&&x.uuid===uuid)??null;
 const att=raw.filter(x=>x.type==='attachment'&&x.attachment?.type==='hook_additional_context'&&x.attachment?.hookName==='prompt.submit');
 // the prompt an attachment belongs to: up its parents through other attachment rows (a budget row sits between, 2.1.331)
 const byUuid=new Map(raw.filter(x=>x.uuid).map(x=>[x.uuid,x]));
 const promptOf=a=>{let x=a,hops=0;while(x&&x.type==='attachment'&&hops++<20)x=byUuid.get(x.parentUuid);return x??null;};
 const bound=rec?att.find(a=>promptOf(a)?.uuid===rec.uuid)??null:null;
 const chain=[];if(bound){let x=bound;while(x&&x.uuid!==rec.uuid){chain.push({uuid:x.uuid,type:x.type,attachment:x.attachment?.type??null});x=byUuid.get(x.parentUuid);}}
 return {record:rec,bound,chain,hookRows:att.map(a=>({uuid:a.uuid,parentUuid:a.parentUuid,prompt:promptOf(a)?.uuid??null,entrypoint:a.entrypoint??null}))};
}
const deliveredOnce=stub=>{const m=stub.requests.filter(x=>x.main);return m.length?m.at(-1).deliveries.length:0;};

async function w1(){
 const cell='w1',r=scratchRoot(cell),sid=randomUUID();
 const {p,stub}=await launch(`qsheet-c5-m1-${cell}`,r,sid,{cell});
 const out={};let ringUuid=null;
 try{
  await init(p,r);await quiet(p,2000,15000);
  const q=await ask(p,r,sid,1);
  answer(p,r,sid,q.id,'Beta');await waitPending(p,r,sid);await delay(6000);
  const n=stub.requests.length;const t=await turn(p,RING);ringUuid=t.uuid;await quiet(p);
  const s=step(p,stub,'w1: a ring to an idle session, an answer pending',t.from,n);
  Object.assign(out,ringStep(s));
  const req=s.requests.find(x=>x.main);
  // the envelope and the sentence in one message: the last user message holds both
  out.sameMessage=!!req&&req.last.text.includes('<sheet-delivery>')&&req.last.text.includes(RING);
  const m=noteSheet(p,r,sid,'after the ring');
  out.pending=(m?.pending??[]).length;out.deliveredAt=m?.closed?.[q.id]?.deliveredAt??null;out.id=q.id;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {raw,debug}=await finish(p,stub,r,sid);
 out.historyDeliveries=deliveredOnce(stub);
 const rr=ringRecords(raw,ringUuid);p.note({event:'qc5_ring_records',label:'the ring',...rr});
 out.ringRecord=rr.record?{entrypoint:rr.record.entrypoint??null,content:rr.record.message?.content,promptSource:rr.record.promptSource??null,origin:rr.record.origin??null}:null;
 out.bound=rr.bound?{uuid:rr.bound.uuid,entrypoint:rr.bound.entrypoint??null,chain:rr.chain}:null;
 out.hookRows=rr.hookRows;
 out.ringLines=debug.filter(l=>/a ring is (filled|dropped)|landed/.test(l)).map(l=>l.replace(/^.*\$\.ui\.log \(to debug\): /,''));
 const stop=!out.ringRecord?.entrypoint;
 out.answer=stop?'stop S1: the ring\'s record names no entrypoint':!out.dropped&&out.historyDeliveries===1&&out.sameMessage&&out.pending===0&&!!out.deliveredAt&&!!out.bound?'pass':'fail';
 return verdict(p,cell,out);
}

async function w2(){
 const cell='w2',r=scratchRoot(cell),sid=randomUUID();
 const {p,stub}=await launch(`qsheet-c5-m1-${cell}`,r,sid,{cell});
 const out={};
 try{
  await init(p,r);await quiet(p,2000,15000);
  let n=stub.requests.length,t=await turn(p,RING);await quiet(p);
  out.nothing={...ringStep(step(p,stub,'w2: a ring, nothing pending',t.from,n)),uuid:t.uuid};
  const q=await ask(p,r,sid,1);dismiss(p,r,sid,q.id);await waitPending(p,r,sid);await delay(6000);
  n=stub.requests.length;t=await turn(p,RING);await quiet(p);
  out.dismissal={...ringStep(step(p,stub,'w2: a ring, only a dismissal pending',t.from,n)),uuid:t.uuid};
  noteSheet(p,r,sid,'after the second ring');
  n=stub.requests.length;t=await turn(p,'QC5-HELLO: say hello.');await quiet(p);
  const s=step(p,stub,'w2: a person\'s message of other words',t.from,n);
  const req=s.requests.find(x=>x.main);
  out.person={...ringStep(s),answered:s.wire.some(w=>w.type==='result'&&w.result==='HELLO'),carries:req?.deliveries??[]};
  const m=noteSheet(p,r,sid,'after the person\'s message');out.pending=(m?.pending??[]).length;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {raw,debug}=await finish(p,stub,r,sid);
 // §Y's rule for a dropped ring is written from what the file keeps of each drop: every record kept whole
 noteWhole(p,raw,'the whole transcript but its listings');
 const dropRows=raw.filter(x=>x.promptSubmitEnding||x.prompt_submit_outcome||(x.type==='system'&&/dropped/i.test(JSON.stringify(x.content??''))));
 out.fileDrops=dropRows.map(x=>({type:x.type,subtype:x.subtype??null,level:x.level??null,content:x.content??null,promptSubmitEnding:x.promptSubmitEnding??null,preventContinuation:x.preventContinuation??null,prompt_submit_outcome:x.prompt_submit_outcome??null,parentUuid:x.parentUuid??null,entrypoint:x.entrypoint??null,uuid:x.uuid}));
 out.ringRowsInFile=[out.nothing?.uuid,out.dismissal?.uuid].map(u=>raw.some(x=>x.uuid===u));
 out.ringLines=debug.filter(l=>/a ring is (filled|dropped)/.test(l)).map(l=>l.replace(/^.*\$\.ui\.log \(to debug\): /,''));
 const dropOk=x=>x?.dropped&&x.reason===RING_DROP&&x.modelCalls===0;
 out.answer=dropOk(out.nothing)&&dropOk(out.dismissal)&&out.person?.answered&&out.person.carries.some(d=>d.replace(/\\"/g,'"').includes('"dismissed":["q1"]'))&&out.pending===0?'pass':'fail';
 return verdict(p,cell,out);
}

// ---------------------------------------------------------------- W3 to W12
const ENDS=['completed','cancelled','discarded','refused'];
const lifecycle=(p,uuid)=>p.frames.filter(x=>x.frame.type==='command_lifecycle'&&x.frame.command_uuid===uuid).map(x=>x.frame.state);
const ended=(p,uuid)=>lifecycle(p,uuid).some(st=>ENDS.includes(st));
const toolUseSeen=(p,from,needle)=>p.wait(f=>f.type==='assistant'&&JSON.stringify(f.message?.content??'').includes(needle),{after:from,timeout:60000}).catch(()=>null);
const lines=(debug,re)=>debug.filter(l=>re.test(l)).map(l=>l.replace(/^.*\$\.ui\.log \(to debug\): /,''));
const RING_LINES=/a ring is (filled|dropped)|landed \d+ key|took \d+ entr/;
// Every envelope the model's history holds, by its keys, over the requests given (a history repeats what it held).
const historyKeys=reqs=>{const last=reqs.filter(x=>x.main).at(-1);return last?last.deliveries.map(d=>{try{return JSON.parse(d.replace(/\\"/g,'"')).keys;}catch{return d;}}):[];};
const newSessionAfter=(p,from,sid)=>p.frames.find(x=>x.seq>from&&x.frame.type==='system'&&x.frame.subtype==='init'&&x.frame.session_id&&x.frame.session_id!==sid)?.frame.session_id??null;
async function prepared(cell,{script=W_SCRIPT,n=1}={}){
 const r=scratchRoot(cell),sid=randomUUID();
 const {p,stub}=await launch(`qsheet-c5-m1-${cell}`,r,sid,{cell,script});
 await init(p,r);await quiet(p,2000,15000);
 const qs=[];for(let i=1;i<=n;i++)qs.push(await ask(p,r,sid,i));
 return {r,sid,p,stub,qs};
}
async function answered(p,r,sid,q){answer(p,r,sid,q.id,'Beta');await waitPending(p,r,sid);await delay(6000);}

async function w3(){
 const cell='w3';const {r,sid,p,stub,qs}=await prepared(cell);const out={};
 try{
  await answered(p,r,sid,qs[0]);
  const from=p.seq,n=stub.requests.length;const u1=frame(p,RING),u2=frame(p,RING);
  await until(()=>ended(p,u1)&&ended(p,u2),60000,200);await quiet(p);
  const s=step(p,stub,'w3: two rings one after the other, an answer pending',from,n);
  const drops=s.wire.filter(w=>w.prompt_submit_outcome?.kind==='dropped_by_hook');
  Object.assign(out,{lifecycle:{first:lifecycle(p,u1),second:lifecycle(p,u2)},drops:drops.length,reason:drops[0]?.prompt_submit_outcome?.reason??null,modelCalls:s.requests.filter(x=>x.main).length,history:historyKeys(stub.requests)});
  const m=noteSheet(p,r,sid,'after the rings');out.pending=(m?.pending??[]).length;out.deliveredAt=m?.closed?.[qs[0].id]?.deliveredAt??null;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {debug}=await finish(p,stub,r,sid);out.ringLines=lines(debug,RING_LINES);
 out.answer=out.drops===1&&out.reason===RING_DROP&&out.modelCalls===1&&out.history.length===1&&out.pending===0&&!!out.deliveredAt?'pass':'fail';
 return verdict(p,cell,out);
}

// W4a and W4b: a /clear between an answer and a ring. `landed`: the answer lands by a ring before the /clear.
async function w4(cell,landed){
 const {r,sid,p,stub,qs}=await prepared(cell);const out={};let nsid=null;
 try{
  answer(p,r,sid,qs[0].id,'Beta');await waitPending(p,r,sid);await delay(6000);
  if(landed){const n=stub.requests.length;const t=await turn(p,RING);await quiet(p);out.before=ringStep(step(p,stub,`${cell}: a ring before the /clear`,t.from,n));}
  const cleared=stub.requests.length;
  const c=await turn(p,'/clear');await quiet(p);nsid=newSessionAfter(p,c.from,sid);
  step(p,stub,`${cell}: /clear`,c.from,cleared);
  // the old sheet: kept with its outcome (landed) or removed with it (pending); the record's directory is looked at
  if(!landed)out.oldRecordGone=!!(await until(()=>!existsSync(join(r.sminos,'sheet',sid,'state.json')),40000,500));
  out.oldRecord=existsSync(join(r.sminos,'sheet',sid,'state.json'))?noteSheet(p,r,sid,'the old session after the /clear')?.closed??null:null;
  await delay(4000);
  let n=stub.requests.length;let t=await turn(p,RING);await quiet(p);
  out.after=ringStep(step(p,stub,`${cell}: a ring after the /clear`,t.from,n));
  n=stub.requests.length;t=await turn(p,'QC5-HELLO: say hello.');await quiet(p);
  const hello=step(p,stub,`${cell}: a person's message in the new conversation`,t.from,n);
  out.newHistory=historyKeys(hello.requests);out.before&&(out.oldHistory=historyKeys(stub.requests.slice(0,cleared)));
  out.newSession=nsid!==null;if(nsid)noteSheet(p,r,nsid,'the new session');
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {debug}=await finish(p,stub,r,sid);
 if(nsid)noteTranscript(p,r,nsid,'the new conversation\'s transcript');
 out.ringLines=lines(debug,RING_LINES);out.clearLines=lines(debug,/a \/clear left|cleared/);
 const dropped=x=>x?.dropped&&x.reason===RING_DROP&&x.modelCalls===0;
 out.answer=(landed?out.before?.deliveries===1&&out.oldHistory?.length===1:out.oldRecordGone)&&dropped(out.after)&&out.newHistory.length===0&&out.newSession?'pass':'fail';
 return verdict(p,cell,out);
}
const w4a=()=>w4('w4a',true),w4b=()=>w4('w4b',false);

async function w5(){
 const cell='w5';const {r,sid,p,stub,qs}=await prepared(cell);const out={};
 try{
  const from=p.seq,n=stub.requests.length;frame(p,'QC5-SLEEP 15: run the wait.');
  await toolUseSeen(p,from,'toolu_sleep');await delay(1000);
  answer(p,r,sid,qs[0].id,'Beta');await waitPending(p,r,sid);await delay(2000);
  const u=frame(p,RING,'next');out.ringWrittenAt=p.seq;
  await p.wait(f=>f.type==='result',{after:from,timeout:90000}).catch(()=>null);await until(()=>ended(p,u),30000,200);await quiet(p);
  const s=step(p,stub,'w5: an answer one second into a long call, and a ring written next during it',from,n);
  const main=s.requests.filter(x=>x.main);
  out.carriedBy=main.filter(x=>x.deliveries.length).map(x=>x.last?.types);out.holders=main.filter(x=>x.deliveries.length).map(x=>x.holders);out.modelCalls=main.length;out.history=historyKeys(stub.requests);
  out.ringLifecycle=lifecycle(p,u);out.ringFrames=s.wire.filter(w=>w.seq>out.ringWrittenAt&&(w.command_uuid===u||w.prompt_submit_outcome||w.type==='result'||w.subtype==='informational')).map(w=>({seq:w.seq,type:w.type,subtype:w.subtype??null,state:w.state??null,num_turns:w.num_turns,prompt_submit_outcome:w.prompt_submit_outcome??null,content:w.content??null,result:w.result}));
  out.results=s.wire.filter(w=>w.type==='result').length;
  const m=noteSheet(p,r,sid,'after the call');out.pending=(m?.pending??[]).length;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {raw,debug}=await finish(p,stub,r,sid);out.ringLines=lines(debug,RING_LINES);
 out.fileDrops=raw.filter(x=>x.promptSubmitEnding).map(x=>({type:x.type,subtype:x.subtype,level:x.level,content:x.content,promptSubmitEnding:x.promptSubmitEnding}));
 out.answer=out.history.length===1&&out.carriedBy.length>=1&&(out.carriedBy[0]??[]).includes('tool_result')&&out.pending===0?'pass':'fail';
 return verdict(p,cell,out);
}

// The engine and its children killed at once, as B6: the `landed` step the engine started dies with it.
function killTree(p){
 const tree=execFileSync('ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));
 const kids=[];const walk=id=>{for(const [c,pp] of tree)if(pp===id){kids.push(c);walk(c);}};walk(p.child.pid);
 for(const id of [p.child.pid,...kids])try{process.kill(id,'SIGKILL');}catch{}
 return 1+kids.length;
}
async function w6(){
 const cell='w6';let {r,sid,p,stub,qs}=await prepared(cell);const out={};
 try{
  await answered(p,r,sid,qs[0]);
  const n=stub.requests.length;frame(p,RING);
  await until(()=>stub.requests.slice(n).some(x=>x.deliveries?.length),20000,20);
  out.killed=killTree(p);p.note({event:'qc5_kill',afterRequests:stub.requests.length,killed:out.killed});await p.closed;
  const m=noteSheet(p,r,sid,'after the kill');out.pendingAfterKill=(m?.pending??[]).map(o=>o.key);
  p.note({event:'stub_requests',requests:stub.requests});await stub.close();noteTranscript(p,r,sid,'first process');noteDebug(p,r);sweep(p,r);
  verdict(p,cell,{part:'first process',...out});
  const r2={...r,debug:join(r.root,'engine-debug-resumed.log')};
  ({p,stub}=await launch(`qsheet-c5-m1-${cell}-resumed`,r2,sid,{cell:cell+'-resumed',resume:sid,script:W_SCRIPT}));r=r2;
  await init(p,r);await delay(8000);
  const s0=noteSheet(p,r,sid,'after the resumed start, before any prompt');out.pendingAtStart=(s0?.pending??[]).length;out.deliveredAt=s0?.closed?.[qs[0].id]?.deliveredAt??null;out.requestsBeforePrompt=stub.requests.filter(x=>x.main).length;
  let k=stub.requests.length,t=await turn(p,RING);await quiet(p);out.ring=ringStep(step(p,stub,'w6: a ring after the resumed start',t.from,k));
  k=stub.requests.length;t=await turn(p,'QC5-HELLO: say hello.');await quiet(p);step(p,stub,'w6: a person\'s message',t.from,k);
  out.history=historyKeys(stub.requests);
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {debug}=await finish(p,stub,r,sid);out.ringLines=lines(debug,RING_LINES);out.startLines=lines(debug,/search|landed|delivered envelopes/);
 out.answer=out.pendingAfterKill?.length===1&&out.pendingAtStart===0&&!!out.deliveredAt&&out.requestsBeforePrompt===0&&out.ring?.dropped&&out.history.length===1?'pass':'fail';
 return verdict(p,cell,out);
}

async function w7(){
 const cell='w7';const {r,sid,p,stub,qs}=await prepared(cell);const out={};
 try{
  await answered(p,r,sid,qs[0]);
  W7_RING_SLEEPS.on=true;
  const from=p.seq,n=stub.requests.length;const u=frame(p,RING);
  await until(()=>lifecycle(p,u).includes('started'),20000,5);
  const at=p.seq;let reply=null;try{reply=await p.request('interrupt',{},15000);}catch(e){reply={error:e.message};}
  await p.wait(f=>f.type==='result',{after:from,timeout:60000}).catch(()=>null);await until(()=>ended(p,u),20000,200);await quiet(p);
  W7_RING_SLEEPS.on=false;
  const s=step(p,stub,'w7: a ring, interrupted as soon as it started',from,n);
  out.interruptAt=at;out.interrupt=reply?.subtype??reply;out.ringLifecycle=lifecycle(p,u);
  out.ringTurn={modelCalls:s.requests.filter(x=>x.main).length,carried:s.requests.filter(x=>x.main&&x.deliveries.length).length,result:s.wire.filter(w=>w.type==='result').map(w=>({subtype:w.subtype,num_turns:w.num_turns,result:w.result}))};
  const m=noteSheet(p,r,sid,'after the interrupt');out.pendingAfterStop=(m?.pending??[]).map(o=>o.key);
  const k=stub.requests.length,t=await turn(p,'QC5-HELLO: say hello.');await quiet(p);
  const h=step(p,stub,'w7: a person\'s message',t.from,k);out.helloCarried=h.requests.filter(x=>x.main&&x.last?.text?.includes('<sheet-delivery>')).length;
  out.history=historyKeys(stub.requests);
  const m2=noteSheet(p,r,sid,'after the message');out.pending=(m2?.pending??[]).length;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {debug}=await finish(p,stub,r,sid);out.ringLines=lines(debug,RING_LINES);
 out.landedIn=out.ringTurn?.carried?(out.pendingAfterStop?.length?'neither yet':'the interrupted turn'):'the message';
 out.answer=out.history?.length===1&&out.pending===0?'pass':'fail';
 return verdict(p,cell,out);
}

async function w8(){
 const cell='w8';const {r,sid,p,stub,qs}=await prepared(cell,{n:2});const out={};
 try{
  const from=p.seq;frame(p,'QC5-SLEEP 20: run the wait.');
  await toolUseSeen(p,from,'toolu_sleep');await delay(1000);
  answer(p,r,sid,qs[0].id,'Beta');await waitPending(p,r,sid);await delay(3000);
  let reply=null;try{reply=await p.request('interrupt',{},15000);}catch(e){reply={error:e.message};}
  await p.wait(f=>f.type==='result',{after:from,timeout:60000}).catch(()=>null);await quiet(p);
  out.interrupt=reply?.subtype??reply;const atStop=stub.requests.length;
  step(p,stub,'w8: a wait, an answer, an interrupt',from,0);
  dismiss(p,r,sid,qs[1].id);
  await until(()=>{const m=show(r,sid);return (m?.pending??[]).length>=2;},40000,700);noteSheet(p,r,sid,'after the dismissal');await delay(8000);
  out.requestsBetween=stub.requests.length-atStop;
  const k=stub.requests.length,t=await turn(p,'QC5-HELLO: say hello.');await quiet(p);
  const h=step(p,stub,'w8: a person\'s message',t.from,k);
  const req=h.requests.find(x=>x.main);out.carries=req?.deliveries??[];
  const m=noteSheet(p,r,sid,'after the message');out.pending=(m?.pending??[]).length;out.history=historyKeys(stub.requests);
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {debug}=await finish(p,stub,r,sid);out.ringLines=lines(debug,RING_LINES);
 const all=(out.carries??[]).map(d=>d.replace(/\\"/g,'"')).join(' ');
 out.answer=out.requestsBetween===0&&/"answered":\[\{"id":"q1"/.test(all)&&/"dismissed":\[[^\]]*"q2"/.test(all)&&out.pending===0?'pass':'fail';
 return verdict(p,cell,out);
}

async function w9(){
 const cell='w9';let {r,sid,p,stub,qs}=await prepared(cell);const out={};
 try{
  await finish(p,stub,r,sid,'stopped');verdict(p,cell,{part:'first process'});
  answer(p,r,sid,qs[0].id,'Beta');const m0=noteSheet(p,r,sid,'answered while stopped');out.whileStopped={open:(m0?.open??[]).length,pending:(m0?.pending??[]).length};
  const r2={...r,debug:join(r.root,'engine-debug-resumed.log')};
  ({p,stub}=await launch(`qsheet-c5-m1-${cell}-resumed`,r2,sid,{cell:cell+'-resumed',resume:sid,script:W_SCRIPT}));r=r2;
  await init(p,r);
  const m1=noteSheet(p,r,sid,'at ready, before any frame');out.atReady={pending:(m1?.pending??[]).map(o=>({id:o.id,acrossStop:o.acrossStop})),framesWritten:p.frames.filter(x=>x.direction==='out'&&x.frame.type==='user').length,requests:stub.requests.filter(x=>x.main).length};
  const k=stub.requests.length,t=await turn(p,RING);await quiet(p);
  const s=step(p,stub,'w9: a ring at ready of the resumed launch',t.from,k);out.ring=ringStep(s);
  const req=s.requests.find(x=>x.main);out.startContext=!!req?.last?.text?.includes('after a resume');out.marked=!!req?.last?.text?.includes('while this session was stopped');
  const k2=stub.requests.length,t2=await turn(p,RING);await quiet(p);out.second=ringStep(step(p,stub,'w9: a second ring',t2.from,k2));
  out.history=historyKeys(stub.requests);const m2=noteSheet(p,r,sid,'after the rings');out.pending=(m2?.pending??[]).length;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {debug}=await finish(p,stub,r,sid);out.ringLines=lines(debug,RING_LINES);
 out.answer=out.whileStopped?.pending===0&&out.atReady?.pending?.length===1&&out.atReady.pending[0].acrossStop===true&&out.atReady.framesWritten===0&&!out.ring?.dropped&&out.ring?.deliveries===1&&out.startContext&&out.marked&&out.second?.dropped&&out.history.length===1&&out.pending===0?'pass':'fail';
 return verdict(p,cell,out);
}

// The Agent tool runs a subagent in the background on this engine (its call returns at once; the main turn ends, and
// the agent's completion comes later as a task notification that opens a turn of its own): each subagent is waited for
// by its notification and the turn that follows.
async function agentDone(p,toolUseId,from){
 const note=await p.wait(f=>f.type==='system'&&f.subtype==='task_notification'&&f.tool_use_id===toolUseId&&f.status==='completed',{after:from,timeout:150000}).catch(()=>null);
 if(!note)return false;
 const at=p.frames.find(x=>x.frame===note)?.seq??from;
 await p.wait(f=>f.type==='result',{after:at,timeout:60000}).catch(()=>null);await quiet(p);return true;
}
async function w10(){
 const cell='w10',r=scratchRoot(cell),sid=randomUUID();
 const {p,stub}=await launch(`qsheet-c5-m1-${cell}`,r,sid,{cell,script:W_SCRIPT,keepHeld:true});const out={};
 const subOf=x=>(x.first??'').includes('QC5-SUB A')?'A':(x.first??'').includes('QC5-SUB B')?'B':'main';
 const SEND_OPENING_Q5=/From the human, through the question tool, not from your coordinator/;
 const holds=(x,id)=>x.deliveries.some(d=>d.replace(/\\"/g,'"').includes(`"id":"${id}"`));
 try{
  await init(p,r);await quiet(p,2000,15000);
  // A: asks and still runs (a 20 s wait); the answer comes during the wait
  let from=p.seq;frame(p,'QC5-AGENT A: start the subagent.');
  const qa=await until(()=>show(r,sid)?.open?.find(q=>q.question==='QC5-M2 sub question A?'),60000,500);
  noteSheet(p,r,sid,'A asked');out.askerA=qa?.asker??null;
  await toolUseSeen(p,from,'toolu_suba_sleep');await delay(1500);
  if(qa)answer(p,r,sid,qa.id,'Beta');
  out.aDone=await agentDone(p,'toolu_agenta',from);
  const sa=step(p,stub,'w10: subagent A asks and still runs; the answer comes during its wait',from,0);
  noteSheet(p,r,sid,'after A');
  const reqs=sa.requests.filter(x=>x.main);
  out.a={inSubagent:reqs.filter(x=>subOf(x)==='A'&&holds(x,qa?.id)).length,inMain:reqs.filter(x=>subOf(x)==='main'&&holds(x,qa?.id)).length,
   subRequestAfterWait:reqs.filter(x=>subOf(x)==='A').at(-1)?.last?.text?.slice(-900)??null,
   // the message of the subagent's history that holds the envelope: the tool's send, its opening line first
   subHeld:(reqs.filter(x=>subOf(x)==='A'&&holds(x,qa?.id)).at(0)?.held??[]).map(m=>({i:m.i,role:m.role,opening:SEND_OPENING_Q5.test(m.content),content:m.content})),
   waitMovedToBackground:sa.wire.some(w=>w.type==='system'&&w.subtype==='task_started')&&p.frames.some(x=>x.frame.type==='system'&&x.frame.subtype==='task_started'&&x.frame.tool_use_id==='toolu_suba_sleep'&&x.frame.is_background===true)};
  // B: asks and ends with its question open; then the answer, then a ring
  from=p.seq;const n=stub.requests.length;frame(p,'QC5-AGENT B: start the subagent.');
  out.bDone=await agentDone(p,'toolu_agentb',from);
  const sb=step(p,stub,'w10: subagent B asks and ends',from,n);
  const qb=show(r,sid)?.open?.find(q=>q.question==='QC5-M2 sub question B?');noteSheet(p,r,sid,'B ended');out.askerB=qb?.asker??null;
  out.notice=sb.requests.filter(x=>x.main&&subOf(x)==='main'&&/ended with questions still open/.test(x.last?.text??'')).length;
  if(qb){answer(p,r,sid,qb.id,'Alpha');await waitPending(p,r,sid);await delay(6000);}
  const k=stub.requests.length,t=await turn(p,RING);await quiet(p);
  const s=step(p,stub,'w10: a ring for the ended subagent\'s answer',t.from,k);out.ring=ringStep(s);
  const req=s.requests.find(x=>x.main);const text=req?.last?.text??'';
  out.envelope={namesAsker:/from the subagent/.test(text)&&/which has ended/.test(text),questionWords:text.includes('QC5-M2 sub question B?'),label:/→ Alpha/.test(text),excerpt:text.slice(0,700)};
  const mainReqs=stub.requests.filter(x=>x.main&&subOf(x)==='main');
  out.noticesInHistory=mainReqs.at(-1)?.ended??null;out.history=historyKeys(mainReqs);
  out.mainHoldsA=mainReqs.some(x=>holds(x,qa?.id));
  const m=noteSheet(p,r,sid,'after the ring');out.pending=(m?.pending??[]).length;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {debug}=await finish(p,stub,r,sid);out.ringLines=lines(debug,RING_LINES);out.sendLines=lines(debug,/sheet: .*(send|subagent)/);
 out.answer=out.aDone&&out.bDone&&out.a?.inSubagent>=1&&out.a.subHeld.some(m=>m.opening)&&out.a.inMain===0&&!out.mainHoldsA&&out.notice===1&&out.noticesInHistory===1&&!out.ring?.dropped&&out.envelope?.namesAsker&&out.envelope.questionWords&&out.history.length===1&&out.pending===0?'pass':'fail';
 return verdict(p,cell,out);
}

async function w11(){
 const cell='w11';const {r,sid,p,stub,qs}=await prepared(cell);const out={};
 try{
  answer(p,r,sid,qs[0].id,'Beta');await waitPending(p,r,sid);await delay(6000);
  const c=await turn(p,'/compact',{timeout:120000});await quiet(p);
  out.compacted=p.frames.some(x=>x.seq>c.from&&x.frame.type==='system'&&x.frame.subtype==='compact_boundary');
  noteSheet(p,r,sid,'after the compaction');
  const k=stub.requests.length,t=await turn(p,RING);await quiet(p);
  const s=step(p,stub,'w11: a ring after the compaction',t.from,k);out.ring=ringStep(s);
  const req=s.requests.find(x=>x.main);
  out.afterCompaction={deliveries:req?.deliveries?.length??0,questionWords:/QC5-M2 question 1\?/.test(req?.last?.text??''),label:/→ Beta/.test(req?.last?.text??''),messages:req?.messages??null};
  const m=noteSheet(p,r,sid,'after the ring');out.pending=(m?.pending??[]).length;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 const {debug}=await finish(p,stub,r,sid);out.ringLines=lines(debug,RING_LINES);out.startLines=lines(debug,/compact|start's context|SessionStart/i).slice(0,10);
 out.answer=out.compacted&&!out.ring?.dropped&&out.afterCompaction?.deliveries===1&&out.afterCompaction.questionWords&&out.pending===0?'pass':'fail';
 return verdict(p,cell,out);
}

async function w12(){
 const cell='w12',r=scratchRoot(cell),sid=randomUUID();
 const {p,stub}=await launch(`qsheet-c5-m1-${cell}`,r,sid,{cell,script:W_SCRIPT});const out={};
 try{
  await init(p,r);await quiet(p,2000,15000);
  const from=p.seq,n=stub.requests.length;const ring=frame(p,RING),person=frame(p,'QC5-HELLO: say hello.');
  await until(()=>ended(p,ring)&&ended(p,person),60000,100);await quiet(p);
  const s=step(p,stub,'w12: a person\'s frame queued behind a ring that is dropped',from,n);
  const who=u=>u===ring?'ring':u===person?'person':undefined;
  out.order=p.frames.filter(x=>x.seq>from&&x.frame.type!=='stream_event').map(x=>({seq:x.seq,type:x.frame.type,subtype:x.frame.subtype??null,state:x.frame.state??null,of:who(x.frame.command_uuid)??(x.frame.type==='user'?who(x.frame.uuid)??null:null),
   outcome:x.frame.prompt_submit_outcome?.kind??null,num_turns:x.frame.num_turns,result:typeof x.frame.result==='string'?x.frame.result.slice(0,80):undefined}));
  out.ring=ringStep({...s,wire:s.wire.filter(w=>w.seq<=(p.frames.find(x=>x.frame.command_uuid===ring&&ENDS.includes(x.frame.state))?.seq??Infinity))});
  out.personAnswered=s.wire.some(w=>w.type==='result'&&w.result==='HELLO');out.modelCalls=s.requests.filter(x=>x.main).length;
 }catch(e){p.note({event:'scenario_error',error:e.stack});console.error(e.message);}
 await finish(p,stub,r,sid);
 out.answer=out.ring?.dropped&&out.ring.reason===RING_DROP&&out.personAnswered&&out.modelCalls===1?'pass':'fail';
 return verdict(p,cell,out);
}

const CELLS={p6,p7,p8,p9,'p9-first':p9first,w1,w2,w3,w4a,w4b,w5,w6,w7,w8,w9,w10,w11,w12};
export default async()=>{
 // the whole set by default; `p9-first` (the first sitting's frames, M1 at 34e1942ca) only when named
 const only=(env0.QC5_ONLY||Object.keys(CELLS).filter(c=>c!=='p9-first').join(',')).split(',').filter(Boolean);
 for(const c of only)if(!CELLS[c])throw new Error(`QC5_ONLY: no cell ${c} (${Object.keys(CELLS).join(', ')})`);
 for(const c of only)await CELLS[c]();
};
