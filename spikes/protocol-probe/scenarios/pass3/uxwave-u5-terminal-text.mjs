// UX wave U5, probe P7 (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md on ux-wave/U5a, "Probes", P7):
// does a message of several comments, sent to a terminal session through the sminos bridge as MAWS's terminal route
// sends it, arrive intact? Run it only as
//   ./vm-run.sh --managed --prefix <p> -e CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 run run-pass3.mjs uxwave-u5-terminal-text
// --managed so the owner's plugins (to-human, sminos, doperpowers) load as in an owner's terminal session (P7's step 6:
// which other mods with a prompt or append hook are loaded), the bridge among them; their mods run only under
// CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1. The HOME is vm-run.sh's scratch one, so sminos's state is private and unenrolled.
//
// The terminal session is an interactive engine in tmux. The sender is this script, posting exactly as
// src/services/lane-a/driver.ts and deliveries.ts post a `laneA.send`: `GET /status` for the launch, then
// `POST /command?wait=10000` with {op: 'deliver', key: {writer: 'maws/<machine>', seq}, text, launch} on
// $HOME/.claude/sminos/bridge/<session>.sock, and the fate (`delivered` submitted, entered or refused) read from the
// `GET /events` stream. The text is built by MAWS's own functions (src/shared/anchor/message.ts, bundled with esbuild),
// in the form U5a's Interfaces §A defines for a message of several comments to the main conversation (see `FORMAT`):
// the framing line, the blocks, and the escape of a comment's own tag-shaped lines. Comment content is invented.
//
// Steps (P7's 1 to 4 and 6; 5 needs a second machine): idle; during a `sleep 30` foreground call; after an Esc;
// a text of about 70,000 characters, idle. For each: the SHA-256 of the text sent and of the row the engine kept (the
// row `entered` names, in the session's transcript file), the first differing offset when they differ, MAWS's reader
// (parseAnchoredText) over both, and every other row that holds the step's marker. After the busy and Esc steps the
// model is asked to quote the last line of what it read.
//
// Written: fixtures/uxwave/<tag>.json, a reduced record (the invented texts, hashes, fates, row shapes, the plugins'
// names and versions); fixtures/uxwave/<tag>.rows.jsonl, the transcript reduced to each row's type, origin and shape,
// with text kept only for the probe's own invented prompts and the model's text answers. The raw transcript, the panes
// and the event stream stay under $PROBE_ROOT/raw (outside the repository): the owner's plugins' hook output is in them.
import {execFileSync} from 'node:child_process';
import {request} from 'node:http';
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,statSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hostname} from 'node:os';
import {redact} from '../../harness.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const REPO=join(HERE,'../../../..');
const BIN=process.env.PROBE_ENGINE, WORK=process.env.PROBE_WORK, ROOT=process.env.PROBE_ROOT, HOME=process.env.HOME;
const TAG=process.env.UXW_TAG||'u5-terminal-text';
const FIXTURES=(process.env.PROBE_FIXTURE_ROOT?process.env.PROBE_FIXTURE_ROOT.replace(/\/?$/,'/'):join(HERE,'../../')+'/')+'fixtures/uxwave/';
const RAW=join(ROOT,'raw');
const WRITER='maws/probe-vm';
const MARKETPLACE='/var/lib/devcloud/marketplaces/doperpowers';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const slug=p=>p.replace(/[^a-zA-Z0-9]/g,'-');

function findUp(rel,from){let d=from;for(;;){const f=join(d,rel);if(existsSync(f))return f;const up=dirname(d);if(up===d)throw new Error('not found: '+rel);d=up;}}
async function anchorModule(){
 const out=join(ROOT,'anchor-message.mjs');
 execFileSync(findUp('node_modules/.bin/esbuild',REPO),[join(REPO,'src/shared/anchor/message.ts'),'--bundle','--format=esm','--platform=node','--log-level=warning','--outfile='+out,'--tsconfig='+join(REPO,'tsconfig.json')],{cwd:REPO});
 return import(out);
}

// The bridge's HTTP over its socket, as src/services/lane-a/bridge-client.ts calls it.
function call(socket,method,path,body,timeoutMs){return new Promise((resolve,reject)=>{const data=body===undefined?undefined:JSON.stringify(body);
 const req=request({socketPath:socket,method,path,agent:false,headers:{Connection:'close',...(data!==undefined&&{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const t=Buffer.concat(chunks).toString('utf8');let b=null;try{b=JSON.parse(t);}catch{}resolve({status:res.statusCode,body:b});});});
 req.on('error',reject);const timer=setTimeout(()=>req.destroy(new Error('timeout')),timeoutMs);req.on('close',()=>clearTimeout(timer));req.end(data);});}
function subscribe(socket,lines){const req=request({socketPath:socket,method:'GET',path:'/events',agent:false,headers:{Connection:'close'}},res=>{let rest='';res.setEncoding('utf8');res.on('data',chunk=>{const parts=(rest+chunk).split('\n');rest=parts.pop()??'';for(const p of parts){if(!p.trim())continue;try{lines.push({at:new Date().toISOString(),line:JSON.parse(p)});}catch{lines.push({at:new Date().toISOString(),unparsed:p.slice(0,200)});}}});});req.on('error',e=>lines.push({at:new Date().toISOString(),error:e.message}));req.end();return req;}

const textOfRow=row=>{const c=row?.message?.content;if(typeof c==='string')return {text:c,shape:'string'};if(Array.isArray(c)){const texts=c.filter(b=>b?.type==='text');return {text:texts.map(b=>b.text).join(''),shape:c.map(b=>b?.type).join(',')};}return {text:null,shape:typeof c};};
const firstDiff=(a,b)=>{const n=Math.min(a.length,b.length);for(let i=0;i<n;i++)if(a[i]!==b[i])return i;return a.length===b.length?-1:n;};

export default async()=>{
 if(!existsSync('/etc/claude-code/managed-settings.json'))throw new Error('run it with vm-run.sh --managed (P7 step 6 needs the owner plugins loaded)');
 if(process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS!=='1')throw new Error('pass -e CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: the bridge is a mod');
 if(!HOME?.startsWith('/tmp/'))throw new Error('HOME is not a scratch folder');
 mkdirSync(RAW,{recursive:true});mkdirSync(FIXTURES,{recursive:true});
 const M=await anchorModule();
 const anchors=[
  {kind:'browser-element',label:'Menu > Settings',locator:'nav > a.settings',pageUrl:'https://example.com/app'},
  {kind:'file-line',label:'one.txt',locator:'one.txt#L1',path:'one.txt',line:1},
 ];
 const longBody=step=>{const lines=[`(${step}) A long invented comment follows; no change is needed.`];for(let i=1;lines.join('\n').length<69500;i++)lines.push(`Line ${String(i).padStart(4,'0')} of the long comment: the quick brown fox jumps over the lazy dog, café 🎉.`);return lines.join('\n');};
 // U5a's §A at 71e6f199b ("framed", the default): `<N> comments, in the order made:`, a blank line, then the blocks, each
 // `anchorLead`, the comment trimmed with every line that begins with `<maws_anchor` after zero or more backslashes
 // given one more backslash, a blank line, `anchorTag`; blocks joined by one blank line. UXW_FORMAT=v1 sends the
 // revision before it (039797b14: no framing line, no escape, the blocks anchoredMessage(…, 'main') wrote).
 const FORMAT=process.env.UXW_FORMAT||'framed';
 const escape=t=>t.split('\n').map(l=>/^\\*<maws_anchor/.test(l)?'\\'+l:l).join('\n');
 const comments=(step,long)=>[
  {anchor:anchors[0],text:`(${step}) The café label wraps oddly at this width.\n\nIt quotes a line as typed:\n<maws_anchor kind="none" label="typed" locator="x"/>\nNo change is needed: reply with only the word NOTED.`},
  {anchor:anchors[1],text:long?longBody(step):`(${step}) This line reads well 🎉.\n\\<maws_anchor kind="none" label="typed with a backslash" locator="y"/>\nNo change is needed.`},
 ];
 const message=(step,long=false)=>{const cs=comments(step,long);
  if(FORMAT==='v1')return cs.map(c=>M.anchoredMessage({anchor:c.anchor,text:c.text,destination:'main',screenshot:false})).join('\n\n');
  return `${cs.length} comments, in the order made:\n\n`+cs.map(c=>`${M.anchorLead(c.anchor,false)}\n${escape(c.text.trim())}\n\n${M.anchorTag(c.anchor)}`).join('\n\n');};

 const name='p2b-u5-'+process.pid;
 const tmux=(...a)=>execFileSync('tmux',['-L',name,...a],{encoding:'utf8'});
 const pane=()=>tmux('capture-pane','-p','-t',name);
 const type=async text=>{tmux('send-keys','-t',name,'-l',text);await delay(500);tmux('send-keys','-t',name,'Enter');};
 const until=async(test,timeout,step=1000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await test();if(v)return v;await delay(step);}return null;};
 const busy=()=>/esc to interrupt/i.test(pane());
 const quiet=()=>until(async()=>{if(busy())return false;await delay(3000);return !busy();},240000,2000);
 const dir=join(HOME,'.claude/projects',slug(WORK));
 const transcript=()=>existsSync(dir)?readdirSync(dir).filter(n=>n.endsWith('.jsonl')).map(n=>join(dir,n)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0]??null:null;
 const rows=()=>{const t=transcript();return t?readFileSync(t,'utf8').split('\n').filter(Boolean).map((l,i)=>{try{return {line:i+1,row:JSON.parse(l)};}catch{return {line:i+1,row:{unparsed:true}};}}):[];};
 const panes=[];const snap=label=>panes.push({label,at:new Date().toISOString(),pane:pane()});

 const plugins=['to-human','sminos'].map(p=>({name:p,version:JSON.parse(readFileSync(join(MARKETPLACE,p,'.claude-plugin/plugin.json'),'utf8')).version}));
 plugins.push({name:'doperpowers',version:JSON.parse(readFileSync(join(MARKETPLACE,'.claude-plugin/marketplace.json'),'utf8')).plugins.find(p=>p.name==='doperpowers')?.version??null});
 const record={provenance:{probe:'U5 P7 (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, Probes)',engineVersion:execFileSync(BIN,['--version'],{encoding:'utf8'}).trim(),launch:'interactive engine in tmux, --model haiku, managed settings kept (vm-run.sh --managed), CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1',plugins,format:FORMAT,writer:WRITER,post:'POST /command?wait=10000 {op:"deliver",key:{writer,seq},text,launch} (src/services/lane-a/deliveries.ts, driver.ts)'},steps:[]};
 const events=[];let sub=null,session=null,socket=null,seq=0;
 try{
  tmux('new-session','-d','-s',name,'-x','160','-y','48','-c',WORK,'-e','TERM=xterm-256color',BIN,'--model','haiku');
  await until(()=>/auto mode|❯/.test(pane()),90000);await delay(4000);snap('start');
  await type('Without using any tool, reply with only the word READY.');await delay(5000);await quiet();snap('warm');
  session=transcript()?.split('/').pop().replace('.jsonl','')??null;if(!session)throw new Error('no transcript');
  socket=join(HOME,'.claude/sminos/bridge',session+'.sock');
  if(!await until(()=>existsSync(socket),30000))throw new Error('no bridge socket');
  const status=await call(socket,'GET','/status',undefined,5000);
  record.status={status:status.status,keys:Object.keys(status.body??{}),launchNamed:typeof status.body?.launch==='string'};
  sub=subscribe(socket,events);await delay(1500);

  const deliver=async(step,text)=>{
   const s=await call(socket,'GET','/status',undefined,5000);const launch=typeof s.body?.launch==='string'?s.body.launch:null;
   const key={writer:WRITER,seq:++seq};const from=events.length;
   const posted=await call(socket,'POST','/command?wait=10000',{op:'deliver',key,text,...(launch!==null&&{launch})},12000);
   const fate=await until(()=>events.slice(from).map(e=>e.line).find(l=>l?.type==='delivered'&&l.key?.seq===key.seq&&l.key?.writer===WRITER&&(l.outcome==='entered'||l.outcome==='refused')),90000,500);
   return {key,posted:{status:posted.status,body:posted.body},fate,fates:events.slice(from).map(e=>e.line).filter(l=>l?.type==='delivered'&&l.key?.seq===key.seq).map(l=>({outcome:l.outcome,...(l.uuid&&{uuid:l.uuid}),...(l.reason&&{reason:l.reason})}))};
  };
  const check=(step,text,d,extra={})=>{
   const all=rows();const uuid=d.fate?.uuid;const kept=uuid?all.find(r=>r.row.uuid===uuid):null;
   const got=kept?textOfRow(kept.row):{text:null,shape:null};
   const at=got.text===null?null:firstDiff(text,got.text);
   const marker=`(${step})`;
   const others=all.filter(r=>r!==kept&&JSON.stringify(r.row).includes(marker.replace(/[()]/g,m=>m))).map(r=>{const t=textOfRow(r.row);return {line:r.line,type:r.row.type,isMeta:r.row.isMeta??null,origin:r.row.origin??null,attachment:r.row.attachment?.type??null,shape:t.shape,sha256:t.text?sha(t.text):null,equal:t.text===text,holdsText:t.text?.includes(text)??false};});
   const sentParse=M.parseAnchoredText(text),keptParse=got.text===null?null:M.parseAnchoredText(got.text);
   const entry={step,sent:{utf16:text.length,bytes:Buffer.byteLength(text),sha256:sha(text),...(text.length<2000?{text}:{head:text.slice(0,300),tail:text.slice(-300)})},
    posted:d.posted,fates:d.fates,
    kept:kept?{line:kept.line,type:kept.row.type,isMeta:kept.row.isMeta??null,origin:kept.row.origin??null,promptId:kept.row.promptId?'present':null,shape:got.shape,utf16:got.text?.length??null,sha256:got.text===null?null:sha(got.text),equal:got.text===text,firstDiff:at,...(at!==null&&at>=0?{sentAround:JSON.stringify(text.slice(Math.max(0,at-40),at+40)),keptAround:JSON.stringify(got.text.slice(Math.max(0,at-40),at+40))}:{})}:null,
    reader:{sent:sentParse?{anchor:sentParse.anchor,destination:sentParse.destination,textSha256:sha(sentParse.text)}:null,kept:keptParse?{anchor:keptParse.anchor,destination:keptParse.destination,textSha256:sha(keptParse.text)}:null,same:JSON.stringify(sentParse)===JSON.stringify(keptParse)},
    otherRowsWithMarker:others,...extra};
   record.steps.push(entry);console.log(step,JSON.stringify({fates:entry.fates.map(f=>f.outcome),equal:entry.kept?.equal??null,firstDiff:at,readerSame:entry.reader.same,others:others.length}));
   return entry;
  };
  const lastAnswer=after=>{const all=rows().filter(r=>r.line>after&&r.row.type==='assistant');const texts=all.flatMap(r=>(r.row.message?.content??[]).filter(b=>b.type==='text').map(b=>b.text));return texts.at(-1)??null;};
  const QUOTE='Without using any tool: quote, inside one fenced code block and character for character, the last non-empty line of the most recent message with comments that reached you. Nothing else.';
  // P7 names `sleep 30`; the engine refuses a standalone sleep of that length (the first run's model said so, rows
  // 57-58 there), so the turn holds a foreground python wait of 30 s instead. The step waits until the call is in the
  // transcript with no result yet, i.e. running.
  const SLEEP=step=>`(${step}-turn) Run exactly \`python3 -c "import time; time.sleep(30); print('P7-WAIT-DONE')"\` with the Bash tool in the foreground (run_in_background false), description "p7 wait". Then reply with only the word DONE.`;
  const waiting=()=>{const all=rows().map(r=>r.row);const calls=all.filter(r=>r.type==='assistant').flatMap(r=>(r.message?.content??[]).filter(b=>b.type==='tool_use'&&String(b.input?.command??'').includes('time.sleep(30)')).map(b=>b.id));const done=new Set(all.filter(r=>r.type==='user').flatMap(r=>Array.isArray(r.message?.content)?r.message.content.filter(b=>b.type==='tool_result').map(b=>b.tool_use_id):[]));return calls.find(id=>!done.has(id))??null;};
  const interrupted=after=>rows().filter(r=>r.line>after&&r.row.type==='user'&&/interrupted/i.test(JSON.stringify(r.row.message?.content??''))).map(r=>({line:r.line,text:textOfRow(r.row).text?.slice(0,120)??null}));

  // 1. idle
  {const step='p7-idle';const text=message(step);const d=await deliver(step,text);await delay(4000);await quiet();snap(step);check(step,text,d);}
  // 2. during a turn: a foreground sleep 30
  {const step='p7-busy';const text=message(step);await type(SLEEP(step));const call=await until(waiting,90000);await delay(5000);snap(step+'-before');
   const runningAtSend=waiting()!==null;const d=await deliver(step,text);await delay(3000);await quiet();snap(step);const n=rows().length;await type(QUOTE);await delay(4000);await quiet();check(step,text,d,{quote:lastAnswer(n),waitCall:call?'running':'never seen',runningAtSend});}
  // 3. after an Esc (the turn interrupted during its sleep), then a send
  {const step='p7-esc';const text=message(step);const n0=rows().length;await type(SLEEP(step));const call=await until(waiting,90000);await delay(5000);tmux('send-keys','-t',name,'Escape');await until(()=>!busy(),30000);await delay(3000);snap(step+'-stopped');
   const stop={waitCall:call?'running at the Esc':'never seen',interruptRows:interrupted(n0)};const d=await deliver(step,text);await delay(4000);await quiet();snap(step);const n=rows().length;await type(QUOTE);await delay(4000);await quiet();check(step,text,d,{quote:lastAnswer(n),...stop});}
  // 4. about 70,000 characters, idle
  {const step='p7-long';const text=message(step,true);const d=await deliver(step,text);await delay(4000);await quiet();snap(step);check(step,text,d);}
 }finally{
  try{sub?.destroy();}catch{}
  const t=transcript();
  writeFileSync(join(RAW,'panes.json'),JSON.stringify(panes,null,1));writeFileSync(join(RAW,'events.json'),JSON.stringify(events,null,1));
  record.session=session?'present':null;
  // the reduced transcript: shapes only, text kept for the probe's own invented prompts and the model's text answers
  const reduced=rows().map(({line,row:r})=>{const t=textOfRow(r);const mine=typeof t.text==='string'&&/\(p7-[a-z]+(-turn)?\)|^Without using any tool/.test(t.text);
   return {line,type:r.type,...(r.subtype&&{subtype:r.subtype}),...(r.isMeta!==undefined&&{isMeta:r.isMeta}),...(r.origin&&{origin:{kind:r.origin.kind,...(r.origin.name&&{name:r.origin.name}),...(r.origin.asUser!==undefined&&{asUser:r.origin.asUser})}}),...(r.attachment?.type&&{attachment:r.attachment.type}),
    ...(r.message?{shape:t.shape}:{}),...(r.type==='user'&&mine?{text:t.text.length<2000?t.text:{utf16:t.text.length,sha256:sha(t.text)}}:{}),...(r.type==='user'&&t.text!==null&&!mine?{textSha256:sha(t.text)}:{}),
    ...(r.type==='assistant'?{text:(r.message?.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('')||undefined,tools:(r.message?.content??[]).filter(b=>b.type==='tool_use').map(b=>b.name)}:{})};});
  writeFileSync(FIXTURES+TAG+'.rows.jsonl',reduced.map(r=>redact(JSON.stringify(r))).join('\n')+'\n');
  writeFileSync(FIXTURES+TAG+'.json',redact(JSON.stringify(record,null,1))+'\n');
  try{tmux('kill-server');}catch{}
  console.log(TAG,JSON.stringify({session,transcript:t,raw:RAW,fixture:FIXTURES+TAG+'.json'}));
 }
};
