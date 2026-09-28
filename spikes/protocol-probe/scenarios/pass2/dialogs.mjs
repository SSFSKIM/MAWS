// Item 6: supportedDialogKinds, an MCP elicitation round trip, and dialog expiry "never" through flag settings.
import {run,initPayload,root} from './common.mjs';
const mcp={mcpServers:{'maws-elicit':{type:'stdio',command:process.execPath,args:[root+'scenarios/pass2/elicit-mcp-server.mjs']}}};
export default ()=>run('dialogs',async p=>{await p.request('initialize',initPayload());
 p.on('elicitation',r=>{p.note({event:'elicitation_seen',mcp_server_name:r.mcp_server_name,mode:r.mode,message:r.message});return {action:'accept',content:{color:'teal'}};});
 p.on('can_use_tool',r=>{p.note({event:'escalation',tool:r.tool_name,decision_reason_type:r.decision_reason_type});return {behavior:'allow',updatedInput:r.input};});
 await p.turn('Call the mcp__maws-elicit__ask_color tool once, then reply with the color it returned.');
 const s=await p.request('get_settings',{});p.note({event:'dialog_expiry',effective:s.response?.effective?.dialogExpiry});
},{model:'sonnet',flags:['--mcp-config',JSON.stringify(mcp),'--settings',JSON.stringify({dialogExpiry:'never'})]});
