// C8b R5 (docs/doperpowers/plans/2026-09-28-c8b-agent-work-tools.md, Interfaces, Spike specifications): does a child
// that dispatches its own agent put the grandchild's task_started and frames on the parent's wire, with which
// parent_tool_use_id and agent_id, and what do the sidecars say. Runs under `mode: 'default'`, so a refused nested Agent
// call is the engine's policy and not a missing handler. The session's sidecars and transcripts are read from the
// scratch CLAUDE_CONFIG_DIR and copied, redacted, into fixtures/pass3/nested-agents-sidecars/.
import {run,initPayload,delay,root} from '../pass2/common.mjs';
import {redact} from '../../harness.mjs';
import {C8B,scratchConfig,sys,idle,spend,walk} from './c8b-common.mjs';
import {readFileSync,writeFileSync,mkdirSync,rmSync,realpathSync,statSync} from 'node:fs';

const ALLOWED=['Agent','Task','Read','Bash'];

export default ()=>{const config=scratchConfig();return run('nested-agents',async p=>{
 p.note({event:'c8b_scenario',...C8B,probe:'R5',mode:'default',configHome:config});
 p.on('can_use_tool',r=>{const allow=ALLOWED.includes(r.tool_name);p.note({event:'nested_permission',toolName:r.tool_name,agentId:r.agent_id??null,allowed:allow});return allow?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only Agent, Task, Read and Bash are in scope.'};});
 await p.request('initialize',initPayload({perTaskStopAffordance:true}));
 const after=p.seq;
 await p.turn('Dispatch one general-purpose Agent, model sonnet, named "outer". Its task: dispatch a general-purpose Agent, model haiku, named "inner", to read one.txt and report its line, wait for it, then report inner\'s answer. Reply DONE with both answers.');
 // a background dispatch ends the turn before the agents do: wait for every started task's notification, then the engine's turn
 const end=Date.now()+180000;
 while(Date.now()<end){const startedIds=p.frames.filter(r=>sys(r.frame,'task_started')).map(r=>r.frame.task_id);const done=new Set(p.frames.filter(r=>sys(r.frame,'task_notification')).map(r=>r.frame.task_id));if(startedIds.every(id=>done.has(id)))break;await p.wait(f=>sys(f,'task_notification'),{after:p.seq,timeout:Math.max(1000,end-Date.now())}).catch(()=>{});}
 await idle(p,90000);

 const rows=p.frames.filter(r=>r.seq>after);
 const started=rows.filter(r=>sys(r.frame,'task_started')).map(r=>({seq:r.seq,task_id:r.frame.task_id,tool_use_id:r.frame.tool_use_id,spawn_depth:r.frame.spawn_depth??null,agent_id:r.frame.agent_id??null,parent_tool_use_id:r.frame.parent_tool_use_id??null,is_backgrounded:r.frame.is_backgrounded??null,task_type:r.frame.task_type,description:r.frame.description,keys:Object.keys(r.frame)}));
 p.note({event:'nested_task_started',count:started.length,started});
 // every Agent tool_use and who issued it (parent_tool_use_id null: the main session)
 const agentCalls=rows.filter(r=>r.frame.type==='assistant').flatMap(r=>r.frame.message.content.filter(b=>b.type==='tool_use'&&(b.name==='Agent'||b.name==='Task')).map(b=>({seq:r.seq,tool_use_id:b.id,issuedUnder:r.frame.parent_tool_use_id??null,agent_id:r.frame.agent_id??null,input:{name:b.input?.name??null,model:b.input?.model??null,run_in_background:b.input?.run_in_background??null,description:b.input?.description??null}})));
 p.note({event:'nested_agent_calls',calls:agentCalls});
 const byParent={};for(const r of rows.filter(r=>r.frame.type==='assistant'||r.frame.type==='user')){const k=(r.frame.parent_tool_use_id??'main')+'|'+(r.frame.agent_id??'-');byParent[k]??={parent_tool_use_id:r.frame.parent_tool_use_id??null,agent_id:r.frame.agent_id??null,assistant:0,user:0,firstSeq:r.seq};byParent[k][r.frame.type]++;}
 p.note({event:'nested_frames_by_parent',groups:Object.values(byParent)});
 const childCall=agentCalls.find(c=>c.issuedUnder!==null);
 if(childCall){const res=rows.find(r=>r.frame.type==='user'&&Array.isArray(r.frame.message?.content)&&r.frame.message.content.some(b=>b.type==='tool_result'&&b.tool_use_id===childCall.tool_use_id));const block=res?.frame.message.content.find(b=>b.tool_use_id===childCall.tool_use_id);const text=typeof block?.content==='string'?block.content:(block?.content||[]).map(b=>b.text||'').join('');
  p.note({event:'nested_child_agent_result',tool_use_id:childCall.tool_use_id,is_error:block?.is_error??null,text:text.slice(0,600)});
  if(block?.is_error)p.note({event:'nested_refused',text:text.slice(0,600)});}
 else p.note({event:'nested_refused',text:null,reason:'the child issued no Agent call'});
 p.note({event:'nested_notifications',frames:rows.filter(r=>sys(r.frame,'task_notification')).map(r=>({seq:r.seq,task_id:r.frame.task_id,tool_use_id:r.frame.tool_use_id,status:r.frame.status,keys:Object.keys(r.frame)}))});

 // the sidecars, from the scratch config home only
 const slug=realpathSync(p.cwd).replace(/[^a-zA-Z0-9]/g,'-');const sessionDir=config+'/projects/'+slug+'/'+p.sessionId;
 const files=walk(sessionDir+'/subagents').filter(f=>/\/agent-[^/]+\.(meta\.json|jsonl)$/.test(f));
 const dest=root+'fixtures/pass3/nested-agents-sidecars/';rmSync(dest,{recursive:true,force:true});mkdirSync(dest,{recursive:true});
 const metas=[];
 for(const f of files){const name=f.slice(f.lastIndexOf('/')+1);writeFileSync(dest+name,redact(readFileSync(f,'utf8')));if(name.endsWith('.meta.json')){const m=JSON.parse(readFileSync(f,'utf8'));metas.push({file:name,relative:f.slice(sessionDir.length+1),parentAgentId:m.parentAgentId??null,spawnDepth:m.spawnDepth??null,toolUseId:m.toolUseId??null,name:m.name??null,agentType:m.agentType??null,keys:Object.keys(m)});}}
 p.note({event:'nested_sidecars',sessionDir:sessionDir.replace(config,'<configHome>'),listing:walk(sessionDir).map(f=>({path:f.slice(sessionDir.length+1),bytes:statSync(f).size})),copied:files.map(f=>f.slice(f.lastIndexOf('/')+1)),metas});
 spend(p);
},{dir:'fixtures/pass3/',mode:'default',model:'sonnet',env:{CLAUDE_CONFIG_DIR:config},flags:['--forward-subagent-text','--replay-user-messages','--max-budget-usd','0.40']});};
