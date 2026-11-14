// UX wave U11, connector scopes, second pass: the checks 1, 2, 3, 4, 5, 9 and 11 of the draft section "Probes and
// checks" (U11-connector-scopes.md), on engine 2.1.322. Run as
//   ./vm-run.sh --prefix <p> run run-pass3.mjs uxwave-u11-connector-scopes-2      (UXW_CASES=a,b to run some cases)
// Built on uxwave-u11-connector-scopes.mjs (the first pass): the same six invented servers, one change. The plugin's
// stdio server now runs a copy of the stub inside the plugin, `node ${CLAUDE_PLUGIN_ROOT}/srv.mjs cs-pserver`, so an
// allow entry by command can be tried both with the variable and with the folder the engine expands it to.
//   cs-proj (the repository's .mcp.json), cs-user and cs-oauth (`claude mcp add --scope user`, stdio and HTTP),
//   cs-local (`--scope local`), plugin:cs-plug:cs-pserver and plugin:cs-plug:cs-poauth (plugin cs-plug, user scope).
// The HTTP stub accepts only the token seeded in the scratch credential store (as a completed sign-in leaves one) and
// counts every request with its time; the stdio stub appends one line per start, per JSON-RPC method, per signal and
// per stdin close to a log, so a case can say whether, when and how long a server ran. Folders: the scratch repository (root), a linked
// worktree of it beside it (`git worktree add`), and a subfolder `sub`. Every session is MAWS's launch
// (uxwave-common-arrivals.mjs mawsLaunch). Only the toggle cases with a turn call a model (haiku, one word).
// Cases, by check:
//   1  allow-*        allowedMcpServers in the user settings (or --settings, or a linked worktree) by plugin engine
//                     name, bare name, serverCommand and serverUrl; the engine's debug log is searched for its warning
//   2  toggle-*       mcp_toggle off then on for each of the six in one session; on for each from `disabled`
//   3  early-*        mcp_toggle off for all six right after initialize, before and after the first mcp_status
//   4  two-live       two live sessions in the root; each sent its own toggles
//   5  place-live     live sessions in the worktree and the subfolder while the root's session switches; then new ones
//   9  add-json       `claude mcp add-json` for http, sse and stdio at user, local and project scope; refused names
//   11 term-*         a terminal session (the interactive engine under tmux) typing /mcp disable and /mcp enable, in the
//                     root, in the worktree, and from a list that already holds two names
// Written: the journals fixtures/uxwave/<tag>-<case>[-<step>].jsonl (trimmed: stream events dropped, long arrays
// reduced to their count and the probe's own names) and the record fixtures/uxwave/<tag>.ndjson (one case a line).
import {mawsLaunch,turn,delay,BIN,ENGINE_VERSION,FIXTURES,sys,rowsOf} from './uxwave-common-arrivals.mjs';
import {redact} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,appendFileSync,readdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {join,dirname} from 'node:path';

const TAG=process.env.UXW_TAG||'u11-connector-scope2';
const ROOT=process.env.PROBE_ROOT, HOME=process.env.HOME, REPO=process.env.PROBE_WORK;
const WT=join(ROOT,'worktree'), SUB=join(REPO,'sub');
const GLOBAL=join(HOME,'.claude.json'), USER_SETTINGS=join(HOME,'.claude/settings.json'), CREDS=join(HOME,'.claude/.credentials.json');
const PROJECT_SETTINGS=join(REPO,'.claude/settings.json'), LOCAL_SETTINGS=join(REPO,'.claude/settings.local.json'), WT_LOCAL=join(WT,'.claude/settings.local.json');
const MCPJSON=join(REPO,'.mcp.json'), AUTH_CACHE=join(HOME,'.claude/mcp-needs-auth-cache.json');
const MARKET=join(ROOT,'cs-market'), SERVER=join(ROOT,'cs-mcp.mjs'), STDIO_LOG=join(ROOT,'stdio-log.ndjson');
const PLUGIN='cs-plug@cs-market', P_STDIO='plugin:cs-plug:cs-pserver', P_HTTP='plugin:cs-plug:cs-poauth';
const NAMES=['cs-proj','cs-user','cs-oauth','cs-local',P_STDIO,P_HTTP];
let INSTALL='';
let REPORTED={};  // each server's config as allow-none's mcp_status reports it (the engine's expansion of the plugin's)   // the plugin's installed folder, read from installed_plugins.json after install
const anonStr=s=>{if(typeof s!=='string')return s;if(INSTALL)s=s.split(INSTALL).join('<plugin-install>');return s.split(WT).join('<worktree>').split(SUB).join('<root>/sub').split(HOME).join('<home>').split(REPO).join('<root>').split(ROOT).join('<scratch>');};
let BASE='';
const anon=s=>{s=anonStr(s);return BASE&&typeof s==='string'?s.split(BASE).join('<base>'):s;};
const deep=v=>v===undefined?v:JSON.parse(anon(JSON.stringify(v)));
const readJson=f=>existsSync(f)?JSON.parse(readFileSync(f,'utf8')):undefined;
const writeJson=(f,v)=>{mkdirSync(dirname(f),{recursive:true});writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const edit=(f,fn)=>writeJson(f,fn(readJson(f)??{}));
const cli=(args,cwd=REPO)=>{try{return {cmd:anon(args.join(' ')),ok:true,out:anon(execFileSync(BIN,args,{cwd,encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim())};}catch(e){return {cmd:anon(args.join(' ')),ok:false,code:e.status??null,out:anon(String(e.stdout??'')+String(e.stderr??'')).trim()};}};
const git=(...a)=>execFileSync('git',['-c','user.name=Probe','-c','user.email=probe@localhost',...a],{cwd:REPO,encoding:'utf8'});

const SERVER_JS=`import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs';
const name=process.argv[2], log=ev=>appendFileSync(${JSON.stringify(STDIO_LOG)},JSON.stringify({t:Date.now(),name,pid:process.pid,ev})+'\\n');
const out=m=>process.stdout.write(JSON.stringify(m)+'\\n');log('start');
const rl=createInterface({input:process.stdin});rl.on('close',()=>{log('stdin-closed');process.exit(0);});
for(const sig of ['SIGTERM','SIGINT','SIGHUP'])process.on(sig,()=>{log(sig);process.exit(0);});
rl.on('line',l=>{let m;try{m=JSON.parse(l);}catch{return;}if(m.method)log(m.method);
 if(m.method==='initialize')out({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name,version:'0.0.1'}}});
 else if(m.method==='tools/list')out({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}});
 else if(m.method==='tools/call')out({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'pong'}]}});
 else if(m.id!==undefined)out({jsonrpc:'2.0',id:m.id,result:{}});});
`;
const stdioLog=()=>existsSync(STDIO_LOG)?readFileSync(STDIO_LOG,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];

// The HTTP stub. /mcp/<name>: streamable HTTP behind the seeded token (401 with RFC 9728 metadata otherwise).
// /open/<name>: streamable HTTP with no sign-in. /sse/<name>: the legacy SSE transport with no sign-in.
let TOKENS={};
const hits=[];
const rpcAnswer=(rpc,name)=>rpc.method==='initialize'?{jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:rpc.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name,version:'0.0.1'}}}
 :rpc.method==='tools/list'?{jsonrpc:'2.0',id:rpc.id,result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}}:{jsonrpc:'2.0',id:rpc.id,result:{}};
const sseStreams=new Map();
function httpStub(){
 const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const u=new URL(req.url,'http://x'), path=u.pathname, json=(code,v,h={})=>{res.writeHead(code,{'content-type':'application/json',...h});res.end(JSON.stringify(v));};
  const auth=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  let rpc=null;try{rpc=JSON.parse(body||'null');}catch{}
  const which=Object.entries(TOKENS).find(([,t])=>t===auth)?.[0]??(auth?'unknown':'none');
  hits.push({t:Date.now(),method:req.method,path,token:which,rpc:rpc?.method??null,probeHeader:req.headers['x-probe']??null});
  let m=path.match(/^\/mcp\/([a-z-]+)$/);
  if(m){
   const name=m[1];
   if(!Object.entries(TOKENS).some(([k,t])=>k.startsWith(name+'/')&&t===auth))return json(401,{error:'invalid_token'},{'www-authenticate':`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp/${name}"`});
   if(req.method!=='POST'){res.writeHead(405);return res.end();}
   if(!rpc||rpc.id===undefined){res.writeHead(202);return res.end();}
   return json(200,rpcAnswer(rpc,name));
  }
  m=path.match(/^\/open\/([a-z0-9-]+)$/);
  if(m){if(req.method!=='POST'){res.writeHead(405);return res.end();}if(!rpc||rpc.id===undefined){res.writeHead(202);return res.end();}return json(200,rpcAnswer(rpc,m[1]));}
  m=path.match(/^\/sse\/([a-z0-9-]+)$/);
  if(m&&req.method==='GET'){const sid=randomUUID();res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive'});res.write(`event: endpoint\ndata: /sse/${m[1]}/messages?sid=${sid}\n\n`);sseStreams.set(sid,res);res.on('close',()=>sseStreams.delete(sid));return;}
  m=path.match(/^\/sse\/([a-z0-9-]+)\/messages$/);
  if(m&&req.method==='POST'){const s=sseStreams.get(u.searchParams.get('sid'));res.writeHead(s?202:404);res.end();if(s&&rpc&&rpc.id!==undefined)s.write(`event: message\ndata: ${JSON.stringify(rpcAnswer(rpc,m[1]))}\n\n`);return;}
  const pr=path.match(/^\/.well-known\/oauth-protected-resource\/mcp\/([a-z-]+)$/);
  if(pr)return json(200,{resource:`${BASE}/mcp/${pr[1]}`,authorization_servers:[BASE]});
  if(path==='/.well-known/oauth-authorization-server')return json(200,{issuer:BASE,authorization_endpoint:`${BASE}/authorize`,token_endpoint:`${BASE}/token`,registration_endpoint:`${BASE}/register`,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
  json(404,{error:'not_found'});
 });});
 return new Promise(r=>server.listen(0,'127.0.0.1',()=>{BASE=`http://127.0.0.1:${server.address().port}`;r(server);}));
}
const url=bare=>`${BASE}/mcp/${bare}`;
const keyOf=(name,cfg)=>name+'|'+createHash('sha256').update(JSON.stringify({type:cfg.type,url:cfg.url,headers:cfg.headers||{}})).digest('hex').slice(0,16);
function seedCredentials(){
 const store={mcpOAuth:{}};
 for(const [name,bare] of [['cs-oauth','cs-oauth'],[P_HTTP,'cs-poauth']]){
  const cfg={type:'http',url:url(bare)}, token=`probe-invented-${bare}`;TOKENS[`${bare}/ordered`]=token;
  store.mcpOAuth[keyOf(name,cfg)]={serverName:name,serverUrl:cfg.url,accessToken:token,refreshToken:`probe-invented-refresh-${bare}`,expiresAt:Date.now()+7*86400000,scope:''};
 }
 writeJson(CREDS,store);
}

const setupSteps=[];
function setup(){
 writeFileSync(SERVER,SERVER_JS);
 writeJson(MCPJSON,{mcpServers:{'cs-proj':{type:'stdio',command:'node',args:[SERVER,'cs-proj']}}});
 mkdirSync(SUB,{recursive:true});writeFileSync(join(SUB,'note.txt'),'sub\n');
 git('add','.');git('commit','-qm','mcp and sub');
 git('worktree','add','-q','-b','cs2-wt',WT);
 writeJson(join(MARKET,'.claude-plugin/marketplace.json'),{name:'cs-market',owner:{name:'Probe'},plugins:[{name:'cs-plug',source:'./cs-plug',description:'Invented probe plugin'}]});
 writeJson(join(MARKET,'cs-plug/.claude-plugin/plugin.json'),{name:'cs-plug',version:'0.0.1',description:'Invented probe plugin'});
 writeFileSync(join(MARKET,'cs-plug/srv.mjs'),SERVER_JS);
 writeJson(join(MARKET,'cs-plug/.mcp.json'),{mcpServers:{'cs-pserver':{command:'node',args:['${CLAUDE_PLUGIN_ROOT}/srv.mjs','cs-pserver']},'cs-poauth':{type:'http',url:url('cs-poauth')}}});
 const step=(...a)=>setupSteps.push(cli(a));
 step('mcp','add','--scope','user','cs-user','--','node',SERVER,'cs-user');
 step('mcp','add','--scope','user','--transport','http','cs-oauth',url('cs-oauth'));
 step('mcp','add','--scope','local','cs-local','--','node',SERVER,'cs-local');
 step('plugin','marketplace','add',MARKET);
 step('plugin','install',PLUGIN);
 const inst=readJson(join(HOME,'.claude/plugins/installed_plugins.json'));
 INSTALL=inst?.plugins?.[PLUGIN]?.[0]?.installPath??'';
 edit(USER_SETTINGS,us=>({...us,enableAllProjectMcpServers:true}));
 // The worktree and its subfolder are trusted as the root is (a terminal session there would otherwise ask).
 edit(GLOBAL,d=>({...d,projects:{...d.projects,[WT]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true},[SUB]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}}));
 seedCredentials();
}

const FILES={global:GLOBAL,user:USER_SETTINGS,project:PROJECT_SETTINGS,local:LOCAL_SETTINGS,wtLocal:WT_LOCAL,creds:CREDS,authCache:AUTH_CACHE,mcpjson:MCPJSON};
let BASELINE={};
const snapshot=()=>Object.fromEntries(Object.entries(FILES).map(([k,f])=>[k,existsSync(f)?readFileSync(f,'utf8'):null]));
function restore(keys=Object.keys(FILES)){for(const k of keys){const f=FILES[k];if(BASELINE[k]===null){if(existsSync(f))rmSync(f);}else{mkdirSync(dirname(f),{recursive:true});writeFileSync(f,BASELINE[k]);}}}

// What the engine holds in .claude.json for each place: the disabled list and the servers defined there.
const places=()=>{const d=readJson(GLOBAL)??{};return deep(Object.fromEntries(Object.entries(d.projects??{}).filter(([,v])=>v.disabledMcpServers||v.enabledMcpServers||Object.keys(v.mcpServers??{}).length).map(([k,v])=>[k,{disabledMcpServers:v.disabledMcpServers,enabledMcpServers:v.enabledMcpServers,mcpServers:v.mcpServers?Object.keys(v.mcpServers):undefined}])));};
const listNow=(key='<root>')=>places()[key]?.disabledMcpServers??null;
const mine=n=>typeof n==='string'&&/cs-|aj-/.test(n);
const statusOf=r=>r?.error?{error:r.error}:Object.fromEntries((r?.response?.mcpServers??[]).filter(s=>mine(s.name)).map(s=>[s.name,`${s.status}${s.scope?' '+s.scope:''}${(s.tools??[]).length?' tools:'+s.tools.map(t=>t.name).join(','):''}${s.error?' error:'+anon(String(s.error)).slice(0,160):''}`]));
const configsOf=r=>Object.fromEntries((r?.response?.mcpServers??[]).filter(s=>mine(s.name)).map(s=>[s.name,s.config??null]));
const cmdOf=n=>{const c=REPORTED[n];if(!c?.command)throw new Error('no reported command for '+n+' (run allow-none first)');return [c.command,...(c.args??[])];};
async function status(p){const r=await p.request('mcp_status',{},15000).catch(e=>({error:e.message}));return {seq:p.seq,servers:statusOf(r)};}
async function settled(p,bound=45000){
 const t0=Date.now();
 for(;;){const r=await p.request('mcp_status',{},15000).catch(e=>({error:e.message}));
  const all=r?.response?.mcpServers??[], cs=all.filter(s=>mine(s.name));
  if(all.length&&all.every(s=>s.status!=='pending')&&(cs.length>0||Date.now()-t0>8000)||Date.now()-t0>bound)return {seq:p.seq,servers:statusOf(r)};
  await delay(1500);}
}
async function toggle(p,serverName,enabled){
 const sent=Date.now();const r=await p.request('mcp_toggle',{serverName,enabled},30000).catch(e=>({subtype:'timeout',error:e.message}));
 return {server:serverName,enabled,seq:p.seq,subtype:r.subtype??null,error:r.error?anon(String(r.error)):null,response:deep(r.response),ms:Date.now()-sent,sent};
}
const hitsView=(from=0,to=Infinity)=>{const o={};for(const x of hits.filter(h=>h.t>=from&&h.t<=to)){const k=`${x.path} ${x.method}${x.rpc?' '+x.rpc:''} via ${x.token}`;o[k]=(o[k]??0)+1;}return o;};
const stdioView=(from=0,to=Infinity)=>{const o={};for(const x of stdioLog().filter(e=>e.t>=from&&e.t<=to)){o[x.name]=[...(o[x.name]??[]),x.ev];}return o;};
const initOf=p=>{const init=p.frames.find(r=>sys(r.frame,'init'));return init?{seq:init.seq,mcp_servers:(init.frame.mcp_servers??[]).filter(s=>mine(s.name)).map(s=>`${s.name} ${s.status}`),tools:(init.frame.tools??[]).filter(mine),toolCount:(init.frame.tools??[]).length}:null;};
function deferredOf(transcript){
 return rowsOf(transcript).filter(x=>x.row.type==='attachment'&&x.row.attachment?.type==='deferred_tools_delta').map(({line,row:r})=>{const a=r.attachment;return {line,addedNames:(a.addedNames??[]).filter(mine),addedCount:(a.addedNames??[]).length,removedNames:(a.removedNames??[]).filter(mine),pendingMcpServers:a.pendingMcpServers,needsAuthMcpServers:a.needsAuthMcpServers,failedMcpServers:a.failedMcpServers};});
}

// Journals are trimmed after each session: stream events go (no statement here reads them), and an array longer than
// 24 items (the command, skill, agent and model lists of initialize's answer, init's tools) keeps its count and the
// probe's own items. Every other row keeps its seq, so a citation's line number is the seq it names.
function shrink(v){
 if(Array.isArray(v)){if(v.length>24){const kept=v.filter(x=>/cs-|aj-|mcp__/.test(JSON.stringify(x)));return {trimmedArray:v.length,kept:kept.map(shrink)};}return v.map(shrink);}
 if(v&&typeof v==='object'){const o={};for(const [k,x] of Object.entries(v))o[k]=shrink(x);return o;}
 if(typeof v==='string'&&v.length>4000)return v.slice(0,600)+`…[${v.length} chars]`;
 return v;
}
const PROBE_RE=/cs-|aj-|mcp_toggle|mcp_status|mcpServers|disabledMcp/;
function slim(frame){
 const s=JSON.stringify(frame);
 if(s.length>4000&&!PROBE_RE.test(s)){
  if(frame.type==='control_response'&&frame.response&&typeof frame.response==='object'){const inner=frame.response.response;return {...frame,response:{...frame.response,response:inner&&typeof inner==='object'?{trimmedBytes:JSON.stringify(inner).length,keys:Object.keys(inner)}:inner}};}
  if(frame.type==='control_request'&&frame.request&&typeof frame.request==='object')return {...frame,request:{subtype:frame.request.subtype,trimmedBytes:JSON.stringify(frame.request).length}};
 }
 return shrink(frame);
}
function trimJournal(file){
 if(!existsSync(file))return;
 const rows=readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(r=>r.frame?.type!=='stream_event');
 writeFileSync(file,rows.map(r=>redact(anon(JSON.stringify({...r,frame:slim(r.frame)})))).join('\n')+'\n');
}
const journals=[];
async function launch(step,opts,body){
 const name=TAG+'-'+step;journals.push(FIXTURES+name+'.jsonl');
 const L=await mawsLaunch(name,{cwd:REPO,provenance:{probe:'U11 connector scopes, second pass',case:step},...opts},body);
 return L;
}
function debugLines(file){
 if(!existsSync(file))return {missing:true};
 const lines=readFileSync(file,'utf8').split('\n');
 const pick=re=>[...new Set(lines.filter(l=>re.test(l)&&!/CA certs/.test(l)).map(l=>anon(l.replace(/^\S+\s+/,'')).slice(0,400)))];
 rmSync(file);
 return {lines:lines.length,settings:pick(/Invalid entry|Invalid setting|allowedMcpServers|deniedMcpServers|policy|allowlist|allow list/i).slice(0,20),mcp:pick(/MCP|mcp/).filter(l=>/cs-|plugin:|allow|block|polic|skip/i.test(l)).slice(0,40)};
}

const record=[];
const keep=row=>{const r=deep(row);record.push(r);console.log(JSON.stringify(r).slice(0,1500));};
const settingsView=()=>deep(Object.fromEntries(Object.entries({user:USER_SETTINGS,project:PROJECT_SETTINGS,local:LOCAL_SETTINGS,wtLocal:WT_LOCAL}).filter(([,f])=>existsSync(f)).map(([k,f])=>[k,readJson(f)])));

// Check 1: the allow list.
const sN=n=>({serverName:n});
const ALLOW=[
 {name:'allow-none',what:'control: no allow list; mcp_status with each server\'s config as the engine reports it (what ${CLAUDE_PLUGIN_ROOT} expands to)',configs:true},
 {name:'allow-pname-only',what:'user allowedMcpServers naming only the plugin servers by engine name (plugin:cs-plug:...)',user:()=>[sN(P_STDIO),sN(P_HTTP)]},
 {name:'allow-pname',what:'user allowedMcpServers: the plugin servers by engine name, and cs-user (a valid name, the control)',user:()=>[sN(P_STDIO),sN(P_HTTP),sN('cs-user')]},
 {name:'allow-bare',what:'user allowedMcpServers: the plugin servers by bare name (cs-pserver, cs-poauth), and cs-user',user:()=>[sN('cs-pserver'),sN('cs-poauth'),sN('cs-user')]},
 {name:'allow-cmd',what:'user allowedMcpServers: serverCommand for cs-pserver as allow-none\'s mcp_status reports its command (the engine\'s expansion of ${CLAUDE_PLUGIN_ROOT}); serverName cs-user (stdio) and cs-oauth (http)',user:()=>[{serverCommand:cmdOf(P_STDIO)},sN('cs-user'),sN('cs-oauth')]},
 {name:'allow-cmd-install',what:'user allowedMcpServers: serverCommand for cs-pserver with the plugin\'s installed folder (installed_plugins.json installPath) in place of ${CLAUDE_PLUGIN_ROOT}; serverName cs-user',user:()=>[{serverCommand:['node',INSTALL+'/srv.mjs','cs-pserver']},sN('cs-user')]},
 {name:'allow-cmd-var',what:'user allowedMcpServers: serverCommand for cs-pserver as its .mcp.json spells it (${CLAUDE_PLUGIN_ROOT}); serverName cs-user',user:()=>[{serverCommand:['node','${CLAUDE_PLUGIN_ROOT}/srv.mjs','cs-pserver']},sN('cs-user')]},
 {name:'allow-url',what:'user allowedMcpServers: serverUrl for cs-poauth; serverName cs-oauth (http) and cs-user (stdio)',user:()=>[{serverUrl:url('cs-poauth')},sN('cs-oauth'),sN('cs-user')]},
 {name:'allow-address-all',what:'user allowedMcpServers by address only: serverCommand for each of the four stdio servers (as mcp_status reports them), serverUrl for both HTTP servers',user:()=>[...['cs-proj','cs-user','cs-local',P_STDIO].map(n=>({serverCommand:cmdOf(n)})),{serverUrl:url('cs-oauth')},{serverUrl:url('cs-poauth')}]},
 {name:'allow-flag',what:'allowedMcpServers [cs-user] in --settings alone',flag:()=>[sN('cs-user')]},
 {name:'allow-worktree',what:'a session in the linked worktree: user allowedMcpServers [cs-user]; the worktree\'s own .claude/settings.local.json [cs-oauth]',cwd:WT,user:()=>[sN('cs-user')],wtLocal:()=>[sN('cs-oauth')]},
 {name:'allow-worktree-rootlocal',what:'a session in the linked worktree: user allowedMcpServers [cs-user]; the main root\'s .claude/settings.local.json [cs-proj] (the worktree has none)',cwd:WT,user:()=>[sN('cs-user')],local:()=>[sN('cs-proj')]},
];
async function allowCase(c){
 restore();
 if(c.user)edit(USER_SETTINGS,s=>({...s,allowedMcpServers:c.user()}));
 if(c.local)edit(LOCAL_SETTINGS,s=>({...s,allowedMcpServers:c.local()}));
 if(c.wtLocal)edit(WT_LOCAL,s=>({...s,allowedMcpServers:c.wtLocal()}));
 const dbg=join(ROOT,`debug-${c.name}.log`);
 const flags=['--debug-file',dbg,...(c.flag?['--settings',JSON.stringify({dialogExpiry:'never',allowedMcpServers:c.flag()})]:[])];
 const row={case:c.name,check:1,what:c.what,cwd:c.cwd??REPO,settings:settingsView(),flagSettings:c.flag?c.flag():undefined,fixture:'fixtures/uxwave/'+TAG+'-'+c.name+'.jsonl'};
 const t0=Date.now();
 await launch(c.name,{cwd:c.cwd??REPO,flags},async p=>{row.status=await settled(p);if(c.configs){row.configs=configsOf(await p.request('mcp_status',{},15000));REPORTED=row.configs;}});
 row.hits=hitsView(t0);row.stdio=stdioView(t0);
 row.debug=debugLines(dbg);
 const J=FIXTURES+TAG+'-'+c.name+'.jsonl';
 row.stderr=existsSync(J)?readFileSync(J,'utf8').split('\n').filter(l=>/"stderr"/.test(l)).map(l=>anon(JSON.parse(l).frame?.text??'').slice(0,300)).slice(0,10):[];
 row.wireWarnings=existsSync(J)?readFileSync(J,'utf8').split('\n').filter(l=>/Invalid entry|allowedMcpServers/.test(l)).map(l=>{const r=JSON.parse(l);return {seq:r.seq,type:r.frame?.type,subtype:r.frame?.subtype};}):[];
 keep(row);
}

// Check 2: mcp_toggle both ways, each kind.
async function toggleCases(){
 restore();
 const row={case:'toggle-off-on',check:2,what:'one session in the root: for each of the six, mcp_toggle off, mcp_status, the place list; mcp_toggle on, mcp_status, the place list; then all six off, the session ends',fixture:'fixtures/uxwave/'+TAG+'-toggle-off-on.jsonl',steps:[]};
 const t0=Date.now();
 await launch('toggle-off-on',{},async p=>{
  row.atStart=await settled(p);
  for(const n of NAMES){
   const ta=Date.now();
   const off=await toggle(p,n,false);const lOff=listNow();const sOff=await status(p);
   await delay(1500);const lOff2=listNow();const tb=Date.now();
   const on=await toggle(p,n,true);const lOn=listNow();await delay(1500);const sOn=await status(p);const lOn2=listNow();
   await delay(500);const tc=Date.now();
   const bare=n.replace(/^plugin:cs-plug:/,'');
   row.steps.push({server:n,off:{...off,status:sOff.servers[n]??'absent',statusSeq:sOff.seq,listAtAnswer:lOff,listAfter1500ms:lOff2,stdio:stdioView(ta,tb)[bare],hits:hitsView(ta,tb)},on:{...on,status:sOn.servers[n]??'absent',statusSeq:sOn.seq,listAtAnswer:lOn,listAfter1500ms:lOn2,stdio:stdioView(tb,tc)[bare],hits:hitsView(tb,tc)}});
  }
  for(const n of NAMES)await toggle(p,n,false);
  row.allOff=await status(p);
 });
 row.listAfterEnd=places();row.hits=hitsView(t0);
 keep(row);

 // The second session starts with all six disabled (written by the first's toggles) and switches each on.
 const r2={case:'toggle-on-from-disabled',check:2,what:'a new session in the root, the place list holding all six (written by toggle-off-on): mcp_toggle on for each, mcp_status, the place list; then one turn: init tools and deferred names',fixture:'fixtures/uxwave/'+TAG+'-toggle-on-from-disabled.jsonl',listBefore:places(),steps:[]};
 const t1=Date.now();
 const L=await launch('toggle-on-from-disabled',{},async p=>{
  r2.atStart=await settled(p);r2.hitsAtStart=hitsView(t1);r2.stdioAtStart=stdioView(t1);
  for(const n of NAMES){const ta=Date.now();const on=await toggle(p,n,true);const l0=listNow();await delay(1500);const s=await status(p);r2.steps.push({...on,status:s.servers[n]??'absent',statusSeq:s.seq,listAtAnswer:l0,listAfter1500ms:listNow(),hits:hitsView(ta),stdio:stdioView(ta)});}
  const t=await turn(p,'Reply with only the word ok');r2.result={seq:p.seq,subtype:t.result?.subtype??null,text:t.result?.result??null};
  r2.init=initOf(p);
 });
 r2.deferred=deferredOf(L.transcript);r2.listAfterEnd=places();
 keep(r2);
}

// Check 3: a toggle right after initialize.
async function earlyCase(name,afterStatus){
 restore();
 const row={case:name,check:3,what:afterStatus?'mcp_toggle off for all six at the first mcp_status answer (the draft\'s rule), then one turn':'mcp_toggle off for all six as the first request after initialize (before any mcp_status), then one turn',fixture:'fixtures/uxwave/'+TAG+'-'+name+'.jsonl'};
 const t0=Date.now();
 const L=await launch(name,{},async p=>{
  row.bodyStartMs=Date.now()-t0;
  if(afterStatus){const s=await status(p);row.firstStatus=s;}
  const tSend=Date.now();
  row.toggles=await Promise.all(NAMES.map(n=>toggle(p,n,false)));
  const tDone=Date.now();
  row.toggleWindow={sentAtMs:tSend-t0,lastAnswerAtMs:tDone-t0};
  row.hitsBeforeToggleAnswered=hitsView(t0,tDone);row.stdioBeforeToggleAnswered=stdioView(t0,tDone);
  row.afterToggle=await status(p);
  await delay(2000);
  const t=await turn(p,'Reply with only the word ok');row.result={seq:p.seq,subtype:t.result?.subtype??null,text:t.result?.result??null};
  row.init=initOf(p);
 });
 row.deferred=deferredOf(L.transcript);row.hitsAll=hitsView(t0);row.stdioAll=stdioView(t0);
 {const J=readFileSync(FIXTURES+TAG+'-'+name+'.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
  const out=J.find(r=>r.direction==='out'&&r.frame?.request?.subtype==='initialize'), id=out?.frame?.request_id, ans=J.find(r=>r.frame?.type==='control_response'&&r.frame.response?.request_id===id);
  const spawn=J.find(r=>r.direction==='meta'||r.seq===1);
  row.initialize={sentAtMs:out?Date.parse(out.at)-t0:null,seq:out?.seq,answeredAtMs:ans?Date.parse(ans.at)-t0:null,answerSeq:ans?.seq,firstRowAtMs:spawn?Date.parse(spawn.at)-t0:null};}
 row.stdioTimeline=stdioLog().filter(e=>e.t>=t0).map(e=>({ms:e.t-t0,name:e.name,ev:e.ev}));
 row.httpTimeline=hits.filter(h=>h.t>=t0).map(h=>({ms:h.t-t0,path:h.path,rpc:h.rpc,token:h.token,code:undefined}));
 row.listAfterEnd=places();
 keep(row);
}

// Check 4: two live sessions in one place.
async function twoLive(){
 restore();
 const row={case:'two-live',check:4,what:'sessions A and B live in the root at once; A switches cs-user off; B is sent its own off for cs-user; A switches cs-oauth off, then B switches cs-local off (does B\'s write keep A\'s); B switches cs-user on',fixture:['fixtures/uxwave/'+TAG+'-two-live-a.jsonl','fixtures/uxwave/'+TAG+'-two-live-b.jsonl'],steps:[]};
 const step=async(label,f)=>{const v=await f();const l0=listNow();await delay(1500);row.steps.push({step:label,...v,listAtAnswer:l0,listAfter1500ms:listNow()});};
 await launch('two-live-a',{},async a=>{
  row.aStart=await settled(a);
  await launch('two-live-b',{},async b=>{
   row.bStart=await settled(b);
   await step('A off cs-user',async()=>({toggle:await toggle(a,'cs-user',false)}));
   await step('B status after A\'s off',async()=>({status:(await status(b)).servers['cs-user']}));
   await step('B off cs-user',async()=>{const t=await toggle(b,'cs-user',false);const s=await status(b);return {toggle:t,status:s.servers['cs-user'],statusSeq:s.seq};});
   await step('A off cs-oauth',async()=>({toggle:await toggle(a,'cs-oauth',false)}));
   await step('B off cs-local',async()=>({toggle:await toggle(b,'cs-local',false)}));
   await step('B on cs-user',async()=>{const t=await toggle(b,'cs-user',true);await delay(1500);const s=await status(b);return {toggle:t,status:s.servers['cs-user'],statusSeq:s.seq};});
   await step('A status',async()=>{const s=await status(a);return {status:s.servers,statusSeq:s.seq};});
   await step('B status',async()=>{const s=await status(b);return {status:s.servers,statusSeq:s.seq};});
  });
  row.listAfterBEnded=places()['<root>']?.disabledMcpServers??null;
 });
 row.listAfterBothEnded=places();
 keep(row);
}

// Check 5: the worktree and the subfolder, live and new, after the root's session switched.
async function placeLive(){
 restore();
 const row={case:'place-live',check:5,what:'live sessions in the worktree (W) and the subfolder (S); the root\'s session (R) switches cs-user and plugin:cs-plug:cs-pserver off; W and S read their status; then new sessions in the worktree and the subfolder read theirs',fixture:['root','wt','sub','wt-new','sub-new'].map(s=>'fixtures/uxwave/'+TAG+'-place-'+s+'.jsonl')};
 await launch('place-wt',{cwd:WT},async w=>{
  row.wStart=await settled(w);
  await launch('place-sub',{cwd:SUB},async s=>{
   row.sStart=await settled(s);
   await launch('place-root',{cwd:REPO},async r=>{
    row.rStart=await settled(r);
    row.rToggles=[await toggle(r,'cs-user',false),await toggle(r,P_STDIO,false)];
    row.rAfter=await status(r);
   });
   row.listAfterRoot=places();
   row.wAfter=await status(w);row.sAfter=await status(s);
  });
 });
 await launch('place-wt-new',{cwd:WT},async w=>{row.wNew=await settled(w);});
 await launch('place-sub-new',{cwd:SUB},async s=>{row.sNew=await settled(s);});
 row.listAfterAll=places();
 keep(row);
}

// Check 9: claude mcp add-json.
async function addJson(){
 restore();
 const row={case:'add-json',check:9,what:'`claude mcp add-json <name> <json> --scope <s>` for an http, an sse and a stdio entry at user, local and project scope (cwd the root); then a session in the root reads mcp_status; then refused names and entries',fixture:'fixtures/uxwave/'+TAG+'-add-json.jsonl',adds:[]};
 const entry=(type,scope)=>{const n=`aj-${type}-${scope}`;return [n,type==='http'?{type:'http',url:`${BASE}/open/${n}`,headers:{'X-Probe':'invented'}}:type==='sse'?{type:'sse',url:`${BASE}/sse/${n}`,headers:{'X-Probe':'invented'}}:{type:'stdio',command:'node',args:[SERVER,n],env:{PROBE_VAR:'1'}}];};
 for(const scope of ['user','local','project'])for(const type of ['http','sse','stdio']){
  const [n,json]=entry(type,scope);const r=cli(['mcp','add-json',n,JSON.stringify(json),'--scope',scope]);
  const g=readJson(GLOBAL)??{}, mj=readJson(MCPJSON)??{};
  const written=scope==='user'?g.mcpServers?.[n]:scope==='local'?g.projects?.[REPO]?.mcpServers?.[n]:mj.mcpServers?.[n];
  row.adds.push({name:n,scope,type,given:json,answer:r,written:written??null,equal:JSON.stringify(written)===JSON.stringify(json)});
 }
 const t0=Date.now();
 await launch('add-json',{},async p=>{row.status=await settled(p,60000);});
 row.hits=hitsView(t0);row.stdio=stdioView(t0);
 const ok={type:'http',url:`${BASE}/open/aj-x`};
 row.refusals=[
  ['plugin:cs-plug:aj-x',ok,'user'],['claude.ai Probe',ok,'user'],['has space',ok,'user'],['dot.name',ok,'user'],['aj-http-user',ok,'user'],['aj-http-user',ok,'local'],
  ['aj-ws',{type:'ws',url:'ws://127.0.0.1:1/x'},'user'],['aj-notype',{url:`${BASE}/open/aj-notype`},'user'],['aj-badurl',{type:'http',url:'not a url'},'user'],
 ].map(([n,j,s])=>{const r=cli(['mcp','add-json',n,JSON.stringify(j),'--scope',s]);const g=readJson(GLOBAL)??{};return {name:n,scope:s,given:j,answer:r,writtenUser:g.mcpServers?.[n]??null,writtenLocal:g.projects?.[REPO]?.mcpServers?.[n]??null};});
 row.mcpGetCliHelp=cli(['mcp','add-json','--help']);
 keep(row);
}

// Check 11: the terminal's /mcp disable and /mcp enable.
async function termCase(name,cwd,commands,preset){
 restore();
 if(preset)edit(GLOBAL,d=>({...d,projects:{...d.projects,[REPO]:{...d.projects?.[REPO],disabledMcpServers:preset}}}));
 const row={case:name,check:11,what:`an interactive engine under tmux (TERM xterm-256color, --model haiku), cwd ${anon(cwd)}; typed: ${commands.join(' | ')}; the place lists read after each`,route:'terminal',steps:[]};
 const sock='cs2-'+process.pid+'-'+name;
 const tmux=(...a)=>execFileSync('tmux',['-L',sock,...a],{encoding:'utf8'});
 const pane=()=>tmux('capture-pane','-p','-t',sock);
 const type=async text=>{tmux('send-keys','-t',sock,'-l',text);await delay(800);tmux('send-keys','-t',sock,'Enter');};
 const until=async(test,timeout,step=1000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await test();if(v)return v;await delay(step);}return null;};
 const trim=s=>s.split('\n').map(l=>anon(l.trimEnd())).filter(Boolean);
 try{
  tmux('new-session','-d','-s',sock,'-x','160','-y','48','-c',cwd,'-e','TERM=xterm-256color',BIN,'--model','haiku');
  row.ready=!!await until(()=>/❯|for shortcuts|auto mode/.test(pane()),60000);await delay(6000);
  row.paneAtStart=trim(pane()).slice(-12);row.listAtStart=places();
  for(const c of commands){await type(c);await delay(5000);row.steps.push({typed:c,pane:trim(pane()).slice(-14),list:places()});tmux('send-keys','-t',sock,'Escape');await delay(800);}
 }catch(e){row.error=anon(e.message);try{row.pane=trim(pane());}catch{}}
 finally{try{tmux('send-keys','-t',sock,'C-c');await delay(500);tmux('send-keys','-t',sock,'C-c');await delay(2000);}catch{}try{tmux('kill-server');}catch{}}
 await delay(1500);
 row.listAfterExit=places();
 keep(row);
}

const want=n=>{const only=process.env.UXW_CASES?.split(',');return !only||only.includes(n);};
export default async()=>{
 if(!HOME?.startsWith('/tmp/'))throw new Error('HOME is not a scratch folder');
 mkdirSync(FIXTURES,{recursive:true});
 const stub=await httpStub();
 try{
  setup();
  BASELINE=snapshot();
  const g=readJson(GLOBAL);
  keep({case:'setup',engine:ENGINE_VERSION,steps:setupSteps,stub:'<base>/mcp/<name> (token), <base>/open/<name>, <base>/sse/<name>',pluginInstall:INSTALL?'<plugin-install>':'(not found)',pluginInstallShape:INSTALL.replace(HOME,'<home>').replace(/\/[^/]+$/,'/<version>'),pluginMcp:readJson(join(INSTALL,'.mcp.json')),topMcpServers:g.mcpServers,projectMcpServers:g.projects?.[REPO]?.mcpServers,userSettings:readJson(USER_SETTINGS),worktreeList:git('worktree','list','--porcelain')});
  for(const c of ALLOW)if(want(c.name))await allowCase(c);
  if(want('toggle'))await toggleCases();
  if(want('early-initialize'))await earlyCase('early-initialize',false);
  if(want('early-status'))await earlyCase('early-status',true);
  if(want('two-live'))await twoLive();
  if(want('place-live'))await placeLive();
  if(want('add-json'))await addJson();
  if(want('term-root'))await termCase('term-root',REPO,['/mcp disable cs-user','/mcp disable plugin:cs-plug:cs-pserver','/mcp enable cs-user']);
  if(want('term-worktree'))await termCase('term-worktree',WT,['/mcp disable cs-oauth']);
  if(want('term-from-disabled'))await termCase('term-from-disabled',REPO,['/mcp enable cs-user','/mcp enable plugin:cs-plug:cs-poauth'],['cs-user',P_HTTP]);
 }finally{
  stub.close();
  for(const j of journals)trimJournal(j);
  writeFileSync(FIXTURES+TAG+'.ndjson',redact(record.map(r=>anon(JSON.stringify(r))).join('\n'))+'\n');
  console.log(TAG,FIXTURES+TAG+'.ndjson');
 }
};
