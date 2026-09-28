// W2-1d: node_repl whose parent is OpenAI's signed node running a script that is not OpenAI's (our own launcher).
// Also: SkyComputerUseClient `mcp` launched from a non-OpenAI parent. No GUI action.
import {run} from './mcp-client.mjs';
import {cuaRepl} from './cua-env.mjs';
import {readFileSync} from 'node:fs';
const base=cuaRepl();
const banner=readFileSync('/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/instructions/banner.js','utf8');
await run('w2-auth-signed-node-own-script',async p=>{
 await p.init();
 const r=await p.callTool('js',{title:'listApps',code:'const apps = await cua.listApps({emit:false}); nodeRepl.write(`apps=${apps.length}`);'});
 console.log('own-script launcher: isError',!!r.isError,'→',r.content.filter(c=>c.type==='text').map(c=>c.text).join(' ').slice(-200));
},{command:base.command,args:['/tmp/maws-cu-probe/own-launcher.mjs'],env:{...base.env,NODE_REPL_JS_BANNER:banner,NODE_REPL_UNTRUSTED_ENV_ALLOWLIST:'CUA_REPL_ENABLED_SURFACES,CUA_REPL_BROWSER_ENV'},capabilities:{elicitation:{form:{}}}});
await run('w2-client-mcp-foreign-parent',async p=>{
 const init=await p.init();console.log('client mcp initialize →',JSON.stringify(init.serverInfo));
 try{const t=await p.request('tools/list',{},15000);console.log('client mcp tools →',t.tools.map(x=>x.name).join(','));}catch(e){console.log('client mcp tools/list failed:',e.message);}
},{command:process.env.HOME+'/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient',args:['mcp'],env:{CODEX_HOME:'/tmp/maws-cu-probe/codex-home'},capabilities:{elicitation:{form:{}}}});
