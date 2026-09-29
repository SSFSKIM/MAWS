// W2-1b: the genuine OpenAI-signed node_repl, launched through cua-repl.mjs by a neutral MCP client with no
// OpenAI process in its ancestry. No GUI action: listApps only.
import {run,delay} from './mcp-client.mjs';
import {cuaRepl} from './cua-env.mjs';
const {command,args,env}=cuaRepl();
for (const [name,capabilities] of [['w2-foreign-parent-elicitation-bare',{elicitation:{}}],['w2-foreign-parent-elicitation-form',{elicitation:{form:{}}}]]){
 await run(name,async p=>{
  p.on('elicitation/create',params=>{p.note({event:'elicitation_seen',message:params.message});return {action:'decline'};});
  const init=await p.init();console.log(name,'server',JSON.stringify(init.serverInfo),'caps',JSON.stringify(init.capabilities));
  const tools=await p.request('tools/list',{});console.log(name,'tools',tools.tools.map(t=>t.name).join(','));
  const r=await p.callTool('js',{title:'List apps',code:'const apps = await cua.listApps({emit:false}); nodeRepl.write(`apps=${apps.length} first=${JSON.stringify(apps.slice(0,2))}`);',timeout_ms:30000});
  console.log(name,'js isError',r.isError,JSON.stringify(r.content.map(c=>c.type==='text'?c.text.slice(-600):c.type)));
  p.tree('after-listApps');
 },{command,args,env,capabilities});
}
