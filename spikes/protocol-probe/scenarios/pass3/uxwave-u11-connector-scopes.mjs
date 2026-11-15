// UX wave U11, connector scopes: which setting or flag of engine 2.1.322 switches a connector (an MCP server) off for
// new sessions at user scope (every project) and at project scope (this project only), so that its tools are neither
// in the session's tool list nor among the deferred tool names tool search can load, while its sign-in is kept for
// when it is switched back on. Run as
//   ./vm-run.sh --prefix <p> run run-pass3.mjs uxwave-u11-connector-scopes      (UXW_CASES=a,b to run some cases)
// Built on uxwave-u11-connector-place.mjs (the stdio stub, MAWS's launch through uxwave-common-arrivals.mjs mawsLaunch).
// Six invented servers that every session in the scratch repository loads, one or two per kind:
//   cs-proj     the repository's committed .mcp.json (kind a), approved by `enableAllProjectMcpServers` in the user
//               settings file, as in the place probe
//   cs-user     `claude mcp add --scope user` (kind b): top-level `mcpServers` of $HOME/.claude.json
//   cs-oauth    `claude mcp add --scope user --transport http`: an OAuth-protected HTTP server served by this script
//   cs-local    `claude mcp add --scope local` (kind c): `projects[<root>].mcpServers` of $HOME/.claude.json
//   plugin:cs-plug:cs-pserver, plugin:cs-plug:cs-poauth   the plugin cs-plug of a local marketplace cs-market,
//               installed with the engine's own CLI (kind d); a stdio server and an OAuth-protected HTTP one
// Sign-in: the engine's credential store under the scratch HOME ($HOME/.claude/.credentials.json, key `mcpOAuth`) is
// seeded with an access token for each HTTP server, as a completed sign-in leaves one; the HTTP stub accepts only
// that token and answers 401 (with RFC 9728 metadata) otherwise, so `connected` means the stored sign-in was used and
// `needs-auth` that a new sign-in would be asked for. The entry's key is `<name>|<sha256 of {type,url,headers}>[:16]`
// (cli.pretty.js Ea, ~550404); two encodings of that object are seeded, each with its own token, and the stub records
// which token arrived.
// Per case: every file is restored to the baseline, the case's switch is applied, and a session (MAWS's launch, cwd
// the repository root) reads mcp_status once no cs-* server is pending, then sends one one-word prompt to the cheapest
// model so `system/init` (mcp_servers, tools) is sent and the transcript's `deferred_tools_delta` attachment (the
// names tool search can load) is written. Then the switch is undone (the configuration files restored; the credential
// store left as the case left it) and a second session reads mcp_status with no prompt: whether the servers come back
// and the HTTP ones connect with the stored sign-in. Written: the journals fixtures/uxwave/<tag>-<case>{,-then-on}.jsonl,
// the transcripts <tag>-<case>.transcript.jsonl, and the record fixtures/uxwave/<tag>.ndjson (one case a line).
import {mawsLaunch,turn,delay,BIN,ENGINE_VERSION,FIXTURES,sys,rowsOf,keepTranscript} from './uxwave-common-arrivals.mjs';
import {redact} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';

const TAG=process.env.UXW_TAG||'u11-connector-scope';
const ROOT=process.env.PROBE_ROOT, HOME=process.env.HOME, REPO=process.env.PROBE_WORK;
const GLOBAL=join(HOME,'.claude.json'), USER_SETTINGS=join(HOME,'.claude/settings.json'), CREDS=join(HOME,'.claude/.credentials.json');
const PROJECT_SETTINGS=join(REPO,'.claude/settings.json'), LOCAL_SETTINGS=join(REPO,'.claude/settings.local.json');
const MARKET=join(ROOT,'cs-market'), SERVER=join(ROOT,'cs-mcp.mjs');
const PLUGIN='cs-plug@cs-market';
const P_STDIO='plugin:cs-plug:cs-pserver', P_HTTP='plugin:cs-plug:cs-poauth';
const NAMES=['cs-proj','cs-user','cs-oauth','cs-local',P_STDIO,P_HTTP];
const BARE=['cs-proj','cs-user','cs-oauth','cs-local','cs-pserver','cs-poauth'];
const TOOL_PREFIX=n=>'mcp__'+n.replace(/[^A-Za-z0-9_-]/g,'_')+'__';
const PERM_RULES=NAMES.map(n=>TOOL_PREFIX(n).slice(0,-2));
const anon=s=>typeof s==='string'?s.split(HOME).join('<home>').split(REPO).join('<root>').split(ROOT).join('<scratch>'):s;
const deep=v=>JSON.parse(anon(JSON.stringify(v)));
const readJson=f=>existsSync(f)?JSON.parse(readFileSync(f,'utf8')):undefined;
const writeJson=(f,v)=>{mkdirSync(dirname(f),{recursive:true});writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const cli=(...a)=>{try{return {ok:true,out:anon(execFileSync(BIN,a,{cwd:REPO,encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim())};}catch(e){return {ok:false,out:anon(String(e.stdout??'')+String(e.stderr??'')).trim()};}};

const SERVER_JS=`import {createInterface} from 'node:readline';
const out=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',l=>{let m;try{m=JSON.parse(l);}catch{return;}
 if(m.method==='initialize')out({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:process.argv[2],version:'0.0.1'}}});
 else if(m.method==='tools/list')out({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}});
 else if(m.method==='tools/call')out({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'pong'}]}});
 else if(m.id!==undefined)out({jsonrpc:'2.0',id:m.id,result:{}});});
`;

// The OAuth-protected HTTP stub: /mcp/<name> answers JSON-RPC to a request bearing that server's seeded token, 401
// otherwise. Every request is counted with which token it carried.
let BASE='', TOKENS={};
const hits=[];
function httpStub(){
 const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const path=new URL(req.url,'http://x').pathname, json=(code,v,h={})=>{res.writeHead(code,{'content-type':'application/json',...h});res.end(JSON.stringify(v));};
  const auth=(req.headers.authorization||'').replace(/^Bearer\s+/i,''), m=path.match(/^\/mcp\/([a-z-]+)$/);
  let rpc=null;try{rpc=JSON.parse(body||'null');}catch{}
  const which=Object.entries(TOKENS).find(([,t])=>t===auth)?.[0]??(auth?'unknown':'none');
  hits.push({method:req.method,path,token:which,rpc:rpc?.method??null});
  if(m){
   const name=m[1];
   if(!Object.entries(TOKENS).some(([k,t])=>k.startsWith(name+'/')&&t===auth))return json(401,{error:'invalid_token'},{'www-authenticate':`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp/${name}"`});
   if(req.method!=='POST'){res.writeHead(405);return res.end();}
   if(!rpc||rpc.id===undefined){res.writeHead(202);return res.end();}
   if(rpc.method==='initialize')return json(200,{jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:rpc.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name,version:'0.0.1'}}});
   if(rpc.method==='tools/list')return json(200,{jsonrpc:'2.0',id:rpc.id,result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}});
   return json(200,{jsonrpc:'2.0',id:rpc.id,result:{}});
  }
  const pr=path.match(/^\/.well-known\/oauth-protected-resource\/mcp\/([a-z-]+)$/);
  if(pr)return json(200,{resource:`${BASE}/mcp/${pr[1]}`,authorization_servers:[BASE]});
  if(path==='/.well-known/oauth-authorization-server')return json(200,{issuer:BASE,authorization_endpoint:`${BASE}/authorize`,token_endpoint:`${BASE}/token`,registration_endpoint:`${BASE}/register`,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
  if(path==='/register'&&req.method==='POST'){const meta=JSON.parse(body||'{}');return json(201,{...meta,client_id:'probe-client',client_id_issued_at:Math.floor(Date.now()/1000)});}
  json(404,{error:'not_found'});
 });});
 return new Promise(r=>server.listen(0,'127.0.0.1',()=>{BASE=`http://127.0.0.1:${server.address().port}`;r(server);}));
}
const url=bare=>`${BASE}/mcp/${bare}`;

// The credential store's entry key for an HTTP server (cli.pretty.js Ea): two candidate encodings of {type,url,headers}.
const keyOf=(name,cfg,sorted)=>name+'|'+createHash('sha256').update(sorted?JSON.stringify({headers:cfg.headers||{},type:cfg.type,url:cfg.url}):JSON.stringify({type:cfg.type,url:cfg.url,headers:cfg.headers||{}})).digest('hex').slice(0,16);
function seedCredentials(){
 const store={mcpOAuth:{}};
 for(const [name,bare] of [['cs-oauth','cs-oauth'],[P_HTTP,'cs-poauth']]){
  const cfg={type:'http',url:url(bare)};
  for(const sorted of [false,true]){
   const token=`probe-invented-${bare}-${sorted?'sorted':'ordered'}`;TOKENS[`${bare}/${sorted?'sorted':'ordered'}`]=token;
   store.mcpOAuth[keyOf(name,cfg,sorted)]={serverName:name,serverUrl:cfg.url,accessToken:token,refreshToken:`probe-invented-refresh-${bare}`,expiresAt:Date.now()+7*86400000,scope:''};
  }
 }
 writeJson(CREDS,store);
}
const credsView=()=>{const s=readJson(CREDS);return s?Object.fromEntries(Object.entries(s.mcpOAuth??{}).map(([k,v])=>[k,{serverName:v.serverName,accessToken:v.accessToken?'present:'+createHash('sha256').update(v.accessToken).digest('hex').slice(0,8):'empty'}])):null;};

const setupSteps=[];
function setup(){
 writeFileSync(SERVER,SERVER_JS);
 writeJson(join(REPO,'.mcp.json'),{mcpServers:{'cs-proj':{type:'stdio',command:'node',args:[SERVER,'cs-proj']}}});
 const git=(...a)=>execFileSync('git',['-c','user.name=Probe','-c','user.email=probe@localhost',...a],{cwd:REPO,encoding:'utf8'});
 git('add','.mcp.json');git('commit','-qm','mcp');
 writeJson(join(MARKET,'.claude-plugin/marketplace.json'),{name:'cs-market',owner:{name:'Probe'},plugins:[{name:'cs-plug',source:'./cs-plug',description:'Invented probe plugin'}]});
 writeJson(join(MARKET,'cs-plug/.claude-plugin/plugin.json'),{name:'cs-plug',version:'0.0.1',description:'Invented probe plugin'});
 writeJson(join(MARKET,'cs-plug/.mcp.json'),{mcpServers:{'cs-pserver':{command:'node',args:[SERVER,'cs-pserver']},'cs-poauth':{type:'http',url:url('cs-poauth')}}});
 const step=(cmd,...a)=>setupSteps.push({cmd,...cli(...a)});
 step('mcp add --scope user cs-user','mcp','add','--scope','user','cs-user','--','node',SERVER,'cs-user');
 step('mcp add --scope user --transport http cs-oauth','mcp','add','--scope','user','--transport','http','cs-oauth',url('cs-oauth'));
 step('mcp add --scope local cs-local','mcp','add','--scope','local','cs-local','--','node',SERVER,'cs-local');
 step('plugin marketplace add','plugin','marketplace','add',MARKET);
 step('plugin install '+PLUGIN,'plugin','install',PLUGIN);
 const us=readJson(USER_SETTINGS)??{};writeJson(USER_SETTINGS,{...us,enableAllProjectMcpServers:true});
 seedCredentials();
}

// The files a case may change; restored from the baseline before each case and before each `then-on` session.
const AUTH_CACHE=join(HOME,'.claude/mcp-needs-auth-cache.json');
const FILES={global:GLOBAL,user:USER_SETTINGS,project:PROJECT_SETTINGS,local:LOCAL_SETTINGS,creds:CREDS,authCache:AUTH_CACHE};
let BASELINE={};
const snapshot=()=>Object.fromEntries(Object.entries(FILES).map(([k,f])=>[k,existsSync(f)?readFileSync(f,'utf8'):null]));
function restore(keys=Object.keys(FILES)){for(const k of keys){const f=FILES[k];if(BASELINE[k]===null){if(existsSync(f))rmSync(f);}else{mkdirSync(dirname(f),{recursive:true});writeFileSync(f,BASELINE[k]);}}}
const edit=(f,fn)=>writeJson(f,fn(readJson(f)??{}));
const projectEntry=fn=>edit(GLOBAL,d=>({...d,projects:{...d.projects,[REPO]:fn(d.projects?.[REPO]??{})}}));
const deny=names=>names.map(serverName=>({serverName}));
const FLAG=extra=>['--settings',JSON.stringify({dialogExpiry:'never',...extra})];

// Each case: what it switches, where, and how.
const CASES=[
 {name:'base',what:'control: no switch'},
 {name:'base-no-signin',what:'control: the credential store emptied (shows the HTTP servers need the stored sign-in)',apply:()=>writeJson(CREDS,{mcpOAuth:{}})},
 {name:'dms-project-key',what:'disabledMcpServers (all six names) under projects[<root>] in $HOME/.claude.json, where mcp_toggle writes it',apply:()=>projectEntry(p=>({...p,disabledMcpServers:NAMES}))},
 {name:'dms-top-level',what:'disabledMcpServers (all six) at the top level of $HOME/.claude.json',apply:()=>edit(GLOBAL,d=>({...d,disabledMcpServers:NAMES}))},
 {name:'dms-user-settings',what:'disabledMcpServers (all six) in the user settings file',apply:()=>edit(USER_SETTINGS,s=>({...s,disabledMcpServers:NAMES}))},
 {name:'djs-user',what:'disabledMcpjsonServers (all six) in the user settings file',apply:()=>edit(USER_SETTINGS,s=>({...s,disabledMcpjsonServers:NAMES}))},
 {name:'djs-project',what:'disabledMcpjsonServers (all six) in <root>/.claude/settings.json',apply:()=>edit(PROJECT_SETTINGS,s=>({...s,disabledMcpjsonServers:NAMES}))},
 {name:'djs-local',what:'disabledMcpjsonServers (all six) in <root>/.claude/settings.local.json',apply:()=>edit(LOCAL_SETTINGS,s=>({...s,disabledMcpjsonServers:NAMES}))},
 {name:'djs-flag',what:'disabledMcpjsonServers (all six) in --settings',flags:FLAG({disabledMcpjsonServers:NAMES})},
 {name:'ejs-not-listed',what:'no enableAllProjectMcpServers; enabledMcpjsonServers names another server only (user settings)',apply:()=>edit(USER_SETTINGS,s=>{const {enableAllProjectMcpServers,...r}=s;return {...r,enabledMcpjsonServers:['cs-other']};})},
 {name:'djs-user-ejs-local',what:'precedence: user settings disabledMcpjsonServers [cs-proj], local settings enabledMcpjsonServers [cs-proj], no enableAllProjectMcpServers',apply:()=>{edit(USER_SETTINGS,s=>{const {enableAllProjectMcpServers,...r}=s;return {...r,disabledMcpjsonServers:['cs-proj']};});edit(LOCAL_SETTINGS,s=>({...s,enabledMcpjsonServers:['cs-proj']}));}},
 {name:'ejs-user-djs-local',what:'precedence: user settings enabledMcpjsonServers [cs-proj], local settings disabledMcpjsonServers [cs-proj], no enableAllProjectMcpServers',apply:()=>{edit(USER_SETTINGS,s=>{const {enableAllProjectMcpServers,...r}=s;return {...r,enabledMcpjsonServers:['cs-proj']};});edit(LOCAL_SETTINGS,s=>({...s,disabledMcpjsonServers:['cs-proj']}));}},
 {name:'deny-user',what:'deniedMcpServers {serverName} for the six bare names in the user settings file',apply:()=>edit(USER_SETTINGS,s=>({...s,deniedMcpServers:deny(BARE)}))},
 {name:'deny-project',what:'deniedMcpServers (six bare names) in <root>/.claude/settings.json',apply:()=>edit(PROJECT_SETTINGS,s=>({...s,deniedMcpServers:deny(BARE)}))},
 {name:'deny-local',what:'deniedMcpServers (six bare names) in <root>/.claude/settings.local.json',apply:()=>edit(LOCAL_SETTINGS,s=>({...s,deniedMcpServers:deny(BARE)}))},
 {name:'deny-flag',what:'deniedMcpServers (six bare names) in --settings',flags:FLAG({deniedMcpServers:deny(BARE)})},
 {name:'deny-user-plugin-name',what:'deniedMcpServers naming the plugin servers by their engine names (plugin:cs-plug:...) in the user settings file',apply:()=>edit(USER_SETTINGS,s=>({...s,deniedMcpServers:deny([P_STDIO,P_HTTP])}))},
 {name:'deny-user-allow-local',what:'precedence: user settings deniedMcpServers [cs-user]; local settings allowedMcpServers naming all six bare names',apply:()=>{edit(USER_SETTINGS,s=>({...s,deniedMcpServers:deny(['cs-user'])}));edit(LOCAL_SETTINGS,s=>({...s,allowedMcpServers:deny(BARE)}));}},
 {name:'allow-user',what:'allowedMcpServers [cs-user] alone in the user settings file',apply:()=>edit(USER_SETTINGS,s=>({...s,allowedMcpServers:deny(['cs-user'])}))},
 {name:'allow-user-allow-local',what:'precedence: user settings allowedMcpServers [cs-user]; local settings allowedMcpServers [cs-oauth]',apply:()=>{edit(USER_SETTINGS,s=>({...s,allowedMcpServers:deny(['cs-user'])}));edit(LOCAL_SETTINGS,s=>({...s,allowedMcpServers:deny(['cs-oauth'])}));}},
 {name:'perm-deny-user',what:'permissions.deny mcp__<server> for all six in the user settings file',apply:()=>edit(USER_SETTINGS,s=>({...s,permissions:{...s.permissions,deny:PERM_RULES}}))},
 {name:'perm-deny-user-allow-local',what:'precedence: user permissions.deny mcp__cs-user; local permissions.allow mcp__cs-user',apply:()=>{edit(USER_SETTINGS,s=>({...s,permissions:{deny:['mcp__cs-user']}}));edit(LOCAL_SETTINGS,s=>({...s,permissions:{allow:['mcp__cs-user']}}));}},
 {name:'strict',what:'--strict-mcp-config --mcp-config naming cs-user and cs-oauth with the same configuration as the user scope',flags:()=>['--strict-mcp-config','--mcp-config',JSON.stringify({mcpServers:{'cs-user':{type:'stdio',command:'node',args:[SERVER,'cs-user']},'cs-oauth':{type:'http',url:url('cs-oauth')}}})]},
 {name:'plugin-off-user',what:'enabledPlugins {cs-plug@cs-market: false} in the user settings file (the whole plugin)',apply:()=>edit(USER_SETTINGS,s=>({...s,enabledPlugins:{...s.enabledPlugins,[PLUGIN]:false}}))},
 {name:'plugin-off-project',what:'precedence: user enabledPlugins true (as installed); <root>/.claude/settings.json enabledPlugins false',apply:()=>edit(PROJECT_SETTINGS,s=>({...s,enabledPlugins:{[PLUGIN]:false}}))},
 {name:'plugin-on-project',what:'precedence: user enabledPlugins false; <root>/.claude/settings.json enabledPlugins true',apply:()=>{edit(USER_SETTINGS,s=>({...s,enabledPlugins:{...s.enabledPlugins,[PLUGIN]:false}}));edit(PROJECT_SETTINGS,s=>({...s,enabledPlugins:{[PLUGIN]:true}}));}},
 {name:'remove-by-file',what:'cs-user and cs-oauth deleted from the top-level mcpServers of $HOME/.claude.json by editing the file',apply:()=>edit(GLOBAL,d=>{const {['cs-user']:a,['cs-oauth']:b,...rest}=d.mcpServers??{};return {...d,mcpServers:rest};})},
 {name:'remove-by-cli',what:'`claude mcp remove --scope user` for cs-user and cs-oauth',apply:row=>{row.cli=[cli('mcp','remove','--scope','user','cs-user'),cli('mcp','remove','--scope','user','cs-oauth')];}},
];

const mine=n=>typeof n==='string'&&/cs-/.test(n);
const statusOf=r=>(r?.response?.mcpServers??[]).filter(s=>mine(s.name)).map(s=>({name:s.name,status:s.status,scope:s.scope,tools:(s.tools??[]).map(t=>t.name)}));
async function settled(p,bound=45000){
 const until=Date.now()+bound;let last;
 for(;;){last=await p.request('mcp_status',{},15000).catch(e=>({error:e.message}));
  const s=statusOf(last);if(s.every(x=>x.status!=='pending')&&s.length>0||Date.now()>until)return {seq:p.seq,servers:s};
  await delay(1500);}
}
const hitsView=from=>{const h=hits.slice(from);const o={};for(const x of h){const k=`${x.path} ${x.method} via ${x.token}`;o[k]=(o[k]??0)+1;}return o;};

const record=[];
const keep=row=>{record.push(row);console.log(JSON.stringify(row).slice(0,2000));};

async function runCase(c){
 restore();
 const row={case:c.name,what:c.what,fixture:'fixtures/uxwave/'+TAG+'-'+c.name+'.jsonl'};
 c.apply?.(row);
 row.files=deep(Object.fromEntries(Object.entries({user:USER_SETTINGS,project:PROJECT_SETTINGS,local:LOCAL_SETTINGS}).filter(([,f])=>existsSync(f)).map(([k,f])=>[k,readJson(f)])));
 const g=readJson(GLOBAL);row.globalMcp=deep({mcpServers:Object.keys(g.mcpServers??{}),disabledMcpServers:g.disabledMcpServers,project:{mcpServers:Object.keys(g.projects?.[REPO]?.mcpServers??{}),disabledMcpServers:g.projects?.[REPO]?.disabledMcpServers}});
 row.credsBefore=credsView();
 const flags=typeof c.flags==='function'?c.flags():c.flags??[];
 if(flags.length)row.flags=deep(flags);
 let h0=hits.length;
 const L=await mawsLaunch(TAG+'-'+c.name,{cwd:REPO,flags,provenance:{probe:'U11 connector scopes',case:c.name}},async p=>{
  row.status=await settled(p);
  row.hitsAtSettle=hitsView(h0);
  const t=await turn(p,'Reply with only the word ok');
  row.result={seq:p.seq,subtype:t.result?.subtype??null,text:t.result?.result??null};
  const init=p.frames.find(r=>sys(r.frame,'init'));
  row.init=init?{seq:init.seq,mcp_servers:(init.frame.mcp_servers??[]).filter(s=>mine(s.name)),tools:(init.frame.tools??[]).filter(mine),toolCount:(init.frame.tools??[]).length,plugins:(init.frame.plugins??[]).map(x=>x.name)}:null;
 });
 const rows=rowsOf(L.transcript);
 const deltas=rows.filter(x=>x.row.type==='attachment'&&x.row.attachment?.type==='deferred_tools_delta');
 row.transcript=keepTranscript(L.transcript,TAG+'-'+c.name).replace(/^.*fixtures\//,'fixtures/');
 row.deferred=deltas.map(({line,row:r})=>{const a=r.attachment;return {line,addedNames:(a.addedNames??[]).filter(mine),addedCount:(a.addedNames??[]).length,removedNames:(a.removedNames??[]).filter(mine),pendingMcpServers:a.pendingMcpServers,needsAuthMcpServers:a.needsAuthMcpServers,failedMcpServers:a.failedMcpServers};});
 row.mcpServersOfOtherAttachments=rows.filter(x=>x.row.type==='attachment'&&/mcp/.test(x.row.attachment?.type??'')&&x.row.attachment.type!=='deferred_tools_delta').map(({line,row:r})=>({line,type:r.attachment.type}));
 row.credsAfter=credsView();
 row.authCacheAfter=Object.keys(readJson(AUTH_CACHE)??{});
 row.hits=hitsView(h0);
 // The switch undone: configuration restored, the credential store and the engine's needs-auth cache
 // ($HOME/.claude/mcp-needs-auth-cache.json) kept as the case left them.
 restore(c.name==='remove-by-cli'?['user','project','local']:['global','user','project','local']);
 if(c.name==='remove-by-cli')row.cliReAdd=[cli('mcp','add','--scope','user','cs-user','--','node',SERVER,'cs-user'),cli('mcp','add','--scope','user','--transport','http','cs-oauth',url('cs-oauth'))];
 if(c.name==='base-no-signin')restore(['creds']);
 h0=hits.length;
 const on={fixture:'fixtures/uxwave/'+TAG+'-'+c.name+'-then-on.jsonl',credsBefore:credsView()};
 await mawsLaunch(TAG+'-'+c.name+'-then-on',{cwd:REPO,provenance:{probe:'U11 connector scopes',case:c.name+'-then-on'}},async p=>{on.status=await settled(p);});
 on.hits=hitsView(h0);on.credsAfter=credsView();on.authCacheBefore=row.authCacheAfter;
 row.thenOn=on;
 keep(deep(row));
}

export default async()=>{
 if(!HOME?.startsWith('/tmp/'))throw new Error('HOME is not a scratch folder');
 mkdirSync(FIXTURES,{recursive:true});
 const stub=await httpStub();
 try{
  setup();
  BASELINE=snapshot();
  const g=readJson(GLOBAL);
  keep(deep({case:'setup',engine:ENGINE_VERSION,bin:BIN,steps:setupSteps,stub:'<base>/mcp/<name>',topMcpServers:g.mcpServers,projectMcpServers:g.projects?.[REPO]?.mcpServers,userSettings:readJson(USER_SETTINGS),installedPlugins:Object.keys(readJson(join(HOME,'.claude/plugins/installed_plugins.json'))?.plugins??{}),credentialKeys:credsView()}));
  const only=process.env.UXW_CASES?.split(',');
  for(const c of CASES.filter(c=>!only||only.includes(c.name)))await runCase(c);
 }finally{
  stub.close();
  writeFileSync(FIXTURES+TAG+'.ndjson',redact(record.map(r=>JSON.stringify(r).split(BASE).join('<base>')).join('\n'))+'\n');
  console.log(TAG,FIXTURES+TAG+'.ndjson');
 }
};
