// C12 M5, the launch-environment probe (launch-env-common.mjs), the variable added at M3 (the architect's ruling):
// does CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1 add `system/session_state_changed` frames to the product's launch and
// change nothing else? Two arms under the same scratch home and launch, the variable unset and then set, each one turn
// in `default` mode that asks for a write (`touch`), so the engine parks a can_use_tool the host answers after a second:
// the turn passes through every state the frame names. The set arm's fixture ends with the comparison: the frame kinds
// each arm saw beyond the other's, the init frames' fields, and what the forwarder saw of the tools and system prompt.
import {launch,initPayload,endAsStop} from './c10-common.mjs';
import {scratchRoot,clearEnvironment,startForwarder,engineEnv,noteRequests,PRODUCT_FLAGS,SPEND_CAP_PER_LAUNCH,MODEL,PROVENANCE} from './launch-env-common.mjs';
import {scratch,delay} from '../../harness.mjs';
import {realpathSync} from 'node:fs';

const TURN='Use the Bash tool to run exactly this command and nothing else: touch c12-state.txt';
const VOLATILE=new Set(['session_id','uuid','cwd','memory_paths','messaging_socket_path']);
const kind=f=>f.type==='system'?`system/${f.subtype}`:f.type==='control_request'?`control_request/${f.request?.subtype}`:f.type;

async function arm(name,repoPrefix,vars,compareWith){
 const {base,home}=scratchRoot();clearEnvironment();
 const forwarder=await startForwarder();
 const cwd=realpathSync(scratch(`${base}/${repoPrefix}`));
 const env=engineEnv({home,forwarder:forwarder.url,vars});
 let summary;
 try{
  await launch(name,{cwd,env,model:MODEL,flags:[...PRODUCT_FLAGS,'--max-budget-usd',SPEND_CAP_PER_LAUNCH],provenance:{...PROVENANCE,arm:vars,envKeys:Object.keys(env).sort()}},async p=>{
   p.on('can_use_tool',async r=>{p.note({event:'allowed_after_1s',tool:r.tool_name});await delay(1000);return {behavior:'allow',updatedInput:r.input};});
   await p.init(initPayload());
   await p.turn(TURN);
   await delay(3000); // an `idle` that follows the result arrives within it
   const frames=p.frames.filter(r=>r.direction==='in').map(r=>r.frame);
   const init=frames.find(f=>f.type==='system'&&f.subtype==='init');
   const main=forwarder.requests.filter(r=>r.agentToolName);
   summary={
    arm:vars,
    states:p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='session_state_changed').map(r=>({seq:r.seq,state:r.frame.state})),
    kinds:[...new Set(frames.filter(f=>f.type!=='stream_event').map(kind))].sort(),
    init:Object.fromEntries(Object.entries(init??{}).filter(([k])=>!VOLATILE.has(k))),
    toolsSha256:[...new Set(main.map(r=>r.toolsSha256))],systemChars:[...new Set(main.map(r=>r.systemChars))],
    canUseTool:frames.filter(f=>f.type==='control_request'&&f.request?.subtype==='can_use_tool').map(f=>f.request.tool_name),
    result:(({subtype,is_error,num_turns})=>({subtype,is_error,num_turns}))(frames.filter(f=>f.type==='result').at(-1)??{}),
    total_cost_usd:Math.max(0,...frames.filter(f=>f.type==='result').map(f=>f.total_cost_usd??0)),
   };
   noteRequests(e=>p.note(e),forwarder.requests);
   p.note({event:'launch_env_observation',...summary});
   if(compareWith){
    const onlyIn=(a,b)=>a.kinds.filter(k=>!b.kinds.includes(k));
    const initDiff=[...new Set([...Object.keys(summary.init),...Object.keys(compareWith.init)])].filter(k=>JSON.stringify(summary.init[k])!==JSON.stringify(compareWith.init[k]));
    p.note({event:'state_events_comparison',kindsOnlyWithVariable:onlyIn(summary,compareWith),kindsOnlyWithout:onlyIn(compareWith,summary),initFieldsDiffering:initDiff,
     toolsSame:JSON.stringify(summary.toolsSha256)===JSON.stringify(compareWith.toolsSha256),systemCharsSame:JSON.stringify(summary.systemChars)===JSON.stringify(compareWith.systemChars),
     canUseToolSame:JSON.stringify(summary.canUseTool)===JSON.stringify(compareWith.canUseTool),statesWithout:compareWith.states.length,states:summary.states.map(s=>s.state)});
   }
   await endAsStop(p);
  });
 }finally{await forwarder.close();}
 console.log(name,JSON.stringify({states:summary?.states.map(s=>s.state),kinds:summary?.kinds,cost:summary?.total_cost_usd}));
 return summary;
}

export default async()=>{
 const without=await arm('launch-env-state-events-unset','repo-se-no-',{},null);
 await arm('launch-env-state-events','repo-se-on-',{CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1'},without);
};
