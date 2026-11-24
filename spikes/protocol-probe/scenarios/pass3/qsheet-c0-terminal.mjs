// Question sheet, child C0: the terminal half of the engine probes (composite spec
// docs/doperpowers/specs/2026-11-23-question-sheet-design.md, §12; child C0; parent pin ad4427f93; board ticket #865).
// An interactive engine (the installed one, a terminal session as a person starts one) under tmux, with the probe mod
// of qsheet-c0.mjs loaded by `--plugin-dir`, answered by the scripted Messages API stand-in (../../stub-api.mjs), under
// a scratch CLAUDE_CONFIG_DIR seeded with the first-run flags, the trust of its working repository and the owner's
// feature-gate cache (PROBE_FEATURE_CACHE). The environment is built from nothing but PATH, HOME, TERM and the locale.
// The record of each run is fixtures/qsheet/<name>.ndjson: notes (not a journal, so not .jsonl), pane captures, the requests the stand-in received, the
// mod's own log, and the session's transcript rows that carry an arrival.
//   qsheet-t-p2   P2 in a terminal session: $.session.send to a running background child (from the tool's dispatch
//                 and from a timer), then to the ended child; the pane shows whether any dialog opened
//   qsheet-t-p5   P5 in a terminal session: SessionStart context at startup, /compact, a new process's --resume and
//                 /branch; plus a capture of a path outside the project and of a .env from a timer (P3: no dialog)
// Run: node run-pass3.mjs qsheet-c0-terminal (QSHEET_ONLY=qsheet-t-p2 picks one).
import {startStubApi,textTurn,toolTurn} from '../../stub-api.mjs';
import {redact,delay} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,cpSync,appendFileSync,realpathSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HERE=dirname(fileURLToPath(import.meta.url));
const FIXTURES=join(HERE,'../../fixtures/qsheet');
const MODS=process.env.QSHEET_MODS||join(HERE,'qsheet-c0-mods');
const KEEP=process.env.QSHEET_KEEP||join(homedir(),'.local/share/question-sheet-c0/runs');
const BIN=realpathSync(process.env.PROBE_ENGINE||join(homedir(),'.local/bin/claude'));
const VERSION=execFileSync(BIN,['--version'],{encoding:'utf8'}).trim().split(/\s+/)[0];
const PROVENANCE={spec:'docs/doperpowers/specs/2026-11-23-question-sheet-design.md',child:'C0',pin:'ad4427f93',ticket:'#865',api:'stub-api.mjs (nothing spent)',engine:BIN,engineVersion:VERSION,surface:'terminal (tmux)'};

const MARK=/.{0,140}QSP-[A-Z0-9]+[^"\\]{0,110}/g;
const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(b=>b.type==='text'?b.text:b.type==='tool_result'?'[tool_result '+b.tool_use_id+'] '+textOf(b.content):b.type==='tool_use'?'[tool_use '+b.name+' '+b.id+']':'['+b.type+']').join('\n'):'';
const isChild=body=>JSON.stringify(body.messages?.[0]??'').includes('QSP-CHILD');
const lastUser=body=>[...(body.messages??[])].reverse().find(m=>m.role==='user');
const record=body=>{const msgs=body.messages??[];const whole=JSON.stringify(msgs);const blocks=[...whole.matchAll(/.{0,80}system-reminder> x.{0,20}|.{0,60}<sheet-delivery>.{0,30}/g)].map(x=>x[0]).slice(0,12);const hits=[];msgs.forEach((m,i)=>{for(const x of JSON.stringify(m.content).matchAll(MARK))hits.push({i,role:m.role,hit:x[0]});});return {child:isChild(body),messages:msgs.length,hits,blocks,last:textOf(lastUser(body)?.content).slice(-600)};};
const rules=list=>body=>{const last=JSON.stringify(lastUser(body)??'');for(const [needle,turn] of list)if(last.includes(needle))return typeof turn==='function'?turn(body):turn;return undefined;};

function scratch(label,settings){
 const root=realpathSync(mkdtempSync(`/tmp/qsheet-${label}-`));
 const home=join(root,'config'),cwd=join(root,'repo'),qsp=join(root,'qsp');
 for(const d of [home,cwd,join(qsp,'log'),join(qsp,'cmd'),join(qsp,'res')])mkdirSync(d,{recursive:true});
 writeFileSync(join(cwd,'one.txt'),'ONE\n');
 execFileSync('git',['init','-q'],{cwd});execFileSync('git',['add','one.txt'],{cwd});execFileSync('git',['-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','seed'],{cwd});
 const features=process.env.PROBE_FEATURE_CACHE?JSON.parse(readFileSync(process.env.PROBE_FEATURE_CACHE,'utf8')):{};
 writeFileSync(join(home,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,theme:'light',hasResetAutoModeOptInForDefaultOffer:true,hasSeenAutoDefaultNudge:true,hasSeenAutoModeEntryWarning:true,hasSeenAutoDefaultNotice:true,autoModeClassifierBillingNoticeAcknowledgedAt:Date.now(),projects:{[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}},...features}));
 writeFileSync(join(home,'settings.json'),JSON.stringify(settings)+'\n');
 const plugins=join(root,'plugins');cpSync(join(MODS,'qsprobe'),join(plugins,'qsprobe'),{recursive:true,filter:s=>!s.includes('/types/')});
 return {root,home,cwd,qsp,plugin:join(plugins,'qsprobe')};
}

class Term{
 constructor(name,run,stub){this.name=name;this.run=run;this.stub=stub;this.sock='qs-'+name;this.file=join(FIXTURES,name+'.ndjson');this.seq=0;mkdirSync(FIXTURES,{recursive:true});writeFileSync(this.file,'');}
 note(o){appendFileSync(this.file,redact(JSON.stringify({seq:++this.seq,at:new Date().toISOString(),...o}))+'\n');}
 tmux(...a){return execFileSync('tmux',['-L',this.sock,...a],{encoding:'utf8'});}
 start(args,extraEnv=[]){
  const env=['env','-i',`PATH=${process.env.PATH}`,`HOME=${homedir()}`,'TERM=xterm-256color','LANG=en_US.UTF-8',`CLAUDE_CONFIG_DIR=${this.run.home}`,`ANTHROPIC_BASE_URL=${this.stub.url}`,'ANTHROPIC_AUTH_TOKEN=stub-token','CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',`QSP_DIR=${this.run.qsp}`,'DISABLE_AUTOUPDATER=1','ENABLE_TOOL_SEARCH=true',...extraEnv];
  const argv=[...env,BIN,'--plugin-dir',this.run.plugin,'--model','haiku','--permission-mode','default',...args];
  // PATH and HOME are inherited from the owner's shell and name its tools and home: only their keys are recorded, never a value.
  const inherited=a=>/^(PATH|HOME)=/.test(a);
  this.note({event:'spawn',envKeys:env.slice(2).map(a=>a.split('=')[0]).sort(),argv:argv.filter(a=>!inherited(a)).map(a=>a.startsWith('ANTHROPIC_AUTH_TOKEN')?'ANTHROPIC_AUTH_TOKEN=stub-token':a)});
  try{this.tmux('kill-server');}catch{}
  execFileSync('tmux',['-L',this.sock,'new-session','-d','-s',this.sock,'-x','160','-y','48','-c',this.run.cwd,...argv]);
 }
 pane(){try{return this.tmux('capture-pane','-p','-t',this.sock);}catch(e){return '(no pane: '+e.message+')';}}
 snap(label){const text=this.pane();this.note({event:'pane',label,text});return text;}
 async type(text){this.tmux('send-keys','-t',this.sock,'-l',text);await delay(300);this.tmux('send-keys','-t',this.sock,'Enter');}
 key(k){this.tmux('send-keys','-t',this.sock,k);}
 async until(test,{timeout=30000,label}={}){const end=Date.now()+timeout;while(Date.now()<end){const t=this.pane();if(test(t))return t;await delay(400);}this.snap('timeout: '+label);return null;}
 async idle(ms=2500,timeout=60000){let last='',same=0;const end=Date.now()+timeout;while(Date.now()<end){await delay(500);const t=this.pane();const n=this.stub.requests.length;const k=t+'|'+n;if(k===last){same+=500;if(same>=ms)return true;}else{same=0;last=k;}}return false;}
 stop(){try{this.tmux('kill-server');}catch{}}
}

const logs=qsp=>{const d=join(qsp,'log');return existsSync(d)?readdirSync(d).sort().map(f=>({file:f,...JSON.parse(readFileSync(join(d,f),'utf8'))})):[];};
let cmdN=0;
async function cmd(t,a,timeout=30000){const name=`t${String(++cmdN).padStart(3,'0')}-${a.op}.json`;writeFileSync(join(t.run.qsp,'cmd',name),JSON.stringify(a));t.note({event:'qsp_cmd',name,cmd:a});const out=join(t.run.qsp,'res',name);const end=Date.now()+timeout;while(Date.now()<end){if(existsSync(out)){const r=JSON.parse(readFileSync(out,'utf8'));t.note({event:'qsp_res',name,res:r});return r;}await delay(200);}t.note({event:'qsp_res_timeout',name});return null;}
function transcriptRows(run,sid){const dir=join(run.home,'projects');if(!existsSync(dir))return [];const out=[];for(const p of readdirSync(dir))for(const f of readdirSync(join(dir,p)))if(f.endsWith('.jsonl')&&(!sid||f.startsWith(sid)))out.push({file:f,rows:readFileSync(join(dir,p,f),'utf8').split('\n').filter(Boolean).map(l=>{try{const r=JSON.parse(l);return {type:r.type,sessionId:r.sessionId,att:r.attachment?.type,text:r.message?textOf(r.message.content).slice(0,240):(r.attachment?.content?JSON.stringify(r.attachment.content).slice(0,240):undefined)};}catch{return {unparsed:true};}})});return out;}
async function finish(t,keepAs){
 t.note({event:'stub_requests',requests:t.stub.requests});
 t.note({event:'qsp_logs',logs:logs(t.run.qsp)});
 t.note({event:'transcripts',files:transcriptRows(t.run).map(f=>({file:f.file,rows:f.rows.filter(r=>r.type==='user'||r.att==='hook_additional_context'||r.type==='system'||(r.text&&/QSP/.test(r.text)))}))});
 t.stop();await t.stub.close();
 mkdirSync(KEEP,{recursive:true});try{cpSync(t.run.root,join(KEEP,keepAs),{recursive:true});}catch{}
 rmSync(t.run.root,{recursive:true,force:true});
}
const ready=p=>/❯|>\s*$|\? for shortcuts|bypass|auto mode|accept edits|plan mode/m.test(p);

// ================= P2 in a terminal =================
let onChildSleep=null;
const childTurn=body=>{const all=JSON.stringify(body.messages);if(all.includes('toolu_c2'))return textTurn('DONE');if(all.includes('toolu_c1'))return toolTurn('toolu_c2','Bash',{command:'echo QSP-child-second-round',description:'echo'});const f=onChildSleep;onChildSleep=null;f?.();return toolTurn('toolu_c1','Bash',{command:'sleep 6; echo slept',description:'wait'});};
async function tP2(){
 const name='qsheet-t-p2';
 const parent=rules([
  ['"tool_use_id":"toolu_p2a"',toolTurn('toolu_p2s','mcp__qsprobe__ask',{op:'send',agent:'latest',text:'QSP-TOLD-1: sent from inside the tool dispatch'})],
  ['"tool_use_id":"toolu_p2s"',textTurn('parent waits')],
  ['QSP-P2-start',toolTurn('toolu_p2a','Agent',{description:'p2 child',prompt:'QSP-CHILD: run the sleep, then reply DONE.',subagent_type:'general-purpose',run_in_background:true})],
 ]);
 const stub=await startStubApi({record,respond:body=>isChild(body)?childTurn(body):parent(body)??textTurn('parent ok')});
 const run=scratch('tp2',{permissions:{allow:['Bash','Agent','Read','mcp__qsprobe__ask']}});
 const t=new Term(name,run,stub);cmdN=0;
 t.note({event:'provenance',...PROVENANCE,question:'P2 in a terminal session: $.session.send to a running background child from the tool dispatch and from a timer; to the child once ended; whether a dialog opens'});
 t.start([]);
 await t.until(ready,{timeout:40000,label:'prompt'});t.snap('started');
 onChildSleep=()=>setTimeout(()=>{t.note({event:'timer_send_while_child_sleeps'});cmd(t,{op:'send',agent:'latest',text:'QSP-TOLD-2: sent from a timer, outside any dispatch, while the child sleeps'});},2500);
 await t.type('QSP-P2-start: start the child.');
 await delay(4000);t.snap('child running');
 const end=Date.now()+60000;while(Date.now()<end&&!t.stub.requests.some(r=>r.child&&r.last.includes('toolu_c2')))await delay(500);
 await t.idle(4000,60000);t.snap('after the child ended');
 const ag=await cmd(t,{op:'agents'});
 const id=ag?.agents?.at(-1)?.id;
 const n0=stub.requests.length;
 await cmd(t,{op:'send',agent:id,text:'QSP-TOLD-3: sent to the child after it ended'});
 await delay(6000);await t.idle(4000,60000);t.snap('after the send to the ended child');
 t.note({event:'tp2_children',running:stub.requests.slice(0,n0).filter(r=>r.child).map(r=>({n:r.n,told:r.hits.filter(h=>h.hit.includes('TOLD')).map(h=>h.hit.slice(-120))})),ended:stub.requests.slice(n0).filter(r=>r.child).map(r=>({n:r.n,told:r.hits.filter(h=>h.hit.includes('TOLD')).map(h=>h.hit.slice(-120))}))});
 await finish(t,name);
}

// ================= P5 (and P3's dialog question) in a terminal =================
async function tP5(){
 const name='qsheet-t-p5';
 const respond=rules([['REMINDER: Do NOT call any tools',textTurn('<analysis>probe</analysis>\n<summary>QSP compact summary: short turns.</summary>')],['QSP-P5-',body=>textTurn('ok '+(body.messages?.length??0))]]);
 const stub=await startStubApi({record,respond,side:()=>textTurn('<summary>QSP compact summary (side).</summary>')});
 const run=scratch('tp5',{});
 writeFileSync(join(run.cwd,'.env'),'TOKEN=SECRET-VALUE-123\n');writeFileSync(join(run.root,'outside.txt'),'OUTSIDE\n');
 const t=new Term(name,run,stub);cmdN=0;
 t.note({event:'provenance',...PROVENANCE,question:'P5 in a terminal session: SessionStart context at startup, /compact, --resume (a new process) and /branch; P3: a capture of a path outside the project from a timer opens no dialog'});
 const sid=randomUUID();
 const step=async(label,text)=>{const n=stub.requests.length;await t.type(text);await delay(1500);await t.idle(3000,60000);t.note({event:'tp5_step',label,requests:stub.requests.slice(n).filter(r=>r.messages>0).map(r=>({n:r.n,messages:r.messages,ss:r.hits.filter(h=>/SSCTX/.test(h.hit)).map(h=>h.hit.slice(-110))}))});t.snap(label);};
 t.start(['--session-id',sid]);
 await t.until(ready,{timeout:40000,label:'prompt'});t.snap('started');
 await step('startup, first prompt','QSP-P5-one: hello.');
 await cmd(t,{op:'captures',items:[{path:join(run.root,'outside.txt')},{path:'.env'},{path:'one.txt'}]});
 await delay(1500);t.snap('after the captures from a timer (P3: any dialog?)');
 await step('/compact','/compact');
 await step('after the compaction','QSP-P5-two: and now?');
 t.stop();await delay(1500);
 t.start(['--resume',sid]);
 await t.until(ready,{timeout:40000,label:'prompt after resume'});t.snap('resumed');
 await step('resumed, first prompt','QSP-P5-three: resumed.');
 await step('/branch','/branch');
 await delay(2000);t.snap('after /branch');
 await step('after the branch, first prompt','QSP-P5-four: branched.');
 await finish(t,name);
}

// ================= P5: a literal <sheet-delivery> block in a terminal session's hook contexts =================
async function tBlock(){
 const name='qsheet-t-block';
 const stub=await startStubApi({record,respond:rules([['"tool_use_id":"toolu_pb"',textTurn('B done')],['QSP-P5B',toolTurn('toolu_pb','Bash',{command:'echo QSP-P5B-ran',description:'echo'})]])});
 const run=scratch('tblock',{permissions:{allow:['Bash']}});
 const t=new Term(name,run,stub);cmdN=0;
 t.note({event:'provenance',...PROVENANCE,question:'P5 (the coordinator\'s addition) in a terminal session: a <sheet-delivery>{…}</sheet-delivery> block whose JSON string holds "<b>", "&", and a literal </system-reminder> and <system-reminder>, appended to the SessionStart, prompt and tool-result contexts: what the model receives and what a session.append hook sees'});
 t.start([],['QSP_BLOCK=2']);
 await t.until(ready,{timeout:40000,label:'prompt'});
 await t.type('QSP-P5B: run the echo.');await delay(2000);await t.idle(3000,40000);t.snap('after the turn');
 t.note({event:'tblock_requests',requests:stub.requests.filter(r=>r.messages>0).map(r=>({n:r.n,blocks:r.blocks}))});
 t.note({event:'tblock_append',rows:logs(run.qsp).filter(l=>l.tag==='session.append')});
 await finish(t,name);
}

export default async()=>{
 const only=(process.env.QSHEET_ONLY??'').split(',').filter(Boolean);
 const want=n=>only.length===0||only.includes(n);
 if(want('qsheet-t-p2'))await tP2();
 if(want('qsheet-t-p5'))await tP5();
 if(want('qsheet-t-block'))await tBlock();
};
