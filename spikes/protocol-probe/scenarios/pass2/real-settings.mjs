// Item 2: owner's real settings sources with MCP discovery on; init inventory and process-tree memory (one active session, then three idle).
import {run,probe,initPayload,delay} from './common.mjs';
const real={settingSources:'user,project,local',strictMcp:false,model:'sonnet'};
const inventory=(p,f)=>p.note({event:'init_inventory',permissionMode:f.permissionMode,model:f.model,apiKeySource:f.apiKeySource,tools:f.tools,toolCount:f.tools?.length,mcp_servers:f.mcp_servers,slash_commands:f.slash_commands,commandCount:f.slash_commands?.length,skills:f.skills,skillCount:f.skills?.length,agents:f.agents,plugins:f.plugins});
export default async()=>{
 await run('real-settings',async p=>{await p.request('initialize',initPayload());await delay(20000);p.tree('idle-after-initialize');
  p.on('can_use_tool',r=>{p.note({event:'escalation',tool:r.tool_name,decision_reason_type:r.decision_reason_type});return {behavior:'allow',updatedInput:r.input};});
  const after=p.seq;p.user('Use Bash to run exactly: git status --short && sleep 4. Then reply OK.');
  await p.wait(f=>f.type==='assistant'&&f.message.content.some(b=>b.type==='tool_use'),{after});p.tree('peak-during-tool');
  const init=await p.wait(f=>f.type==='system'&&f.subtype==='init',{after});inventory(p,init);
  await p.wait(f=>f.type==='result',{after});await delay(3000);p.tree('idle-after-turn');
  await p.request('mcp_status',{});
 },real);
 const ps=[1,2,3].map(i=>probe('real-settings-idle-'+i,real));
 await Promise.all(ps.map(p=>p.request('initialize',initPayload())));await delay(25000);
 const totals=ps.map(p=>p.tree('idle-concurrent'));ps[0].note({event:'concurrent_idle_totals',totals});
 for(const p of ps)await p.stop();
};
