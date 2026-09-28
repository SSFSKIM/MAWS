// W2-1c: which parent does the service accept for the node_repl relay? No GUI action: listApps, and an app-policy
// check for TextEdit whose approval elicitation is declined (so no GetSkyshot, no launch, no input).
import {run} from './mcp-client.mjs';
import {cuaRepl} from './cua-env.mjs';
import {readFileSync} from 'node:fs';
const base=cuaRepl();
const banner=readFileSync('/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/instructions/banner.js','utf8');
const direct={command:base.env.CUA_REPL_NODE_REPL_PATH,args:[],env:{...base.env,NODE_REPL_JS_BANNER:banner,NODE_REPL_UNTRUSTED_ENV_ALLOWLIST:'CUA_REPL_ENABLED_SURFACES,CUA_REPL_BROWSER_ENV'}};
const cells={
 listApps:'const apps = await cua.listApps({emit:false}); nodeRepl.write(`apps=${apps.length}`);',
 policyTextEdit:'try { await cua.getApp("TextEdit"); nodeRepl.write("getApp returned"); } catch (e) { nodeRepl.write(`getApp error: ${e.message}`); }',
};
const cases=[['w2-auth-via-signed-node-launcher',base],['w2-auth-node_repl-direct-child-of-unsigned',direct]];
for (const [name,spec] of cases) await run(name,async p=>{
 p.on('elicitation/create',params=>{p.note({event:'elicitation_seen',message:params.message,meta:params._meta??params.meta});return {action:'decline'};});
 await p.init();await p.request('tools/list',{});
 for (const [cell,code] of Object.entries(cells)){const r=await p.callTool('js',{title:cell,code,timeout_ms:30000});const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');console.log(name,cell,'isError',!!r.isError,'→',text.slice(-400).replace(/\n/g,' | '));}
 p.tree('end');
},{...spec,capabilities:{elicitation:{form:{}}}});
