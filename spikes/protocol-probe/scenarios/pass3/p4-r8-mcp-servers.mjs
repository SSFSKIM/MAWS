// P4-R8 (docs/doperpowers/plans/2026-10-19-p4-smoothing.md, routed by the architect as P4-R8; parent pin blob
// bd54d325b4c967eeafb98fb6426049bff1c55669 at master 559ec731a): MCP servers MAWS passes to the sessions it launches,
// through `--mcp-config`, on MAWS's own wire (D-1). No prompt is sent in either arm, so no model is called.
//   owner    the owner's real config home (no CLAUDE_CONFIG_DIR: the one place the engine's OAuth tokens live), the
//            binary MAWS's sessions run (the realpath of ~/.local/bin/claude; MAWS's Settings name no other), MAWS's
//            launch line, environment and initialize with its `maws` server, plus `--mcp-config` naming `notion` as
//            the owner's user scope named it until 2026-10-21. What mcp_status reports for it, and so whether the login
//            made under the user-scope entry is reused. The raw recording is private and deleted after curation or
//            failure; the fixture keeps control exchanges with every other server reduced to its name, status, scope and type, and the
//            initialize answer to its keys (the account, the owner's commands and plugins are not kept).
//   scratch  a scratch config home naming `notion` in user, local and project scope at a local server's three
//            distinct paths, and the same `--mcp-config` plus `probe-oauth`, an OAuth-protected local server: whose
//            `notion` the engine connects (precedence, read from which paths the local server is asked for), what a
//            server that needs auth reads as in mcp_status and in an mcp_call, and what mcp_authenticate answers. The
//            browser is never opened; the flow is left to lapse with the process.
// Run: node run-pass3.mjs p4-r8-mcp-servers   (R8_ARM=owner or R8_ARM=scratch for one arm)
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,delay,BIN,ENGINE_VERSION,relayReady} from './p1-common.mjs';
import {run as harnessRun} from '../../harness.mjs';
import {SdkServer} from '../../sdk-mcp.mjs';
import {clearEngineEnvironment} from './mods-environment.mjs';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync,realpathSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const FIXTURES=fileURLToPath(new URL('../../fixtures/p4/',import.meta.url));
const contract=await import('../../../../src/shared/owner/contract.ts');
const served=JSON.parse(readFileSync(HERE+'p4-maws-tools.json','utf8'));
const PROVENANCE={child:'P4-R8',pin:'bd54d325b4c967eeafb98fb6426049bff1c55669',document:'docs/doperpowers/plans/2026-10-19-p4-smoothing.md',spike:'the probe on MAWS\'s own wire before the launch passes the app\'s servers (D-1)',served:'p4-maws-tools.json'};
const NOTION={type:'http',url:'https://mcp.notion.com/mcp'};
// MAWS's launch beyond the harness's own flags (src/engine-host/launch.ts: ENGINE_FLAGS, the maws server's two tool
// flags, and `--settings` with the to-human lane's env as main's launch decision adds it)
const MAWS_SETTINGS={dialogExpiry:'never',env:{[contract.NATIVE_TO_HUMAN_ENV]:String(contract.TO_HUMAN_CONTRACT_VERSION)}};
const MAWS_FLAGS=['--forward-subagent-text','--replay-user-messages','--include-hook-events','--disallowedTools','AskUserQuestion','--allowedTools','mcp__maws__message'];
const OWNER_HOME=homedir();
const OWNER_GLOBAL=join(OWNER_HOME,'.claude.json');
const slug=path=>path.replace(/[^a-zA-Z0-9]/g,'-');

// mcp_status until every named server has left `pending`, or the bound.
async function settled(p,names,{bound=60000}={}){
 const until=Date.now()+bound;let last;
 for(;;){
  last=success(await p.request('mcp_status',{},15000),'mcp_status');
  const left=names.filter(n=>{const s=last.mcpServers.find(x=>x.name===n);return !s||s.status==='pending';});
  if(left.length===0||Date.now()>until)return last;
  await delay(1500);
 }
}

// ---- owner -----------------------------------------------------------------------------------------------------
// Only what the questions read, from a recording made against the owner's config home: the probe's own requests and
// the answers to them, the `maws` server's exchanges (MAWS's own), and meta rows; every other server reduced.
const reduceServer=s=>s.name==='notion'
 ?{name:s.name,status:s.status,scope:s.scope,config:{type:s.config?.type,url:s.config?.url,headerKeys:Object.keys(s.config?.headers??{})},serverInfo:s.serverInfo??null,error:s.error??null,tools:(s.tools??[]).map(t=>t.name)}
 :{name:s.name,status:s.status,scope:s.scope,type:s.config?.type??null,toolCount:(s.tools??[]).length};
function curate(rawRows,sessionId){
 const mine=new Set(rawRows.filter(r=>r.direction==='out'&&r.frame.type==='control_request').map(r=>r.frame.request_id));
 const engineAsked=new Set(rawRows.filter(r=>r.direction==='in'&&r.frame.type==='control_request').map(r=>r.frame.request_id));
 const dropped={};const out=[];
 for(const row of rawRows){
  const f=row.frame;let keep=null;
  if(row.direction==='meta')keep=f.event==='spawn'?{...f,args:f.args}:f;
  else if(f.type==='control_request'&&row.direction==='out')keep=f.request.subtype==='initialize'?{...f,request:{subtype:'initialize',keys:Object.keys(f.request).sort(),sdkMcpServers:f.request.sdkMcpServers??null}}:f;
  else if(f.type==='control_response'&&row.direction==='in'&&mine.has(f.response.request_id)){
   const r=f.response.response;
   if(r?.mcpServers)keep={...f,response:{...f.response,response:{mcpServers:r.mcpServers.map(reduceServer)}}};
   else if(r&&typeof r==='object'&&'commands' in r)keep={...f,response:{...f.response,response:{keys:Object.keys(r).sort()}}};
   else keep=f;
  }
  else if(f.type==='control_request'&&row.direction==='in')keep=f.request.subtype==='mcp_message'&&f.request.server_name==='maws'?f:{type:'control_request',request_id:f.request_id,request:{subtype:f.request.subtype}};
  else if(f.type==='control_response'&&row.direction==='out'&&engineAsked.has(f.response.request_id))keep=f;
  if(keep===null){const k=row.direction+':'+(f.type??'?')+(f.subtype?'/'+f.subtype:'');dropped[k]=(dropped[k]??0)+1;continue;}
  out.push({...row,frame:keep});
 }
 out.push({direction:'meta',at:new Date().toISOString(),frame:{event:'curated',from:'a temporary raw recording, deleted after curation',dropped,sessionId}});
 return out.map((r,i)=>({seq:i+1,direction:r.direction,at:r.at,frame:r.frame}));
}

// What the run left in the owner's files, by key and existence only (nothing of a value is read into the fixture).
function ownerSnapshot(cwd,key,sessionId){
 const d=JSON.parse(readFileSync(OWNER_GLOBAL,'utf8'));
 return {userServers:Object.keys(d.mcpServers??{}).sort(),projectKeys:Object.keys(d.projects?.[key]??{}).sort(),projectCount:Object.keys(d.projects??{}).length,transcript:existsSync(join(OWNER_HOME,'.claude','projects',slug(cwd),sessionId+'.jsonl'))};
}

async function owner(){
 // MAWS resolves the installed link at every launch when Settings name no binary (src/engine-host/binary-info.ts)
 const installed=realpathSync(join(OWNER_HOME,'.local/bin/claude'));
 if(BIN!==installed)throw new Error(`refused: the owner arm runs the binary MAWS's sessions run (${installed}), not ${BIN}`);
 const cwd=realpathSync(fileURLToPath(new URL('../../../../',import.meta.url))); // this worktree, whose project key (its repository root) the owner's config already trusts
 const trustKey=execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd,encoding:'utf8'}).trim().replace(/\/\.git$/,'');
 const sessionId=randomUUID();
 const rawDir=mkdtempSync(join(tmpdir(),'maws-p4-r8-raw-'))+'/'; // fresh and owner-only (0700)
 try{
  const debugFile=join(rawDir,'owner-debug.log');
  clearEngineEnvironment();
  // buildEnvironment's constants and the gateway route (D-19's default); SMNS_MEMBER is left out, so sminos never admits
  // the probe as a member of the project (the one difference from a MAWS session's environment)
  const env={ANTHROPIC_BASE_URL:'http://127.0.0.1:8641',ANTHROPIC_AUTH_TOKEN:'claudeusage-local-gateway',ENABLE_TOOL_SEARCH:'true',CLAUDE_CODE_FORK_SUBAGENT:'true',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING:'1',CLAUDE_CODE_QUESTION_PREVIEW_FORMAT:'html',TERM:'dumb',DISABLE_AUTOUPDATER:'1'};
  if(process.env.CLAUDE_CONFIG_DIR)throw new Error('refused: CLAUDE_CONFIG_DIR is set; the owner arm reads the default config home');
  await relayReady();
  const before=ownerSnapshot(cwd,trustKey,sessionId);
  const mcpConfig={mcpServers:{notion:NOTION}};
  const maws=new SdkServer('maws',served.tools);
  const name='p4-r8-owner';
  const p=await harnessRun(name,async p=>{
   p.note({event:'provenance',...PROVENANCE,arm:'owner',engine:BIN,engineVersion:ENGINE_VERSION,configHome:'~/.claude (the owner\'s; CLAUDE_CONFIG_DIR unset)',cwd,trustKey,pinnedSessionId:sessionId,envKeys:Object.keys(env).sort(),mcpConfig,settings:MAWS_SETTINGS});
   p.note({event:'owner_snapshot',phase:'before',...before});
   p.serve('maws',maws);
   p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});
   p.on('elicitation',r=>{p.note({event:'elicitation_seen',server:r.mcp_server_name??null});return {action:'decline'};});
   success(await p.init({...initPayload(trustKey),sdkMcpServers:['maws']}),'initialize');
   const status=await settled(p,['notion','maws']);
   const notion=status.mcpServers.find(s=>s.name==='notion');
   p.note({event:'notion',status:notion?.status??null,scope:notion?.scope??null,url:notion?.config?.url??null,tools:(notion?.tools??[]).length,others:status.mcpServers.filter(s=>s.name!=='notion').map(s=>({name:s.name,status:s.status,scope:s.scope}))});
   await endAsStop(p);
  },{cwd,env,bin:BIN,dir:'../../../../../../../../../../../..'+rawDir,noModel:true,settingSources:'user,project,local',strictMcp:false,mode:'default',flags:[...MAWS_FLAGS,'--session-id',sessionId,'--mcp-config',JSON.stringify(mcpConfig),'--settings',JSON.stringify(MAWS_SETTINGS),'--debug-file',debugFile]});
  const exit=await p.closed;
  const after=ownerSnapshot(cwd,trustKey,sessionId);
  const rows=readFileSync(p.file,'utf8').trim().split('\n').map(JSON.parse);
  const curated=curate(rows,sessionId);
  // the engine's debug lines about the server, its auth and its tokens' storage, with anything token-shaped removed
  const debug=existsSync(debugFile)?readFileSync(debugFile,'utf8').split('\n').filter(l=>/notion/i.test(l)).map(l=>l.replace(/[A-Za-z0-9_\-.]{32,}/g,'[REDACTED]').slice(0,300)):[];
  curated.push({seq:curated.length+1,direction:'meta',at:new Date().toISOString(),frame:{event:'debug_lines',count:debug.length,lines:debug.slice(0,60)}});
  curated.push({seq:curated.length+1,direction:'meta',at:new Date().toISOString(),frame:{event:'owner_snapshot',phase:'after',...after,userServersSame:JSON.stringify(after.userServers)===JSON.stringify(before.userServers),projectKeysSame:JSON.stringify(after.projectKeys)===JSON.stringify(before.projectKeys),projectCountSame:after.projectCount===before.projectCount}});
  writeFileSync(FIXTURES+name+'.jsonl',curated.map(r=>JSON.stringify(r)).join('\n')+'\n');
  console.log(name,JSON.stringify({exit,notion:curated.find(r=>r.frame.event==='notion')?.frame,before,after}));
  if(exit.code!==0)throw new Error(name+' exited with '+JSON.stringify(exit));
 }finally{
  rmSync(rawDir,{recursive:true,force:true});
 }
}

// ---- scratch ---------------------------------------------------------------------------------------------------
// One local server: three plain paths standing for the shadowed `notion` entries (any request to them is counted:
// the engine connected that entry), and an OAuth-protected MCP endpoint shaped as the MCP authorization spec asks
// (RFC 9728 protected-resource metadata, RFC 8414 server metadata, RFC 7591 registration); /authorize and /token are
// never reached, since nothing opens the browser.
function localServer(){
 const hits=[];
 const server=createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   const path=new URL(req.url,'http://x').pathname;hits.push({method:req.method,path});
   const base=`http://127.0.0.1:${server.address().port}`;
   const json=(code,value)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));};
   if(path==='/oauth/mcp'){res.writeHead(401,{'www-authenticate':`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/oauth/mcp"`,'content-type':'application/json'});res.end(JSON.stringify({error:'invalid_token'}));return;}
   if(path==='/.well-known/oauth-protected-resource/oauth/mcp')return json(200,{resource:`${base}/oauth/mcp`,authorization_servers:[base]});
   if(path==='/.well-known/oauth-authorization-server')return json(200,{issuer:base,authorization_endpoint:`${base}/authorize`,token_endpoint:`${base}/token`,registration_endpoint:`${base}/register`,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
   if(path==='/register'&&req.method==='POST'){const meta=JSON.parse(body||'{}');return json(201,{...meta,client_id:'probe-client',client_id_issued_at:Math.floor(Date.now()/1000)});}
   json(404,{error:'not_found'});
  });
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,hits,base:`http://127.0.0.1:${server.address().port}`})));
}

// The keychain item a scratch config home's secure storage uses (the engine's service name: "Claude Code-credentials"
// suffixed with sha256 of the config dir, 8 hex, when CLAUDE_CONFIG_DIR is set; cli.pretty.js 2.1.304:1134003-1134006).
// Only that exact name is ever looked up or removed, and never the unsuffixed owner's item.
const scratchItem=home=>`Claude Code-credentials-${createHash('sha256').update(home.normalize('NFC')).digest('hex').slice(0,8)}`;
const itemExists=service=>{try{execFileSync('security',['find-generic-password','-s',service],{stdio:'ignore'});return true;}catch{return false;}};

async function scratch(){
 const run=scratchRun('r8');
 const local=await localServer();
 const item=scratchItem(run.home);
 if(!/^Claude Code-credentials-[0-9a-f]{8}$/.test(item))throw new Error('refused: '+item);
 const itemBefore=itemExists(item);
 try{
  const at=path=>({type:'http',url:local.base+path});
  writeFileSync(join(run.home,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,mcpServers:{notion:at('/user/mcp')},projects:{[run.cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true,enabledMcpjsonServers:['notion'],mcpServers:{notion:at('/local/mcp')}}}})+'\n');
  writeFileSync(join(run.cwd,'.mcp.json'),JSON.stringify({mcpServers:{notion:at('/project/mcp')}})+'\n');
  const mcpConfig={mcpServers:{notion:NOTION,'probe-oauth':at('/oauth/mcp')}};
  await launch('p4-r8-scratch',run,{dir:'fixtures/p4/',flags:[...MAWS_FLAGS.slice(3),'--mcp-config',JSON.stringify(mcpConfig)],provenance:{...PROVENANCE,arm:'scratch',mcpConfig,shadowed:{user:'/user/mcp',local:'/local/mcp',project:'/project/mcp'}}},async p=>{
   p.serve('maws',new SdkServer('maws',served.tools));
   success(await p.init({...initPayload(run.cwd),sdkMcpServers:['maws']}),'initialize');
   const status=await settled(p,['notion','probe-oauth','maws']);
   const byName=n=>status.mcpServers.find(s=>s.name===n);
   p.note({event:'servers',servers:status.mcpServers.map(s=>({name:s.name,status:s.status,scope:s.scope,url:s.config?.url??null}))});
   check(p,'one notion, the --mcp-config entry',status.mcpServers.filter(s=>s.name==='notion').length===1&&byName('notion').config?.url===NOTION.url,byName('notion'));
   const call=await p.request('mcp_call',{tool:'mcp__probe-oauth__anything',arguments:{}},45000);
   p.note({event:'mcp_call_needs_auth',subtype:call.subtype,error:call.error??null});
   const auth=await p.request('mcp_authenticate',{serverName:'probe-oauth'},45000);
   p.note({event:'mcp_authenticate',subtype:auth.subtype,keys:auth.response?Object.keys(auth.response).sort():null});
   const missing=await p.request('mcp_authenticate',{serverName:'no-such-server'},15000);
   p.note({event:'mcp_authenticate_unknown',subtype:missing.subtype,error:missing.error??null});
   const again=success(await p.request('mcp_status',{},15000),'mcp_status');
   p.note({event:'after_authenticate',status:again.mcpServers.find(s=>s.name==='probe-oauth')?.status??null});
   p.note({event:'local_hits',hits:local.hits});
   await endAsStop(p);
  });
 }finally{
  local.server.close();
  const itemAfter=itemExists(item);
  // the scratch home's own item, made by this run's registration; removed so the run leaves nothing in the keychain
  let removed=false;
  if(itemAfter&&!itemBefore){execFileSync('security',['delete-generic-password','-s',item],{stdio:'ignore'});removed=!itemExists(item);}
  console.log('p4-r8-scratch keychain',JSON.stringify({item,itemBefore,itemAfter,removed}));
  removeRun(run);
 }
}

export default async()=>{
 const arms=(process.env.R8_ARM??'owner,scratch').split(',');
 if(arms.includes('owner'))await owner();
 if(arms.includes('scratch'))await scratch();
};
