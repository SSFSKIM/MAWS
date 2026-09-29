// C8b R1 (docs/doperpowers/plans/2026-09-28-c8b-agent-work-tools.md, Interfaces, Spike specifications): does a `user`
// frame with priority 'next' asking the parent to SendMessage a running child produce the SendMessage tool_use with `to`
// the child, and how and when does the child receive it, in three parent states: idle with a background child, busy
// (its own Bash in flight) with the background child held inside a permission, and waiting on a foreground child.
// Runs under `mode: 'default'` so the child's Bash reaches the host as can_use_tool and can be held; every request is
// recorded and allowed at once except the one held child Bash. The parent's turn state and in-flight tool are recorded at
// every steer. Scratch CLAUDE_CONFIG_DIR under /tmp: the receipt's disk record is read there, never from ~/.claude.
import {run,initPayload,delay} from '../pass2/common.mjs';
import {C8B,scratchConfig,sys,turnOpen,idle,spend,walk} from './c8b-common.mjs';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';

// The draft wording (Interfaces, *The relay*) and the second wording the spec retries with.
export const relayText=(agent,text)=>`Relay to agent ${agent.agentId}${agent.name?` (named "${agent.name}")`:''} with SendMessage, verbatim, then continue what you were doing: ${text}`;
const secondWording=(agent,text)=>`Use the SendMessage tool now to send agent ${agent.agentId}${agent.name?` (named "${agent.name}")`:''} exactly this message, then continue: ${text}`;
const MARK={idle:'Say PING in your next inbox line',busy:'Say PONG in your next inbox line',foreground:'Say PANG in your next inbox line'};
const DISPATCH='Dispatch one general-purpose Agent in the background (run_in_background true), model haiku, without a name. Its task: repeat rounds until the file stop.txt exists, and never stop on your own before that, however many rounds it takes. Each round: Read one.txt, then run exactly this with Bash: sleep 4; echo "round N" >> rounds.txt; test -f stop.txt && echo STOP || echo GO (N the round number). When it prints STOP, reply FINISHED. If you receive a message, append its text to inbox.txt with Bash before your next round. Reply STARTED as soon as it is dispatched.';
const FOREGROUND='Dispatch one general-purpose Agent in the foreground (not in the background), model haiku, named "walker": Read one.txt, then run "sleep 20" with Bash, then reply the file\'s line. Wait for it and reply its answer.';
const allow=r=>({behavior:'allow',updatedInput:r.input});
const blocks=f=>Array.isArray(f.message?.content)?f.message.content:[];
const textOf=c=>typeof c==='string'?c:Array.isArray(c)?c.map(b=>typeof b==='string'?b:b.type==='text'?b.text:b.type==='tool_result'?textOf(b.content):'').join('\n'):'';
// the reply is JSON on 2.1.283 ({ success, message, pin, resumedAgentId? }); the route is read from its `message`
const replyMessage=t=>{try{const j=JSON.parse(t);return typeof j?.message==='string'?j.message:t;}catch{return t;}};
const routeOf=t=>{const m=replyMessage(t).trim();return /^Message queued for delivery to .* at its next tool round\.?$/.test(m)?'agent-live':/^Resum/i.test(m)?'agent-stopped':m.slice(0,300);};

export default ()=>{const config=scratchConfig();return run('relay-to-child',async p=>{
 p.note({event:'c8b_scenario',...C8B,probe:'R1',mode:'default',configHome:config});
 const rowOf=f=>p.frames.find(r=>r.frame===f);
 // the parent's tool rounds and in-flight tool (parent_tool_use_id null)
 const parentToolUses=(from,to=Infinity)=>p.frames.filter(r=>r.seq>from&&r.seq<=to&&r.frame.type==='assistant'&&!r.frame.parent_tool_use_id&&blocks(r.frame).some(b=>b.type==='tool_use'));
 const parentRounds=(from,to)=>new Set(parentToolUses(from,to).map(r=>r.frame.message.id)).size;
 const inFlightTool=()=>{const done=new Set(p.frames.filter(r=>r.frame.type==='user'&&!r.frame.parent_tool_use_id).flatMap(r=>blocks(r.frame)).filter(b=>b.type==='tool_result').map(b=>b.tool_use_id));const open=parentToolUses(0).flatMap(r=>blocks(r.frame)).filter(b=>b.type==='tool_use'&&!done.has(b.id));return open.at(-1)?.name??null;};
 const lastSeq=pred=>p.frames.filter(r=>pred(r.frame)).at(-1)?.seq??null;
 // a child's tool rounds: its forwarded assistant tool_use blocks
 const childToolUses=(tu,from,to=Infinity)=>new Set(p.frames.filter(r=>r.seq>from&&r.seq<to&&r.frame.type==='assistant'&&r.frame.parent_tool_use_id===tu).flatMap(r=>blocks(r.frame)).filter(b=>b.type==='tool_use').map(b=>b.id)).size;
 // who asked: the request's agent_id, else the agent whose forwarded frame issued the tool use
 const agentOfToolUse=id=>{const issued=p.frames.find(r=>r.frame.type==='assistant'&&blocks(r.frame).some(b=>b.type==='tool_use'&&b.id===id));const lane=issued?.frame.parent_tool_use_id;if(!lane)return null;return p.frames.find(r=>sys(r.frame,'task_started')&&r.frame.tool_use_id===lane)?.frame.task_id??null;};

 const hold={armed:false,agentId:null,release:null,seq:null,at:null,arrived:null};
 p.on('can_use_tool',(r,frame)=>{const seq=p.frames.find(x=>x.frame===frame)?.seq??null;const agentId=r.agent_id??agentOfToolUse(r.tool_use_id);
  p.note({event:'relay_permission',toolName:r.tool_name,agentId,requestAgentId:r.agent_id??null,toolUseId:r.tool_use_id,seq,command:typeof r.input?.command==='string'?r.input.command.slice(0,160):undefined});
  if(hold.armed&&r.tool_name==='Bash'&&agentId===hold.agentId){hold.armed=false;hold.seq=seq;hold.at=Date.now();p.note({event:'relay_hold_armed',seq,agentId,toolName:r.tool_name,at:new Date(hold.at).toISOString(),command:r.input?.command});
   return new Promise(res=>{hold.release=()=>{hold.release=null;res(allow(r));};hold.arrived?.();});}
  return allow(r);});
 await p.request('initialize',initPayload({perTaskStopAffordance:true}));

 const gone=(child,kase)=>{const n=p.frames.find(r=>sys(r.frame,'task_notification')&&r.frame.task_id===child.agentId);if(n){p.note({event:'relay_child_gone',case:kase,seq:n.seq});throw new Error('relay_child_gone before case '+kase);}};
 const steer=(agent,text,kase,{wording=relayText,priority='next',variant='first'}={})=>{
  const uuid=randomUUID(),content=wording(agent,text),state={turnOpen:turnOpen(p),inFlightTool:inFlightTool(),lastTurnStartedSeq:lastSeq(f=>sys(f,'init')),lastTurnEndedSeq:lastSeq(f=>f.type==='result')};
  p.send({type:'user',uuid,message:{role:'user',content},parent_tool_use_id:null,origin:{kind:'human'},priority});
  const s={seq:p.seq,uuid,case:kase,variant,priority,content,at:Date.now(),...state};p.note({event:'relay_steer',...s,at:new Date(s.at).toISOString()});return s;};
 const sendMessageAfter=(from,timeout)=>p.wait(f=>f.type==='assistant'&&!f.parent_tool_use_id&&blocks(f).some(b=>b.type==='tool_use'&&b.name==='SendMessage'),{after:from,timeout}).then(f=>{const row=rowOf(f);const b=blocks(f).find(b=>b.name==='SendMessage');return {seq:row.seq,at:Date.parse(row.at),id:b.id,input:b.input,messageId:f.message.id};}).catch(()=>null);
 const replyOf=sm=>p.wait(f=>f.type==='user'&&!f.parent_tool_use_id&&blocks(f).some(b=>b.type==='tool_result'&&b.tool_use_id===sm.id),{after:sm.seq,timeout:60000}).then(f=>{const b=blocks(f).find(b=>b.tool_use_id===sm.id);return {seq:rowOf(f).seq,text:textOf(b.content),is_error:b.is_error??false};}).catch(()=>null);
 const recordSendMessage=async(s,sm,child,extra={})=>{
  const reply=await replyOf(sm);const between=p.frames.filter(r=>r.seq>s.seq&&r.seq<sm.seq);
  const lifecycle=p.frames.filter(r=>r.frame.type==='command_lifecycle'&&r.frame.command_uuid===s.uuid).map(r=>({seq:r.seq,state:r.frame.state}));
  const echo=p.frames.find(r=>r.frame.type==='user'&&r.frame.uuid===s.uuid&&r.frame.isReplay)?.seq??null;
  const rec={case:s.case,variant:s.variant,priority:s.priority,seq:sm.seq,to:sm.input?.to??null,toIsChild:sm.input?.to===child.agentId||(child.name!==null&&sm.input?.to===child.name),message:sm.input?.message??null,summary:sm.input?.summary??null,inputKeys:Object.keys(sm.input??{}),
   parentRoundsSinceSteer:parentRounds(s.seq,sm.seq),parentRoundsBeforeSendMessage:parentRounds(s.seq,sm.seq-1)-(parentToolUses(s.seq,sm.seq-1).some(r=>r.frame.message.id===sm.messageId)?1:0),
   turnStartedBySteer:!s.turnOpen&&between.some(r=>sys(r.frame,'init')),resultsBetween:between.filter(r=>r.frame.type==='result').map(r=>r.seq),inTurn:between.some(r=>r.frame.type==='result')?'next':'same',
   steerLifecycle:lifecycle,steerReplayEchoSeq:echo,msAfterSteer:sm.at-s.at,...extra};
  p.note({event:'relay_sendmessage',...rec});
  p.note({event:'relay_reply_text',case:s.case,seq:reply?.seq??null,text:reply?.text??null,is_error:reply?.is_error??null});
  p.note({event:'relay_wording',case:s.case,variant:s.variant,priority:s.priority,routed:true,replyRoute:reply?routeOf(reply.text):null});
  return {...rec,reply};};
 // The receipt, live: a `user` frame in the child's lane whose own text (not a tool_result) carries the relayed text.
 // The reaction: the child's first forwarded assistant frame carrying it (the model's words, not a delivery fact).
 // Everything else that carries the text after the SendMessage, other than the parent's own frames, is listed as seen.
 const userText=f=>typeof f.message?.content==='string'?f.message.content:blocks(f).filter(b=>b.type!=='tool_result').map(b=>b.type==='text'?b.text:'').join('\n');
 const isReceipt=(f,mark,child)=>f.type==='user'&&f.parent_tool_use_id===child.toolUseId&&userText(f).includes(mark);
 // the model may quote the whole text or only its word (PING, PONG, PANG)
 const isReaction=(f,mark,child)=>f.type==='assistant'&&f.parent_tool_use_id===child.toolUseId&&JSON.stringify(f.message?.content??'').includes(mark.split(' ')[1]);
 const carries=(f,mark)=>f.type!=='stream_event'&&!(f.parent_tool_use_id==null&&(f.type==='assistant'||f.type==='user'||f.type==='result'))&&JSON.stringify(f).includes(mark);
 const receiptOf=async(child,mark,sm,kase)=>{
  const f=await p.wait(f=>isReceipt(f,mark,child)||isReaction(f,mark,child),{after:sm.seq,timeout:60000}).catch(()=>null);
  if(f&&!isReceipt(f,mark,child))await delay(1500);
  const live=p.frames.find(r=>r.seq>sm.seq&&isReceipt(r.frame,mark,child));
  const reaction=p.frames.find(r=>r.seq>sm.seq&&isReaction(r.frame,mark,child));
  const seen=p.frames.filter(r=>r.seq>sm.seq&&carries(r.frame,mark)).map(r=>({seq:r.seq,direction:r.direction,type:r.frame.type,subtype:r.frame.subtype??r.frame.request?.subtype??null,lane:r.frame.parent_tool_use_id??null}));
  if(reaction){const b=blocks(reaction.frame).find(b=>JSON.stringify(b).includes(mark));p.note({event:'relay_child_reaction',case:kase,seq:reaction.seq,blockType:b?.type??null,toolName:b?.name??null,childToolRoundsSinceSendMessage:childToolUses(child.toolUseId,sm.seq,reaction.seq),parentRoundsSinceSendMessage:parentRounds(sm.seq,reaction.seq),msAfterSendMessage:Date.parse(reaction.at)-sm.at});}
  const resume=p.frames.find(r=>r.seq>sm.seq&&sys(r.frame,'task_started')&&r.frame.task_id===child.agentId);
  if(resume)p.note({event:'relay_child_resume',case:kase,seq:resume.seq,tool_use_id:resume.frame.tool_use_id,sendMessageToolUseId:sm.id,is_backgrounded:resume.frame.is_backgrounded??null,prompt:resume.frame.prompt??null});
  if(live){const rec={case:kase,live:true,seq:live.seq,form:/<system-reminder>/.test(userText(live.frame))?'system-reminder':'user',keys:Object.keys(live.frame),origin:live.frame.origin??null,isMeta:live.frame.isMeta??null,text:userText(live.frame).slice(0,600),childToolRoundsSinceSendMessage:childToolUses(child.toolUseId,sm.seq,live.seq),parentRoundsSinceSendMessage:parentRounds(sm.seq,live.seq),msAfterSendMessage:Date.parse(live.at)-sm.at,seen};p.note({event:'relay_child_receipt',...rec});return rec;}
  const line=diskRecords(child.agentId).find(r=>r.type!=='assistant'&&JSON.stringify(r).includes(mark)&&!JSON.stringify(r.message?.content??'').includes('tool_result'));
  const rec={case:kase,live:false,form:line?(line.type==='attachment'?'attachment:'+(line.attachment?.type??'?'):line.type):null,line:line?summarize(line):null,seen};p.note({event:'relay_child_receipt',...rec});return rec;};
 const inboxAfter=async(mark,kase,timeout=60000)=>{const end=Date.now()+timeout;const word=mark.split(' ')[1];while(Date.now()<end){const t=existsSync(p.cwd+'/inbox.txt')?readFileSync(p.cwd+'/inbox.txt','utf8'):'';if(t.includes(word)){p.note({event:'relay_inbox',case:kase,text:t.slice(0,400),at:new Date().toISOString()});return true;}await delay(1000);}p.note({event:'relay_inbox',case:kase,text:null});return false;};
 const sessionDir=()=>config+'/projects/'+realpathSync(p.cwd).replace(/[^a-zA-Z0-9]/g,'-')+'/'+p.sessionId;
 const diskRecords=agentId=>{const f=walk(sessionDir()).find(f=>f.endsWith('/agent-'+agentId+'.jsonl'));return f?readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return {};}}):[];};
 const summarize=r=>({type:r.type,timestamp:r.timestamp??null,isMeta:r.isMeta??r.attachment?.isMeta??null,userType:r.userType??null,isSidechain:r.isSidechain??null,origin:r.origin??r.attachment?.origin??null,keys:Object.keys(r),contentShape:typeof r.message?.content==='string'?'string':Array.isArray(r.message?.content)?r.message.content.map(b=>b.type):null,attachmentType:r.attachment?.type??null,attachmentKeys:r.attachment?Object.keys(r.attachment):null,rendered:r.rendered?JSON.stringify(r.rendered).slice(0,400):null,text:textOf(r.message?.content??r.attachment?.prompt??r.attachment?.content??'').slice(0,400)||JSON.stringify(r.attachment??{}).slice(0,400)});
 const verdict=[];const row=(kase,sm,rc)=>verdict.push({case:kase,sendMessageSeen:!!sm,receiptLive:rc?.live===true,receiptDiskOnly:rc?.live===false&&!!rc.line,noReceipt:!rc||(rc.live===false&&!rc.line),turnStartedBySteer:sm?.turnStartedBySteer??null});

 let child,fg;
 try{
  // turn 1: the background child
  let after=p.seq;p.user(DISPATCH);
  const started=await p.wait(f=>sys(f,'task_started')&&f.task_type==='local_agent',{after,timeout:120000});
  child={agentId:started.task_id,name:null,toolUseId:started.tool_use_id};p.note({event:'relay_child',case:'background',task_id:started.task_id,tool_use_id:started.tool_use_id,is_backgrounded:started.is_backgrounded??null,seq:rowOf(started).seq});
  await p.wait(f=>f.type==='result',{after,timeout:120000});
  const progress=()=>p.frames.filter(r=>sys(r.frame,'task_progress')&&r.frame.task_id===child.agentId).length;
  while(progress()<2)await p.wait(f=>sys(f,'task_progress')&&f.task_id===child.agentId,{after:p.seq,timeout:120000});
  await idle(p,60000,1000);

  // case idle: background child, parent idle
  gone(child,'idle');
  let s=steer(child,MARK.idle,'idle');let sm=await sendMessageAfter(s.seq,120000);let routed=sm;
  if(!sm){p.note({event:'relay_wording',case:'idle',variant:'first',priority:'next',routed:false,replyRoute:null,turnStartedBySteer:p.frames.some(r=>r.seq>s.seq&&sys(r.frame,'init'))});
   await idle(p,60000);gone(child,'idle-retry');s=steer(child,MARK.idle,'idle',{wording:secondWording,variant:'second'});sm=await sendMessageAfter(s.seq,120000);
   if(!sm){const started=p.frames.some(r=>r.seq>s.seq&&sys(r.frame,'init'));p.note({event:'relay_wording',case:'idle',variant:'second',priority:'next',routed:false,replyRoute:null,turnStartedBySteer:started});
    if(!started){await idle(p,60000);gone(child,'idle-now');s=steer(child,MARK.idle,'idle',{priority:'now',variant:'first-now'});sm=await sendMessageAfter(s.seq,120000);if(!sm)p.note({event:'relay_wording',case:'idle',variant:'first-now',priority:'now',routed:false,replyRoute:null});}}
   routed=sm;}
  let rec=routed?await recordSendMessage(s,routed,child):null;let rc=routed?await receiptOf(child,MARK.idle,routed,'idle'):null;if(routed)await inboxAfter(MARK.idle,'idle');row('idle',rec,rc);
  await idle(p,120000);

  // case busy: the parent's own Bash in flight, the child's next Bash held
  gone(child,'busy');
  after=p.seq;p.user('Run "sleep 45" with Bash, then reply DONE.');
  await p.wait(f=>f.type==='assistant'&&!f.parent_tool_use_id&&blocks(f).some(b=>b.type==='tool_use'&&b.name==='Bash'&&/sleep 45/.test(b.input?.command??'')),{after,timeout:120000});
  const arrived=new Promise(res=>{hold.arrived=res;});hold.agentId=child.agentId;hold.armed=true;
  const held=await Promise.race([arrived.then(()=>true),delay(90000).then(()=>false)]);
  if(!held){hold.armed=false;p.note({event:'relay_hold_missing',agentId:child.agentId,waitedMs:90000});throw new Error('relay_hold_missing');}
  s=steer(child,MARK.busy,'busy');sm=await sendMessageAfter(s.seq,150000);
  if(sm){const until=Math.max(sm.at+15000,hold.at+15000);while(Date.now()<until)await delay(500);}
  const whileHeld=p.frames.filter(r=>r.seq>s.seq&&(isReceipt(r.frame,MARK.busy,child)||isReaction(r.frame,MARK.busy,child))).map(r=>r.seq);
  p.note({event:'relay_held',seconds:Math.round((Date.now()-hold.at)/1000),secondsAfterSendMessage:sm?Math.round((Date.now()-sm.at)/1000):null,receiptWhileHeld:whileHeld});
  const releasedSeq=p.seq,releasedAt=Date.now();hold.release?.();p.note({event:'relay_hold_released',seq:releasedSeq,at:new Date().toISOString()});
  rec=sm?await recordSendMessage(s,sm,child,{holdSeq:hold.seq,sendMessageWhileHeld:true}):null;if(!sm)p.note({event:'relay_wording',case:'busy',variant:'first',priority:'next',routed:false,replyRoute:null});
  rc=sm?await receiptOf(child,MARK.busy,sm,'busy'):null;{const reaction=p.frames.find(r=>r.seq>s.seq&&isReaction(r.frame,MARK.busy,child));const diskAt=rc?.line?.timestamp?Date.parse(rc.line.timestamp):null;p.note({event:'relay_busy_receipt_after_release',releasedSeq,releasedAt:new Date(releasedAt).toISOString(),liveReceiptSeq:rc?.live?rc.seq:null,reactionSeq:reaction?.seq??null,diskReceiptAt:rc?.line?.timestamp??null,afterRelease:(rc?.live?rc.seq>releasedSeq:true)&&(reaction?reaction.seq>releasedSeq:true)&&(diskAt!==null?diskAt>=releasedAt:true)&&(!!rc?.live||!!reaction||diskAt!==null)});}if(sm)await inboxAfter(MARK.busy,'busy');row('busy',rec,rc);
  await idle(p,120000);

  // case foreground: the parent blocked inside its Agent call
  gone(child,'foreground');
  after=p.seq;p.user(FOREGROUND);
  const fgStart=await p.wait(f=>sys(f,'task_started')&&f.task_type==='local_agent'&&f.task_id!==child.agentId,{after,timeout:120000});
  fg={agentId:fgStart.task_id,name:'walker',toolUseId:fgStart.tool_use_id};p.note({event:'relay_child',case:'foreground',task_id:fgStart.task_id,tool_use_id:fgStart.tool_use_id,is_backgrounded:fgStart.is_backgrounded??null,seq:rowOf(fgStart).seq,task_started:fgStart});
  await p.wait(f=>f.type==='assistant'&&f.parent_tool_use_id===fg.toolUseId&&blocks(f).some(b=>b.type==='tool_use'&&b.name==='Bash'&&/sleep 20/.test(b.input?.command??'')),{after,timeout:120000});
  s=steer(fg,MARK.foreground,'foreground');
  const returned=await p.wait(f=>sys(f,'task_notification')&&f.task_id===fg.agentId,{after:s.seq,timeout:120000}).catch(()=>null);const returnedSeq=returned?rowOf(returned).seq:null;
  sm=await sendMessageAfter(s.seq,120000);
  const fgInTranscript=()=>diskRecords(fg.agentId).filter(r=>JSON.stringify(r).includes(MARK.foreground)).map(summarize);
  if(sm){rec=await recordSendMessage(s,sm,fg,{afterChildReturned:returnedSeq!==null&&sm.seq>returnedSeq,childReturnedSeq:returnedSeq});}else rec=null;
  rc=sm?await receiptOf(fg,MARK.foreground,sm,'foreground'):null;
  await idle(p,150000);
  p.note({event:'relay_foreground',steerSeq:s.seq,childReturnedSeq:returnedSeq,sendMessageSeq:sm?.seq??null,when:!sm?'never':returnedSeq!==null&&sm.seq>returnedSeq?'after-child-returned':'before-child-returned',to:sm?.input?.to??null,replyText:rec?.reply?.text??null,replyRoute:rec?.reply?routeOf(rec.reply.text):null,receiptLive:rc?.live??null,childTranscriptHoldsText:fgInTranscript(),followingTasks:p.frames.filter(r=>r.seq>s.seq&&(sys(r.frame,'task_started')||sys(r.frame,'task_notification'))).map(r=>({seq:r.seq,subtype:r.frame.subtype,task_id:r.frame.task_id,is_backgrounded:r.frame.is_backgrounded??null,status:r.frame.status??null}))});
  row('foreground',rec,rc);
 }finally{
  hold.armed=false;hold.release?.();
  writeFileSync(p.cwd+'/stop.txt','stop\n');p.note({event:'relay_stop_written',at:new Date().toISOString()});
 }
 if(child){await p.wait(f=>sys(f,'task_notification')&&f.task_id===child.agentId,{after:0,timeout:90000}).catch(()=>p.note({event:'relay_child_not_ended'}));await idle(p,120000);}
 p.note({event:'relay_verdict',rows:verdict});
 // the disk: every sidecar's keys, and every record carrying a relayed text
 const files=walk(sessionDir()+'/subagents');
 p.note({event:'relay_disk',sessionDir:sessionDir().replace(config,'<configHome>'),sidecars:files.filter(f=>f.endsWith('.meta.json')).map(f=>{const m=JSON.parse(readFileSync(f,'utf8'));return {file:f.slice(f.lastIndexOf('/')+1),keys:Object.keys(m),name:m.name??null,toolUseId:m.toolUseId??null};}),
  receipts:Object.entries(MARK).flatMap(([kase,mark])=>files.filter(f=>f.endsWith('.jsonl')).flatMap(f=>readFileSync(f,'utf8').split('\n').filter(l=>l.includes(mark)).map(l=>{let r={};try{r=JSON.parse(l);}catch{}return {case:kase,file:f.slice(f.lastIndexOf('/')+1),...summarize(r)};}))),
  rounds:existsSync(p.cwd+'/rounds.txt')?readFileSync(p.cwd+'/rounds.txt','utf8').split('\n').filter(Boolean).length:0,inbox:existsSync(p.cwd+'/inbox.txt')?readFileSync(p.cwd+'/inbox.txt','utf8').slice(0,600):null});
 spend(p);
},{dir:'fixtures/pass3/',mode:'default',model:'sonnet',env:{CLAUDE_CONFIG_DIR:config},flags:['--forward-subagent-text','--replay-user-messages','--max-budget-usd','0.80']});};
