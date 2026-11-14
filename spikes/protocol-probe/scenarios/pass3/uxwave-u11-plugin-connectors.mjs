// UX wave U11, a plugin's connectors on engine 2.1.322: the name the engine gives a plugin's server, what mcp_status
// and the init frame say of where it came from, which of two same-named plugins' servers is live, a templated URL, a
// plugin turned off, and odd or long names. Run as
//   ./vm-run.sh --prefix <p> run run-pass3.mjs uxwave-u11-plugin-connectors      (UXW_CASES=a,b to run some cases)
// Invented plugins in three scratch marketplaces, each installed with the engine's own CLI (`claude plugin install`):
//   m4-a: key-alpha (manifest name mani-alpha; servers alpha-http, HTTP, and alpha-stdio, stdio),
//         tpl (server tpl-http, its URL written with ${M4_SEG}), odd (servers "sp ace" and "co:lon"),
//         a plugin with a long name and a long server name (combined over 128 characters), twin (server srv)
//   m4-b: twin (manifest name twin, server srv, another address)
//   m4-c: twin-c (manifest name twin, server srv, a third address)
// Every HTTP server is a path of one loopback stub, /h/<id>, which records each request, so a case tells which
// definition a session reached. Every session is MAWS's launch (uxwave-common-arrivals.mjs mawsLaunch, cwd <root>,
// `--debug-file`, M4_SEG in its environment); it reads mcp_status until the plugin servers settle, then sends the
// local command `/cost` so the engine sends `system/init` (its server list) without calling a model.
// Written: the journals fixtures/uxwave/<tag>-<case>.jsonl (trimmed as in passes 2 and 3) and the record
// fixtures/uxwave/<tag>.ndjson (one case a line).
import {mawsLaunch,delay,BIN,ENGINE_VERSION,FIXTURES,sys,prompt,waitFor} from './uxwave-common-arrivals.mjs';
import {redact} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {join,dirname} from 'node:path';

const TAG=process.env.UXW_TAG||'u11-plugin-conn';
const ROOT=process.env.PROBE_ROOT, HOME=process.env.HOME, REPO=process.env.PROBE_WORK;
const USER_SETTINGS=join(HOME,'.claude/settings.json'), PROJECT_SETTINGS=join(REPO,'.claude/settings.json'), LOCAL_SETTINGS=join(REPO,'.claude/settings.local.json');
const INSTALLED=join(HOME,'.claude/plugins/installed_plugins.json'), SERVER=join(ROOT,'m4-mcp.mjs');
const LONG_PLUGIN='long-'+'p'.repeat(90), LONG_SERVER='srv-'+'s'.repeat(40);
const ENV={M4_SEG:'inv-seg'};
let BASE='';
const anon=s=>{if(typeof s!=='string')return s;s=s.split(HOME).join('<home>').split(REPO).join('<root>').split(ROOT).join('<scratch>');return BASE?s.split(BASE).join('<base>'):s;};
const deep=v=>v===undefined?v:JSON.parse(anon(JSON.stringify(v)));
const readJson=f=>existsSync(f)?JSON.parse(readFileSync(f,'utf8')):undefined;
const writeJson=(f,v)=>{mkdirSync(dirname(f),{recursive:true});writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const cli=args=>{try{return {cmd:anon(args.join(' ')),ok:true,out:anon(execFileSync(BIN,args,{cwd:REPO,encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim())};}catch(e){return {cmd:anon(args.join(' ')),ok:false,code:e.status??null,out:anon(String(e.stdout??'')+String(e.stderr??'')).trim()};}};

const SERVER_JS=`import {createInterface} from 'node:readline';
const out=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',l=>{let m;try{m=JSON.parse(l);}catch{return;}
 if(m.method==='initialize')out({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:process.argv[2],version:'0.0.1'}}});
 else if(m.method==='tools/list')out({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}});
 else if(m.id!==undefined)out({jsonrpc:'2.0',id:m.id,result:{}});});
`;
const hits=[];
const answer=(rpc,id)=>rpc.method==='initialize'?{jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:rpc.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:id,version:'0.0.1'}}}
 :rpc.method==='tools/list'?{jsonrpc:'2.0',id:rpc.id,result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}}:{jsonrpc:'2.0',id:rpc.id,result:{}};
function httpStub(){
 const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const u=new URL(req.url,'http://x');let rpc=null;try{rpc=JSON.parse(body||'null');}catch{}
  hits.push({t:Date.now(),path:u.pathname,method:req.method,rpc:rpc?.method??null});
  if(!u.pathname.startsWith('/h/')){res.writeHead(404);return res.end();}
  if(req.method!=='POST'){res.writeHead(405);return res.end();}
  if(!rpc||rpc.id===undefined){res.writeHead(202);return res.end();}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(answer(rpc,u.pathname.split('/')[2])));
 });});
 return new Promise(r=>server.listen(0,'127.0.0.1',()=>{BASE=`http://127.0.0.1:${server.address().port}`;r(server);}));
}
const reached=from=>[...new Set(hits.filter(h=>h.t>=from).map(h=>h.path))].sort();

function plugin(market,key,manifest,servers){
 writeJson(join(ROOT,market,key,'.claude-plugin/plugin.json'),{name:manifest,version:'0.0.1',description:'Invented probe plugin'});
 writeJson(join(ROOT,market,key,'.mcp.json'),{mcpServers:servers});
 return {name:key,source:'./'+key,description:'Invented probe plugin'};
}
function setup(){
 writeFileSync(SERVER,SERVER_JS);
 const A=[plugin('m4-a','key-alpha','mani-alpha',{'alpha-http':{type:'http',url:`${BASE}/h/alpha`},'alpha-stdio':{command:'node',args:[SERVER,'alpha-stdio']}}),
  plugin('m4-a','tpl','tpl',{'tpl-http':{type:'http',url:`${BASE}/h/tpl/\${M4_SEG}`}}),
  plugin('m4-a','odd','odd',{'sp ace':{type:'http',url:`${BASE}/h/space`},'co:lon':{type:'http',url:`${BASE}/h/colon`}}),
  plugin('m4-a',LONG_PLUGIN,LONG_PLUGIN,{[LONG_SERVER]:{type:'http',url:`${BASE}/h/long`}}),
  plugin('m4-a','twin','twin',{srv:{type:'http',url:`${BASE}/h/twin-a`}})];
 writeJson(join(ROOT,'m4-a/.claude-plugin/marketplace.json'),{name:'m4-a',owner:{name:'Probe'},plugins:A});
 writeJson(join(ROOT,'m4-b/.claude-plugin/marketplace.json'),{name:'m4-b',owner:{name:'Probe'},plugins:[plugin('m4-b','twin','twin',{srv:{type:'http',url:`${BASE}/h/twin-b`}})]});
 writeJson(join(ROOT,'m4-c/.claude-plugin/marketplace.json'),{name:'m4-c',owner:{name:'Probe'},plugins:[plugin('m4-c','twin-c','twin',{srv:{type:'http',url:`${BASE}/h/twin-c`}})]});
 const steps=['m4-a','m4-b','m4-c'].map(m=>cli(['plugin','marketplace','add',join(ROOT,m)]));
 const s=readJson(USER_SETTINGS)??{};writeJson(USER_SETTINGS,{...s,enableAllProjectMcpServers:true});
 return steps;
}
const install=id=>cli(['plugin','install',id,'--scope','user']);
const uninstall=id=>cli(['plugin','uninstall',id,'--scope','user']);
const enabled=()=>({user:readJson(USER_SETTINGS)?.enabledPlugins,project:readJson(PROJECT_SETTINGS)?.enabledPlugins,local:readJson(LOCAL_SETTINGS)?.enabledPlugins});
const installedKeys=()=>Object.keys(readJson(INSTALLED)?.plugins??{});

// Journals trimmed as in passes 2 and 3.
const PROBE_RE=/plugin:|m4-|twin|alpha|tpl|mcp_status|mcpServers/;
function shrink(v){if(Array.isArray(v)){if(v.length>24){const kept=v.filter(x=>PROBE_RE.test(JSON.stringify(x)));return {trimmedArray:v.length,kept:kept.map(shrink)};}return v.map(shrink);}
 if(v&&typeof v==='object'){const o={};for(const [k,x] of Object.entries(v))o[k]=shrink(x);return o;}if(typeof v==='string'&&v.length>4000)return v.slice(0,600)+`…[${v.length} chars]`;return v;}
// initialize's answer (commands, agents, models, account) is reduced to its size and keys whatever it names.
function slim(f){const s=JSON.stringify(f);if(s.length>4000&&(!PROBE_RE.test(s)||f.response?.response?.commands)){if(f.type==='control_response'&&f.response&&typeof f.response==='object'){const i=f.response.response;return {...f,response:{...f.response,response:i&&typeof i==='object'?{trimmedBytes:JSON.stringify(i).length,keys:Object.keys(i)}:i}};}
 if(f.type==='control_request'&&f.request)return {...f,request:{subtype:f.request.subtype,trimmedBytes:JSON.stringify(f.request).length}};}return shrink(f);}
// The maws SDK server's own traffic (mcp_message requests and their answers) is dropped too: no statement reads it.
function trimJournal(file){if(!existsSync(file))return;let rows=readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(r=>r.frame?.type!=='stream_event');
 const sdk=new Set(rows.filter(r=>r.frame?.type==='control_request'&&r.frame.request?.subtype==='mcp_message').map(r=>r.frame.request_id));
 rows=rows.filter(r=>!(r.frame?.type==='control_request'&&r.frame.request?.subtype==='mcp_message')&&!(r.frame?.type==='control_response'&&sdk.has(r.frame.response?.request_id)));
 writeFileSync(file,rows.map(r=>redact(anon(JSON.stringify({...r,frame:slim(r.frame)})))).join('\n')+'\n');}

const isPlugin=s=>typeof s?.name==='string'&&s.name.startsWith('plugin:');
const shape=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
const entryView=s=>({name:s.name,status:s.status,scope:s.scope,source:s.source,transport:s.transport,urlHost:s.urlHost,keys:Object.keys(s).sort(),configKeys:s.config&&typeof s.config==='object'?Object.fromEntries(Object.keys(s.config).sort().map(k=>[k,shape(s.config[k])])):null,config:s.config,serverInfo:s.serverInfo,tools:(s.tools??[]).map(t=>t.name),error:s.error});
async function settled(p,bound=45000){const t0=Date.now();for(;;){const r=await p.request('mcp_status',{},15000).catch(e=>({error:e.message}));
 const all=r?.response?.mcpServers??[], pl=all.filter(isPlugin);
 if(all.length&&all.every(s=>s.status!=='pending')&&(pl.length>0||Date.now()-t0>8000)||Date.now()-t0>bound)return {seq:p.seq,servers:all.filter(isPlugin).map(entryView),otherNames:all.filter(s=>!isPlugin(s)).map(s=>s.name)};await delay(1500);}}
const DEBUG_RE=/plugin|m4-|twin|duplicate|collid|overrid|shadow|conflict|same name|already/i;

const record=[];
const keep=row=>{const s=redact(anon(JSON.stringify(row)));record.push(s);console.log(s.slice(0,1500));};
async function session(name,what,extra={}){
 const dbg=join(ROOT,`debug-${name}.log`), t0=Date.now();
 const row={case:name,what,fixture:'fixtures/uxwave/'+TAG+'-'+name+'.jsonl',installed:installedKeys(),enabledPlugins:enabled(),...extra};
 await mawsLaunch(TAG+'-'+name,{cwd:REPO,env:ENV,flags:['--debug-file',dbg],provenance:{probe:'U11 plugin connectors',case:name}},async p=>{
  row.status=await settled(p);
  const s=prompt(p,'/cost');const res=await waitFor(p,f=>f.type==='result',{after:s.seq,timeout:60000});
  const init=p.frames.find(r=>sys(r.frame,'init'));
  row.init=init?{seq:init.seq,pluginServers:(init.frame.mcp_servers??[]).filter(isPlugin),entryKeys:[...new Set((init.frame.mcp_servers??[]).flatMap(x=>Object.keys(x)))].sort(),plugins:(init.frame.plugins??[]).filter(x=>!/@builtin/.test(x.source??'')).map(x=>({name:x.name,source:x.source,path:x.path,keys:Object.keys(x).sort()})),plugin_errors:init.frame.plugin_errors,plugin_warnings:init.frame.plugin_warnings,mcp_server_errors:init.frame.mcp_server_errors}:null;
  row.result={seq:p.seq,subtype:res?.subtype??null,costUsd:res?.total_cost_usd??null};
 });
 row.reached=reached(t0);
 const J=FIXTURES+TAG+'-'+name+'.jsonl';
 row.stderr=existsSync(J)?readFileSync(J,'utf8').split('\n').filter(l=>/"direction":"stderr"/.test(l)).map(l=>anon(JSON.parse(l).frame?.text??'').slice(0,300)).slice(0,10):[];
 const D=existsSync(dbg)?readFileSync(dbg,'utf8').split('\n'):[];
 row.debug={lines:D.length,matched:[...new Set(D.filter(l=>DEBUG_RE.test(l)&&!/CA certs|Starting connection|Successfully connected|Connection established|connected with subscribe|Initializing HTTP|Node version|Environment:|transport options|Plugin autoupdate|cc-plugin|hooks module|hooks native|plugin\.register|getPluginSkills|Checking plugin|Total plugin|settings\.read|engine\.create|getSkills|transport created|Keeping |No token data|connection closed|Cleared connection|startupWorkGate|skipping migration|Initialized versioned|installPluginsForHeadless|Testing basic|Parsed URL|loopback address|Client created|tools\/list|capabilities|Connected to|Calling MCP/.test(l)).map(l=>anon(l.replace(/^\S+\s+/,'')).slice(0,400)))].slice(0,40)};
 if(existsSync(dbg))rmSync(dbg);
 journals.push(J);
 keep(row);
}
const journals=[];
const want=n=>{const only=process.env.UXW_CASES?.split(',');return !only||only.includes(n);};

export default async()=>{
 if(!HOME?.startsWith('/tmp/'))throw new Error('HOME is not a scratch folder');
 mkdirSync(FIXTURES,{recursive:true});
 const stub=await httpStub();
 try{
  const steps=setup();
  // 1, 2, 4, 6: names, provenance, a templated URL, odd and long names.
  const inst=['key-alpha@m4-a','tpl@m4-a','odd@m4-a',LONG_PLUGIN+'@m4-a'].map(install);
  keep({case:'setup',engine:ENGINE_VERSION,marketplaces:steps,installs:inst,installed:installedKeys(),enabledPlugins:enabled(),longPlugin:{chars:LONG_PLUGIN.length,shape:'long-p…'},longServer:{chars:LONG_SERVER.length,shape:'srv-s…'},combinedChars:('plugin:'+LONG_PLUGIN+':'+LONG_SERVER).length,launchEnv:Object.keys(ENV),
   installedEntries:Object.fromEntries(Object.entries(readJson(INSTALLED)?.plugins??{}).map(([k,v])=>[k,v.map(e=>Object.fromEntries(Object.entries(e).map(([a,b])=>[a,a==='installPath'?anon(b):a.endsWith('At')?'<time>':b])))]))});
  if(want('names'))await session('names','key-alpha (manifest mani-alpha), tpl, odd, the long one: installed at user scope');
  // 5: a plugin turned off, at user scope and for the project only.
  if(want('off-user')){const d=cli(['plugin','disable','key-alpha@m4-a','--scope','user']);await session('off-user','`claude plugin disable key-alpha@m4-a --scope user`',{cliDisable:d});cli(['plugin','enable','key-alpha@m4-a','--scope','user']);}
  if(want('off-project')){const d=cli(['plugin','disable','key-alpha@m4-a','--scope','project']);await session('off-project','`claude plugin disable key-alpha@m4-a --scope project` (the user scope still enabled)',{cliDisable:d});
   const e=cli(['plugin','enable','key-alpha@m4-a','--scope','project']);if(existsSync(PROJECT_SETTINGS))rmSync(PROJECT_SETTINGS);}
  if(want('off-local')){const d=cli(['plugin','disable','key-alpha@m4-a','--scope','local']);await session('off-local','`claude plugin disable key-alpha@m4-a --scope local` (the user scope still enabled)',{cliDisable:d});if(existsSync(LOCAL_SETTINGS))rmSync(LOCAL_SETTINGS);}
  for(const id of ['key-alpha@m4-a','tpl@m4-a','odd@m4-a',LONG_PLUGIN+'@m4-a'])uninstall(id);
  // 3: the same manifest name and server name from two marketplaces.
  if(want('twin')){
   const steps1=[install('twin@m4-a'),install('twin@m4-b')];
   await session('twin-ab','twin@m4-a installed, then twin@m4-b (same key name, same manifest name, same server name; /h/twin-a and /h/twin-b)',{steps:steps1});
   const s=readJson(USER_SETTINGS);const ep=s.enabledPlugins??{};const re={};for(const k of Object.keys(ep).reverse())re[k]=ep[k];writeJson(USER_SETTINGS,{...s,enabledPlugins:re});
   await session('twin-ab-settings-reversed','as twin-ab, with the enabledPlugins keys of the user settings written in the other order (installed_plugins.json unchanged)');
   const steps2=[uninstall('twin@m4-a'),uninstall('twin@m4-b'),install('twin@m4-b'),install('twin@m4-a')];
   await session('twin-ba','both uninstalled, then twin@m4-b installed, then twin@m4-a',{steps:steps2});
   const steps3=[uninstall('twin@m4-b'),install('twin-c@m4-c')];
   await session('twin-ac','twin@m4-a, then twin-c@m4-c (key name twin-c, manifest name twin, server srv; /h/twin-c)',{steps:steps3});
   const steps4=[uninstall('twin@m4-a'),uninstall('twin-c@m4-c'),install('twin-c@m4-c'),install('twin@m4-a')];
   await session('twin-ca','both uninstalled, then twin-c@m4-c installed, then twin@m4-a',{steps:steps4});
  }
 }finally{
  stub.close();
  for(const j of journals)trimJournal(j);
  writeFileSync(FIXTURES+TAG+'.ndjson',record.join('\n')+'\n');
  console.log(TAG,FIXTURES+TAG+'.ndjson');
 }
};
