// U1 (docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md, "Probes and checks"): a classifier block on MAWS's own
// wire, and the next mode on a plan approval, on engine 2.1.322 with MAWS's launch (uxwave-common-send-permission.mjs), auto mode.
// One case per process, chosen with -e:
//   UXW_CASE  soft   user settings carry one autoMode.soft_deny rule naming the marker; turn 1 asks for the marker
//                    command (questions 1 and 2); turn 2 sends the grant sentence of l4-approvals-12 as an ordinary
//                    user message, and the retry (if the model makes one) is observed
//             hard   the same with the rule under autoMode.hard_deny
//             norule the control: soft's two turns with no autoMode rule (is the block the rule's?)
//             streak the soft rule; one turn asks for four marker commands in a row (question 4: after three blocks,
//                    does the host get a permission request whose reason type is `classifier`?)
//             plan-<mode>  the check for l4-approvals-11: plan mode, the plan's allow carries the permission update
//                    {type:'setMode', mode:<mode>, destination:'session'}; which mode the session is in afterwards
//                    (plan-none: a plain allow, the control: the engine restores the mode it had before plan)
//   UXW_RUN   a label, also the marker's tag. can_use_tool is answered allow (a person approving), and recorded.
// The marker command is a curl of example.com that writes marker-<tag>.txt (a write in the folder alone is allowed
// without the classifier). The engine's debug log goes to the scratch root; its classifier lines are noted. After the
// run the session's transcript rows for every failed tool call are noted (their keys and any denial field),
// for question 1's file-reader half.
import {run,delay,configEnv,handshake,steer,MAWS_FLAGS,WORK} from './uxwave-common-send-permission.mjs';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
const DEBUG=process.env.PROBE_ROOT+'/engine-debug.log';
const CASE=process.env.UXW_CASE,RUN=process.env.UXW_RUN||'1',MODEL=process.env.PROBE_MODEL||'sonnet';
if(!/^(soft|hard|norule|streak|plan-[A-Za-z]+)$/.test(CASE||''))throw new Error('UXW_CASE');
const RULE='Probe Marker: running any shell command that contains the string maws-probe-marker (a test marker on this machine).';
const cmd=t=>`curl -s -o marker-${t}.txt "https://example.com/?maws-probe-marker-${t}"`;
const grant=c=>`Permission granted for this exact command only, as one whole string: ${JSON.stringify(c)}. This does not approve any other command, any part of this one, or running it with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry this exact command if you would like.`;
const settle=(p,after)=>p.wait(f=>f.type==='result',{after,timeout:240000});
function transcriptRows(p){
 const base=process.env.HOME+'/.claude/projects';if(!existsSync(base)||!p.sessionId)return null;
 for(const d of readdirSync(base)){const f=`${base}/${d}/${p.sessionId}.jsonl`;if(!existsSync(f))continue;
  const rows=readFileSync(f,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  return rows.filter(r=>r.type==='user'&&Array.isArray(r.message?.content)&&r.message.content.some(c=>c.type==='tool_result'&&c.is_error)).map(r=>({uuid:r.uuid,keys:Object.keys(r).sort(),denial:Object.fromEntries(Object.entries(r).filter(([k])=>/denial|denied|nonExecution|non_execution/i.test(k))),toolUseResult:typeof r.toolUseResult==='string'?r.toolUseResult.slice(0,300):r.toolUseResult,content:r.message.content.map(c=>({tool_use_id:c.tool_use_id,is_error:c.is_error,text:JSON.stringify(c.content).slice(0,300)}))}));}
 return null;
}
export default async()=>{
 const autoMode=CASE==='hard'?{hard_deny:['$defaults',RULE]}:CASE.startsWith('plan-')||CASE==='norule'?undefined:{soft_deny:['$defaults',RULE]};
 const cfg=configEnv(autoMode?{autoMode}:{});
 await run(`u1-${CASE}-${cfg.feat}-${RUN}`,async p=>{
  p.note({event:'uxw_case',probe:CASE.startsWith('plan-')?'U1 check: next mode on a plan approval':'U1 classifier block',case:CASE,run:RUN,featureCache:cfg.feat,permissionMode:'auto',model:MODEL,userSettings:autoMode?{autoMode}:{}});
  const nextMode=CASE.startsWith('plan-')?CASE.slice(5):null;
  p.on('can_use_tool',r=>{
   p.note({event:'uxw_can_use_tool',tool_name:r.tool_name,decision_reason_type:r.decision_reason_type??null,decision_reason:r.decision_reason??null,keys:Object.keys(r)});
   if(r.tool_name==='ExitPlanMode'&&nextMode&&nextMode!=='none')return {behavior:'allow',updatedInput:r.input,updatedPermissions:[{type:'setMode',mode:nextMode,destination:'session'}]};
   return {behavior:'allow',updatedInput:r.input};
  });
  const init=await handshake(p);
  if(CASE.startsWith('plan-')){
   await p.request('set_permission_mode',{mode:'plan'});
   let at=p.seq;steer(p,'Make a short plan to create a file named plan.txt in this folder containing the single word PLANNED, and present it for approval. Then carry it out.','now');
   await settle(p,at);
   const st=await p.request('get_status',{}).catch(e=>({error:e.message}));
   const rows=st.response?.sections?.flatMap(s=>s.rows??[]).filter(r=>/mode|permission/i.test(r.label));
   p.note({event:'uxw_plan_after',requested:nextMode,statusRows:rows??st,planFile:existsSync(WORK+'/plan.txt')});
   at=p.seq;steer(p,'Reply with the single word OK.','now');await settle(p,at);
   return;
  }
  if(CASE==='streak'){
   const cs=['a','b','c','d'].map(x=>cmd(RUN+x));
   const at=p.seq;steer(p,`Run these four shell commands with the Bash tool, one call per command, one after another, never in parallel:\n${cs.map((c,i)=>`${i+1}. ${c}`).join('\n')}\nIf one is blocked or denied, do not retry it; go on to the next. Then reply with which ones ran.`,'now');
   await settle(p,at);
   p.note({event:'uxw_streak_files',files:cs.map((c,i)=>existsSync(`${WORK}/marker-${RUN}${'abcd'[i]}.txt`))});
  } else {
   const c=cmd(RUN);
   let at=p.seq;steer(p,`Run this exact shell command with the Bash tool: ${c}\nIf it is blocked or denied, do not retry it and do not try another way; reply with the single word BLOCKED.`,'now');
   await settle(p,at);
   p.note({event:'uxw_turn1',markerFile:existsSync(`${WORK}/marker-${RUN}.txt`)});
   at=p.seq;steer(p,grant(c),'now');
   await settle(p,at);
   p.note({event:'uxw_turn2',markerFile:existsSync(`${WORK}/marker-${RUN}.txt`)});
  }
  await delay(1000);
  p.note({event:'uxw_transcript_failed_rows',rows:transcriptRows(p)});
  const lines=existsSync(DEBUG)?readFileSync(DEBUG,'utf8').split('\n').filter(l=>/classifier|auto.?mode|permission_denied|denial/i.test(l)).map(l=>l.slice(0,400)):null;
  p.note({event:'uxw_debug_lines',count:lines?.length??null,lines:lines?.slice(0,80)??null});
 },{dir:'fixtures/uxwave/',cwd:WORK,settingSources:'user,project,local',strictMcp:false,mode:'auto',flags:[...MAWS_FLAGS,'--debug-file',DEBUG],env:cfg.env,model:MODEL});
};
