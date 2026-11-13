// UX wave U5, P1 (docs/doperpowers/specs/2026-11-12-ux-wave/U5-review-comments-source-control.md, Probes and checks; law 6
// of the root spec): does engine 2.1.322 keep a message of several image blocks and one text block when it is sent idle,
// sent as a steer during a turn, and given as a fork's first message? The fixtures before this held one image
// (pass3/p1-side-thread-live*.jsonl).
//
// Run on a devcloud VM through vm-run.sh (VM.md): ./vm-run.sh --prefix <p> --out <dir> run run-pass3.mjs uxwave-p1-images
// with -e UXP1_RUN=<n> to label a repetition. The engine is the one vm-run.sh names (PROBE_ENGINE, 2.1.322), routed
// through the gateway forward vm-run.sh set up, with the environment vm-run.sh built plus MAWS's own constants
// (src/engine-host/launch.ts buildEnvironment). The launch line is MAWS's: ENGINE_FLAGS (the harness's own line plus
// --forward-subagent-text --replay-user-messages --include-hook-events and --setting-sources user,project,local, no
// --strict-mcp-config), --settings {"dialogExpiry":"never"} (protectedSettings with no effort), --model haiku,
// --permission-mode default and --session-id; the side thread adds --resume <parent> --fork-session. Not passed: the
// maws server's --disallowedTools/--allowedTools pair (the probe serves no `maws` server, so MAWS would not pass it
// either). Probe guard MAWS does not pass: --max-budget-usd. After initialize (MAWS's payload, probe-initialize.mjs) the
// probe sends the one request MAWS sends before any prompt that reaches the engine, set_max_thinking_tokens
// {max_thinking_tokens: null, thinking_display: 'summarized'} (src/engine-host/session.ts).
//
// What is read, per case: the user frames the engine replays (--replay-user-messages), the request the engine makes to
// the Messages API (a loopback forwarder in front of the gateway forward records, per request, each message's role and
// its blocks' types; an image as its media type and which of the probe's images it is, a text as its first 200
// characters; no headers, nothing else of the body), the engine's transcript (JSONL) records, and the model's answer
// (the three images are solid red, green and blue squares, so naming their colours in order shows the model saw them).
import {createServer,request as httpRequest} from 'node:http';
import {deflateSync,crc32} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,existsSync,readdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {run,scratch,delay} from '../../harness.mjs';
import {probeInitialize} from '../../probe-initialize.mjs';

const RUN=process.env.UXP1_RUN??'1';
const BIN=process.env.PROBE_ENGINE;
const UPSTREAM=new URL(process.env.ANTHROPIC_BASE_URL); // vm-run.sh's loopback forward to the gateway
const PROVENANCE={spec:'docs/doperpowers/specs/2026-11-12-ux-wave/U5-review-comments-source-control.md',probe:'P1',law:6,run:RUN};

// ---- the images: solid 16x16 PNGs, red, green, blue (tiny, generated here)
function png([r,g,b],size=16){
 const row=Buffer.alloc(1+size*3);for(let x=0;x<size;x++){row[1+3*x]=r;row[2+3*x]=g;row[3+3*x]=b;}
 const raw=Buffer.concat(Array.from({length:size},()=>row));
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td)>>>0);return Buffer.concat([len,td,crc]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const IMAGES={red:png([230,20,20]),green:png([20,180,20]),blue:png([20,40,230])};
const labelOf=data=>Object.entries(IMAGES).find(([,d])=>d===data)?.[0]??(data?'other:'+createHash('sha1').update(data).digest('hex').slice(0,8):null);
const imageBlock=name=>({type:'image',source:{type:'base64',media_type:'image/png',data:IMAGES[name]}});
// MAWS's composer order: the images, then the text (src/renderer/src/composer/editor/serialize.ts)
const message=(names,text)=>[...names.map(imageBlock),{type:'text',text}];
const blocksOf=content=>typeof content==='string'?[{type:'text',head:content.slice(0,200)}]:(content??[]).map(b=>b.type==='image'?{type:'image',media_type:b.source?.media_type,image:labelOf(b.source?.data)}:b.type==='text'?{type:'text',head:b.text.slice(0,200)}:{type:b.type});
const imagesOf=content=>blocksOf(content).filter(b=>b.type==='image').map(b=>b.image);

// ---- the forwarder: what the engine asks the Messages API, block types only
const api=[];
function forwarder(){
 const server=createServer((req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   const body=Buffer.concat(chunks);
   if(req.method==='POST'&&/\/v1\/messages(\?|$)/.test(req.url)){try{const j=JSON.parse(body.toString('utf8'));api.push({at:new Date().toISOString(),model:j.model,messages:(j.messages||[]).map(m=>({role:m.role,blocks:blocksOf(m.content)}))});}catch{api.push({at:new Date().toISOString(),parsed:false});}}
   const headers={...req.headers,host:UPSTREAM.host};delete headers['accept-encoding'];
   const up=httpRequest({hostname:UPSTREAM.hostname,port:UPSTREAM.port,path:req.url,method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
   up.on('error',e=>{res.writeHead(502);res.end(String(e.message));});up.end(body);
  });
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`})));
}

// ---- MAWS's launch, on the harness
const SETTINGS={dialogExpiry:'never'};
function options(cwd,url,sessionId,extraFlags=[]){
 return {cwd,bin:BIN,dir:'fixtures/uxwave/',model:'haiku',settingSources:'user,project,local',strictMcp:false,mode:'default',
  env:{ANTHROPIC_BASE_URL:url,ENABLE_TOOL_SEARCH:'true',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',TERM:'dumb',DISABLE_AUTOUPDATER:'1'},
  flags:['--forward-subagent-text','--replay-user-messages','--include-hook-events','--settings',JSON.stringify(SETTINGS),'--session-id',sessionId,'--max-budget-usd','0.40',...extraFlags]};
}
async function handshake(p,cwd){
 const init=await p.request('initialize',probeInitialize({accepted:true,directory:cwd}));
 if(init.subtype!=='success')throw new Error('initialize: '+JSON.stringify(init));
 await p.request('set_max_thinking_tokens',{max_thinking_tokens:null,thinking_display:'summarized'}).catch(e=>p.note({event:'set_max_thinking_tokens_failed',error:e.message}));
}
const allowBash=p=>r=>{p.note({event:'permission_asked',tool:r.tool_name});return r.tool_name==='Bash'?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only Bash is in scope.'};};
const transcript=(home,cwd,id)=>{const dir=join(home,'.claude/projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'));const f=join(dir,id+'.jsonl');return existsSync(f)?readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];};
// the user frames from `after` on, as block lists, with their replay flag and seq
const userFrames=(p,after)=>p.frames.filter(r=>r.seq>after&&r.frame.type==='user'&&!r.frame.parent_tool_use_id&&!(Array.isArray(r.frame.message?.content)&&r.frame.message.content.some(b=>b.type==='tool_result'))).map(r=>({seq:r.seq,uuid:r.frame.uuid,isReplay:r.frame.isReplay??null,blocks:blocksOf(r.frame.message?.content)}));
const answerOf=p=>p.frames.filter(r=>r.frame.type==='result').at(-1)?.frame?.result??null;
const resultRow=(p,after,uuid)=>p.frames.find(r=>r.seq>after&&r.frame.type==='result'&&(!uuid||(r.frame.user_message_uuids||[]).includes(uuid)));
// the API requests made from `from` on whose last message is a user message holding images
const apiSince=from=>api.slice(from).map((q,i)=>({index:from+i,model:q.model,messages:q.messages?.length,lastUser:[...(q.messages||[])].reverse().find(m=>m.role==='user')?.blocks,imagesInAll:(q.messages||[]).flatMap(m=>m.blocks.filter(b=>b.type==='image').map(b=>b.image))}));
const ASK='Three images are attached. Name the colour of each image, in the order attached, as a comma-separated list of colour words and nothing else.';
const SLOW='Run exactly this bash command and nothing else: sleep 15; echo SLEPT_OK. When it finishes, reply with the command output.';
const STEER='Three images are attached. When the command has finished, end your reply with a line naming the colour of each image, in the order attached, as a comma-separated list of colour words.';

export default async()=>{
 const {server,url}=await forwarder();
 const cwd=scratch(join(process.env.PROBE_ROOT??'/tmp','repo-'));
 const home=process.env.HOME;
 const P=randomUUID(),C=randomUUID();
 try{
  await run(`uxwave-p1-images-parent-${RUN}`,async p=>{
   p.on('can_use_tool',allowBash(p));
   p.note({event:'provenance',...PROVENANCE,role:'parent',engine:BIN,sessionId:P});
   await handshake(p,cwd);
   p.note({event:'engine',version:p.frames.find(r=>r.frame.type==='system'&&r.frame.subtype==='init')?.frame?.claude_code_version??null});

   // (1) idle: [red, green, blue, text]
   let after=p.seq,from=api.length;
   const idle=p.send({type:'user',uuid:randomUUID(),message:{role:'user',content:message(['red','green','blue'],ASK)},parent_tool_use_id:null,origin:{kind:'human'},priority:'now'});
   const r1=await p.wait(f=>f.type==='result',{after,timeout:120000});
   p.note({event:'case',case:'idle',sent:{seq:after+1,uuid:idle.uuid,images:['red','green','blue']},userFrames:userFrames(p,after),api:apiSince(from),result:{seq:resultRow(p,after)?.seq,subtype:r1.subtype,is_error:r1.is_error,answer:r1.result}});

   // (2) a steer during a turn: a slow Bash turn, then [blue, red, green, text] with priority next 4 s after the tool_use
   for(const priority of ['next','now']){
    after=p.seq;from=api.length;
    p.send({type:'user',uuid:randomUUID(),message:{role:'user',content:SLOW},parent_tool_use_id:null,origin:{kind:'human'},priority:'now'});
    await p.wait(f=>f.type==='assistant'&&(f.message?.content||[]).some(b=>b.type==='tool_use'&&b.name==='Bash'),{after,timeout:90000});
    await delay(4000);
    const order=priority==='next'?['blue','red','green']:['green','blue','red'];
    const steer=p.send({type:'user',uuid:randomUUID(),message:{role:'user',content:message(order,STEER)},parent_tool_use_id:null,origin:{kind:'human'},priority});
    const steerSeq=p.seq;
    const r=await p.wait(f=>f.type==='result'&&(f.user_message_uuids||[]).includes(steer.uuid),{after,timeout:180000}).catch(async()=>p.wait(f=>f.type==='result',{after:steerSeq,timeout:120000}));
    await delay(1500);
    const results=p.frames.filter(x=>x.seq>after&&x.frame.type==='result').map(x=>({seq:x.seq,subtype:x.frame.subtype,user_message_uuids:x.frame.user_message_uuids??null,answer:(x.frame.result??'').slice(0,300)}));
    p.note({event:'case',case:'steer-'+priority,sent:{seq:steerSeq,uuid:steer.uuid,images:order},userFrames:userFrames(p,after),api:apiSince(from),results});
    // a `now` steer may leave the preempted turn's result after it; let the session settle
    if(priority==='now')await delay(3000);
   }
   const recs=transcript(home,cwd,P);
   p.note({event:'transcript',records:recs.length,users:recs.filter(r=>r.type==='user'&&Array.isArray(r.message?.content)&&r.message.content.some(b=>b.type==='image')).map(r=>({uuid:r.uuid,blocks:blocksOf(r.message.content)}))});
   p.note({event:'spend',cost:p.frames.filter(r=>r.frame.type==='result').map(r=>r.frame.total_cost_usd)});
  },options(cwd,url,P));

  // (3) the side thread: --resume P --fork-session --session-id C, its first message [green, blue, red, text]
  await run(`uxwave-p1-images-fork-${RUN}`,async c=>{
   c.note({event:'provenance',...PROVENANCE,role:'fork',engine:BIN,source:P,sessionId:C});
   await handshake(c,cwd);
   const after=c.seq,from=api.length;
   const first=c.send({type:'user',uuid:randomUUID(),message:{role:'user',content:message(['green','blue','red'],ASK)},parent_tool_use_id:null,origin:{kind:'human'},priority:'now'});
   const r=await c.wait(f=>f.type==='result',{after,timeout:120000});
   const recs=transcript(home,cwd,C);
   c.note({event:'case',case:'fork-first',sent:{seq:after+1,uuid:first.uuid,images:['green','blue','red']},userFrames:userFrames(c,after),api:apiSince(from),result:{seq:resultRow(c,after)?.seq,subtype:r.subtype,is_error:r.is_error,answer:r.result},transcriptUsersWithImages:recs.filter(x=>x.type==='user'&&Array.isArray(x.message?.content)&&x.message.content.some(b=>b.type==='image')).map(x=>({uuid:x.uuid,blocks:blocksOf(x.message.content)})),init:c.frames.find(x=>x.frame.type==='system'&&x.frame.subtype==='init')?.frame?.session_id===C});
  },options(cwd,url,C,['--resume',P,'--fork-session']));
 }finally{server.close();}
};
