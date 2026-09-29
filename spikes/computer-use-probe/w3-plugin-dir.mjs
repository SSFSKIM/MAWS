// W3-3: the packaged plugin, sideloaded with --plugin-dir into Claude Code 2.1.283 headless. Inventory only, no app.
// Checks the plugin server name, the plugin-qualified tool names, one js call, and the bundled Stop → turn_ended hook.
import {Probe} from '../protocol-probe/harness.mjs';
import {mkdtempSync} from 'node:fs';
for(const k of Object.keys(process.env))if(/^CMUX_/.test(k)||['CLAUDE_CODE_SESSION_ID','CLAUDE_CODE_CHILD_SESSION','CLAUDE_CODE_SESSION_ATTENDED','CLAUDE_PID','CLAUDE_CODE_MESSAGING_SOCKET','CLAUDE_CODE_MESSAGING_TOKEN','CLAUDE_CODE_EXECPATH','CLAUDE_EFFORT'].includes(k))delete process.env[k];
const BIN='/Users/new/.local/share/claude/versions/2.1.283', PLUGIN='/Users/new/Developer/GitHub/MAWS/plugins/cua';
const p=new Probe('w3-plugin-dir',{dir:'../computer-use-probe/fixtures/',bin:BIN,model:'sonnet',cwd:mkdtempSync('/tmp/maws-cc-cwd-'),strictMcp:false,flags:['--plugin-dir',PLUGIN,'--include-hook-events','--max-budget-usd','1.00']});
const seen={escalations:[],hooks:[]};
p.on('can_use_tool',r=>{seen.escalations.push(r.tool_name);return /cua_repl__/.test(r.tool_name)?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'denied by probe'};});
await p.init({});
const after=p.seq;
p.user('Using only the cua_repl js tool, run exactly `await cua.listApps({emit:false})` and reply with the number of apps it returned. Do nothing else.');
const result=await p.wait(f=>f.type==='result',{after,timeout:300000});
const init=p.frames.map(r=>r.frame).find(f=>f.type==='system'&&f.subtype==='init');
for(const row of p.frames){const m=row.frame;if(m.type==='system'&&/^hook_/.test(m.subtype||''))seen.hooks.push({subtype:m.subtype,event:m.hook_event,output:(m.output||'').slice(0,80)});}
await p.stop();
console.log(JSON.stringify({subtype:result.subtype,cost:result.total_cost_usd,mcp_servers:init?.mcp_servers,cuaTools:(init?.tools||[]).filter(t=>/cua/.test(t)),escalations:seen.escalations,hooks:seen.hooks,answer:String(result.result).slice(0,200)},null,1));
