// P5 O16 M0, question 6 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M0): the per-line latency a session
// host's relay adds, read on a devcloud VM with D3's Go prototype adapted to M1's hot path (main.go beside this file).
// Every time below is CLOCK_MONOTONIC (Node's process.hrtime, Go's runtime.nanotime), one clock across the processes.
//
//   real      the installed engine, MAWS's launch line, against a stub API that streams each answer as 120 text deltas
//             4 ms apart (so the stream is the engine's own: a stream_event line per delta, then assistant, result):
//             once spawned directly (the line sizes and arrival times become the replay trace) and once under the
//             relay, where each line's latency is its arrival at this process's socket less the host's read of it.
//   replay    the trace replayed by a child that stamps each line just before writing it, sizes and timing as the
//             engine wrote them: spawned directly (a pipe, as the engine host reads the engine today) and under the
//             relay, alternating; a line's latency is its arrival here less its stamp. The gate reads the hosted
//             totals (engine write to manager arrival through the relay): per line the added hop is at most the
//             hosted total, since the direct latency is never negative, so the hosted percentiles bound the hop's.
//             `hop` (hosted less direct, per percentile) is an estimate only, recorded and not gated: a difference
//             of independently pooled percentiles is not the percentile of the per-line difference. The live
//             engine's host-read-to-arrival segment is gated beside it as the live estimate of the hop.
//   input     stamped lines written every 5 ms to a child that stamps each on arrival: direct pipe and through the
//             relay's stdin records (the other half of a round trip; not gated, recorded).
//
//   node bench.mjs run --relay <o16-relay binary> --out <summary.json>     the driver (spawns the engine: VM only)
//   node bench.mjs replay <trace.json> | node bench.mjs sink                the children
import {spawn,execFileSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,cpus,release} from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const SELF=fileURLToPath(import.meta.url);
const now=()=>process.hrtime.bigint();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const STAMP=/^\{"o16":"(\d+)"/;
const stampLine=(size,pad='x')=>{const head=`{"o16":"${now()}","pad":"`;return head+pad.repeat(Math.max(0,size-head.length-2))+'"}';};

// ---- children ----
async function replay(tracePath){
 const trace=JSON.parse(readFileSync(tracePath,'utf8'));const start=Number(now()/1000000n);
 for(let i=0;i<trace.length;){
  const due=start+trace[i].atMs;const wait=due-Number(now()/1000000n);if(wait>0)await delay(wait);
  // every line due by now goes in this tick, back to back, as a burst the engine wrote does
  const tickEnd=Number(now()/1000000n);
  while(i<trace.length&&start+trace[i].atMs<=tickEnd){process.stdout.write(stampLine(trace[i].size)+'\n');i++;}
 }
}
function sink(){
 const lat=[];let buf='';
 process.stdin.setEncoding('utf8');
 process.stdout.write('READY\n'); // the driver writes nothing until the sink reads
 process.stdin.on('data',chunk=>{const at=now();buf+=chunk;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);
  if(line==='END'){process.stdout.write(JSON.stringify({o16sink:lat})+'\n');return;}
  const m=STAMP.exec(line);if(m)lat.push(Number(at-BigInt(m[1])));}});
}

// ---- the relay's client (Interfaces §A framing) ----
class HostClient{
 constructor(sock,token,onRecord){this.sock=sock;this.token=token;this.onRecord=onRecord;this.buf=Buffer.alloc(0);this.waiters=[];this.offset=0;this.controls=[];}
 async open(){
  for(let i=0;i<100;i++){try{await new Promise((res,rej)=>{this.s=createConnection(this.sock);this.s.once('connect',res);this.s.once('error',rej);});break;}catch{await delay(20);}}
  this.s.on('data',chunk=>this.data(chunk));
  this.line({t:'auth',token:this.token});await this.until('hello');
  this.line({t:'attach',role:'writer',fence:1});await this.until('attached');
  this.line({t:'read',fromSeq:1});
  this.line({t:'commit'});return this.until('spawned');
 }
 line(o){this.s.write(JSON.stringify(o)+'\n');}
 write(text){const b=Buffer.from(text);this.s.write(Buffer.concat([Buffer.from(JSON.stringify({t:'stdin',offset:this.offset,len:b.length})+'\n'),b]));this.offset+=b.length;}
 until(t){const hit=this.controls.find(c=>c.t===t);if(hit)return Promise.resolve(hit);return new Promise(r=>this.waiters.push({t,r}));}
 data(chunk){
  const at=now();this.buf=this.buf.length?Buffer.concat([this.buf,chunk]):chunk;
  for(;;){
   const nl=this.buf.indexOf(10);if(nl<0)return;
   const head=JSON.parse(this.buf.subarray(0,nl).toString('utf8'));
   if(head.t==='out'||head.t==='err'){
    if(this.buf.length<nl+1+head.len)return;
    const body=this.buf.subarray(nl+1,nl+1+head.len).toString('utf8');this.buf=this.buf.subarray(nl+1+head.len);
    this.onRecord(head,body,at);continue;
   }
   this.buf=this.buf.subarray(nl+1);this.controls.push(head);
   for(const w of [...this.waiters])if(w.t===head.t){this.waiters.splice(this.waiters.indexOf(w),1);w.r(head);}
  }
 }
}
function startRelay(relay,sock,argv,env,cwd){
 const token=randomBytes(32).toString('hex');
 const proc=spawn(relay,[sock,...argv],{stdio:['pipe','pipe','inherit'],env,cwd});
 proc.stdin.end(token+'\n');
 return {proc,token,ready:new Promise(r=>proc.stdout.once('data',r))};
}

// A child read either way: `onLine(line, arrivalNs)` per stdout line; `send(text)` to its stdin.
async function child(mode,{relay,argv,env,cwd,onLine,onHost}){
 if(mode==='direct'){
  const p=spawn(argv[0],argv.slice(1),{stdio:['pipe','pipe','inherit'],env,cwd});let buf='';
  p.stdout.setEncoding('utf8');p.stdout.on('data',chunk=>{const at=now();buf+=chunk;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);onLine(line,at);}});
  return {send:t=>p.stdin.write(t),end:()=>p.stdin.end(),exited:new Promise(r=>p.on('close',r))};
 }
 const dir=mkdtempSync(join(tmpdir(),'o16-relay-'));const sock=join(dir,'h.sock');
 const r=startRelay(relay,sock,argv,env,cwd);await r.ready;
 const c=new HostClient(sock,r.token,(head,body,at)=>{if(head.t==='out'){onHost?.(head,body,at);onLine(body,at);}});
 await c.open();
 return {send:t=>c.write(t),end:()=>c.line({t:'end'}),exited:new Promise(res=>r.proc.on('close',()=>{rmSync(dir,{recursive:true,force:true});res();}))};
}

// ---- the stub API: every main request answered by 120 text deltas, 4 ms apart ----
const sse=(type,data)=>`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`;
async function startStreamingStub(){
 let n=0;
 const server=createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',async()=>{
  const path=req.url.split('?')[0];
  if(path==='/v1/messages/count_tokens'){res.writeHead(200,{'content-type':'application/json'});return res.end('{"input_tokens":1000}');}
  if(req.method!=='POST'||path!=='/v1/messages'){res.writeHead(404);return res.end();}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));const id=`msg_o16relay_${++n}`;
  const main=Array.isArray(body.tools)&&body.tools.some(t=>t?.name==='Bash');
  const deltas=main?120:1;
  if(body.stream!==true){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({id,type:'message',role:'assistant',model:body.model,content:[{type:'text',text:'ok'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}));}
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  res.write(sse('message_start',{message:{id,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1,cache_creation_input_tokens:0,cache_read_input_tokens:0}}}));
  res.write(sse('content_block_start',{index:0,content_block:{type:'text',text:''}}));
  for(let i=0;i<deltas;i++){res.write(sse('content_block_delta',{index:0,delta:{type:'text_delta',text:`word${i} of the streamed answer, `}}));if(main)await delay(4);}
  res.write(sse('content_block_stop',{index:0}));
  res.write(sse('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:deltas}}));
  res.end(sse('message_stop',{}));
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}

// The engine under MAWS's launch line (src/engine-host/launch.ts ENGINE_FLAGS, the constant environment) in a scratch
// config home, `turns` prompts, each awaited to its result; every line's arrival handed to `onLine`.
const ENGINE_FLAGS=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--permission-prompt-tool','stdio','--include-partial-messages','--forward-subagent-text','--replay-user-messages','--include-hook-events','--setting-sources','user,project,local'];
async function engineRun(mode,{engine,relay,stub,turns,onHost}){
 const root=mkdtempSync(join(tmpdir(),'o16-relay-engine-'));const home=join(root,'config');const cwd=join(root,'repo');
 execFileSync('mkdir',['-p',home,cwd]);writeFileSync(join(home,'settings.json'),'{}\n');
 writeFileSync(join(home,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[cwd]:{hasTrustDialogAccepted:true}}})+'\n');
 const env={PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:home,ANTHROPIC_BASE_URL:stub.url,ANTHROPIC_AUTH_TOKEN:'stub-token',ENABLE_TOOL_SEARCH:'true',CLAUDE_CODE_ENTRYPOINT:'sdk-ts',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_FORK_SUBAGENT:'true',TERM:'dumb',DISABLE_AUTOUPDATER:'1'};
 const argv=[engine,...ENGINE_FLAGS,'--model','haiku','--session-id',randomUUID(),'--settings','{"dialogExpiry":"never"}'];
 const lines=[];let waiter=null;
 const c=await child(mode,{relay,argv,env,cwd,onHost,onLine:(line,at)=>{lines.push({at,size:Buffer.byteLength(line)+1});let f;try{f=JSON.parse(line);}catch{return;}if(waiter&&waiter.test(f)){const w=waiter;waiter=null;w.r(f);}}});
 const next=test=>new Promise(r=>{waiter={test,r};});
 let w=next(f=>f.type==='control_response');
 c.send(JSON.stringify({type:'control_request',request_id:'o16-init',request:{subtype:'initialize',workspaceTrust:{accepted:true,directory:cwd}}})+'\n');await w;
 for(let i=0;i<turns;i++){w=next(f=>f.type==='result');c.send(JSON.stringify({type:'user',uuid:randomUUID(),message:{role:'user',content:`Turn ${i}: answer at length.`},parent_tool_use_id:null})+'\n');await w;}
 c.end();await c.exited;rmSync(root,{recursive:true,force:true});
 return lines;
}

const pct=(xs,q)=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.max(0,Math.ceil(q*s.length)-1))];};
const us=ns=>ns===null?null:Math.round(ns/100)/10;
const stats=xs=>({n:xs.length,p50:us(pct(xs,0.5)),p95:us(pct(xs,0.95)),p99:us(pct(xs,0.99)),max:us(pct(xs,1))});

async function run(args){
 const opt=k=>{const i=args.indexOf('--'+k);return i>=0?args[i+1]:null;};
 const relay=opt('relay'),out=opt('out'),engine=opt('engine')??process.env.PROBE_ENGINE;
 const rounds=Number(opt('rounds')??6),turns=Number(opt('turns')??8);
 const given=opt('trace'); // a trace file instead of the engine legs: a smoke run of the replay and input legs
 if(!relay||!out||(!engine&&!given))throw new Error('usage: bench.mjs run --relay <bin> --out <json> --engine <claude> [--trace <file>]');
 const stub=await startStreamingStub();
 const engineVersion=given?null:execFileSync(engine,['--version'],{encoding:'utf8'}).trim();
 const summary={question:6,document:'docs/doperpowers/plans/2026-10-31-p5-o16-holder.md',gate:{p50us:500,p95us:1500},engine,engineVersion,node:process.version,kernel:release(),cpus:cpus().length,cpuModel:cpus()[0]?.model,relay,rounds,turns,at:new Date().toISOString()};
 try{
  // real: direct (the trace), then hosted (host read to arrival)
  let trace,hostSeg=[];
  if(given)trace=JSON.parse(readFileSync(given,'utf8'));
  else{const direct=await engineRun('direct',{engine,relay,stub,turns});const t0=direct[0].at;trace=direct.map(l=>({atMs:Number((l.at-t0)/1000000n),size:l.size}));}
  const sizes=trace.map(t=>t.size);
  summary.trace={lines:trace.length,durationMs:trace.at(-1).atMs,sizeP50:pct(sizes,0.5),sizeP95:pct(sizes,0.95),sizeMax:pct(sizes,1),bytes:sizes.reduce((a,b)=>a+b,0)};
  if(!given){await engineRun('hosted',{engine,relay,stub,turns,onHost:(head,body,at)=>hostSeg.push(Number(at-BigInt(head.tr)))});summary.real={hostReadToArrival:stats(hostSeg)};}
  const dir=mkdtempSync(join(tmpdir(),'o16-trace-'));const tracePath=join(dir,'trace.json');writeFileSync(tracePath,JSON.stringify(trace));
  // replay: alternating direct and hosted, `rounds` of each
  const rep={direct:[],hosted:[]};
  for(let r=0;r<rounds*2;r++){
   const mode=r%2===0?'direct':'hosted';const lat=rep[mode];
   const c=await child(mode,{relay,argv:[process.execPath,SELF,'replay',tracePath],env:{PATH:process.env.PATH},onLine:(line,at)=>{const m=STAMP.exec(line);if(m)lat.push(Number(at-BigInt(m[1])));}});
   c.end();await c.exited;
  }
  summary.replay={direct:stats(rep.direct),hosted:stats(rep.hosted),hop:{p50:us(pct(rep.hosted,0.5)-pct(rep.direct,0.5)),p95:us(pct(rep.hosted,0.95)-pct(rep.direct,0.95)),p99:us(pct(rep.hosted,0.99)-pct(rep.direct,0.99))}};
  // input: stamped lines every 5 ms
  const inp={direct:[],hosted:[]};
  for(let r=0;r<rounds*2;r++){
   const mode=r%2===0?'direct':'hosted';let done,ready;const got=new Promise(res=>{done=res;}),up=new Promise(res=>{ready=res;});
   const c=await child(mode,{relay,argv:[process.execPath,SELF,'sink'],env:{PATH:process.env.PATH},onLine:line=>{if(line==='READY')ready();if(line.startsWith('{"o16sink"')){inp[mode].push(...JSON.parse(line).o16sink);done();}}});
   await up;
   for(let i=0;i<400;i++){c.send(stampLine(200,'y')+'\n');await delay(5);}
   c.send('END\n');await got;c.end();await c.exited;
  }
  summary.input={direct:stats(inp.direct),hosted:stats(inp.hosted),hop:{p50:us(pct(inp.hosted,0.5)-pct(inp.direct,0.5)),p95:us(pct(inp.hosted,0.95)-pct(inp.direct,0.95))}};
  const under=x=>x.p50<=500&&x.p95<=1500;
  summary.verdict=under(summary.replay.hosted)&&(!summary.real||under(summary.real.hostReadToArrival))?'under the gate':'over the gate';
  summary.raw={trace,replayDirectUs:rep.direct.map(us),replayHostedUs:rep.hosted.map(us),realHostSegmentUs:hostSeg.map(us)};
  rmSync(dir,{recursive:true,force:true});
 }finally{await stub.close();}
 writeFileSync(out,JSON.stringify(summary,null,1)+'\n');
 const {raw,...brief}=summary;console.log(JSON.stringify(brief,null,1));
 console.log(`Q6 relay p50/p95 at most ${summary.replay.hosted.p50}/${summary.replay.hosted.p95} µs (hosted totals; live segment ${summary.real?.hostReadToArrival.p50}/${summary.real?.hostReadToArrival.p95}; estimate ${summary.replay.hop.p50}/${summary.replay.hop.p95}) (gate 500/1500): ${summary.verdict}`);
}

const [cmd,...rest]=process.argv.slice(2);
if(cmd==='replay')await replay(rest[0]);
else if(cmd==='sink')sink();
else if(cmd==='run')await run(rest);
else{console.error('usage: bench.mjs run|replay|sink');process.exit(2);}
