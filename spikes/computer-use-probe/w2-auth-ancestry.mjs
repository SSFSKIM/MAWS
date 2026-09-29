// W2-1f: immediate parent vs ancestor. node_repl's immediate parent is an unsigned node, whose parent is OpenAI's
// signed node (and the reverse order). listApps only; no GUI action.
import {run,root} from './mcp-client.mjs';
import {cuaRepl} from './cua-env.mjs';
import {readFileSync} from 'node:fs';
const base=cuaRepl();
const banner=readFileSync('/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/instructions/banner.js','utf8');
const env={...base.env,NODE_REPL_JS_BANNER:banner,NODE_REPL_UNTRUSTED_ENV_ALLOWLIST:'CUA_REPL_ENABLED_SURFACES,CUA_REPL_BROWSER_ENV'};
const signed=base.command, unsigned=process.execPath;
for (const [name,first,second] of [['w2-auth-ancestry-signed-then-unsigned',signed,unsigned],['w2-auth-ancestry-unsigned-then-signed',unsigned,signed]])
 await run(name,async p=>{
  await p.init();
  const r=await p.callTool('js',{title:'listApps',code:'const apps = await cua.listApps({emit:false}); nodeRepl.write(`apps=${apps.length}`);'});
  const procs=p.tree('chain');
  console.log(name,'| isError',!!r.isError,'|',r.content.filter(c=>c.type==='text').map(c=>c.text).join(' ').slice(-120).replace(/\n/g,' '));
  console.log('  chain:',procs.slice(0,3).map(x=>x.command.split(' ')[0].replace(/.*\//,'')).join(' → '));
 },{command:first,args:[root+'hop-launcher.mjs'],env:{...env,HOP_EXEC_1:second},capabilities:{elicitation:{form:{}}}});
