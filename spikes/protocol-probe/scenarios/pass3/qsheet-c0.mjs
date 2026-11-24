// Question sheet, child C0: the engine probes P1 to P5 (composite spec docs/doperpowers/specs/2026-11-23-question-sheet-design.md,
// §12; child C0; parent pin ad4427f93; board ticket #865). The MAWS-run half: each launch is MAWS's (p1-common.mjs:
// ENGINE_FLAGS, `--settings`, buildEnvironment's constants, a scratch CLAUDE_CONFIG_DIR, the installed engine) with a
// probe mod loaded by `--plugin-dir`, answered by the scripted Messages API stand-in (../../stub-api.mjs), so nothing is
// spent and every request the engine sends the model is recorded with each probe marker it carries. The terminal half
// (an interactive engine under tmux, same mod, same stand-in) is qsheet-c0-terminal.mjs beside this file.
//
// The probe mods (qsheet-c0-mods/, copied into each run's root; findings-qsheet-c0.txt reads the record): `qsprobe` registers
// mcp__qsprobe__ask {op, ...}; adds `QSP-TOOLCTX` context to the main model's tool results, `QSP-PROMPTCTX` to every
// prompt.submit, `QSP-SSCTX source=<s>` at every classic.SessionStart; logs what each hook saw under $QSP_DIR/log; and
// runs a command file dropped in $QSP_DIR/cmd from a timer (outside any dispatch, as a drain the bridge triggers would).
// `qsguard` (P3) stands in for another plugin's secrets guard: a tool.check that denies `.env`, an unmatched tool.call
// that scrubs a marker from a Read's result.
//
//   qsheet-p1-hooks      P1: prompt.submit sees and adds context to the host's prompt, its idle `next` steer and its
//                        mid-turn `next` steer; context on a tool result; $.prompt.submit from the tool's dispatch and
//                        from a timer while idle
//   qsheet-p2-send       P2 over the wire: $.session.send from the mod (not a host mcp_call) to a running background
//                        child, from the tool's dispatch and from a timer; to the child once ended; in plan mode
//   qsheet-p3-capture    P3: $.tool.check then $.tool.call of Read from the tool's dispatch: the other plugin's hooks,
//                        a settings deny rule, a settings PreToolUse hook, file_unchanged before and after the model's
//                        own Read, read-before-edit, ranges, the default cut, an image, a path outside the project
//   qsheet-p3-auto       P3's check verdicts again after set_permission_mode auto, from a timer
//   qsheet-p3-compact    P3: after /compact, are files only the plugin read re-attached to the model's context?
//   qsheet-p5-block      P5 (the coordinator's addition): a literal <sheet-delivery> block in each kind of hook
//   qsheet-p5-block-reminder   context, and the row a session.append hook sees; -reminder adds reminder tags inside
//   qsheet-p4-sheet      P4 as C2 builds the record, no engine: os.replace of an fsynced state.json, flock beside the
//                        record across two appenders and a step, a lock-free Node reader and an fstat size sampler
//   qsheet-p4-files      P4 inside an engine session: $.fs.write in place against a reader in another process; a write
//                        beside and a rename; the inbox appended by two processes while the mod reads it
//   qsheet-p5-a .. -e    P5: classic.SessionStart context at startup, /compact, --resume, --fork-session, /clear, and
//                        a text that never changes (-e)
import {launch,scratchRun,initPayload,delay,join,mkdirSync,writeFileSync,existsSync,check,success,endAsStop,transcriptPath} from './p1-common.mjs';
import {startStubApi,textTurn,toolTurn} from '../../stub-api.mjs';
import {readFileSync,readdirSync,cpSync,rmSync,statSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const PROVENANCE={spec:'docs/doperpowers/specs/2026-11-23-question-sheet-design.md',child:'C0',pin:'ad4427f93',ticket:'#865',api:'stub-api.mjs (nothing spent)'};
// The probe mods are kept beside this file (qsheet-c0-mods/); QSHEET_MODS names another copy.
const MODS=process.env.QSHEET_MODS||fileURLToPath(new URL('./qsheet-c0-mods',import.meta.url));
// What the journals record of where the mods came from: a path inside the repository, never the machine's absolute one.
const MODS_REL=process.env.QSHEET_MODS?'(QSHEET_MODS)':'spikes/protocol-probe/scenarios/pass3/qsheet-c0-mods';
const KEEP=process.env.QSHEET_KEEP||join(homedir(),'.local/share/question-sheet-c0/runs');
const DIR='fixtures/qsheet/';

// ---- what a request carried ----
const MARK=/.{0,140}QSP-[A-Z0-9]+[^"\\]{0,110}/g;
const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(b=>b.type==='text'?b.text:b.type==='tool_result'?'[tool_result '+b.tool_use_id+(b.is_error?' error':'')+'] '+textOf(b.content):b.type==='tool_use'?'[tool_use '+b.name+' '+b.id+']':'['+b.type+']').join('\n'):'';
const isChild=body=>JSON.stringify(body.messages?.[0]??'').includes('QSP-CHILD');
const brief=m=>m?{role:m.role,types:Array.isArray(m.content)?m.content.map(b=>b.type):['string'],text:textOf(m.content).slice(-1500)}:null;
// Needles a scenario sets (NEEDLES.list) are looked for in each request whole, with a snippet around each.
const NEEDLES={list:[]};
const record=body=>{const msgs=body.messages??[];const whole=JSON.stringify(msgs);const needles=Object.fromEntries(NEEDLES.list.map(n=>{const i=whole.indexOf(n);return [n,i<0?null:whole.slice(Math.max(0,i-260),i+60)];}));const hits=[];msgs.forEach((m,i)=>{for(const x of JSON.stringify(m.content).matchAll(MARK))hits.push({i,role:m.role,hit:x[0]});});
 return {child:isChild(body),messages:msgs.length,hits,needles,blocks:[...whole.matchAll(/.{0,90}sheet-delivery.{0,60}/g)].map(x=>x[0]).slice(0,12),watch:[...JSON.stringify(msgs).matchAll(/.{0,240}WATCH[12]-CHANGED.{0,60}/g)].map(x=>x[0]),systemHits:[...JSON.stringify(body.system??'').matchAll(MARK)].map(x=>x[0]),last:brief(lastUser(body)),tools:(body.tools??[]).map(t=>t.name).filter(n=>n.startsWith('mcp__')||n==='Agent')};};
// The first rule whose needle the last message holds answers; tool_result needles first by the rule's order.
// (2.1.331 puts system-role entries in `messages`; the last user-role one is the turn's.)
const lastUser=body=>[...(body.messages??[])].reverse().find(m=>m.role==='user');
const rules=list=>body=>{const last=JSON.stringify(lastUser(body)??'');for(const [needle,turn] of list)if(last.includes(needle))return typeof turn==='function'?turn(body):turn;return undefined;};

// ---- the probe's own files ----
function logs(qsp){const d=join(qsp,'log');return existsSync(d)?readdirSync(d).sort().map(f=>({file:f,...JSON.parse(readFileSync(join(d,f),'utf8'))})):[];}
async function waitLog(qsp,test,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const hit=logs(qsp).find(test);if(hit)return hit;await delay(200);}return null;}
let cmdN=0;
async function cmd(p,qsp,a,timeout=30000){const name=`c${String(++cmdN).padStart(3,'0')}-${a.op}.json`;writeFileSync(join(qsp,'cmd',name),JSON.stringify(a));p.note({event:'qsp_cmd',name,cmd:a});const out=join(qsp,'res',name);const end=Date.now()+timeout;while(Date.now()<end){if(existsSync(out)){const r=JSON.parse(readFileSync(out,'utf8'));p.note({event:'qsp_res',name,res:r});return r;}await delay(200);}p.note({event:'qsp_res_timeout',name});return null;}
const results=p=>p.frames.filter(r=>r.frame.type==='result').length;
async function quiet(p,ms=3000,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const s=p.seq;await delay(ms);if(p.seq===s)return true;}return false;}
async function turnT(p,content,ms=60000){const s=p.seq;p.user(content);return p.wait(f=>f.type==='result',{after:s,timeout:ms}).catch(e=>{p.note({event:'turn_timeout',content,ms});return null;});}
function steer(p,content,priority='next'){return p.send({type:'user',uuid:randomUUID(),message:{role:'user',content},parent_tool_use_id:null,origin:{kind:'human'},priority});}
// The wire frames a probe step cites: user replays, results, hook and status frames, task frames.
const wireOf=(p,from)=>p.frames.filter(r=>r.seq>from).map(r=>r.frame).filter(f=>(f.type==='user'&&!(Array.isArray(f.message?.content)&&f.message.content.some(b=>b.type==='tool_result')))||f.type==='result'||(f.type==='system'&&/^(init|hook_|task_|status|compact|local_command)/.test(f.subtype))).map(f=>({type:f.type,subtype:f.subtype,uuid:f.uuid,isReplay:f.isReplay,origin:f.origin,priority:f.priority,text:f.message?textOf(f.message.content).slice(0,300):undefined,hook:f.hook_name??f.hook_event,source:f.source,task_id:f.task_id,status:f.status,result:typeof f.result==='string'?f.result.slice(0,200):undefined}));

// ---- one launch ----
async function probe(name,{question,plugins=['qsprobe'],respond,side,flags=[],vars={},settings={},files={},body,keepRun=false,run:given,sessionId,pinned=true}){
 const run=given??scratchRun(name.replace(/^qsheet-/,'q'),{settings});
 const qsp=join(run.root,'qsp');for(const d of ['log','cmd','res']){rmSync(join(qsp,d),{recursive:true,force:true});mkdirSync(join(qsp,d),{recursive:true});}
 for(const [path,text] of Object.entries(files)){const f=path.startsWith('/')?path:join(run.cwd,path);mkdirSync(join(f,'..'),{recursive:true});writeFileSync(f,text);}
 const dirs=plugins.map(n=>{const to=join(run.root,'plugins',n);if(!existsSync(to))cpSync(join(MODS,n),to,{recursive:true,filter:s=>!s.includes('/types/')});return to;});
 const stub=await startStubApi({record,respond:respond??(()=>undefined),side:side??(()=>textTurn('ok'))});
 cmdN=0;
 let p;
 try{
  p=await launch(name,run,{dir:DIR,relay:false,spendCap:'0.01',sessionId,pinned,flags:[...dirs.flatMap(d=>['--plugin-dir',d]),...flags],debugPattern:/plugin|hook|session\.send|SendMessage|qsprobe|qsguard|QSP|SessionStart|prompt\.submit/i,
   vars:{ANTHROPIC_BASE_URL:stub.url,ANTHROPIC_AUTH_TOKEN:'stub-token',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1',QSP_DIR:qsp,...vars},provenance:{...PROVENANCE,question,plugins,modSource:MODS_REL}},async p=>{
   p.on('can_use_tool',r=>{p.note({event:'permission_asked',tool:r.tool_name,agentId:r.agent_id??null,input:r.input});const h=p.onPermission?.(r);return h??{behavior:'allow',updatedInput:r.input};});
   success(await p.init(initPayload(run.cwd)),'initialize');
   const reg=await waitLog(qsp,l=>l.tag==='registered'||l.tag==='register-failed',20000);
   p.note({event:'qsp_registered',log:reg});
   await body(p,{stub,qsp,run});
   await quiet(p,2000,20000);
   p.note({event:'stub_requests',requests:stub.requests});
   p.note({event:'qsp_logs',logs:logs(qsp)});
   await endAsStop(p);
  });
 }finally{
  await stub.close();
  mkdirSync(KEEP,{recursive:true});try{cpSync(run.root,join(KEEP,name),{recursive:true});}catch{}
  if(!keepRun)rmSync(run.root,{recursive:true,force:true});
 }
 return {p,run,qsp};
}

// ================= P1 =================
const P1={question:'P1: in a MAWS-run session, does the tool\'s prompt.submit hook see the host\'s steer, can it add context to it, does context on a tool result reach the model, does $.prompt.submit start a turn?',
 respond:rules([
  ['toolu_qa',textTurn('A done')],['QSP-A',toolTurn('toolu_qa','Bash',{command:'echo QSP-A-ran',description:'echo'})],
  ['toolu_qb',textTurn('B done')],['QSP-STEER-MID',textTurn('steer read')],['QSP-B',toolTurn('toolu_qb','Bash',{command:'sleep 4',description:'wait'})],
  ['QSP-C',textTurn('C done')],
  ['toolu_qd2',textTurn('D2 done')],['QSP-SUBMITTED-D2',textTurn('submitted D2 read')],['QSP-D2',toolTurn('toolu_qd2','mcp__qsprobe__ask',{op:'submit-at-turn-end',text:'QSP-SUBMITTED-D2: a plugin submitted this at turn.complete'})],
  ['toolu_qd',textTurn('D done')],['QSP-SUBMITTED-D',textTurn('submitted D read')],['QSP-D',toolTurn('toolu_qd','mcp__qsprobe__ask',{op:'submit',text:'QSP-SUBMITTED-D: a plugin submitted this from the tool dispatch'})],
  ['QSP-SUBMITTED-E',textTurn('submitted E read')],
 ]),
 body:async(p,{stub,qsp})=>{
  const step=async(label,fn,wait=true)=>{const from=p.seq,req=stub.requests.length;await fn();if(wait)await quiet(p,3000,40000);p.note({event:'p1_step',label,wire:wireOf(p,from),requests:stub.requests.slice(req).map(r=>({n:r.n,main:r.main,hits:r.hits,last:r.last})),promptSubmits:logs(qsp).filter(l=>l.tag==='prompt.submit').map(l=>l.e.text)});};
  await step('A: a host prompt while idle; a Bash call in its turn',()=>turnT(p,'QSP-A: run the echo.'));
  await step('B: a next steer while a turn runs (during a Bash call)',async()=>{const s=p.seq;const t=turnT(p,'QSP-B: run the sleep.');await p.wait(f=>f.type==='assistant'&&JSON.stringify(f.message?.content??'').includes('toolu_qb'),{after:s,timeout:30000}).catch(()=>null);await delay(1200);p.note({event:'steer_sent',priority:'next'});steer(p,'QSP-STEER-MID: a next steer sent while the sleep runs.');await t;});
  await step('C: a next steer while idle (how MAWS steers an answer)',async()=>{const s=p.seq;steer(p,'QSP-C: an idle next steer.');await p.wait(f=>f.type==='result',{after:s,timeout:30000});});
  await step('D: $.prompt.submit from inside the tool\'s own dispatch',async()=>{const n=results(p);await turnT(p,'QSP-D: call the probe tool.');const end=Date.now()+15000;while(results(p)<n+2&&Date.now()<end)await delay(300);});
  await step('D2: $.prompt.submit from the mod\'s turn.complete hook (the route today\'s ask uses while idle), queued from the tool\'s dispatch',async()=>{const n=results(p);await turnT(p,'QSP-D2: queue a submit for the turn end.');const end=Date.now()+15000;while(results(p)<n+2&&Date.now()<end)await delay(300);});
  await step('E: $.prompt.submit from a timer while idle',async()=>{const n=results(p);await cmd(p,qsp,{op:'submit',text:'QSP-SUBMITTED-E: a plugin submitted this from a timer while idle'});const end=Date.now()+15000;while(results(p)<n+1&&Date.now()<end)await delay(300);});
 }};

// ================= P2 =================
// The child: a Bash sleep (during which the host's timer sends), a second Bash, then DONE; `onChildSleep` is the body's.
let onChildSleep=null;
const childTurn=body=>{const all=JSON.stringify(body.messages);if(all.includes('toolu_c2'))return textTurn('DONE');if(all.includes('toolu_c1'))return toolTurn('toolu_c2','Bash',{command:'echo QSP-child-second-round',description:'echo'});const f=onChildSleep;onChildSleep=null;f?.();return toolTurn('toolu_c1','Bash',{command:'sleep 6; echo slept',description:'wait'});};
const p2Respond=()=>{const parent=rules([
  ['"tool_use_id":"toolu_p2a"',toolTurn('toolu_p2s','mcp__qsprobe__ask',{op:'send',agent:'latest',text:'QSP-TOLD-1: sent from inside the tool dispatch'})],
  ['"tool_use_id":"toolu_p2s"',textTurn('parent waits')],
  ['QSP-P2-start',toolTurn('toolu_p2a','Agent',{description:'p2 child',prompt:'QSP-CHILD: run the sleep, then reply DONE.',subagent_type:'general-purpose',run_in_background:true})],
 ]);return body=>isChild(body)?childTurn(body):parent(body)??textTurn('parent ok');};
const P2={question:'P2 over the wire: $.session.send from a plugin\'s own hook (no host mcp_call) to a running background child, from the tool dispatch and from a timer; to the ended child; in plan mode',
 respond:p2Respond(),
 body:async(p,{stub,qsp})=>{
  onChildSleep=()=>setTimeout(()=>{p.note({event:'timer_send_while_child_sleeps'});cmd(p,qsp,{op:'send',agent:'latest',text:'QSP-TOLD-2: sent from a timer, outside any dispatch, while the child sleeps'});},2500);
  await turnT(p,'QSP-P2-start: start the child.');
  await p.wait(f=>f.type==='system'&&f.subtype==='task_notification',{timeout:60000}).catch(()=>p.note({event:'no_task_notification'}));
  await quiet(p,3000,30000);
  const childReqs=()=>stub.requests.filter(r=>r.child).map(r=>({n:r.n,hits:r.hits.map(h=>h.hit.slice(-160)),last:r.last}));
  p.note({event:'p2_running_child',childRequests:childReqs()});
  const ag=await cmd(p,qsp,{op:'agents'});
  const id=ag?.agents?.at(-1)?.id;
  const n0=stub.requests.length;
  await cmd(p,qsp,{op:'send',agent:id,text:'QSP-TOLD-3: sent to the child after it ended'});
  await delay(8000);await quiet(p,3000,30000);
  p.note({event:'p2_ended_child',childRequests:stub.requests.slice(n0).filter(r=>r.child).map(r=>({n:r.n,hits:r.hits.map(h=>h.hit.slice(-160))}))});
  const mode=await p.request('set_permission_mode',{mode:'plan'},15000).catch(e=>({error:e.message}));
  p.note({event:'set_permission_mode',mode:'plan',answer:mode});
  const n1=stub.requests.length;
  await cmd(p,qsp,{op:'send',agent:id,text:'QSP-TOLD-4: sent to the ended child in plan mode'});
  await delay(8000);await quiet(p,3000,30000);
  p.note({event:'p2_plan_mode',childRequests:stub.requests.slice(n1).filter(r=>r.child).map(r=>({n:r.n,hits:r.hits.map(h=>h.hit.slice(-160))}))});
 }};

// ================= P3 =================
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC','base64');
const BIG=Array.from({length:2500},(_,i)=>`line ${i+1} of big.txt`).join('\n')+'\n';
function p3Files(run){return {'notes.txt':'NOTES line one\nNOTES line two\n','fresh.txt':'FRESH content\n','edit-me.txt':'EDIT-ME here\n','.env':'TOKEN=SECRET-VALUE-123\n','secret.txt':'the value is SECRET-VALUE-123\n','denied.txt':'DENIED by a rule\n','big.txt':BIG,'big2.txt':Array.from({length:20000},(_,i)=>`line ${i+1} of big2.txt, padded to make the file larger than a default read`).join('\n')+'\n','longline.txt':'L'.repeat(5000)+'\nshort second line\n','ctrl.txt':'CTRL read twice by the model\n','ctrl-edit.txt':'CTRL-EDIT never read\n','watch.txt':'WATCH1 read by the plugin only\n','watch2.txt':'WATCH2 read by the model\n',[join(run.root,'outside.txt')]:'OUTSIDE the project\n'};}
const p3Items=run=>[{path:'notes.txt'},{path:'fresh.txt'},{path:'edit-me.txt'},{path:'.env'},{path:'secret.txt'},{path:'denied.txt'},{path:'big.txt'},{path:'big.txt',offset:100,limit:20},{path:'pic.png'},{path:join(run.root,'outside.txt')},{path:'missing.txt'}];
const p3Settings=root=>({permissions:{deny:['Read(**/denied.txt)']},hooks:{PreToolUse:[{matcher:'Read',hooks:[{type:'command',command:`/bin/sh -c 'cat >> ${root}/pretooluse.log; echo >> ${root}/pretooluse.log'`}]}]}});
function p3(){
 return {question:'P3: capture through $.tool.check then $.tool.call of Read from the tool\'s own dispatch',plugins:['qsprobe','qsguard'],
  respond:rules([
   ['QSP-P3b',textTurn('P3b done')],
   ['"tool_use_id":"toolu_r6"',textTurn('P3 done')],
   ['"tool_use_id":"toolu_c2"',toolTurn('toolu_r6','Read',{file_path:'WATCH2'})],
   ['"tool_use_id":"toolu_e2"',toolTurn('toolu_c2','mcp__qsprobe__ask',{op:'captures',items:[{path:'big2.txt'},{path:'longline.txt'},{path:'ctrl.txt'},{path:'watch.txt'}]})],
   ['"tool_use_id":"toolu_r5"',toolTurn('toolu_e2','Edit',{file_path:'CTRLEDIT',old_string:'CTRL-EDIT',new_string:'CTRL-EDITED'})],
   ['"tool_use_id":"toolu_r4"',toolTurn('toolu_r5','Read',{file_path:'CTRL'})],
   ['"tool_use_id":"toolu_r3"',toolTurn('toolu_r4','Read',{file_path:'CTRL'})],
   ['toolu_e1',toolTurn('toolu_r3','Read',{file_path:'NOTES'})],
   ['toolu_r2',toolTurn('toolu_e1','Edit',{file_path:'EDIT',old_string:'EDIT-ME',new_string:'EDITED'})],
   ['toolu_c1',toolTurn('toolu_r2','Read',{file_path:'FRESH'})],
   ['toolu_r1',toolTurn('toolu_c1','mcp__qsprobe__ask',{op:'captures',items:'ITEMS'})],
   ['QSP-P3',toolTurn('toolu_r1','Read',{file_path:'NOTES'})],
  ]),
 };
}
// The model's own control reads (r4, r5: one file twice) and edit (e2: a file nobody read) tell what the plugin's reads
// changed from what the engine does anyway.
// Paths are absolute in the run; the rules above carry placeholders the body fills.
function fill(turn,run){const s=JSON.stringify(turn).replaceAll('"NOTES"',JSON.stringify(join(run.cwd,'notes.txt'))).replaceAll('"FRESH"',JSON.stringify(join(run.cwd,'fresh.txt'))).replaceAll('"EDIT"',JSON.stringify(join(run.cwd,'edit-me.txt'))).replaceAll('"CTRL"',JSON.stringify(join(run.cwd,'ctrl.txt'))).replaceAll('"WATCH2"',JSON.stringify(join(run.cwd,'watch2.txt'))).replaceAll('"CTRLEDIT"',JSON.stringify(join(run.cwd,'ctrl-edit.txt'))).replaceAll('"ITEMS"',JSON.stringify(p3Items(run)));return JSON.parse(s);}

async function runP3(name,{auto=false}={}){
 const run=scratchRun(name.replace(/^qsheet-/,'q'));
 writeFileSync(join(run.home,'settings.json'),JSON.stringify(p3Settings(run.root))+'\n');
 writeFileSync(join(run.cwd,'pic.png'),PNG);
 const base=p3();
 const respond=body=>{const t=base.respond(body);return t?fill(t,run):undefined;};
 return probe(name,{...base,question:base.question+(auto?' (verdicts under --permission-mode auto, from a timer)':''),run,files:p3Files(run),respond,flags:[],body:async(p,{stub,qsp})=>{
  if(!auto){
   await turnT(p,'QSP-P3: read, capture, read, edit, read.');
   await quiet(p,3000,30000);
   // A file in the model's read state that changes on disk is reported to the model at its next request: the plugin's
   // capture of watch.txt against the model's own read of watch2.txt.
   writeFileSync(join(run.cwd,'watch.txt'),'WATCH1 read by the plugin only\nWATCH1-CHANGED on disk after the capture\n');
   writeFileSync(join(run.cwd,'watch2.txt'),'WATCH2 read by the model\nWATCH2-CHANGED on disk after the read\n');
   const before=stub.requests.length;
   await turnT(p,'QSP-P3b: next turn after both files changed.');
   p.note({event:'p3_changed_files',requests:stub.requests.slice(before).filter(r=>r.main).map(r=>({n:r.n,watch1:r.watch.some(w=>w.includes('WATCH1-CHANGED')),watch2:r.watch.some(w=>w.includes('WATCH2-CHANGED')),watch:r.watch}))});
   p.note({event:'p3_tool_results',results:p.frames.filter(r=>r.frame.type==='user'&&Array.isArray(r.frame.message?.content)).flatMap(r=>r.frame.message.content.filter(b=>b.type==='tool_result').map(b=>({tool_use_id:b.tool_use_id,is_error:b.is_error??false,text:textOf(b.content).slice(0,900)})))});
  }
  if(auto){const set=await p.request('set_permission_mode',{mode:'auto'},15000).catch(e=>({error:e.message}));p.note({event:'p3_mode',set:'auto',answer:set});}
  await cmd(p,qsp,{op:'captures',items:[{path:'notes.txt'},{path:'.env'},{path:'denied.txt'},{path:join(run.root,'outside.txt')},{path:'secret.txt'}]},60000);
  const pre=join(run.root,'pretooluse.log');
  p.note({event:'p3_pretooluse_log',lines:existsSync(pre)?readFileSync(pre,'utf8').split('\n').filter(Boolean).map(l=>{try{const j=JSON.parse(l);return {tool_name:j.tool_name,file_path:j.tool_input?.file_path,tool_use_id:j.tool_use_id,agent_id:j.agent_id};}catch{return l.slice(0,200);}}):null});
  p.note({event:'p3_final_files',edit:readFileSync(join(run.cwd,'edit-me.txt'),'utf8'),ctrlEdit:readFileSync(join(run.cwd,'ctrl-edit.txt'),'utf8')});
 }});
}

// ================= P4 =================
const READER=String.raw`
import json,os,sys,time
path,secs=sys.argv[1],float(sys.argv[2])
ok=bad=missing=0;sizes=set();inos=set();end=time.time()+secs;samples=[]
while time.time()<end:
  try:
    st=os.stat(path);inos.add(st.st_ino)
    with open(path,'rb') as f:data=f.read()
  except FileNotFoundError:
    missing+=1;continue
  try:
    j=json.loads(data);ok+=1;sizes.add(len(data))
    if j.get('end')!='END':bad+=1
  except Exception:
    bad+=1
    if len(samples)<5:samples.append({'len':len(data),'head':data[:20].decode('latin1'),'tail':data[-20:].decode('latin1')})
print(json.dumps({'reads':ok+bad+missing,'ok':ok,'torn':bad,'missing':missing,'distinctSizes':len(sizes),'distinctInodes':len(inos),'tornSamples':samples}))
`;
const WRITER=String.raw`
import fcntl,json,os,random,sys
path,who,count,locked,maxlen=sys.argv[1],sys.argv[2],int(sys.argv[3]),sys.argv[4]=='1',int(sys.argv[5])
random.seed(who)
seq=0
while seq<count:
  batch=random.choice([1,1,1,3])
  lines=[]
  b=who+'-b'+str(seq)
  for _ in range(batch):
    seq+=1
    lines.append(json.dumps({'v':1,'key':who+'-'+str(seq),'who':who,'seq':seq,'batch':b,'n':batch,'text':'x'*random.randint(10,maxlen)})+'\n')
  data=''.join(lines)
  if locked:
    with open(path+'.lock','a') as lk:
      fcntl.flock(lk,fcntl.LOCK_EX)
      fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
      try:
        mv=memoryview(data.encode())
        while mv:
          k=os.write(fd,mv);mv=mv[k:]
      finally:
        os.close(fd);fcntl.flock(lk,fcntl.LOCK_UN)
  else:
    with open(path,'a') as f:
      for l in lines:f.write(l)
`;
const VERIFY=String.raw`
import json,sys
path=sys.argv[1]
bad=0;per={};batches={};order=[];n=0
for raw in open(path,'rb').read().split(b'\n'):
  if not raw:continue
  n+=1
  try:j=json.loads(raw)
  except Exception:bad+=1;continue
  per.setdefault(j['who'],[]).append(j['seq']);order.append((j['who'],j['batch']))
inorder={w:s==sorted(s) and len(s)==len(set(s)) for w,s in per.items()}
split=0;seen=set();prev=None
for w,b in order:
  if b!=prev and b in seen:split+=1
  seen.add(b);prev=b
print(json.dumps({'lines':n,'badLines':bad,'perWriter':{w:len(s) for w,s in per.items()},'inOrder':inorder,'splitBatches':split}))
`;
const py=(src,args,timeout)=>new Promise(res=>{const c=spawn('python3',['-I','-c',src,...args.map(String)]);let o='',e='';c.stdout.on('data',d=>o+=d);c.stderr.on('data',d=>e+=d);const t=setTimeout(()=>c.kill(),timeout);c.on('close',code=>{clearTimeout(t);try{res(JSON.parse(o));}catch{res({code,stdout:o.slice(0,500),stderr:e.slice(0,500)});}});});
const P4={question:'P4: is the tool\'s replace of state.json atomic to a reader in another process ($.fs.write in place; a write beside it and a rename through $.process.run); does the inbox\'s locked append hold under two concurrent writers while the mod reads it?',
 body:async(p,{qsp,run})=>{
  const sheet=join(run.root,'sheet');mkdirSync(sheet,{recursive:true});
  for(const mode of ['inplace','rename']){
   const path=join(sheet,`state-${mode}.json`);writeFileSync(path,JSON.stringify({i:-1,pad:'',end:'END'}));
   const reader=py(READER,[path,14],30000);
   await delay(300);
   const w=await cmd(p,qsp,{op:'fswrites',mode,path,iterations:60,bigBytes:1500000,smallBytes:2000},60000);
   const r=await reader;
   p.note({event:'p4_state_replace',mode,writer:w,reader:r});
  }
  for(const [label,locked,maxlen] of [['locked',true,40000],['unlocked-control',false,200000]]){
   const inbox=join(sheet,`inbox-${label}.jsonl`);writeFileSync(inbox,'');
   const reads=cmd(p,qsp,{op:'inbox-reads',path:inbox,ms:9000},40000);
   await delay(300);
   const [a,b]=await Promise.all([py(WRITER,[inbox,'A',1500,locked?1:0,maxlen],60000),py(WRITER,[inbox,'B',1500,locked?1:0,maxlen],60000)]);
   const modReads=await reads;
   const verify=await py(VERIFY,[inbox],60000);
   p.note({event:'p4_inbox_append',label,locked,maxLineBytes:maxlen,writers:[a,b],modReads,verify,bytes:statSync(inbox).size});
  }
 }};

// ================= P5 =================
const p5Respond=rules([['REMINDER: Do NOT call any tools',textTurn('<analysis>probe</analysis>\n<summary>QSP compact summary: the person and the probe exchanged short turns.</summary>')],['QSP-P5-',body=>textTurn('ok '+(body.messages?.length??0))]]);
const p5Side=()=>textTurn('<analysis>probe</analysis>\n<summary>QSP compact summary: the person and the probe exchanged short turns.</summary>');
const p5Step=async(p,stub,label,content)=>{const from=p.seq,req=stub.requests.length;await turnT(p,content);await quiet(p,2500,30000);p.note({event:'p5_step',label,wire:wireOf(p,from),requests:stub.requests.slice(req).map(r=>({n:r.n,main:r.main,messages:r.messages,hits:r.hits,systemHits:r.systemHits,last:r.last}))});};
function p5(){
 const A=randomUUID(),F=randomUUID(),E=randomUUID();
 const run=scratchRun('qp5'),runE=scratchRun('qp5e');
 const common={run,keepRun:true,respond:p5Respond,side:p5Side};
 return [
  ['qsheet-p5-a-startup-compact',{...common,sessionId:A,question:'P5: classic.SessionStart context at startup and after /compact',body:async(p,{stub})=>{
   await p5Step(p,stub,'startup, first prompt','QSP-P5-one: hello.');
   await p5Step(p,stub,'/compact','/compact');
   await p5Step(p,stub,'after the compaction','QSP-P5-two: and now?');
  }}],
  ['qsheet-p5-b-resume',{...common,sessionId:null,pinned:false,flags:['--resume',A],question:'P5: classic.SessionStart context at --resume',body:async(p,{stub})=>{await p5Step(p,stub,'resumed, first prompt','QSP-P5-three: resumed.');}}],
  ['qsheet-p5-c-fork',{...common,sessionId:F,flags:['--resume',A,'--fork-session'],question:'P5: classic.SessionStart context at --resume --fork-session --session-id (MAWS\'s fork launch)',body:async(p,{stub})=>{await p5Step(p,stub,'forked, first prompt','QSP-P5-four: forked.');}}],
  ['qsheet-p5-e-same-text',{...common,run:runE,sessionId:E,vars:{QSP_SSFIXED:'the same text at every start'},question:'P5: a SessionStart context whose text does not change from start to start: at startup, after /compact, at --resume, and after a second /compact',body:async(p,{stub})=>{
   await p5Step(p,stub,'startup','QSP-P5-e1: hello.');
   await p5Step(p,stub,'/compact','/compact');
   await p5Step(p,stub,'after the compaction','QSP-P5-e2: and now?');
  }}],
  ['qsheet-p5-e-same-text-resume',{...common,run:runE,keepRun:false,sessionId:null,pinned:false,flags:['--resume',E],vars:{QSP_SSFIXED:'the same text at every start'},question:'P5: the same unchanging context at a --resume, then after a /compact in the resumed process',body:async(p,{stub})=>{
   await p5Step(p,stub,'resumed','QSP-P5-e3: resumed.');
   await p5Step(p,stub,'/compact','/compact');
   await p5Step(p,stub,'after the second compaction','QSP-P5-e4: and now?');
  }}],
  ['qsheet-p5-d-clear',{...common,keepRun:false,sessionId:null,pinned:false,flags:['--resume',A],question:'P5: classic.SessionStart at /clear (which session id it names)',body:async(p,{stub})=>{await p5Step(p,stub,'resumed','QSP-P5-five: resumed again.');await p5Step(p,stub,'/clear','/clear');await p5Step(p,stub,'after the clear','QSP-P5-six: cleared.');}}],
 ];
}

// ================= P3: what a compaction does with the plugin's reads =================
const P3C={question:'P3: after a /compact, does the engine re-attach to the model files that only the plugin read ($.tool.call of Read, from a timer and from the tool dispatch), as it does for files the model read?',
 files:{'model-read.txt':'MODEL-READ-CONTENT\n','plugin-timer.txt':'PLUGIN-TIMER-CONTENT\n','plugin-tool.txt':'PLUGIN-TOOL-CONTENT\n','.env':'TOKEN=SECRET-VALUE-123\n'},
 respond:rules([
  ['REMINDER: Do NOT call any tools',textTurn('<analysis>probe</analysis>\n<summary>QSP compact summary: short turns.</summary>')],
  ['QSP-P3C-after',textTurn('after done')],
  ['"tool_use_id":"toolu_pc2"',textTurn('captured')],
  ['"tool_use_id":"toolu_pc1"',toolTurn('toolu_pc2','mcp__qsprobe__ask',{op:'captures',items:[{path:'plugin-tool.txt'}]})],
  ['QSP-P3C-read',body=>toolTurn('toolu_pc1','Read',{file_path:JSON.stringify(body).match(/(\/[^"\\]*?)\/model-read\.txt/)?.[0]??'model-read.txt'})],
 ]),
 body:async(p,{stub,qsp,run})=>{
  NEEDLES.list=['MODEL-READ-CONTENT','PLUGIN-TIMER-CONTENT','PLUGIN-TOOL-CONTENT','SECRET-VALUE-123'];
  await turnT(p,'QSP-P3C-read: read model-read.txt at '+join(run.cwd,'model-read.txt'));
  await cmd(p,qsp,{op:'captures',items:[{path:'plugin-timer.txt'},{path:'.env'}]});
  const before=stub.requests.length;
  await turnT(p,'/compact');await quiet(p,2500,30000);
  await turnT(p,'QSP-P3C-after: and now?');await quiet(p,2500,30000);
  p.note({event:'p3c_after_compact',requests:stub.requests.slice(before).map(r=>({n:r.n,main:r.main,messages:r.messages,needles:r.needles}))});
  NEEDLES.list=[];
 }};

// ================= P5: a literal <sheet-delivery> block in each kind of hook context =================
const P5B={question:'P5 (the coordinator\'s addition): a literal <sheet-delivery>{…}</sheet-delivery> block, with a "<b>", an "&" and a "</sheet-delivery>" inside its JSON string, appended to the SessionStart context, a prompt\'s context and a tool result\'s context: the bytes the model receives, and the row a session.append hook sees',
 vars:{QSP_BLOCK:'1'},
 respond:rules([['"tool_use_id":"toolu_pb"',textTurn('B done')],['QSP-P5B',toolTurn('toolu_pb','Bash',{command:'echo QSP-P5B-ran',description:'echo'})]]),
 body:async(p,{stub,qsp})=>{
  await turnT(p,'QSP-P5B: run the echo.');await quiet(p,2500,20000);
  p.note({event:'p5b_blocks',requests:stub.requests.filter(r=>r.main).map(r=>({n:r.n,blocks:r.blocks}))});
  p.note({event:'p5b_append',rows:logs(qsp).filter(l=>l.tag==='session.append')});
 }};

// ================= P4 as C2 builds it: the record written by a Python step, no engine =================
// C2's execution document settles that state.json is never written by a hook: a short-lived `sminos sheet step`
// (Python) reads, applies and replaces it under a lock beside the record, and surfaces append under the same lock.
// (a) os.replace of an fsynced temporary file against a lock-free reader of state.json in another process;
// (b) fcntl.flock on <dir>/<session>.lock held by two appenders and a step at once: no two locked sections overlap, and
//     the step applies every appended line exactly once;
// (c) a lock-free reader of inbox.jsonl (Node, as MAWS's reader is): does it ever see part of one write() of several
//     lines, at a line boundary or mid-line?
const P4_LOCKED=String.raw`
import fcntl,json,os,random,sys,time
def locked(lockpath,fn):
  with open(lockpath,'a') as lk:
    fcntl.flock(lk,fcntl.LOCK_EX)
    t0=time.monotonic_ns()
    try:return fn(),(t0,time.monotonic_ns())
    finally:fcntl.flock(lk,fcntl.LOCK_UN)
`;
const P4_STEP=P4_LOCKED+String.raw`
d,iters=sys.argv[1],int(sys.argv[2])
state=os.path.join(d,'state.json');inbox=os.path.join(d,'inbox.jsonl');lock=os.path.join(d,'sess.lock')
spans=[]
def step():
  try:st=json.load(open(state))
  except FileNotFoundError:st={'offset':0,'applied':0,'keys':0}
  with open(inbox,'rb') as f:
    f.seek(st['offset']);data=f.read()
  cut=data.rfind(b'\n')+1
  lines=[l for l in data[:cut].split(b'\n') if l]
  for l in lines:json.loads(l)
  st['offset']+=cut;st['applied']+=len(lines);st['pad']='p'*random.randint(1000,1500000)
  tmp=state+'.tmp-%d'%os.getpid()
  with open(tmp,'w') as f:
    json.dump(st,f);f.flush();os.fsync(f.fileno())
  os.replace(tmp,state)
  return len(lines)
for i in range(iters):
  n,span=locked(lock,step);spans.append(span);time.sleep(random.random()*0.004)
print(json.dumps({'who':'step','pid':os.getpid(),'spans':spans}))
`;
const P4_APPEND=String.raw`
import fcntl,json,os,random,sys,time
d,who,batches,maxtext=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4])
inbox=os.path.join(d,'inbox.jsonl');lock=os.path.join(d,'sess.lock')
random.seed(who);spans=[];lines=0
for b in range(batches):
  n=random.choice([1,2,3,4])
  data=''.join(json.dumps({'v':1,'key':'%s-%d-%d'%(who,b,i),'batch':'%s-%d'%(who,b),'n':n,'i':i,'text':'t'*random.randint(10,maxtext)})+'\n' for i in range(n)).encode()
  with open(lock,'a') as lk:
    fcntl.flock(lk,fcntl.LOCK_EX);t0=time.monotonic_ns()
    fd=os.open(inbox,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
    try:
      w=os.write(fd,data)
      if w!=len(data):raise SystemExit('short write %d of %d'%(w,len(data)))
    finally:
      os.close(fd);spans.append((t0,time.monotonic_ns()));fcntl.flock(lk,fcntl.LOCK_UN)
  lines+=n;time.sleep(random.random()*0.003)
print(json.dumps({'who':who,'pid':os.getpid(),'lines':lines,'spans':spans}))
`;
const P4_STATE_READER=String.raw`
import json,os,sys,time
path,secs=sys.argv[1],float(sys.argv[2]);ok=torn=missing=0;end=time.time()+secs
while time.time()<end:
  try:
    with open(path,'rb') as f:data=f.read()
  except FileNotFoundError:
    missing+=1;continue
  try:json.loads(data);ok+=1
  except Exception:torn+=1
print(json.dumps({'reads':ok+torn+missing,'ok':ok,'torn':torn,'missing':missing}))
`;
// Node, lock-free, as MAWS's reader would be: reads [offset, size) each time; counts reads that end mid-line and
// reads that end at a line boundary inside one write() (a batch of n lines of which fewer than n are in hand).
async function inboxTail(path,ms,pause=1){
 const {openSync,readSync,fstatSync,closeSync}=await import('node:fs');
 let offset=0,reads=0,midLine=0,partialBatchAtBoundary=0,lines=0,bad=0;const have=new Map();const end=Date.now()+ms;
 while(Date.now()<end){
  let fd;try{fd=openSync(path,'r');}catch{await delay(2);continue;}
  const size=fstatSync(fd).size;
  if(size>offset){const buf=Buffer.alloc(size-offset);const n=readSync(fd,buf,0,buf.length,offset);reads++;const text=buf.subarray(0,n).toString('utf8');const cut=text.lastIndexOf('\n');
   if(cut!==text.length-1)midLine++;
   if(cut>=0){let last=null;for(const l of text.slice(0,cut).split('\n')){lines++;try{const j=JSON.parse(l);have.set(j.batch,(have.get(j.batch)??0)+1);last=j;}catch{bad++;}}
    if(last&&have.get(last.batch)<last.n&&cut===text.length-1)partialBatchAtBoundary++;
    offset+=Buffer.byteLength(text.slice(0,cut+1));}}
  closeSync(fd);if(pause)await delay(pause);else await new Promise(r=>setImmediate(r));
 }
 return {reads,midLineReads:midLine,partialBatchAtLineBoundary:partialBatchAtBoundary,lines,badLines:bad,offset};
}
// (c), directly: sample the inbox's size as fast as fstat allows, then compare every size seen with the offsets at which
// a write() ended (each batch is one write(), so its last line's end); a size between two such offsets is part of one
// write() made visible to a reader holding no lock.
async function sizeSampler(path,ms){
 const {openSync,fstatSync,closeSync}=await import('node:fs');
 const sizes=new Set();let samples=0;const end=Date.now()+ms;let fd=null;
 while(Date.now()<end){try{fd??=openSync(path,'r');sizes.add(fstatSync(fd).size);samples++;}catch{}if(samples%2000===0)await new Promise(r=>setImmediate(r));}
 if(fd!==null)closeSync(fd);
 return {samples,sizes};
}
function batchEnds(path){const buf=readFileSync(path);const ends=new Set([0]);let start=0;for(let i=0;i<buf.length;i++)if(buf[i]===10){const j=JSON.parse(buf.subarray(start,i).toString('utf8'));if(j.i===j.n-1)ends.add(i+1);start=i+1;}return ends;}
async function p4Sheet(){
 for(const [label,maxText,pause,batches] of [['as C2 sizes it (lines up to 40 KB)',40000,1,700],['under pressure (lines up to 400 KB, the reader never sleeps)',400000,0,150]])await p4SheetRun(label,maxText,pause,batches);
}
let p4Note=null;
async function p4SheetRun(label,maxText,pause,batches){
 const {appendFileSync}=await import('node:fs');
 const {redact}=await import('../../harness.mjs');
 const name='qsheet-p4-sheet';const file=join(DIR==='fixtures/qsheet/'?new URL('../../fixtures/qsheet/',import.meta.url).pathname:DIR,name+'.ndjson');
 if(!p4Note){writeFileSync(file,'');let seq=0;p4Note=o=>appendFileSync(file,redact(JSON.stringify({seq:++seq,at:new Date().toISOString(),...o}))+'\n');}const note=p4Note;
 const root=join(homedir(),'.local/share/question-sheet-c0/p4');rmSync(root,{recursive:true,force:true});const d=join(root,'sheet','sess');mkdirSync(d,{recursive:true});
 const fsInfo=execFileSync('/bin/df',['-T','apfs',d],{encoding:'utf8'}).trim().split('\n').slice(-1)[0];
 if(label.startsWith('as C2'))note({event:'provenance',...PROVENANCE,api:'none: no engine runs',question:'P4 as C2 builds the record (the coordinator\'s rewording): (a) os.replace of an fsynced temporary state.json against a lock-free reader; (b) fcntl.flock on a lock file beside the record across two appenders and a step at once; (c) can a lock-free reader of inbox.jsonl see part of one write() of several lines',dir:d,filesystem:fsInfo.split(/\s+/).pop()==='/System/Volumes/Data'?'APFS, /System/Volumes/Data':'APFS',node:process.version});
 writeFileSync(join(d,'inbox.jsonl'),'');writeFileSync(join(d,'state.json'),JSON.stringify({offset:0,applied:0,keys:0}));
 const stateReader=py(P4_STATE_READER,[join(d,'state.json'),25],60000);
 const tail=inboxTail(join(d,'inbox.jsonl'),25000,pause);
 const sampler=sizeSampler(join(d,'inbox.jsonl'),25000);
 const [stepOut,a,b]=await Promise.all([py(P4_STEP,[d,400],120000),py(P4_APPEND,[d,'A',batches,maxText],120000),py(P4_APPEND,[d,'B',batches,maxText],120000)]);
 const final=await py(P4_STEP,[d,1],30000);
 const [reader,tailOut,sampled]=await Promise.all([stateReader,tail,sampler]);
 const ends=batchEnds(join(d,'inbox.jsonl'));const between=[...sampled.sizes].filter(x=>!ends.has(x));
 const st=JSON.parse(readFileSync(join(d,'state.json'),'utf8'));
 const spans=[...(stepOut.spans??[]).map(s=>['step',...s]),...(final.spans??[]).map(s=>['step',...s]),...(a.spans??[]).map(s=>['A',...s]),...(b.spans??[]).map(s=>['B',...s])].sort((x,y)=>x[1]-y[1]);
 let overlaps=0;for(let i=1;i<spans.length;i++)if(spans[i][1]<spans[i-1][2])overlaps++;
 note({event:'p4_sheet',label,maxLineText:maxText,readerPauseMs:pause,lockedSections:spans.length,overlaps,steps:(stepOut.spans??[]).length+1,appended:{A:a.lines,B:b.lines,total:(a.lines??0)+(b.lines??0)},stateApplied:st.applied,stateOffset:st.offset,inboxBytes:statSync(join(d,'inbox.jsonl')).size,stateReader:reader,inboxTail:tailOut,sizeSampler:{samples:sampled.samples,distinctSizes:sampled.sizes.size,writeEnds:ends.size,sizesInsideOneWrite:between.length,examples:between.slice(0,5)},errors:[stepOut,a,b,final].filter(x=>x.code!==undefined)});
 console.log(name,file);
}

export default async()=>{
 const only=(process.env.QSHEET_ONLY??'').split(',').filter(Boolean);
 const want=n=>only.length===0||only.some(o=>n.startsWith(o));
 if(want('qsheet-p1-hooks'))await probe('qsheet-p1-hooks',P1);
 if(want('qsheet-p2-send'))await probe('qsheet-p2-send',P2);
 if(want('qsheet-p3-capture'))await runP3('qsheet-p3-capture');
 if(want('qsheet-p3-auto'))await runP3('qsheet-p3-auto',{auto:true});
 if(want('qsheet-p3-compact'))await probe('qsheet-p3-compact',P3C);
 if(want('qsheet-p5-block'))await probe('qsheet-p5-block',P5B);
 if(want('qsheet-p5-block-reminder'))await probe('qsheet-p5-block-reminder',{...P5B,vars:{QSP_BLOCK:'2'},question:P5B.question+'; here the JSON string also holds a literal </system-reminder> and <system-reminder>'});
 if(want('qsheet-p4-sheet'))await p4Sheet();
 if(want('qsheet-p4-files'))await probe('qsheet-p4-files',P4);
 if(want('qsheet-p5')){for(const [name,s] of p5())await probe(name,s);}
};
