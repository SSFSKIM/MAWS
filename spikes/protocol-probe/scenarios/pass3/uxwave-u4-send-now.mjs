// U4 P1 (docs/doperpowers/specs/2026-11-12-ux-wave/U4-composer.md, "Probes and checks"): Send now and the move to the
// background on engine 2.1.322, on MAWS's launch (uxwave-common-send-permission.mjs). One case per process, chosen with -e:
//   UXW_CASE  a     interrupt {send_now, message_uuid} while a `next` message waits behind a running foreground shell
//             b     the same behind a running foreground Agent call (run_in_background: false; its subagent runs the
//                   shell command). Agents run in the background by default on 2.1.322, so the prompt asks for false.
//             c     the same while the model only writes text
//             c0    a plain interrupt (MAWS's Stop) while the model only writes text, a `next` message waiting: the
//                   comparison for what tells a send-now ending from a Stop
//             d     interrupt {send_now} while a permission request is pending (permission mode default; the request is
//                   held unanswered, then denied after 40 s if it was not withdrawn)
//             e-bash, e-agent  background_tasks {tool_use_id} for the running shell / Agent call, a `next` message waiting
//             e-bash-retry  background_tasks for the running shell, repeated each second while it answers
//                   `backgrounded: false`, for at most 15 s (the retry of U4's automatic move, after Claude Desktop)
//             f     a user frame at priority `now` during the running shell command (no interrupt)
//             f-text, f-agent  the same while the model only writes text / behind a running foreground Agent call
//             h     case a, then MAWS's plain interrupt once the message has been read
//             s0    a plain interrupt during the running shell command, a `next` message waiting (the Stop baseline)
//   UXW_RUN   a label for repeated runs; UXW_NOFEAT=1 (with -e PROBE_FEATURE_CACHE=) for an empty feature cache.
// The long command is `node wait.cjs <tag> <secs>`, which writes wait-<tag>.pid at start and wait-<tag>.done at its end,
// so the process's survival is read from the pid and the done file, not from the model.
import {run,delay,configEnv,cacheAfter,handshake,steer,lifecycle,alive,until,writeWaiter,MAWS_FLAGS,WORK} from './uxwave-common-send-permission.mjs';
import {existsSync} from 'node:fs';
const CASE=process.env.UXW_CASE,RUN=process.env.UXW_RUN||'1',SECS=40;
const KIND=/^(b|e-agent|f-agent)$/.test(CASE)?'agent':/^(c|c0|f-text)$/.test(CASE)?'text':'shell';
if(!/^(a|b|c|c0|d|e-bash|e-bash-retry|e-agent|f|f-text|f-agent|h|s0)$/.test(CASE||''))throw new Error('UXW_CASE');
const tag=(CASE+RUN).replace(/[^a-z0-9]/g,'');
const PROMPT={
 shell:`Run this exact shell command with the Bash tool, in the foreground (do not set run_in_background): node wait.cjs ${tag} ${SECS}\nWhen it finishes, reply with its output and nothing else.`,
 agent:`Use the Agent tool once, with subagent_type general-purpose and run_in_background set to false (a foreground agent), and give it this task: "Run this exact shell command with the Bash tool in the foreground (do not set run_in_background): node wait.cjs ${tag} ${SECS}. Then report its output." Do not run the command yourself. When the agent returns, reply with its report.`,
 text:'Without using any tools, write a story of about 500 words about a lighthouse keeper who collects sea glass.',
}[KIND];
const MESSAGE='Reply with the single word PINEAPPLE, then carry on with what you were doing.';
export default async()=>{
 const cfg=configEnv({});const mode=CASE==='d'?'default':'auto';
 writeWaiter(WORK);const pidFile=`${WORK}/wait-${tag}.pid`,doneFile=`${WORK}/wait-${tag}.done`;
 await run(`u4p1-${CASE}-${cfg.feat}-${RUN}`,async p=>{
  p.note({event:'uxw_case',probe:'U4 P1',case:CASE,run:RUN,featureCache:cfg.feat,permissionMode:mode,model:process.env.PROBE_MODEL||'haiku',waitSeconds:SECS});
  let held=null;
  p.on('can_use_tool',r=>{
   if(CASE==='d'&&r.tool_name==='Bash')return new Promise(res=>{held=r;setTimeout(()=>res({behavior:'deny',message:'The probe declined this call.'}),40000);});
   return {behavior:'allow',updatedInput:r.input};
  });
  await handshake(p);
  const first=steer(p,PROMPT,'now');p.note({event:'uxw_prompt',uuid:first});
  // the call is running: the waiter's pid file (shell, agent), the held request (d), or text streaming (text)
  const ready=KIND==='text'?await p.wait(f=>f.type==='stream_event'&&f.event?.delta?.type==='text_delta',{timeout:90000}).then(()=>true,()=>false)
   :CASE==='d'?await until(()=>held!==null,90000):await until(()=>alive(pidFile)?.alive,120000);
  p.note({event:'uxw_ready',ready,alive:alive(pidFile)});if(!ready)throw new Error('the call never ran');
  await delay(1500);
  const NOW=CASE.startsWith('f');const uuid=steer(p,MESSAGE,NOW?'now':'next');p.note({event:'uxw_message',uuid,priority:NOW?'now':'next'});
  await p.wait(lifecycle(uuid,'queued'),{timeout:10000}).catch(()=>p.note({event:'uxw_no_queued_lifecycle'}));
  await delay(500);
  const actAt=p.seq;
  const top=p.frames.filter(r=>r.frame.type==='assistant'&&r.frame.parent_tool_use_id==null).flatMap(r=>r.frame.message.content.filter(c=>c.type==='tool_use'));
  let response=null;
  if(/^(a|b|c|d|h)$/.test(CASE))response=await p.request('interrupt',{send_now:true,message_uuid:uuid}).catch(e=>({error:e.message}));
  else if(/^(c0|s0)$/.test(CASE))response=await p.request('interrupt',{reason:'user-cancel',cancel_queued:false}).catch(e=>({error:e.message}));
  else if(CASE.startsWith('e-')){const call=top.filter(c=>KIND==='agent'?/^(Agent|Task)$/.test(c.name):c.name==='Bash').at(-1);p.note({event:'uxw_background_target',tool_use_id:call?.id,name:call?.name});const tries=[];for(const t=Date.now()+15000;;){response=await p.request('background_tasks',{tool_use_id:call?.id}).catch(e=>({error:e.message}));tries.push({at:new Date().toISOString(),response:response.response??response});if(CASE!=='e-bash-retry'||response.response?.backgrounded!==false||Date.now()>t)break;await delay(1000);}p.note({event:'uxw_background_tries',tries});}
  p.note({event:'uxw_action',case:CASE,response,actSeq:actAt});
  await delay(2000);p.note({event:'uxw_alive',label:'2s after the action',alive:alive(pidFile)});
  if(CASE==='h'){
   await p.wait(f=>lifecycle(uuid,'started')(f)||(f.type==='assistant'&&JSON.stringify(f.message?.content??'').includes('PINEAPPLE')),{after:actAt,timeout:60000}).catch(()=>p.note({event:'uxw_message_not_read'}));
   await delay(2000);const stopAt=p.seq;
   const stop=await p.request('interrupt',{reason:'user-cancel',cancel_queued:false}).catch(e=>({error:e.message}));
   p.note({event:'uxw_stop',response:stop,stopSeq:stopAt});
   await delay(3000);p.note({event:'uxw_alive',label:'3s after the stop',alive:alive(pidFile)});
  }
  const result=await p.wait(f=>f.type==='result',{after:actAt,timeout:150000}).catch(()=>null);
  p.note({event:'uxw_first_result_after_action',subtype:result?.subtype??null,alive:alive(pidFile)});
  // the follow-up: until the waiter finished (or died), then until the wire is quiet for 12 s (90 s at most)
  if(KIND!=='text')await until(()=>existsSync(doneFile)||alive(pidFile)?.alive===false,(SECS+40)*1000,500);
  let last=p.seq,quiet=0;for(const t=Date.now()+90000;Date.now()<t&&quiet<12;){await delay(1000);if(p.seq===last)quiet++;else{quiet=0;last=p.seq;}}
  p.note({event:'uxw_final',alive:alive(pidFile),doneFile:existsSync(doneFile),results:p.frames.filter(r=>r.frame.type==='result').map(r=>({seq:r.seq,subtype:r.frame.subtype})),featureCacheAfter:cacheAfter(cfg)});
 },{dir:'fixtures/uxwave/',cwd:WORK,settingSources:'user,project,local',strictMcp:false,mode,flags:MAWS_FLAGS,env:cfg.env});
};
