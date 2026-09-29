// The cua_repl launch recipe Codex Desktop writes into the unified-computer-use plugin's .mcp.json,
// re-pointed at a scratch CODEX_HOME so probes never write into ~/.codex, with analytics off.
import {readFileSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
export const PLUGIN_MCP=homedir()+'/.codex/plugins/cache/openai-bundled/unified-computer-use/26.924.22138/.mcp.json';
export const SCRATCH='/tmp/maws-cu-probe';
export const MODULES='/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules';
export function cuaRepl({surfaces='computer',codexHome=SCRATCH+'/codex-home',extraEnv={}}={}){
 const server=JSON.parse(readFileSync(PLUGIN_MCP,'utf8')).mcpServers.cua_repl;mkdirSync(codexHome,{recursive:true});
 const env={...server.env,CODEX_HOME:codexHome,NODE_REPL_TRUSTED_CODE_PATHS:`${codexHome}:${MODULES}`,CUA_REPL_ENABLED_SURFACES:surfaces,NODE_REPL_DISABLE_ANALYTICS:'1',...extraEnv};
 return {command:server.command,args:server.args,env,server};
}
