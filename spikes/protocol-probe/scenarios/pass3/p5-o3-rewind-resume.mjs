// P5 O3-F, a findings-only spike (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md, child O3-F, document blob
// 67da2f63a992c9c6f6369ffe1ff3fc7605999c89 at master 1d1d71937; parent docs/doperpowers/plans/2026-10-27-p5-org.md, P5;
// RL §12.3, U6's half; 2026-10-28): does the engine's `rewind_conversation`, as `session.rewind` sends it
// (src/engine-host/rewind.ts: the conversation with the caller's last-seen uuid and interrupt_if_running false, then,
// when asked, `rewind_files` for the same message), restore or duplicate content when the target message was written
// by an earlier process of the session, before a release and a `--resume`?
//
// Each launch is MAWS's (p1-common: the launch line, the initialize payload, a scratch config home, file checkpointing
// on) against a scripted Messages API (sseOf from ../../stub-api.mjs; nothing spent). One API serves every launch of an
// arm, and every message id and tool-use id it mints carries the run's token, as the real API's are unique: the engine's
// resume joins assistant records by `message.id` (research/desk-remote/truncation-spike.md), so a stub that reused ids
// across launches would fabricate the very duplication the spike looks for. The script is keyed by content: a prompt's
// `[[O3F:<turn>]]` marker picks its turn and a tool_result continues the turn of the tool_use it answers. Every turn
// is the same four requests, each leaving a marker the request bodies are read for:
//   WORKING_<t> text + Read state.txt, Write state.txt "STATE_<t>", Write <t>.txt "CONTENT_<t>", text REPLY_<t>
// so every later request body shows which turns the model is given (`context`) and whether any block is there twice.
// The arms (fixtures fixtures/p5/p5-o3-rewind-resume-<arm>-l<n>.jsonl, each arm's prompt uuids in -<arm>-uuids.json,
// the transcript it left in fixtures/p5/p5-o3-rewind-resume-transcripts/p5-o3-rewind-resume-<arm>.jsonl, of which every
// snapshot note's `lines` is a prefix; findings-p5-o3-rewind-resume.txt):
//   pre          (1) l1: T1, T2; release. l2 --resume: T3, then a rewind to T2's prompt (from l1), last seen T3's, then
//                T4. Release. l3 --resume: T5.
//   pre-files    (2) the same, the rewind with rewindFiles (a dry run first, then the conversation, then the files).
//   post         (3, the control) l1: T1, T2; release. l2 --resume: T3, T4, then a rewind with files to T3's prompt
//                (from l2), last seen T4's, then T5. Release. l3 --resume: T6.
//   pre-release  l1: T1, T2; release. l2 --resume: at once a rewind to T2's prompt, last seen T2's (the rewind widget's
//                Load now on a dormant session), then a release with nothing sent. l3 --resume: T3.
//   same-release l1: T1, T2, then a rewind to T2's prompt in the same launch; release with nothing sent. l2 --resume:
//                T3. (No launch boundary before the target: whether a rewind survives a release on its own.)
//   kill-after-rewind, -200ms, -1s  as pre-release, but l2 is SIGKILLed 0, 200 or 1000 ms after the rewind is answered
//                (a crash, not a release).
//   plain-release the release arms' control, no rewind: l1: T1, T2; release. l2 --resume: T3 (its Read of state.txt).
// Run on a Linux host or the mini, never on the owner's MacBook (P5 Decision Log 29), as a user whose home holds no
// credential, with no managed settings file routing the engine:
//   PROBE_ENGINE=~/.local/share/claude/versions/2.1.283 node run-pass3.mjs p5-o3-rewind-resume
// P5O3F_ARM=<arm,...> picks arms.
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,delay,randomUUID,existsSync,join,writeFileSync,mkdirSync,records,transcriptPath,summarise,ENGINE_VERSION} from './p1-common.mjs';
import {sseOf,jsonOf,textTurn,toolTurn} from '../../stub-api.mjs';
import {allowAll,blocks,textOf} from './e7-common.mjs';
import {idle} from './c8b-common.mjs';
import {redact,root} from '../../harness.mjs';
import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';

const PROVENANCE={child:'P5-O3-F',pin:'67da2f63a992c9c6f6369ffe1ff3fc7605999c89',document:'docs/doperpowers/plans/2026-10-28-p5-o3-spine.md',spike:'O3-F: native rewind across --resume (RL §12.3, U6\'s half)',api:'a content-keyed script over stub-api.mjs sseOf, ids unique per run (nothing spent)'};
const DEBUG=/rewind|resume|checkpoint|file.?history|snapshot|leaf|sibling|chain|orphan|last-prompt|restore/i;
const MANAGED=['/etc/claude-code/managed-settings.json','/Library/Application Support/ClaudeCode/managed-settings.json'];
const TRANSCRIPTS='fixtures/p5/p5-o3-rewind-resume-transcripts/';
export const MARKERS=/\b(?:PROMPT|WORKING|REPLY|STATE|CONTENT)_T\d\b/g;
const TOKEN=randomUUID().slice(0,8);

// ---- the scripted API -------------------------------------------------------------------------------------------
const isMainLoop=body=>Array.isArray(body.tools)&&body.tools.some(t=>t?.name==='Bash'||t?.name==='Read');
const userBlocks=m=>m?.role!=='user'?[]:typeof m.content==='string'?[{type:'text',text:m.content}]:m.content??[];
const MARK=/\[\[O3F:(T\d)\]\]/;
// One turn of the script, for the arm's working directory.
const plan=(t,cwd)=>[
 {blocks:[{type:'text',text:`WORKING_${t}: reading the state.`},{type:'tool_use',name:'Read',input:{file_path:join(cwd,'state.txt')}}],stop:'tool_use'},
 toolTurn(null,'Write',{file_path:join(cwd,'state.txt'),content:`STATE_${t}\n`}),
 toolTurn(null,'Write',{file_path:join(cwd,`${t}.txt`),content:`CONTENT_${t}\n`}),
 textTurn(`REPLY_${t}: done.`),
];
// A block of a request body in brief: role, kind, the markers it holds (or its head), ids shortened to their counter.
const short=id=>String(id).replace(/^toolu_o3f_[0-9a-f]{8}_/,'#');
const tags=s=>{const m=String(s).match(MARKERS);return m?[...new Set(m)].join(','):JSON.stringify(String(s).slice(0,48));};
export function blockBrief(role,b){
 const r=role==='assistant'?'a':'u';
 if(typeof b==='string')return `${r}:${tags(b)}`;
 if(b.type==='text')return /^\s*<system-reminder>/.test(b.text)?`${r}:<reminder>`:`${r}:${tags(b.text)}`;
 if(b.type==='tool_use')return `${r}:use ${b.name}${short(b.id)}${String(JSON.stringify(b.input)).match(MARKERS)?' '+tags(JSON.stringify(b.input)):''}`;
 if(b.type==='tool_result')return `${r}:result${short(b.tool_use_id)}${b.is_error?' ERROR':''} ${tags(textOf(b.content))}`;
 return `${r}:${b.type}`;
}
const contentOf=m=>typeof m.content==='string'?[m.content]:m.content??[];
// What one request body gives the model: its blocks in brief, every marker's count, and any block present twice.
export function contextOf(body){
 const context=(body.messages??[]).map(m=>contentOf(m).map(b=>blockBrief(m.role,b)).join(' | '));
 const counts={};const seen=new Map();
 for(const m of body.messages??[])for(const b of contentOf(m)){
  const key=typeof b==='string'?'s:'+b:b.type==='tool_use'?'use:'+b.id:b.type==='tool_result'?'result:'+b.tool_use_id:b.type==='text'?'text:'+b.text:null;
  if(key&&!/^(s|text):\s*<system-reminder>/.test(key))seen.set(key,(seen.get(key)??0)+1);
  const text=typeof b==='string'?b:b.type==='text'?b.text:b.type==='tool_use'?JSON.stringify(b.input):b.type==='tool_result'?textOf(b.content):'';
  for(const k of new Set(text.match(MARKERS)??[]))counts[k]=(counts[k]??0)+1;
 }
 const twice=[...seen].filter(([,n])=>n>1).map(([k,n])=>({block:k.slice(0,80),n}));
 return {messages:(body.messages??[]).length,context,counts,twice};
}

export async function startScriptedApi(cwd){
 const requests=[];const issued=new Map();let n=0;
 const answer=body=>{
  if(!isMainLoop(body))return {kind:'side',turn:textTurn('ok')};
  const last=userBlocks(body.messages?.at(-1));
  const text=last.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  let t,step;const m=text.match(MARK);
  if(m){t=m[1];step=0;}
  else{const prior=last.filter(b=>b.type==='tool_result').map(b=>issued.get(b.tool_use_id)).find(Boolean);if(!prior)return {kind:'unscripted',turn:textTurn('ok'),head:text.slice(0,200)};t=prior.t;step=prior.step+1;}
  const turn=plan(t,cwd)[step]??textTurn('(the turn has no more steps)');
  const out={...turn,blocks:turn.blocks.map(b=>{if(b.type!=='tool_use')return b;const id=`toolu_o3f_${TOKEN}_${String(++n).padStart(3,'0')}`;issued.set(id,{t,step});return {...b,id};})};
  return {kind:'main',turnLabel:t,step,turn:out,...contextOf(body)};
 };
 const server=createServer((req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));
  req.on('end',()=>{
   const path=req.url.split('?')[0];
   if(req.method==='POST'&&path==='/v1/messages/count_tokens'){requests.push({n:requests.length+1,path});res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({input_tokens:1000}));}
   if(req.method!=='POST'||path!=='/v1/messages'){requests.push({n:requests.length+1,method:req.method,path,status:404});res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({type:'error',error:{type:'not_found_error',message:'stub'}}));}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{res.writeHead(400);return res.end();}
   const {turn,...why}=answer(body);
   const id=`msg_o3f_${TOKEN}_${String(requests.length+1).padStart(3,'0')}`;
   requests.push({n:requests.length+1,at:new Date().toISOString(),id,stream:body.stream===true,...why,reply:turn.blocks.map(b=>b.type==='tool_use'?{tool_use:b.name,id:short(b.id)}:{text:b.text})});
   if(body.stream===true){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});return res.end(sseOf(turn,{id,model:body.model}));}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(jsonOf(turn,{id,model:body.model})));
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,requests,close:()=>new Promise(r=>server.close(()=>r()))};
}

// ---- what the steps record --------------------------------------------------------------------------------------
const KEEP=r=>r.frame.type!=='stream_event'&&!(r.frame.type==='system'&&r.frame.subtype==='init');
function frameBrief(r){
 const f=r.frame,o={seq:r.seq,type:f.type};
 if(f.type==='control_request')o.subtype=f.request?.subtype;
 else if(f.type==='control_response')Object.assign(o,{subtype:f.response?.subtype,request_id:f.response?.request_id});
 else if(f.type==='result')Object.assign(o,{subtype:f.subtype,is_error:f.is_error,terminal_reason:f.terminal_reason??null});
 else if(f.type==='assistant')Object.assign(o,{id:f.message?.id,uuid:f.uuid,blocks:blocks(f).map(b=>blockBrief('assistant',b))});
 else if(f.type==='user')Object.assign(o,{uuid:f.uuid,isReplay:f.isReplay??null,blocks:blocks(f).length?blocks(f).map(b=>blockBrief('user',b)):[blockBrief('user',textOf(f.message?.content))]});
 else if(f.type==='system')o.subtype=f.subtype;
 return o;
}
const framesFrom=(p,from)=>p.frames.filter(r=>r.seq>from&&KEEP(r)).map(frameBrief);
// A transcript record in brief: p1-common's lineage keys, the API message id, and an anchor's or snapshot's fields.
function recordBrief(r,i){
 const o={line:i+1,...summarise(r)};delete o.sessionId;delete o.version;delete o.entrypoint;delete o.userType;
 if(r.message?.id)o.messageId=r.message.id;
 if(r.type==='user'||r.type==='assistant')o.text=(Array.isArray(r.message?.content)?r.message.content.map(b=>blockBrief(r.type,b)):[blockBrief(r.type,r.message?.content??'')]).join(' | ');
 if(r.type==='last-prompt')Object.assign(o,{lastPrompt:tags(r.lastPrompt??''),rewound:r.rewound,leafUuid:r.leafUuid});
 if(r.type==='file-history-snapshot')Object.assign(o,{messageId:r.messageId,isSnapshotUpdate:r.isSnapshotUpdate,tracked:Object.keys(r.snapshot?.trackedFileBackups??{}).sort(),snapshotMessageId:r.snapshot?.messageId});
 for(const k of ['rewound','leafUuid','isMeta','isCompactSummary','logicalParentUuid','toolUseResult'])if(r[k]!==undefined&&o[k]===undefined)o[k]=k==='toolUseResult'?true:r[k];
 return o;
}
// The engine's own resume walk as MAWS's shared reader states it (src/shared/wire/transcript.ts currentChain): from the
// last record with a uuid, up `parentUuid`. Here only to make the snapshot readable; the findings read the real one.
function chainOf(recs){const by=new Map();let leaf=null;for(const r of recs)if(typeof r.uuid==='string'){if(!by.has(r.uuid))by.set(r.uuid,r);leaf=r;}const out=[];const seen=new Set();for(let c=leaf;c&&!seen.has(c.uuid);c=c.parentUuid?by.get(c.parentUuid):null){seen.add(c.uuid);out.push(c.uuid);}return out.reverse();}
function filesOf(cwd){const out={};for(const f of readdirSync(cwd).filter(f=>/^(state|T\d)\.txt$/.test(f)).sort())out[f]=readFileSync(join(cwd,f),'utf8').trim();return out;}
function historyOf(run,sessionId){const dir=join(run.home,'file-history',sessionId);return existsSync(dir)?readdirSync(dir).sort():null;}
// The engine only appends to a transcript, so a snapshot is its first `lines` lines: the arm keeps the final file once
// (transcriptCopy) and every snapshot is that file's prefix.
function snapshotOf(run,arm,sessionId,label){
 const recs=records(transcriptPath(run,sessionId));
 return {event:'transcript_snapshot',label,at:new Date().toISOString(),lines:recs.length,records:recs.map(recordBrief),chain:chainOf(recs),files:filesOf(run.cwd),fileHistory:historyOf(run,sessionId)};
}
function transcriptCopy(run,arm,sessionId){
 const file=transcriptPath(run,sessionId);if(!existsSync(file))return;
 mkdirSync(root+TRANSCRIPTS,{recursive:true});
 writeFileSync(root+`${TRANSCRIPTS}p5-o3-rewind-resume-${arm}.jsonl`,redact(readFileSync(file,'utf8')));
}

// ---- the steps ----------------------------------------------------------------------------------------------------
async function open(p,run){
 allowAll(p);
 success(await p.init(initPayload(run.cwd)),'initialize');
}
// One human turn: the prompt (its uuid MAWS's), then until the engine is idle; its frames and requests noted.
async function turn(p,api,t){
 const from=p.seq,before=api.requests.length,uuid=randomUUID();
 p.send({type:'user',uuid,message:{role:'user',content:`[[O3F:${t}]] PROMPT_${t} Do step ${t}.`},parent_tool_use_id:null,origin:{kind:'human'}});
 await p.wait(f=>f.type==='result',{after:from,timeout:180000});
 await idle(p,120000,2500);
 p.note({event:'step',label:t,uuid,frames:framesFrom(p,from),requests:api.requests.slice(before)});
 return uuid;
}
// `session.rewind` as rewind.ts sends it: the conversation (the caller's last seen, never interrupting), then, only after
// a successful conversation rewind and only when asked, the files for the same message. A dry run of the files first
// when `dryRun` (the receipt's Undo asks it), which changes nothing.
async function rewind(p,label,{target,lastSeen,files,dryRun=false}){
 const from=p.seq;let filesDryRun=null,filesRestore=null;
 if(dryRun)filesDryRun=await p.request('rewind_files',{user_message_id:target,dry_run:true},8000);
 const conversation=await p.request('rewind_conversation',{target_message_uuid:target,last_seen_user_message_uuid:lastSeen,interrupt_if_running:false},8000);
 if(files&&conversation.subtype==='success'&&conversation.response?.rewound)filesRestore=await p.request('rewind_files',{user_message_id:target},8000);
 await delay(2000);
 p.note({event:'rewind',label,target,lastSeen,files,filesDryRun,conversation,filesRestore,frames:framesFrom(p,from)});
 return conversation;
}

async function withLaunch(name,run,api,{question,resume=null,sessionId=null},body){
 const managed=MANAGED.filter(f=>existsSync(f));let id=sessionId;
 await launch(name,run,{dir:'fixtures/p5/',relay:false,spendCap:'0.05',debugPattern:DEBUG,sessionId:resume?null:sessionId,pinned:resume===null,vars:{ANTHROPIC_BASE_URL:api.url,ANTHROPIC_AUTH_TOKEN:'stub-token'},flags:resume?['--resume',resume]:[],provenance:{...PROVENANCE,question,managedSettings:managed,token:TOKEN,...(resume?{resumed:resume}:{})}},async p=>{
  // a managed settings file applies whatever --setting-sources says; one naming a gateway would route past the stub
  check(p,'no managed settings file routes the engine',managed.every(f=>!/ANTHROPIC_BASE_URL/.test(readFileSync(f,'utf8'))),managed);
  await open(p,run);
  id=resume??sessionId;
  await body(p,id);
  check(p,'every main-loop request reached the stub',api.requests.some(r=>r.kind==='main')||/-(pre-release|kill-after-rewind[-0-9a-z]*)-l2$/.test(name));
  if(!p.exited)await endAsStop(p);
 });
}

// A crash, not a release: as pre-release, but l2 is SIGKILLed `ms` after the rewind is answered.
const killArm=ms=>({question:`after a release and a --resume, at once a rewind to a message from before the resume, then SIGKILL ${ms} ms after the rewind is answered; a second resume and a turn`,async run({L,arm}){
 const u={};
 await L(1,null,async p=>{u.T1=await turn(p,arm.api,'T1');u.T2=await turn(p,arm.api,'T2');arm.snap(p,'l1-end');});
 // the launch ends by SIGKILL, so launch() throws on its exit status after recording; the arm goes on
 await L(2,'resume',async p=>{arm.snap(p,'l2-start');const from=p.seq;const conversation=await p.request('rewind_conversation',{target_message_uuid:u.T2,last_seen_user_message_uuid:u.T2,interrupt_if_running:false},8000);if(ms)await delay(ms);p.child.kill('SIGKILL');p.note({event:'rewind',label:'rewind',target:u.T2,lastSeen:u.T2,files:false,filesDryRun:null,conversation,filesRestore:null,frames:framesFrom(p,from),killedAfterMs:ms});await p.closed;}).catch(e=>arm.note(e.message));
 arm.snapOff('l2-after-kill');
 await L(3,'resume',async p=>{u.T3=await turn(p,arm.api,'T3');arm.snap(p,'l3-end');});
 return u;
}});

const ARMS={
 pre:{question:'(1) after a turn, a release and a --resume: a turn, then a rewind to a message from before the resume (conversation only), then a turn; a second resume and a turn',async run({L,arm}){
  const u={};
  await L(1,null,async p=>{u.T1=await turn(p,arm.api,'T1');u.T2=await turn(p,arm.api,'T2');arm.snap(p,'l1-end');});
  await L(2,'resume',async p=>{arm.snap(p,'l2-start');u.T3=await turn(p,arm.api,'T3');arm.snap(p,'l2-before-rewind');await rewind(p,'rewind',{target:u.T2,lastSeen:u.T3,files:false});arm.snap(p,'l2-after-rewind');u.T4=await turn(p,arm.api,'T4');arm.snap(p,'l2-after-next');});
  await L(3,'resume',async p=>{u.T5=await turn(p,arm.api,'T5');arm.snap(p,'l3-end');});
  return u;
 }},
 'pre-files':{question:'(2) as (1), the rewind with rewindFiles',async run({L,arm}){
  const u={};
  await L(1,null,async p=>{u.T1=await turn(p,arm.api,'T1');u.T2=await turn(p,arm.api,'T2');arm.snap(p,'l1-end');});
  await L(2,'resume',async p=>{arm.snap(p,'l2-start');u.T3=await turn(p,arm.api,'T3');arm.snap(p,'l2-before-rewind');await rewind(p,'rewind',{target:u.T2,lastSeen:u.T3,files:true,dryRun:true});arm.snap(p,'l2-after-rewind');u.T4=await turn(p,arm.api,'T4');arm.snap(p,'l2-after-next');});
  await L(3,'resume',async p=>{u.T5=await turn(p,arm.api,'T5');arm.snap(p,'l3-end');});
  return u;
 }},
 post:{question:'(3) the control: after a release and a --resume, two turns, then a rewind with rewindFiles to the first message after the resume, then a turn; a second resume and a turn',async run({L,arm}){
  const u={};
  await L(1,null,async p=>{u.T1=await turn(p,arm.api,'T1');u.T2=await turn(p,arm.api,'T2');arm.snap(p,'l1-end');});
  await L(2,'resume',async p=>{arm.snap(p,'l2-start');u.T3=await turn(p,arm.api,'T3');u.T4=await turn(p,arm.api,'T4');arm.snap(p,'l2-before-rewind');await rewind(p,'rewind',{target:u.T3,lastSeen:u.T4,files:true,dryRun:true});arm.snap(p,'l2-after-rewind');u.T5=await turn(p,arm.api,'T5');arm.snap(p,'l2-after-next');});
  await L(3,'resume',async p=>{u.T6=await turn(p,arm.api,'T6');arm.snap(p,'l3-end');});
  return u;
 }},
 'pre-release':{question:'after a release and a --resume, at once a rewind to a message from before the resume (Load now), then a release with nothing sent; a second resume and a turn',async run({L,arm}){
  const u={};
  await L(1,null,async p=>{u.T1=await turn(p,arm.api,'T1');u.T2=await turn(p,arm.api,'T2');arm.snap(p,'l1-end');});
  await L(2,'resume',async p=>{arm.snap(p,'l2-start');await rewind(p,'rewind',{target:u.T2,lastSeen:u.T2,files:false});arm.snap(p,'l2-after-rewind');await delay(3000);});
  arm.snapOff('l2-after-release');
  await L(3,'resume',async p=>{u.T3=await turn(p,arm.api,'T3');arm.snap(p,'l3-end');});
  return u;
 }},
 'same-release':{question:'a rewind in the launch that wrote its target, then a release with nothing sent; a resume and a turn',async run({L,arm}){
  const u={};
  await L(1,null,async p=>{u.T1=await turn(p,arm.api,'T1');u.T2=await turn(p,arm.api,'T2');arm.snap(p,'l1-before-rewind');await rewind(p,'rewind',{target:u.T2,lastSeen:u.T2,files:false});arm.snap(p,'l1-after-rewind');await delay(3000);});
  arm.snapOff('l1-after-release');
  await L(2,'resume',async p=>{u.T3=await turn(p,arm.api,'T3');arm.snap(p,'l2-end');});
  return u;
 }},
 'kill-after-rewind':killArm(0),
 'kill-after-rewind-200ms':killArm(200),
 'kill-after-rewind-1s':killArm(1000),
 'plain-release':{question:'the control for the release arms: no rewind; a release and a --resume, then a turn whose first call reads the file the last turn wrote',async run({L,arm}){
  const u={};
  await L(1,null,async p=>{u.T1=await turn(p,arm.api,'T1');u.T2=await turn(p,arm.api,'T2');arm.snap(p,'l1-end');});
  await L(2,'resume',async p=>{u.T3=await turn(p,arm.api,'T3');arm.snap(p,'l2-end');});
  return u;
 }},
};

async function runArm(name){
 const def=ARMS[name];const run=scratchRun('o3f-'+name);
 writeFileSync(join(run.cwd,'state.txt'),'STATE_T0\n');
 const api=await startScriptedApi(run.cwd);const sessionId=randomUUID();
 // a snapshot taken between launches (no process running) is noted at the start of the next launch's fixture
 const between=[];
 const arm={api,snap:(p,label)=>p.note(snapshotOf(run,name,sessionId,label)),snapOff:label=>between.push({...snapshotOf(run,name,sessionId,label),betweenLaunches:true}),note:message=>between.push({event:'arm_note',message})};
 const L=async(n,mode,body)=>withLaunch(`p5-o3-rewind-resume-${name}-l${n}`,run,api,{question:def.question,resume:mode==='resume'?sessionId:null,sessionId},async p=>{for(const s of between.splice(0))p.note(s);await body(p);});
 try{
  const uuids=await def.run({L,arm});
  writeFileSync(root+`fixtures/p5/p5-o3-rewind-resume-${name}-uuids.json`,JSON.stringify({arm:name,sessionId,token:TOKEN,engine:ENGINE_VERSION,uuids},null,1)+'\n');
 }finally{transcriptCopy(run,name,sessionId);await api.close();removeRun(run);}
}

export default async()=>{
 console.log('engine',ENGINE_VERSION,'token',TOKEN);
 const arms=(process.env.P5O3F_ARM??Object.keys(ARMS).join(',')).split(',');
 for(const name of arms){if(!ARMS[name])throw new Error('unknown arm '+name);await runArm(name);}
};
