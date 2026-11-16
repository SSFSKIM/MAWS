// UX wave U1c (docs/doperpowers/plans/2026-11-15-ux-wave-U1c-approve-and-retry.md on ux-wave/U1c, "Probes asked for"
// B, C, D, E): the grant sentence of "Approve and retry" on MAWS's own wire, engine 2.1.322, auto mode, MAWS's launch
// (uxwave-common-send-permission.mjs, as uxwave-u1-classifier.mjs). One case per process, chosen with -e:
//   UXW_CASE  e        U1's soft case kept whole: turn 1 the marker command is blocked; turn 2 the grant as an idle
//                      prompt (priority now). The journal and the session's transcript file are both kept (probe E).
//             b        one turn: the marker command, then a 30 s foreground wait. As soon as the block's
//                      system/permission_denied frame is read, the grant is written as a `user` frame of priority
//                      'next' (MAWS's steer while a turn runs). Probe B.
//             b-wait   the same, the grant written 5 s into the wait's call (the call's tool_use seen, no result).
//             b-join-grant-first, b-join-other-first  as b-wait, and 5 s into the wait two next-step messages are
//                      written back to back: the grant and an ordinary one ("also say the word EXTRA when done"), in
//                      that order or the other, so the engine reads them together.
//             b-two    the task has two marker commands (<run>a, <run>b) before the wait; once both are blocked and the
//                      wait runs 5 s, two grants are written back to back, one for each.
//             b-joinend-grant-first, b-joinend-other-first, b-twoend  the same messages, but the turn has no step after
//                      the block(s) other than a long written reply: the messages are written as soon as that reply's
//                      first text streams, so no tool boundary is left to absorb them into the turn.
//             c-mcp    a stdio MCP server `uxw` with one tool `note` (no annotations); the rule names any call whose
//                      input holds the marker; turn 1 asks for one note call holding it; turn 2 the grant with the
//                      word "call" and Design 2's subject (compact JSON of {server, tool, input}). Probe C.
//             c-write  the same for a Write of a file outside the working folder whose path holds the marker; the
//                      subject {tool: "Write", input}. Probe C.
//             d-during the main loop launches one subagent (Agent, foreground) that runs the marker command and, if
//                      it is blocked, a 30 s wait before it hands back. When the subagent's block is read, the grant
//                      is written to the main loop as a steer (priority 'next'). Probe D.
//             d-after  the same subagent; the grant sent once the turn has ended, as an idle prompt. Probe D.
//   UXW_RUN   a label, also the marker's tag. can_use_tool is answered allow (a person approving) and recorded.
// Kept in fixtures/uxwave/: u1c-<case>-<run>.jsonl (the journal), u1c-<case>-<run>.transcript.jsonl (the session's
// transcript file, redacted), and for d-* each subagent's file as u1c-<case>-<run>.agent-<id>.transcript.jsonl.
import {run,delay,configEnv,handshake,steer,MAWS_FLAGS,WORK,ROOT} from './uxwave-common-send-permission.mjs';
import {redact} from '../../harness.mjs';
import {readdirSync,readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {hostname} from 'node:os';
const DEBUG=ROOT+'/engine-debug.log';
const CASE=process.env.UXW_CASE,RUN=process.env.UXW_RUN||'1',MODEL=process.env.PROBE_MODEL||'haiku';
// UX wave U1c (Decision Log 47): the run's label goes into a shell command and file names, so it is checked first.
if(!/^[A-Za-z0-9._-]+$/.test(RUN)){console.error(`UXW_RUN must hold only letters, digits, ".", "_" and "-"; it is ${JSON.stringify(RUN)}.`);process.exit(2);}
const CASES=['e','b','b-wait','b-join-grant-first','b-join-other-first','b-two','b-joinend-grant-first','b-joinend-other-first','b-twoend','c-mcp','c-write','d-during','d-after'];
if(!CASES.includes(CASE))throw new Error('UXW_CASE='+CASES.join(' | '));
const FIXTURES=(process.env.PROBE_FIXTURE_ROOT?process.env.PROBE_FIXTURE_ROOT.replace(/\/?$/,'/'):new URL('../../',import.meta.url).pathname)+'fixtures/uxwave/';
const HOST=hostname();
const scrub=t=>redact(String(t)).split(HOST).join('<host>');
const RULE_SHELL='Probe Marker: running any shell command that contains the string maws-probe-marker (a test marker on this machine).';
const RULE_ANY='Probe Marker: any action whose input contains the string maws-probe-marker, whether a shell command, a file write or an MCP tool call (a test marker on this machine).';
const TAG=`${CASE}-${RUN}`;
// UXW_VIA=file (the default): the step that meets the rule is written to a task file the model is told to carry out, so
// the call is the agent's own step, not the person's stated request (on 2026-11-15 the server classifier let a
// soft_deny rule yield to a request in the person's own prompt: see the findings). UXW_VIA=prompt: in the prompt, as U1.
const VIA=process.env.UXW_VIA||'file',LIST=process.env.UXW_LIST||'soft';
let tasks=0;
const instruct=(steps,conduct)=>{if(VIA==='prompt')return `${steps}\n${conduct}`;const f=`task-${++tasks}.txt`;writeFileSync(`${WORK}/${f}`,steps+'\n');return `Read the file ${f} in this folder and carry out what it says. ${conduct}`;};
const cmd=t=>`curl -s -o marker-${t}.txt "https://example.com/?maws-probe-marker-${t}"`;
// consentMessage of src/shared/engine/arrival.ts (the engine's own sentence, cli.pretty.js Yn), inlined.
const grant=(kind,subject)=>`Permission granted for this exact ${kind} only, as one whole string: ${JSON.stringify(subject)}. This does not approve any other ${kind}, any part of this one, or running it with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry this exact ${kind} if you would like.`;
const WAIT=`python3 uxw_wait.py 30`;
const settle=(p,after,timeout=300000)=>p.wait(f=>f.type==='result',{after,timeout});
const toolUses=f=>f.type==='assistant'?(f.message?.content??[]).filter(b=>b.type==='tool_use'):[];
const toolResults=f=>f.type==='user'&&Array.isArray(f.message?.content)?f.message.content.filter(b=>b.type==='tool_result'):[];
const blockOf=f=>(f.type==='system'&&f.subtype==='permission_denied')||(f.type==='user'&&JSON.stringify(f.tool_result_meta??f).includes('"automode-blocked"'));
function sessionDir(p){const base=process.env.HOME+'/.claude/projects';if(!existsSync(base)||!p.sessionId)return null;for(const d of readdirSync(base))if(existsSync(`${base}/${d}/${p.sessionId}.jsonl`))return `${base}/${d}`;return null;}
// The stdio MCP server of c-mcp: newline-delimited JSON-RPC, one tool `note`, which appends its text to note.txt.
const MCP_SERVER=`const fs=require('fs');let buf='';process.stdin.setEncoding('utf8');
const out=m=>process.stdout.write(JSON.stringify(m)+'\\n');
process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);if(!l.trim())continue;let m;try{m=JSON.parse(l);}catch{continue;}
 if(m.id===undefined||m.id===null)continue;
 if(m.method==='initialize')out({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'uxw',version:'0.0.1'}}});
 else if(m.method==='tools/list')out({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'note',description:'Appends a short note to the file note.txt in the working folder.',inputSchema:{type:'object',properties:{text:{type:'string',description:'The note.'}},required:['text']}}]}});
 else if(m.method==='tools/call'){fs.appendFileSync(process.cwd()+'/note.txt',String(m.params?.arguments?.text??'')+'\\n');out({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'noted'}]}});}
 else if(m.method==='ping')out({jsonrpc:'2.0',id:m.id,result:{}});
 else out({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'method not found'}});}});
`;
export default async()=>{
 const rule=CASE.startsWith('c-')?RULE_ANY:RULE_SHELL;
 const autoMode={[LIST==='hard'?'hard_deny':'soft_deny']:['$defaults',rule]};
 const cfg=configEnv({autoMode});
 writeFileSync(WORK+'/uxw_wait.py','import sys,time\ntime.sleep(float(sys.argv[1]))\nprint("WAITED")\n');
 const outside=ROOT+'/outside';mkdirSync(outside,{recursive:true});
 const flags=[...MAWS_FLAGS,'--debug-file',DEBUG];
 if(CASE==='c-mcp'){writeFileSync(ROOT+'/uxw-mcp.cjs',MCP_SERVER);flags.push('--mcp-config',JSON.stringify({mcpServers:{uxw:{type:'stdio',command:'node',args:[ROOT+'/uxw-mcp.cjs']}}}));}
 let sessionId=null;
 const p=await run(`u1c-${TAG}`,async p=>{
  p.note({event:'uxw_case',via:VIA,list:LIST,tasks:'the task files are written in the working folder; their text is the steps the prompt names',probe:'U1c probe '+CASE[0].toUpperCase(),case:CASE,run:RUN,featureCache:cfg.feat,permissionMode:'auto',model:MODEL,userSettings:{autoMode},plan:'docs/doperpowers/plans/2026-11-15-ux-wave-U1c-approve-and-retry.md (ux-wave/U1c), Probes asked for'});
  p.on('can_use_tool',r=>{p.note({event:'uxw_can_use_tool',tool_name:r.tool_name,decision_reason_type:r.decision_reason_type??null,decision_reason:r.decision_reason??null,keys:Object.keys(r)});return {behavior:'allow',updatedInput:r.input};});
  await handshake(p);
  const sendGrant=(text,priority,why)=>{const at=p.seq;const uuid=steer(p,text,priority);p.note({event:'uxw_grant_sent',priority,why,uuid,afterSeq:at});return {uuid,at};};
  const retryOf=(after,match)=>p.frames.filter(r=>r.seq>after&&r.direction==='in').flatMap(r=>toolUses(r.frame).filter(match).map(b=>({seq:r.seq,id:b.id,name:b.name,parent_tool_use_id:r.frame.parent_tool_use_id??null})));
  const resultFor=id=>{for(const r of p.frames)for(const b of toolResults(r.frame))if(b.tool_use_id===id)return {seq:r.seq,is_error:b.is_error??false,meta:(r.frame.tool_result_meta??[]).find(m=>m.id===id)??r.frame.tool_result_meta??null};return null;};
  const summary=(after,match)=>retryOf(after,match).map(c=>({...c,result:resultFor(c.id)}));
  if(CASE==='e'){
   const c=cmd(RUN);let at=p.seq;steer(p,instruct(`Run this exact shell command with the Bash tool: ${c}`,'If it is blocked or denied, do not retry it and do not try another way; reply with the single word BLOCKED.'),'now');
   await settle(p,at);p.note({event:'uxw_turn1',markerFile:existsSync(`${WORK}/marker-${RUN}.txt`)});
   const g=sendGrant(grant('command',c),'now','idle, after the turn of the block');
   await settle(p,g.at);
   p.note({event:'uxw_turn2',markerFile:existsSync(`${WORK}/marker-${RUN}.txt`),calls:summary(g.at,b=>b.input?.command===c)});
  }else if(CASE==='b'||CASE==='b-wait'){
   const c=cmd(RUN);const at=p.seq;
   steer(p,instruct(`Do these two steps in order, in this one turn, each with one Bash tool call in the foreground (run_in_background false):\n1. Run this exact shell command: ${c}\n2. Run exactly \`${WAIT}\` (timeout 120000).`,'If step 1 is blocked or denied, do not retry it and do not try another way; go on to step 2. After step 2, reply with the single word DONE.'),'now');
   const block=await p.wait(blockOf,{after:at,timeout:180000});
   const blockSeq=p.frames.find(r=>r.frame===block)?.seq;
   p.note({event:'uxw_block_seen',seq:blockSeq});
   let g;
   if(CASE==='b')g=sendGrant(grant('command',c),'next','the block read, the turn still running');
   else{
    const wait=await p.wait(f=>toolUses(f).some(b=>String(b.input?.command??'').includes('uxw_wait.py')),{after:blockSeq,timeout:180000});
    const id=toolUses(wait).find(b=>String(b.input?.command??'').includes('uxw_wait.py')).id;
    await delay(5000);
    p.note({event:'uxw_wait_running',tool_use_id:id,resultYet:resultFor(id)!==null});
    g=sendGrant(grant('command',c),'next','5 s into the 30 s wait of the same turn');
   }
   await settle(p,at,300000);
   const resultSeq=p.seq;
   p.note({event:'uxw_turn_end',markerFile:existsSync(`${WORK}/marker-${RUN}.txt`),calls:summary(g.at,b=>b.input?.command===c)});
   // If the steer was not taken into that turn, the engine may run it as a turn of its own after the result.
   const more=await p.wait(f=>f.type==='result',{after:resultSeq,timeout:60000}).catch(()=>null);
   p.note({event:'uxw_after',anotherTurn:!!more,markerFile:existsSync(`${WORK}/marker-${RUN}.txt`),calls:summary(g.at,b=>b.input?.command===c)});
  }else if(['b-join-grant-first','b-join-other-first','b-two'].includes(CASE)){
   const two=CASE==='b-two';const cs=two?[cmd(RUN+'a'),cmd(RUN+'b')]:[cmd(RUN)];const at=p.seq;
   const steps=two?`Do these three steps in order, in this one turn, each with one Bash tool call in the foreground (run_in_background false):\n1. Run this exact shell command: ${cs[0]}\n2. Run this exact shell command: ${cs[1]}\n3. Run exactly \`${WAIT}\` (timeout 120000).`:`Do these two steps in order, in this one turn, each with one Bash tool call in the foreground (run_in_background false):\n1. Run this exact shell command: ${cs[0]}\n2. Run exactly \`${WAIT}\` (timeout 120000).`;
   steer(p,instruct(steps,two?'If step 1 or step 2 is blocked or denied, do not retry it and do not try another way; go on to the next step. After step 3, reply with the single word DONE.':'If step 1 is blocked or denied, do not retry it and do not try another way; go on to step 2. After step 2, reply with the single word DONE.'),'now');
   const wait=await p.wait(f=>toolUses(f).some(b=>String(b.input?.command??'').includes('uxw_wait.py')),{after:at,timeout:240000});
   const id=toolUses(wait).find(b=>String(b.input?.command??'').includes('uxw_wait.py')).id;
   p.note({event:'uxw_blocks_before_wait',seqs:p.frames.filter(r=>r.seq>at&&r.frame.type==='system'&&r.frame.subtype==='permission_denied').map(r=>r.seq)});
   await delay(5000);
   p.note({event:'uxw_wait_running',tool_use_id:id,resultYet:resultFor(id)!==null});
   const OTHER='Also say the word EXTRA when done.';
   const texts=two?cs.map(c=>grant('command',c)):CASE==='b-join-grant-first'?[grant('command',cs[0]),OTHER]:[OTHER,grant('command',cs[0])];
   const sent=texts.map(t=>sendGrant(t,'next',t===OTHER?'the ordinary message, back to back with the grant':'5 s into the 30 s wait of the same turn, back to back with another next-step message'));
   const g=sent[0];
   await settle(p,at,300000);
   const resultSeq=p.seq;
   p.note({event:'uxw_turn_end',sent:sent.map(x=>x.uuid),markerFiles:cs.map(c=>existsSync(`${WORK}/${c.match(/-o (\S+)/)[1]}`)),calls:summary(g.at,b=>cs.includes(b.input?.command))});
   const more=await p.wait(f=>f.type==='result',{after:resultSeq,timeout:60000}).catch(()=>null);
   p.note({event:'uxw_after',anotherTurn:!!more,markerFiles:cs.map(c=>existsSync(`${WORK}/${c.match(/-o (\S+)/)[1]}`)),calls:summary(g.at,b=>cs.includes(b.input?.command))});
  }else if(CASE.startsWith('b-joinend')||CASE==='b-twoend'){
   const two=CASE==='b-twoend';const cs=two?[cmd(RUN+'a'),cmd(RUN+'b')]:[cmd(RUN)];const at=p.seq;
   const LONG='write, as your reply, a paragraph of about 250 words describing a lighthouse, and end it with the single word DONE';
   const steps=two?`Do these steps in order, in this one turn, each command with one Bash tool call in the foreground (run_in_background false):\n1. Run this exact shell command: ${cs[0]}\n2. Run this exact shell command: ${cs[1]}\n3. Use no more tools: ${LONG}.`:`Do these steps in order, in this one turn:\n1. Run this exact shell command with one Bash tool call in the foreground (run_in_background false): ${cs[0]}\n2. Use no more tools: ${LONG}.`;
   steer(p,instruct(steps,'If a command is blocked or denied, do not retry it and do not try another way; go on to the next step.'),'now');
   const denials=()=>p.frames.filter(r=>r.seq>at&&r.frame.type==='system'&&r.frame.subtype==='permission_denied');
   for(const end=Date.now()+240000;denials().length<cs.length;){if(Date.now()>end)throw new Error('the blocks never came');await delay(100);}
   const last=denials().at(-1).seq;
   await p.wait(f=>f.type==='stream_event'&&f.event?.delta?.type==='text_delta'&&!f.parent_tool_use_id,{after:last,timeout:120000});
   p.note({event:'uxw_reply_streaming',afterBlockSeq:last});
   const OTHER='Also say the word EXTRA when done.';
   const texts=two?cs.map(c=>grant('command',c)):CASE==='b-joinend-grant-first'?[grant('command',cs[0]),OTHER]:[OTHER,grant('command',cs[0])];
   const sent=texts.map(t=>sendGrant(t,'next',t===OTHER?'the ordinary message, back to back with the grant':'while the turn\'s last reply streams, back to back with another next-step message'));
   const g=sent[0];
   await settle(p,at,300000);
   const resultSeq=p.seq;
   p.note({event:'uxw_turn_end',sent:sent.map(x=>x.uuid),markerFiles:cs.map(c=>existsSync(`${WORK}/${c.match(/-o (\S+)/)[1]}`)),calls:summary(g.at,b=>cs.includes(b.input?.command))});
   const more=await p.wait(f=>f.type==='result',{after:resultSeq,timeout:120000}).catch(()=>null);
   p.note({event:'uxw_after',anotherTurn:!!more,markerFiles:cs.map(c=>existsSync(`${WORK}/${c.match(/-o (\S+)/)[1]}`)),calls:summary(g.at,b=>cs.includes(b.input?.command))});
  }else if(CASE==='c-mcp'||CASE==='c-write'){
   const marker=`maws-probe-marker-${RUN}`;
   const target=`${outside}/${marker}.txt`;
   const ask=instruct(CASE==='c-mcp'
    ?`Call the MCP tool mcp__uxw__note exactly once with the text "${marker}" (load it with ToolSearch first if it is not loaded).`
    :`Use the Write tool exactly once to create the file ${target} with the content "${marker}" (one line).`,'If the call is blocked or denied, do not retry it and do not try another way; reply with the single word BLOCKED.');
   let at=p.seq;steer(p,ask,'now');await settle(p,at);
   const mine=b=>CASE==='c-mcp'?b.name==='mcp__uxw__note':b.name==='Write';
   const calls=retryOf(at,mine);
   const first=calls[0];
   p.note({event:'uxw_turn1',calls:summary(at,mine),blocked:p.frames.filter(r=>r.seq>at&&blockOf(r.frame)).map(r=>r.seq),noteFile:existsSync(WORK+'/note.txt'),target:existsSync(target)});
   if(!first){p.note({event:'uxw_no_call'});return;}
   const input=p.frames.flatMap(r=>toolUses(r.frame)).find(b=>b.id===first.id).input;
   const subject=JSON.stringify(CASE==='c-mcp'?{server:'uxw',tool:'note',input}:{tool:'Write',input});
   const g=sendGrant(grant('call',subject),'now','idle, after the turn of the block');
   p.note({event:'uxw_grant_subject',subject});
   await settle(p,g.at);
   p.note({event:'uxw_turn2',calls:summary(g.at,mine),noteFile:existsSync(WORK+'/note.txt'),target:existsSync(target)});
  }else{
   const c=cmd(RUN);
   const sub=instruct(`Run this exact shell command with the Bash tool: ${c}`,`If it is blocked or denied, do not retry it and do not try another way; instead run exactly \`${WAIT}\` with the Bash tool in the foreground (timeout 120000), then reply with the single word BLOCKED.`);
   const at=p.seq;
   steer(p,`Call the Agent tool exactly once, in the foreground (run_in_background false), with subagent_type "general-purpose", description "uxw marker" and this prompt, verbatim:\n${sub}\nWhen it returns, reply with only the word it replied.`,'now');
   const block=await p.wait(f=>blockOf(f),{after:at,timeout:240000});
   const blockSeq=p.frames.find(r=>r.frame===block)?.seq;
   p.note({event:'uxw_block_seen',seq:blockSeq,parent_tool_use_id:block.parent_tool_use_id??null,type:block.type,subtype:block.subtype??null});
   let g;
   if(CASE==='d-during'){await delay(2000);g=sendGrant(grant('command',c),'next','the subagent\'s block read, the subagent still running');}
   const r1=await settle(p,at,400000);let endSeq=p.seq;
   p.note({event:'uxw_turn_end',markerFile:existsSync(`${WORK}/marker-${RUN}.txt`)});
   if(CASE==='d-after'){g=sendGrant(grant('command',c),'now','idle, after the subagent handed back and the turn ended');await settle(p,g.at);endSeq=p.seq;}
   else{const more=await p.wait(f=>f.type==='result',{after:endSeq,timeout:60000}).catch(()=>null);p.note({event:'uxw_after',anotherTurn:!!more});}
   p.note({event:'uxw_retries',markerFile:existsSync(`${WORK}/marker-${RUN}.txt`),calls:summary(g.at,b=>b.input?.command===c||String(b.input?.prompt??'').includes('maws-probe-marker'))});
  }
  await delay(1500);
  sessionId=p.sessionId;
  const dir=sessionDir(p);
  p.note({event:'uxw_transcript',kept:!!dir});
  const lines=existsSync(DEBUG)?readFileSync(DEBUG,'utf8').split('\n').filter(l=>/classifier|auto.?mode|permission_denied|denial/i.test(l)).map(l=>l.slice(0,400)):null;
  p.note({event:'uxw_debug_lines',count:lines?.length??null,lines:lines?.slice(0,80)??null});
  if(dir){
   mkdirSync(FIXTURES,{recursive:true});
   writeFileSync(`${FIXTURES}u1c-${TAG}.transcript.jsonl`,scrub(readFileSync(`${dir}/${p.sessionId}.jsonl`,'utf8')));
   const sub=`${dir}/${p.sessionId}/subagents`;
   if(existsSync(sub))for(const n of readdirSync(sub)){const m=n.match(/^agent-([^.]+)\.(jsonl|meta\.json)$/);if(!m)continue;writeFileSync(`${FIXTURES}u1c-${TAG}.agent-${m[1]}.${m[2]==='jsonl'?'transcript.jsonl':'meta.json'}`,scrub(readFileSync(`${sub}/${n}`,'utf8')));}
  }
 },{dir:'fixtures/uxwave/',cwd:WORK,settingSources:'user,project,local',strictMcp:false,mode:'auto',flags,env:cfg.env,model:MODEL});
};
