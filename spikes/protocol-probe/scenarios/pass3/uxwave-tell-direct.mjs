// The subagent tell (UX wave, the direct tell): can MAWS's engine host message one of a session's subagents itself,
// as a terminal session's bridge does with the plugin interface's `$.session.send({ to: { agentId }, text })`, rather
// than asking the parent to `SendMessage` it? The engine takes no control request for it (`send_task_message` answers
// "Unsupported control request subtype" on a local session), so the probe loads a mod of MAWS's own with
// `--plugin-dir`: it registers one tool (`$.tool.register`) whose `tool.run` hook makes the send, and the host calls
// that tool through the `mcp_call` control, with no model turn. Answered from what the engine sends a scripted Messages
// API stand-in (../../stub-api.mjs), so nothing is spent, under a scratch CLAUDE_CONFIG_DIR (p1-common.mjs: none of the
// person's settings, hooks or plugins load; the environment is rebuilt from the base keys, so no sminos variable
// reaches the engine and the only token is the stand-in's).
//   uxwave-tell-register        the mod loads, registers its tool, and `--disallowedTools` withholds it from the
//                               model: what mcp_status lists, and what an mcp_call answers, plain and checked
//   uxwave-tell-register-open   the same mod with no deny rule: the checked call runs the hook (`tool.run` runs only
//                               under `check_permissions`, after a `can_use_tool` to the host)
//   uxwave-tell-hidden          the mod's `tool.offer` hook keeps the tool from the model: no request names it, the
//                               model's own call of it is refused, and the host's checked call still runs the hook
//   uxwave-tell-guard           no `tool.offer` hook: the model calls the tool and the hook refuses it, its call's id
//                               not a host's (`toolu_mcp_call_`)
//   uxwave-tell-live-bg         a background child held in a permission request: the tell's answer, and whether the
//                               child's next request carries the text
//   uxwave-tell-live-fg         the same asked as a foreground child (run_in_background false), which this engine
//                               launches in the background anyway (task_started is_backgrounded true)
//   uxwave-tell-live-fg-waited  a child the parent truly waits on, background tasks switched off
//   uxwave-tell-ended           a background child that has finished: the tell's answer, and whether the child is
//                               resumed with the text
//   uxwave-tell-stopped         a background child stopped with stop_task: the tell's answer
//   uxwave-tell-builtin-*       the same questions of the mod the app ships (mods/maws-tell)
//   uxwave-tell-mode-<mode>     a finished child told after `set_permission_mode` plan or dontAsk: whether the host is
//                               asked and the hook runs; `-check` adds the mod's `tool.check` allow for the host's own
//                               call, and uxwave-tell-check-default asks whether that allow spares the `can_use_tool`
import {check,success,endAsStop,launch,scratchRun,removeRun,initPayload,delay,join,mkdirSync,writeFileSync} from './p1-common.mjs';
import {startStubApi,textTurn,toolTurn} from '../../stub-api.mjs';
import {fileURLToPath} from 'node:url';

const MOD='maws-tell-probe';
const CHILD_MARK='TELL-PROBE-CHILD';
const TELL_TEXT='TELL-PROBE-TEXT: also list the folder';
const PROVENANCE={charter:'docs/charter.md',child:'UX wave, the direct subagent tell',api:'stub-api.mjs (nothing spent)'};

// The probe mod: one tool, answered by its own tool.run hook, which sends the text to the agent the input names and
// refuses any call that is not the host's (a checked mcp_call's id is `toolu_mcp_call_<uuid>`). The input's id is
// `agent`, since `agentId` beside a tool's arguments is the engine's (the calling loop). `offer` adds the hook that keeps
// the tool from every loop's model; `checkAllow` adds a tool.check hook that allows the host's own call.
const modFiles=({offer=true,checkAllow=false}={})=>({
 '.claude-plugin/plugin.json':JSON.stringify({name:MOD,version:'0.1.0',description:'MAWS probe: a host tells one of the session\'s agents something'},null,1)+'\n',
 'hooks/hooks.json':JSON.stringify({modules:['./register.ts']})+'\n',
 'hooks/register.ts':`// MAWS probe mod (spikes/protocol-probe/scenarios/pass3/uxwave-tell-direct.mjs)
const TOOL = 'mcp__${MOD}__tell'
const fromHost = id => typeof id === 'string' && id.startsWith('toolu_mcp_call_')
export const register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      const r = await $.tool.register({ name: 'tell', description: 'Sends a message to one of this session\\'s agents.', inputSchema: { type: 'object', properties: { agent: { type: 'string' }, text: { type: 'string' } }, required: ['agent', 'text'] } })
      $.ui.log('TELL_PROBE registered ' + r.tool, { to: 'transcript' })
    } catch (error) {
      $.ui.log('TELL_PROBE register failed ' + String(error), { to: 'transcript' })
    }
    return result
  })
  on('tool.run', { tool: TOOL }, async ($, e) => {
    if (!fromHost(e.tool_use_id)) return { deny: 'TELL_NOT_HOST ' + String(e.tool_use_id) }
    const sent = await $.session.send({ to: { agentId: String(e.agent) }, text: String(e.text) })
    return sent.isDelivered ? { result: 'delivered' } : { deny: 'TELL_REFUSED ' + sent.reason }
  })
${offer?"  on('tool.offer', { tool: TOOL }, () => ({ isOffered: false }))\n":''}${checkAllow?"  on('tool.check', { tool: TOOL }, ($, e, next) => fromHost(e.tool_use_id) ? { decision: 'allow', reason: 'the host tells an agent' } : next(e))\n":''}  on('ui.message', async ($, e, next) => {
    const data = e.data
    if (!data || typeof data !== 'object' || !('agent' in data)) return next(e)
    const sent = await $.session.send({ to: { agentId: String(data.agent) }, text: String(data.text) })
    return { props: sent }
  })
}
`,
});

function writeMod(root,mod){
 const dir=join(root,MOD);
 for(const [path,text] of Object.entries(modFiles(mod))){mkdirSync(join(dir,path,'..'),{recursive:true});writeFileSync(join(dir,path),text);}
 return dir;
}

const isChild=body=>JSON.stringify(body.messages?.[0]??'').includes(CHILD_MARK);
// What a request carried: the tools by name, whether it is the child's, and whether it holds the told text.
const record=body=>{const text=JSON.stringify(body.messages??[]);return {tools:(body.tools??[]).map(t=>t.name).sort(),child:isChild(body),told:text.includes('TELL-PROBE-TEXT'),named:JSON.stringify(body).includes(`${MOD}__tell`),messages:(body.messages??[]).length};};

async function registeredTool(p){
 const log=await p.wait(f=>f.type==='system'&&f.subtype==='ui_log'&&String(f.text??'').startsWith('TELL_PROBE'),{timeout:30000});
 p.note({event:'mod_log',text:log.text});
 return String(log.text).startsWith('TELL_PROBE registered ')?String(log.text).slice('TELL_PROBE registered '.length):null;
}
async function tell(p,tool,agent,label,{checked=true}={}){
 const answer=await p.request('mcp_call',{tool,arguments:{agent,text:TELL_TEXT},...(checked&&{check_permissions:true})},30000).catch(e=>({error:String(e.message)}));
 p.note({event:'tell_answer',label,agent,answer});
 return answer;
}
// The agent ids the engine reported for the session's tasks (task_started frames), newest last.
const agentIds=p=>p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='task_started').map(r=>r.frame.task_id);

// MAWS's own mod as the app ships it (mods/maws-tell), for the builtin scenarios
const BUILTIN=fileURLToPath(new URL('../../../../mods/maws-tell',import.meta.url));
const BUILTIN_TOOL='mcp__maws-tell__tell';
async function builtinTool(p){
 for(let i=0;i<20;i++){
  const status=await p.request('mcp_status',{},15000).catch(()=>null);
  const server=status?.response?.mcpServers?.find(s=>s.name==='maws-tell');
  if(server?.status==='connected'&&server.tools?.some(t=>t.name==='tell')){p.note({event:'builtin_listed',server:{name:server.name,status:server.status,source:server.source,tools:server.tools.map(t=>t.name)}});return BUILTIN_TOOL;}
  await delay(250);
 }
 return null;
}

async function probe(name,{question,flags=[],vars={},mod,builtin=false,respond,body,permission=()=>({behavior:'deny',message:'the probe denies the call'})}){
 const run=scratchRun(name.replace(/^uxwave-/,''));
 const plugin=builtin?BUILTIN:writeMod(run.root,mod);
 const stub=await startStubApi({record,respond});
 try{
  await launch(name,run,{dir:'fixtures/uxwave/',relay:false,spendCap:'0.01',flags:['--plugin-dir',plugin,...flags],debugPattern:/plugin|tool\.register|session\.send|SendMessage|mcp_call|TELL/i,vars:{ANTHROPIC_BASE_URL:stub.url,ANTHROPIC_AUTH_TOKEN:'stub-token',...vars},provenance:{...PROVENANCE,question}},async p=>{
   // the host's own tell is allowed at once (the checked call asks); any other call is the scenario's
   p.on('can_use_tool',r=>{if(String(r.tool_name).endsWith('__tell')){p.note({event:'permission_asked',tool:r.tool_name,agentId:r.agent_id??null});return {behavior:'allow',updatedInput:r.input};}return permission(p,r);});
   success(await p.init(initPayload(run.cwd)),'initialize');
   const tool=builtin?await builtinTool(p):await registeredTool(p);
   check(p,'the mod registered its tool',tool!==null,tool);
   await body(p,{stub,tool});
   p.note({event:'stub_requests',requests:stub.requests});
   await endAsStop(p);
  });
 }finally{await stub.close();removeRun(run);}
}

const agentCall=background=>toolTurn('toolu_tell_agent','Agent',{description:'tell probe child',prompt:`${CHILD_MARK}: create held.txt with Bash, then reply DONE.`,subagent_type:'general-purpose',run_in_background:background});

// Parent: one Agent call, then a closing text for every later request. Child: one Bash call (held at its permission
// request while the host tells it), then DONE.
function family(background){
 let parent=0,child=0;
 return body=>{
  if(isChild(body))return child++===0?toolTurn('toolu_tell_bash','Bash',{command:'touch held.txt',description:'Create a file'}):textTurn('DONE');
  return parent++===0?agentCall(background):textTurn('parent done');
 };
}

const registerBody=withheld=>async(p,{stub,tool})=>{
 const status=await p.request('mcp_status',{},15000).catch(e=>({error:String(e.message)}));
 p.note({event:'mcp_status',answer:status});
 await tell(p,tool,'a0000000000000000','no such agent, unchecked',{checked:false});
 await tell(p,tool,'a0000000000000000','no such agent, checked');
 await p.turn('Say ready.');
 const main=stub.requests.filter(r=>r.main);
 p.note({event:'offered',withheld,offered:main.map(r=>r.tools.includes(tool))});
 const attach=await p.request('ui_attach',{surface:'desktop',client_id:'probe',viewport:{columns:100,rows:40},answers:[]},15000).catch(e=>({error:String(e.message)}));
 p.note({event:'ui_attach',answer:attach});
 const message=await p.request('ui_message',{plugin:MOD,instance_id:'probe-instance',client:'probe',module:'probe.js',component:'Pane',surface:'desktop',client_id:'probe',data:{agent:'a0000000000000000',text:TELL_TEXT}},15000).catch(e=>({error:String(e.message)}));
 p.note({event:'ui_message',answer:message});
};

// The parent's model calls the tell tool itself, then closes; the host then makes its own checked call.
const MODEL_CALL={agent:'a0000000000000000',text:TELL_TEXT};
const modelCalls=()=>{let n=0;return body=>isChild(body)?undefined:n++===0?toolTurn('toolu_tell_model','mcp__'+MOD+'__tell',MODEL_CALL):textTurn('parent done');};
const modelCallBody=async(p,{stub,tool})=>{
 await p.turn('Call the tell tool.');
 const results=p.frames.filter(r=>r.frame.type==='user'&&Array.isArray(r.frame.message?.content)).flatMap(r=>r.frame.message.content.filter(b=>b.type==='tool_result'&&b.tool_use_id==='toolu_tell_model'));
 p.note({event:'model_call_result',results});
 p.note({event:'named_in_requests',named:stub.requests.filter(r=>r.main).map(r=>r.named)});
 await tell(p,tool,'a0000000000000000','host call after the model\'s');
};

// A finished child told after the session's mode changed (null: left at default).
const modeBody=mode=>async(p,{stub,tool})=>{
 await p.turn('Start the child.');
 await p.wait(f=>f.type==='system'&&f.subtype==='task_notification',{timeout:30000}).catch(()=>{});
 await delay(2000);
 if(mode!==null){const set=await p.request('set_permission_mode',{mode},15000).catch(e=>({error:String(e.message)}));p.note({event:'set_permission_mode',mode,answer:set});}
 await tell(p,tool,agentIds(p).at(-1),'finished background child'+(mode?' in '+mode:''));
 await delay(8000);
 p.note({event:'resumed_with_text',value:stub.requests.some(r=>r.child&&r.told)});
};
const modeScenarios=(mode,checkAllow)=>({[`uxwave-tell-mode-${mode.toLowerCase()}${checkAllow?'-check':''}`]:{question:`a finished child told in ${mode} mode${checkAllow?', the mod allowing the host\'s own call at tool.check':''}: is the host asked, does the hook run, is the child resumed`,mod:{checkAllow},respond:family(true),body:modeBody(mode)}});

// The same questions asked of the mod the app ships, the host's call made as the engine host makes it: a running
// background child, a child the parent waits on, a finished child, a stopped child, and plan and dontAsk mode (whose
// tool.check allow the mod carries), and the model's own call of the tool (refused: not offered).
function builtinScenarios(){
 const held=(label)=>async(p,r)=>{p.note({event:'held',tool:r.tool_name,agentId:r.agent_id??null});await tell(p,BUILTIN_TOOL,r.agent_id??agentIds(p).at(-1),label);return {behavior:'deny',message:'the probe denies the call'};};
 const told=async(p,{stub})=>{await p.turn('Start the child.');await p.wait(()=>stub.requests.some(r=>r.child&&r.told),{timeout:30000}).catch(()=>{});await delay(3000);p.note({event:'child_told',value:stub.requests.some(r=>r.child&&r.told)});};
 const stopping=async(p,r)=>{const id=agentIds(p).at(-1);const stop=await p.request('stop_task',{task_id:id},15000).catch(e=>({error:String(e.message)}));p.note({event:'stop_task',answer:stop});await delay(1500);await tell(p,BUILTIN_TOOL,id,'stopped background child');return {behavior:'deny',message:'the probe denies the call'};};
 const base={builtin:true};
 return {
  'uxwave-tell-builtin-live-bg':{...base,question:'the shipped mod: a running background child, held at a permission request',respond:family(true),permission:held('running background child'),body:told},
  'uxwave-tell-builtin-waited':{...base,question:'the shipped mod: a child the parent waits on, held at a permission request',vars:{CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:'1'},respond:family(false),permission:held('waited foreground child'),body:told},
  'uxwave-tell-builtin-ended':{...base,question:'the shipped mod: a finished background child is resumed with the text',respond:family(true),body:modeBody(null)},
  'uxwave-tell-builtin-stopped':{...base,question:'the shipped mod: a child stopped with stop_task refuses',respond:family(true),permission:stopping,body:async(p)=>{await p.turn('Start the child.');await delay(4000);}},
  'uxwave-tell-builtin-plan':{...base,question:'the shipped mod in plan mode: refused',respond:family(true),body:modeBody('plan')},
  'uxwave-tell-builtin-dontask':{...base,question:'the shipped mod in dontAsk mode: delivered, the mod allowing the host\'s own call',respond:family(true),body:modeBody('dontAsk')},
  'uxwave-tell-builtin-model':{...base,question:'the shipped mod: no request names the tool, and the model\'s own call of it is refused',respond:(()=>{let n=0;return body=>isChild(body)?undefined:n++===0?toolTurn('toolu_tell_model',BUILTIN_TOOL,MODEL_CALL):textTurn('parent done');})(),body:modelCallBody},
 };
}

const SCENARIOS={
 'uxwave-tell-register':{question:'a --plugin-dir mod registers a tool withheld from the model by --disallowedTools: is it listed, absent from the request, and callable through mcp_call',mod:{offer:false},flags:['--disallowedTools','mcp__*__tell'],body:registerBody(true)},
 'uxwave-tell-register-open':{question:'the same mod with no deny rule: mcp_call reaches its hook only when checked',mod:{offer:false},body:registerBody(false)},
 'uxwave-tell-hidden':{question:'a tool.offer hook keeps the tool from the model: no request names it, the model\'s call is refused, and the host\'s checked call still runs the hook',respond:modelCalls('hidden'),body:modelCallBody},
 'uxwave-tell-guard':{question:'no tool.offer hook: the model calls the tool and the hook refuses a call whose id is not the host\'s',mod:{offer:false},respond:modelCalls('guard'),body:modelCallBody},
 'uxwave-tell-live-bg':{question:'a running background child, held at a permission request: the tell answers, and the child\'s next request carries the text',respond:family(true),permission:async(p,r)=>{
  const id=agentIds(p).at(-1);p.note({event:'held',tool:r.tool_name,agentId:r.agent_id??null,tasks:agentIds(p)});
  await tell(p,p.tellTool,r.agent_id??id,'running background child');
  return {behavior:'deny',message:'the probe denies the call'};
 },body:async(p,{stub,tool})=>{p.tellTool=tool;await p.turn('Start the child.');await p.wait(()=>stub.requests.some(r=>r.child&&r.told),{timeout:30000}).catch(()=>{});await delay(3000);check(p,'the child read the text',stub.requests.some(r=>r.child&&r.told),stub.requests);}},
 'uxwave-tell-live-fg':{question:'a running foreground child, held at a permission request: the tell answers, and the child\'s next request carries the text',respond:family(false),permission:async(p,r)=>{
  p.note({event:'held',tool:r.tool_name,agentId:r.agent_id??null,tasks:agentIds(p)});
  await tell(p,p.tellTool,r.agent_id??agentIds(p).at(-1),'running foreground child');
  return {behavior:'deny',message:'the probe denies the call'};
 },body:async(p,{stub,tool})=>{p.tellTool=tool;await p.turn('Start the child.');await delay(3000);check(p,'the child read the text',stub.requests.some(r=>r.child&&r.told),stub.requests);}},
 'uxwave-tell-live-fg-waited':{question:'a foreground child the parent truly waits on (CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1, since this engine launches run_in_background false in the background), held at a permission request: the tell answers, and the child\'s next request carries the text',vars:{CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:'1'},respond:family(false),permission:async(p,r)=>{
  p.note({event:'held',tool:r.tool_name,agentId:r.agent_id??null,tasks:agentIds(p)});
  await tell(p,p.tellTool,r.agent_id??agentIds(p).at(-1),'running foreground child');
  return {behavior:'deny',message:'the probe denies the call'};
 },body:async(p,{stub,tool})=>{p.tellTool=tool;await p.turn('Start the child.');await delay(3000);check(p,'the child read the text',stub.requests.some(r=>r.child&&r.told),stub.requests);}},
 'uxwave-tell-ended':{question:'a background child that has finished: the tell answers, and the child is resumed with the text',respond:family(true),permission:()=>({behavior:'deny',message:'the probe denies the call'}),body:async(p,{stub,tool})=>{
  await p.turn('Start the child.');
  await p.wait(f=>f.type==='system'&&f.subtype==='task_notification',{timeout:30000}).catch(()=>{});
  await delay(2000);
  const id=agentIds(p).at(-1);
  await tell(p,tool,id,'finished background child');
  await delay(8000);
  check(p,'the child was resumed with the text',stub.requests.some(r=>r.child&&r.told),stub.requests);
 }},
 ...modeScenarios('plan',false),...modeScenarios('dontAsk',false),...modeScenarios('plan',true),...modeScenarios('dontAsk',true),
 'uxwave-tell-check-default':{question:'the mod\'s tool.check allows the host\'s own call: is the host still asked, and does a finished child resume',mod:{checkAllow:true},respond:family(true),body:modeBody(null)},
 'uxwave-tell-stopped':{question:'a background child stopped with stop_task: the tell answers',respond:family(true),permission:async(p,r)=>{
  const id=agentIds(p).at(-1);
  const stop=await p.request('stop_task',{task_id:id},15000).catch(e=>({error:String(e.message)}));
  p.note({event:'stop_task',answer:stop});
  await delay(1500);
  await tell(p,p.tellTool,id,'stopped background child');
  return {behavior:'deny',message:'the probe denies the call'};
 },body:async(p,{stub,tool})=>{p.tellTool=tool;await p.turn('Start the child.');await delay(4000);}},
 ...builtinScenarios(),
};

export default async()=>{
 const only=(process.env.TELL_ONLY??'').split(',').filter(Boolean);
 for(const [name,scenario] of Object.entries(SCENARIOS))if(only.length===0||only.includes(name))await probe(name,scenario);
};
