// UX wave U11, connector scopes, third pass: does "Write a secret as ${NAME} and set NAME in your environment." hold
// for a connector entry, on engine 2.1.322? Run as
//   ./vm-run.sh --prefix <p> run run-pass3.mjs uxwave-u11-connector-scopes-3
// A. `${NAME}` per field: an HTTP, an SSE and a stdio entry at each of project scope (<root>/.mcp.json), user scope and
//    local scope, all written with `claude mcp add-json`, with `${…}` in a header's value, the URL (path and query), a
//    stdio entry's env values, its args and its command; `${QUAY_UNSET:-fallback}` with the name unset; and, in entries
//    of their own (one of each kind at each scope), a `${QUAY_UNSET}` with no fallback.
// B. One header (remote entries) and one env value (stdio entries) per name of a spread: a name of the person's own
//    with no credential-looking part, four of the person's own that look like credentials, and well-known ones.
//    Every name holds an invented value in the engine's environment (NO_PROXY covers loopback, since HTTPS_PROXY is
//    one of them).
// C. add-json of a stdio entry with no env key, and of one with `args: []` and no env; every add-json's file entry
//    compared with the JSON given (the A entries hold `${…}` unexpanded).
// The HTTP stub records, per request, the path and query and the probe's headers; the stdio stub records its argv,
// its env values and the names inherited from the engine's environment. Values never leave the scenario: the record
// holds a class per value (set: the invented value; empty; absent; literal: `${…}` sent as written; fallback; other).
// One session (MAWS's launch, cwd <root>, `--debug-file`) reads mcp_status until the probe's servers settle; the
// record keeps what the wire, stderr and the debug file said about variables. No model is called.
// Written: the journal fixtures/uxwave/<tag>-<case>.jsonl (trimmed as in the second pass) and the record
// fixtures/uxwave/<tag>.ndjson (one case a line).
import {mawsLaunch,delay,BIN,ENGINE_VERSION,FIXTURES} from './uxwave-common-arrivals.mjs';
import {redact} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,appendFileSync,chmodSync} from 'node:fs';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {join,dirname} from 'node:path';

const TAG=process.env.UXW_TAG||'u11-connector-scope3';
const ROOT=process.env.PROBE_ROOT, HOME=process.env.HOME, REPO=process.env.PROBE_WORK;
const GLOBAL=join(HOME,'.claude.json'), MCPJSON=join(REPO,'.mcp.json'), USER_SETTINGS=join(HOME,'.claude/settings.json');
const SERVER=join(ROOT,'x3-mcp.mjs'), NOARGS=join(ROOT,'x3-noargs.mjs'), STDIO_LOG=join(ROOT,'x3-stdio.ndjson');
const NODE_DIR=dirname(process.execPath);
let BASE='';
const anon=s=>{if(typeof s!=='string')return s;s=s.split(HOME).join('<home>').split(REPO).join('<root>').split(ROOT).join('<scratch>').split(NODE_DIR).join('<node-dir>');return BASE?s.split(BASE).join('<base>'):s;};
const deep=v=>v===undefined?v:JSON.parse(anon(JSON.stringify(v)));
const readJson=f=>existsSync(f)?JSON.parse(readFileSync(f,'utf8')):undefined;
const writeJson=(f,v)=>{mkdirSync(dirname(f),{recursive:true});writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const cli=args=>{try{return {ok:true,out:anon(execFileSync(BIN,args,{cwd:REPO,encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim())};}catch(e){return {ok:false,code:e.status??null,out:anon(String(e.stdout??'')+String(e.stderr??'')).trim()};}};

// B's names and their invented values; QUAY_SEG and QUAY_NODE_DIR serve A's URL path and command.
const OWN=['QUAY_REGION'], OWN_CRED=['QUAY_TICKETS_TOKEN','QUAY_API_KEY','QUAY_PASSWORD','QUAY_SECRET'];
const KNOWN=['GITHUB_TOKEN','GH_TOKEN','NPM_TOKEN','AWS_SECRET_ACCESS_KEY','ANTHROPIC_API_KEY','HTTPS_PROXY','OTEL_EXPORTER_OTLP_HEADERS'];
const NAMES=[...OWN,...OWN_CRED,...KNOWN];
const VAL=Object.fromEntries(NAMES.map(n=>[n,n==='HTTPS_PROXY'?'http://127.0.0.1:9':'inv-'+n.toLowerCase().replace(/_/g,'-')]));
VAL.QUAY_SEG='inv-seg';VAL.QUAY_NODE_DIR=NODE_DIR;
const ENV={...VAL,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'};
const classOf=(v,name)=>v===undefined||v===null?'absent':v===VAL[name]?'set':v===''?'empty':v==='fallback'?'fallback':/\$\{/.test(v)?'literal':'other';
const H=n=>'x-v-'+n.toLowerCase().replace(/_/g,'-');

const SERVER_JS=`#!/usr/bin/env node
import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs';
const name=process.argv[2]??'x3-noargs';
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(V_|QUAY_|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|AWS_SECRET_ACCESS_KEY|ANTHROPIC_API_KEY|HTTPS_PROXY|OTEL_EXPORTER_OTLP_HEADERS)/.test(k)));
appendFileSync(${JSON.stringify(STDIO_LOG)},JSON.stringify({name,argv:process.argv.slice(2),execPath:process.execPath,env})+'\\n');
const out=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',l=>{let m;try{m=JSON.parse(l);}catch{return;}
 if(m.method==='initialize')out({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name,version:'0.0.1'}}});
 else if(m.method==='tools/list')out({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}});
 else if(m.id!==undefined)out({jsonrpc:'2.0',id:m.id,result:{}});});
`;

// HTTP stub: /x3/<server>/... streamable HTTP; /x3s/<server>/... legacy SSE (GET opens the stream, POST
// /x3s/<server>/messages?sid= carries requests). No sign-in. Every request is kept with its path, query and headers.
const reqs=[];const streams=new Map();
const answer=(rpc,name)=>rpc.method==='initialize'?{jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:rpc.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name,version:'0.0.1'}}}
 :rpc.method==='tools/list'?{jsonrpc:'2.0',id:rpc.id,result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}}:{jsonrpc:'2.0',id:rpc.id,result:{}};
function httpStub(){
 const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const u=new URL(req.url,'http://x');let rpc=null;try{rpc=JSON.parse(body||'null');}catch{}
  const seg=u.pathname.split('/').filter(Boolean);
  reqs.push({kind:seg[0],server:seg[1],method:req.method,rpc:rpc?.method??null,path:u.pathname,query:Object.fromEntries(u.searchParams),headers:Object.fromEntries(Object.entries(req.headers).filter(([k])=>k.startsWith('x-')))});
  if(seg[0]==='x3'){if(req.method!=='POST'){res.writeHead(405);return res.end();}if(!rpc||rpc.id===undefined){res.writeHead(202);return res.end();}res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(answer(rpc,seg[1])));}
  if(seg[0]==='x3s'&&seg[2]==='messages'&&req.method==='POST'){const s=streams.get(u.searchParams.get('sid'));res.writeHead(s?202:404);res.end();if(s&&rpc&&rpc.id!==undefined)s.write(`event: message\ndata: ${JSON.stringify(answer(rpc,seg[1]))}\n\n`);return;}
  if(seg[0]==='x3s'&&req.method==='GET'){const sid=randomUUID();res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.write(`event: endpoint\ndata: /x3s/${seg[1]}/messages?sid=${sid}\n\n`);streams.set(sid,res);res.on('close',()=>streams.delete(sid));return;}
  res.writeHead(404);res.end();
 });});
 return new Promise(r=>server.listen(0,'127.0.0.1',()=>{BASE=`http://127.0.0.1:${server.address().port}`;r(server);}));
}

// The entries. Remote: the URL carries ${QUAY_SEG} in the path and ${QUAY_REGION}, ${QUAY_TICKETS_TOKEN} and the
// fallback in the query; one header per name of B, and one with the fallback. Stdio: command ${QUAY_NODE_DIR}/node;
// args carry QUAY_REGION, QUAY_TICKETS_TOKEN, GITHUB_TOKEN and the fallback; one env value per name, and the fallback.
const remote=(type,name)=>({type,url:`${BASE}/${type==='sse'?'x3s':'x3'}/${name}/\${QUAY_SEG}?region=\${QUAY_REGION}&tickets=\${QUAY_TICKETS_TOKEN}&fb=\${QUAY_UNSET:-fallback}`,
 headers:{...Object.fromEntries(NAMES.map(n=>[H(n),'${'+n+'}'])),'x-fallback':'${QUAY_UNSET:-fallback}'}});
const stdio=name=>({type:'stdio',command:'${QUAY_NODE_DIR}/node',args:[SERVER,name,'region=${QUAY_REGION}','tickets=${QUAY_TICKETS_TOKEN}','gh=${GITHUB_TOKEN}','fb=${QUAY_UNSET:-fallback}'],
 env:{...Object.fromEntries(NAMES.map(n=>['V_'+n,'${'+n+'}'])),V_FALLBACK:'${QUAY_UNSET:-fallback}'}});
const unsetRemote=(type,name)=>({type,url:`${BASE}/${type==='sse'?'x3s':'x3'}/${name}/u?unset=\${QUAY_UNSET}`,headers:{'x-unset':'${QUAY_UNSET}'}});
const unsetStdio=name=>({type:'stdio',command:'node',args:[SERVER,name,'unset=${QUAY_UNSET}'],env:{V_UNSET:'${QUAY_UNSET}'}});
const SCOPES=['project','user','local'];
const ENTRIES=()=>SCOPES.flatMap(s=>[[`x3-http-${s}`,s,remote('http',`x3-http-${s}`)],[`x3-sse-${s}`,s,remote('sse',`x3-sse-${s}`)],[`x3-stdio-${s}`,s,stdio(`x3-stdio-${s}`)],
 [`x3-unset-http-${s}`,s,unsetRemote('http',`x3-unset-http-${s}`)],[`x3-unset-sse-${s}`,s,unsetRemote('sse',`x3-unset-sse-${s}`)],[`x3-unset-stdio-${s}`,s,unsetStdio(`x3-unset-stdio-${s}`)]])
 .concat([['x3-noenv','user',{type:'stdio',command:'node',args:[SERVER,'x3-noenv']}],['x3-noargs','user',{type:'stdio',command:NOARGS,args:[]}]]);
const writtenAt=(name,scope)=>scope==='user'?readJson(GLOBAL)?.mcpServers?.[name]:scope==='local'?readJson(GLOBAL)?.projects?.[REPO]?.mcpServers?.[name]:readJson(MCPJSON)?.mcpServers?.[name];

// Journals trimmed as in the second pass.
function shrink(v){if(Array.isArray(v)){if(v.length>24){const kept=v.filter(x=>/x3-|mcp__/.test(JSON.stringify(x)));return {trimmedArray:v.length,kept:kept.map(shrink)};}return v.map(shrink);}
 if(v&&typeof v==='object'){const o={};for(const [k,x] of Object.entries(v))o[k]=shrink(x);return o;}if(typeof v==='string'&&v.length>4000)return v.slice(0,600)+`…[${v.length} chars]`;return v;}
function slim(f){const s=JSON.stringify(f);if(s.length>4000&&!/x3-|mcp_status|mcpServers/.test(s)){if(f.type==='control_response'&&f.response&&typeof f.response==='object'){const i=f.response.response;return {...f,response:{...f.response,response:i&&typeof i==='object'?{trimmedBytes:JSON.stringify(i).length,keys:Object.keys(i)}:i}};}
 if(f.type==='control_request'&&f.request)return {...f,request:{subtype:f.request.subtype,trimmedBytes:JSON.stringify(f.request).length}};}return shrink(f);}
const scrubValues=s=>{for(const [k,v] of Object.entries(VAL))if(k!=='QUAY_NODE_DIR')s=s.split(v).join(`<value of ${k}>`);return s;};
function trimJournal(file){if(!existsSync(file))return;const rows=readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(r=>r.frame?.type!=='stream_event');
 writeFileSync(file,rows.map(r=>scrubValues(redact(anon(JSON.stringify({...r,frame:slim(r.frame)}))))).join('\n')+'\n');}

const mine=n=>typeof n==='string'&&/^x3-/.test(n);
async function settled(p,bound=60000){const t0=Date.now();for(;;){const r=await p.request('mcp_status',{},15000).catch(e=>({error:e.message}));
 const all=(r?.response?.mcpServers??[]).filter(s=>mine(s.name));if(all.length&&all.every(s=>s.status!=='pending')||Date.now()-t0>bound)return {seq:p.seq,raw:r};await delay(1500);}}

const record=[];
const keep=row=>{const s=scrubValues(anon(JSON.stringify(row)));record.push(s);console.log(s.slice(0,1500));};

export default async()=>{
 if(!HOME?.startsWith('/tmp/'))throw new Error('HOME is not a scratch folder');
 mkdirSync(FIXTURES,{recursive:true});
 const stub=await httpStub();
 const journal=FIXTURES+TAG+'-session.jsonl';
 try{
  writeFileSync(SERVER,SERVER_JS);writeFileSync(NOARGS,SERVER_JS);chmodSync(NOARGS,0o755);
  const us=readJson(USER_SETTINGS)??{};writeJson(USER_SETTINGS,{...us,enableAllProjectMcpServers:true});
  // C, and the writing of every A entry: add-json, then the file's entry compared with the JSON given.
  const adds=ENTRIES().map(([name,scope,json])=>{const r=cli(['mcp','add-json',name,JSON.stringify(json),'--scope',scope]);const w=writtenAt(name,scope);
   return {name,scope,given:json,answer:r,writtenEqualsGiven:JSON.stringify(w)===JSON.stringify(json),written:JSON.stringify(w)===JSON.stringify(json)?'(as given)':w??null};});
  keep({case:'setup',engine:ENGINE_VERSION,names:{own:OWN,ownCredentialLooking:OWN_CRED,wellKnown:KNOWN},valueShapes:'inv-<name in lower case, _ as -> for each; HTTPS_PROXY http://127.0.0.1:9; NO_PROXY 127.0.0.1,localhost; QUAY_NODE_DIR the folder of node; QUAY_UNSET never set',stub:'<base>/x3/<server>/… (http), <base>/x3s/<server>/… (sse)',adds});
  // A and B: one session in the root with every name set.
  const dbg=join(ROOT,'debug.log');
  const row={case:'expansion',check:'A,B',what:'one MAWS launch in <root> with each name of B set to an invented value; mcp_status until the x3 servers settle; what each stub received',fixture:'fixtures/uxwave/'+TAG+'-session.jsonl',engineEnvNames:Object.keys(ENV)};
  await mawsLaunch(TAG+'-session',{cwd:REPO,env:ENV,flags:['--debug-file',dbg],provenance:{probe:'U11 connector scopes, third pass',case:'expansion'}},async p=>{
   const s=await settled(p);row.statusSeq=s.seq;
   row.status=Object.fromEntries((s.raw?.response?.mcpServers??[]).filter(x=>mine(x.name)).map(x=>[x.name,{status:x.status,scope:x.scope,tools:(x.tools??[]).map(t=>t.name),error:x.error?anon(String(x.error)).slice(0,300):undefined,fields:Object.keys(x).sort()}]));
   await delay(1500);
  });
  // What each remote stub received: the first request carrying each of the probe's headers, per server.
  row.remote={};
  for(const [name,scope] of ENTRIES().map(([n,s])=>[n,s]).filter(([n])=>/http|sse/.test(n))){
   const rs=reqs.filter(r=>r.server===name);const first=rs[0];
   if(!first){row.remote[name]={requests:0};continue;}
   const pathSeg=first.path.split('/').slice(3).join('/');
   const v={requests:rs.length,methods:[...new Set(rs.map(r=>`${r.method}${r.rpc?' '+r.rpc:''}`))]};
   if(/unset/.test(name)){v.path=pathSeg;v.query=first.query;v.xUnset=first.headers['x-unset']===undefined?'absent':first.headers['x-unset']===''?'empty':/\$\{/.test(first.headers['x-unset'])?'literal':'other';}
   else{v.pathSegment=classOf(pathSeg,'QUAY_SEG');v.query={region:classOf(first.query.region,'QUAY_REGION'),tickets:classOf(first.query.tickets,'QUAY_TICKETS_TOKEN'),fb:classOf(first.query.fb)};
    v.headers=Object.fromEntries(NAMES.map(n=>[n,classOf(first.headers[H(n)],n)]));v.headers.fallback=classOf(first.headers['x-fallback']);
    v.sameOnEveryRequest=rs.every(r=>JSON.stringify(Object.fromEntries(NAMES.map(n=>[n,r.headers[H(n)]])))===JSON.stringify(Object.fromEntries(NAMES.map(n=>[n,first.headers[H(n)]]))));}
   row.remote[name]=v;
  }
  // What each stdio stub saw.
  const log=existsSync(STDIO_LOG)?readFileSync(STDIO_LOG,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
  row.stdio={};
  for(const e of log){
   const a=e.argv, kv=Object.fromEntries(a.slice(2).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
   const v={starts:log.filter(x=>x.name===e.name).length,command:e.execPath===join(NODE_DIR,'node')||e.execPath===process.execPath?'set (ran as <node-dir>/node)':anon(e.execPath)};
   if(/unset/.test(e.name)){v.argUnset=kv.unset===undefined?'absent':kv.unset===''?'empty':/\$\{/.test(kv.unset)?'literal':'other';v.envUnset=e.env.V_UNSET===undefined?'absent':e.env.V_UNSET===''?'empty':/\$\{/.test(e.env.V_UNSET)?'literal':'other';}
   else if(e.name.startsWith('x3-stdio')){v.args={region:classOf(kv.region,'QUAY_REGION'),tickets:classOf(kv.tickets,'QUAY_TICKETS_TOKEN'),gh:classOf(kv.gh,'GITHUB_TOKEN'),fb:classOf(kv.fb)};
    v.envField=Object.fromEntries(NAMES.map(n=>[n,classOf(e.env['V_'+n],n)]));v.envField.fallback=classOf(e.env.V_FALLBACK);}
   v.inherited=Object.fromEntries(NAMES.map(n=>[n,classOf(e.env[n],n)]));
   row.stdio[e.name]=v;
  }
  // Where a person could be told: the wire, stderr and the debug file.
  const J=readFileSync(journal,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
  const tell=/credential variable|never expanded|read as empty|QUAY_UNSET|environment variable|Missing environment|not set/i;
  row.wire=J.filter(r=>r.direction==='in'&&tell.test(JSON.stringify(r.frame))).map(r=>({seq:r.seq,type:r.frame.type,subtype:r.frame.subtype??r.frame.response?.subtype,text:scrubValues(anon(JSON.stringify(r.frame))).match(/.{0,120}(credential variable|never expanded|read as empty|QUAY_UNSET|environment variable|Missing environment|not set).{0,160}/i)?.[0]}));
  row.stderr=J.filter(r=>r.direction==='stderr').map(r=>scrubValues(anon(r.frame?.text??'')).slice(0,400));
  const D=existsSync(dbg)?readFileSync(dbg,'utf8').split('\n'):[];
  row.debug={lines:D.length,matched:[...new Set(D.filter(l=>tell.test(l)&&!/CA certs/.test(l)).map(l=>scrubValues(anon(l.replace(/^\S+\s+/,''))).slice(0,500)))].slice(0,60)};
  if(existsSync(dbg))rmSync(dbg);
  keep(row);
 }finally{
  stub.close();
  trimJournal(journal);
  writeFileSync(FIXTURES+TAG+'.ndjson',redact(record.join('\n'))+'\n');
  console.log(TAG,FIXTURES+TAG+'.ndjson');
 }
};
