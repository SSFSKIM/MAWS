#!/usr/bin/env node
// cua-shim: a stdio MCP proxy that lets a non-Codex host (Claude Code) drive OpenAI's computer-use stack.
//
//   host ──stdio──▶ cua-shim ──stdio──▶ cua_node/bin/node cua-repl.mjs ──▶ node_repl ──socket──▶ SkyComputerUseService
//
// The service authenticates its socket peer by code signature and requires the relay chain above node_repl to reach an
// OpenAI-signed process; OpenAI's bundled `node` is that process, so the launch recipe below must stay exactly Codex's
// (spikes/computer-use-probe/findings.md §1). Everything Codex-specific that the JS layer expects from its host is
// supplied here instead:
//   1. tools/call gets `_meta["x-codex-turn-metadata"]` and friends, which node_repl uses to key session approvals;
//   2. an accepted app-approval elicitation gets `_meta.persist` so the approval sticks for the session;
//   3. image results get their real MIME type (node_repl labels JPEG screenshots `image/png`);
//   4. tools/list is trimmed to js and js_reset (plus the host-only turn_ended), marked `anthropic/alwaysLoad`;
//   5. `notifications/cancelled` and everything else pass through untouched.
//
// Env: CUA_SHIM_CODEX_HOME (scratch home for approvals and config; default /tmp/maws-cu-probe/codex-home),
//      CUA_SHIM_SESSION_ID (default CLAUDE_CODE_SESSION_ID, else a fresh uuid), CUA_SHIM_MODEL (default "claude"),
//      CUA_SHIM_PERSIST (session | always | none; default session), CUA_SHIM_SURFACES (default computer),
//      CUA_SHIM_LOG (JSONL journal path; unset = no journal), CUA_SHIM_PLUGIN_MCP (override the plugin .mcp.json path).
import {spawn} from 'node:child_process';
import {readFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';

const env=process.env;
const PLUGIN_MCP=env.CUA_SHIM_PLUGIN_MCP||homedir()+'/.codex/plugins/cache/openai-bundled/unified-computer-use/26.924.22138/.mcp.json';
const CODEX_HOME=env.CUA_SHIM_CODEX_HOME||'/tmp/maws-cu-probe/codex-home';
const SESSION=env.CUA_SHIM_SESSION_ID||env.CLAUDE_CODE_SESSION_ID||randomUUID();
const MODEL=env.CUA_SHIM_MODEL||'claude';
const PERSIST=env.CUA_SHIM_PERSIST||'session';
const SURFACES=env.CUA_SHIM_SURFACES||'computer';
const LOG=env.CUA_SHIM_LOG;
const MODEL_TOOLS=new Set(['js','js_reset']);
const KEEP_TOOLS=new Set([...MODEL_TOOLS,'turn_ended']);

const plugin=JSON.parse(readFileSync(PLUGIN_MCP,'utf8')).mcpServers.cua_repl;
const modules=plugin.env.NODE_REPL_NODE_MODULE_DIRS;
mkdirSync(CODEX_HOME,{recursive:true});
const childEnv={...env,...plugin.env,CODEX_HOME,NODE_REPL_TRUSTED_CODE_PATHS:`${CODEX_HOME}:${modules}`,CUA_REPL_ENABLED_SURFACES:SURFACES,NODE_REPL_DISABLE_ANALYTICS:'1'};
for(const k of Object.keys(childEnv))if(k.startsWith('CUA_SHIM_'))delete childEnv[k];

const child=spawn(plugin.command,plugin.args,{env:childEnv,stdio:['pipe','pipe','inherit']});
child.on('exit',(code,signal)=>{log('meta',{event:'child_exit',code,signal});process.exit(code??1);});
child.on('error',e=>{log('meta',{event:'child_error',error:e.message});process.exit(1);});
process.stdin.on('end',()=>child.stdin.end());
for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.on(sig,()=>child.kill(sig));

let seq=0;
function log(direction,frame){if(!LOG)return;appendFileSync(LOG,JSON.stringify({seq:++seq,direction,at:new Date().toISOString(),frame:strip(frame)})+'\n');}
function strip(frame){return JSON.parse(JSON.stringify(frame,(_k,v)=>v&&typeof v==='object'&&typeof v.data==='string'&&v.data.length>256?{...v,data:`<${v.data.length} base64 chars>`}:v));}

// Host → server
let calls=0;const pendingElicitations=new Set();
function toServer(msg){
 if(msg.method==='tools/call'&&msg.params){
  const p=msg.params;const meta=p._meta??{};const toolUseId=meta['claudecode/toolUseId'];
  const turnId=toolUseId||`${SESSION}-${++calls}`;
  p._meta={...meta,callId:turnId,threadId:SESSION,sessionId:SESSION,'x-codex-turn-metadata':{session_id:SESSION,thread_id:SESSION,turn_id:turnId,call_id:turnId,model:MODEL}};
 }
 if(msg.id!==undefined&&msg.method===undefined&&pendingElicitations.has(msg.id)){
  pendingElicitations.delete(msg.id);
  if(msg.result&&msg.result.action==='accept'){
   if(msg.result.content==null)msg.result.content={};
   if(PERSIST!=='none'&&msg.result._meta==null)msg.result._meta={persist:PERSIST};
  }
 }
 return msg;
}

// Server → host
const MAGIC=[['/9j/','image/jpeg'],['iVBOR','image/png'],['R0lGOD','image/gif'],['UklGR','image/webp']];
function sniff(item){if(item.type!=='image'||typeof item.data!=='string')return item;const hit=MAGIC.find(([m])=>item.data.startsWith(m));return hit&&hit[1]!==item.mimeType?{...item,mimeType:hit[1]}:item;}
const listRequests=new Set();
function toHost(msg){
 if(msg.method==='elicitation/create'&&msg.id!==undefined)pendingElicitations.add(msg.id);
 if(msg.id!==undefined&&msg.result){
  if(listRequests.has(msg.id)){listRequests.delete(msg.id);if(Array.isArray(msg.result.tools))msg.result.tools=msg.result.tools.filter(t=>KEEP_TOOLS.has(t.name)).map(t=>MODEL_TOOLS.has(t.name)?{...t,_meta:{...(t._meta??{}),'anthropic/alwaysLoad':true}}:t);}
  if(Array.isArray(msg.result.content))msg.result.content=msg.result.content.map(sniff);
 }
 return msg;
}

function relay(input,output,rewrite,direction){
 createInterface({input}).on('line',line=>{if(!line.trim())return;let msg;try{msg=JSON.parse(line);}catch{output.write(line+'\n');return;}
  if(direction==='to_server'&&msg.method==='tools/list'&&msg.id!==undefined)listRequests.add(msg.id);
  const out=rewrite(msg);log(direction,out);output.write(JSON.stringify(out)+'\n');});
}
relay(process.stdin,child.stdin,toServer,'to_server');
relay(child.stdout,process.stdout,toHost,'to_host');
log('meta',{event:'start',session:SESSION,codexHome:CODEX_HOME,persist:PERSIST,surfaces:SURFACES,command:plugin.command,args:plugin.args,pid:child.pid});
