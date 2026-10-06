// E7 M0 (docs/doperpowers/plans/2026-10-06-e7-orchestration.md, Interfaces "Probe scenarios and fixtures"; child E7 of
// the P1 composite docs/doperpowers/plans/2026-10-05-p1-extension.md, parent pin c2269755fde4bb2f3a8e34b2014352a3dd640132):
// what the e7-* scenarios share on top of p1-common.mjs's launch (scratch config home under /tmp, MAWS's launch line and
// environment, the relay gate, the owner-file delta of A-15).
import {redact} from '../../harness.mjs';
import {idle,turnOpen} from './c8b-common.mjs';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {join,relative,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export {idle,turnOpen};

export const E7={child:'E7',document:'docs/doperpowers/plans/2026-10-06-e7-orchestration.md',pin:'c2269755fde4bb2f3a8e34b2014352a3dd640132',spike:'E7 M0'};
// The engine's debug lines about what E7 probes (messaging, the registry, scheduling, teams).
export const E7_DEBUG=/uds-messaging|cross-session|peer|inbox|sessionRegistry|ScheduledTasks|ListAgents|SendMessage|cron|schedul|team|teammate|amber_flint/i;

export const sys=(f,subtype)=>f.type==='system'&&f.subtype===subtype;
export const blocks=f=>Array.isArray(f.message?.content)?f.message.content:[];
export const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(b=>typeof b==='string'?b:b.type==='text'?b.text:b.type==='tool_result'?textOf(b.content):'').join('\n'):'';
export const allowAll=p=>p.on('can_use_tool',r=>{p.note({event:'permission_asked',tool:r.tool_name,input:r.input});return {behavior:'allow',updatedInput:r.input};});

// The parent lane's tool uses and results (parent_tool_use_id null), with the tool_use_result the engine attaches.
export const toolUsesAfter=(p,from,name)=>p.frames.filter(r=>r.seq>from&&r.frame.type==='assistant'&&!r.frame.parent_tool_use_id).flatMap(r=>blocks(r.frame).filter(b=>b.type==='tool_use'&&(!name||b.name===name)).map(b=>({seq:r.seq,at:r.at,id:b.id,name:b.name,input:b.input})));
export const resultOf=(p,id)=>{const r=p.frames.find(x=>x.frame.type==='user'&&!x.frame.parent_tool_use_id&&blocks(x.frame).some(b=>b.type==='tool_result'&&b.tool_use_id===id));if(!r)return null;const b=blocks(r.frame).find(b=>b.type==='tool_result'&&b.tool_use_id===id);return {seq:r.seq,at:r.at,isError:b.is_error??false,text:textOf(b.content),structured:r.frame.tool_use_result??null};};
export const pairsAfter=(p,from,name)=>toolUsesAfter(p,from,name).map(u=>({use:u,result:resultOf(p,u.id)}));
export const waitToolUse=(p,from,name,timeout=120000)=>p.wait(f=>f.type==='assistant'&&!f.parent_tool_use_id&&blocks(f).some(b=>b.type==='tool_use'&&b.name===name),{after:from,timeout}).then(()=>toolUsesAfter(p,from,name)[0]).catch(()=>null);
export const waitResultOf=(p,id,timeout=120000)=>p.wait(f=>f.type==='user'&&!f.parent_tool_use_id&&blocks(f).some(b=>b.type==='tool_result'&&b.tool_use_id===id),{timeout}).then(()=>resultOf(p,id)).catch(()=>null);
export const lifecycleOf=(p,uuid)=>p.frames.filter(r=>r.frame.type==='command_lifecycle'&&r.frame.command_uuid===uuid).map(r=>({seq:r.seq,at:r.at,state:r.frame.state}));
export const resultsAfter=(p,from)=>p.frames.filter(r=>r.seq>from&&r.frame.type==='result').map(r=>({seq:r.seq,at:r.at,subtype:r.frame.subtype,is_error:r.frame.is_error,user_message_uuids:r.frame.user_message_uuids??null,result:typeof r.frame.result==='string'?r.frame.result.slice(0,600):null,total_cost_usd:r.frame.total_cost_usd}));
export const cost=p=>Math.max(0,...p.frames.filter(r=>r.frame.type==='result').map(r=>r.frame.total_cost_usd??0));

// A frame row in brief: what a finding cites.
export const brief=r=>({seq:r.seq,direction:r.direction,type:r.frame.type,subtype:r.frame.subtype??r.frame.request?.subtype??r.frame.event??null,origin:r.frame.origin??undefined,uuid:r.frame.uuid??undefined,isReplay:r.frame.isReplay??undefined,priority:r.frame.priority??undefined,text:r.frame.type==='user'?textOf(r.frame.message?.content).slice(0,240):undefined,state:r.frame.state??undefined,command_uuid:r.frame.command_uuid??undefined});
export const framesBetween=(p,from,to=Infinity)=>p.frames.filter(r=>r.seq>from&&r.seq<to&&r.frame.type!=='stream_event').map(brief);

// The steer MAWS writes (src/engine-host/queue.ts steer): a `user` frame with origin human and a priority.
export function steer(p,content,{priority='next',label}={}){
 const uuid=randomUUID(),open=turnOpen(p);
 p.send({type:'user',uuid,message:{role:'user',content},parent_tool_use_id:null,origin:{kind:'human'},priority});
 const s={seq:p.seq,at:Date.now(),uuid,content,priority,turnOpenAtSend:open,label};p.note({event:'e7_steer',...s,at:new Date(s.at).toISOString()});return s;
}
// A plain prompt that does not wait for its result (the harness's turn() waits).
export function prompt(p,content){const uuid=randomUUID();p.send({type:'user',uuid,message:{role:'user',content},parent_tool_use_id:null,origin:{kind:'human'}});return {seq:p.seq,uuid};}

// Files under a directory, with their mtimes, sizes and (small JSON) contents.
export function snapshotDir(dir){
 const out={};const walk=d=>{if(!existsSync(d))return;for(const e of readdirSync(d,{withFileTypes:true})){const f=join(d,e.name);if(e.isDirectory())walk(f);else{const st=statSync(f);let content=null;try{const t=readFileSync(f,'utf8');content=t.length<20000?(f.endsWith('.json')?JSON.parse(t):t):null;}catch{content=null;}out[relative(dir,f)]={mtimeMs:st.mtimeMs,size:st.size,content};}}};
 walk(dir);return out;
}
// Copies files into a fixture directory, redacted as the harness redacts journals.
export function copyRedacted(src,dst){mkdirSync(dirname(dst),{recursive:true});writeFileSync(dst,redact(readFileSync(src,'utf8')));}
export const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
