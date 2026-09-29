// W2-1e: the legacy direct Swift MCP server (SkyComputerUseClient mcp) from a non-OpenAI parent: list_apps only.
import {run} from './mcp-client.mjs';
await run('w2-client-mcp-list-apps',async p=>{
 await p.init();const t=await p.request('tools/list',{});p.note({event:'tools',tools:t.tools});
 try{const r=await p.callTool('list_apps',{},{timeout:30000});console.log('list_apps isError',!!r.isError,'→',JSON.stringify(r.content).slice(0,300));}catch(e){console.log('list_apps failed:',e.message);}
},{command:process.env.HOME+'/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient',args:['mcp'],env:{CODEX_HOME:'/tmp/maws-cu-probe/codex-home'},capabilities:{elicitation:{form:{}}}});
