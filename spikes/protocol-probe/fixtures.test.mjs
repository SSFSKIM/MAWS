import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const dir=new URL('./fixtures/',import.meta.url);
const load=n=>readFileSync(new URL(n+'.jsonl',dir),'utf8').trim().split('\n').map(JSON.parse);
for(const file of readdirSync(dir).filter(f=>f.endsWith('.jsonl')))test(file+' is ordered, complete NDJSON with correlated RPC replies',()=>{
 const rows=load(file.slice(0,-6));let seq=0;const pending=new Set();
 for(const row of rows){assert.equal(row.seq,++seq);assert.ok(['in','out','meta','stderr'].includes(row.direction));const f=row.frame;
 if(f.type==='control_request')pending.add(row.direction+':'+f.request_id);
 if(f.type==='control_response'){const key=(row.direction==='in'?'out':'in')+':'+f.response.request_id;assert.ok(pending.delete(key),'response has pending request '+key);}
 assert.notEqual(f.event,'parse_error');assert.notEqual(f.event,'scenario_error');
 }assert.equal(pending.size,0);assert.ok(rows.some(r=>r.frame.event==='exit'&&r.frame.code===0));
});
test('child records preserve ancestry without claiming child token streams',()=>{const child=load('subagent').filter(r=>r.frame.parent_tool_use_id);assert.ok(child.some(r=>r.frame.type==='assistant'));assert.ok(child.some(r=>r.frame.type==='user'));assert.ok(!child.some(r=>r.frame.type==='stream_event'));});
test('interruption cancels queued UUID and a later turn succeeds',()=>{const a=load('queue-and-interrupt');const receipt=a.find(r=>r.frame.response?.response?.cancelled)?.frame.response.response;assert.equal(receipt.cancelled.length,1);assert.deepEqual(receipt.still_queued,[]);assert.ok(a.some(r=>r.frame.type==='command_lifecycle'&&r.frame.command_uuid===receipt.cancelled[0]&&r.frame.state==='cancelled'));assert.ok(a.some(r=>r.frame.type==='result'&&r.frame.result==='RESUMED'));});
test('CLI fork uses a new session while preserving context',()=>{const original=load('resume-fork-start').find(r=>r.frame.type==='result').frame;const fork=load('resume-fork-cli').find(r=>r.frame.type==='result').frame;assert.notEqual(fork.session_id,original.session_id);assert.equal(fork.result,'ZEBRA');});
// Pass-2 fixtures (child C2 of docs/charter.md). Integrity for every file, then one behavioural check per finding.
const dir2=new URL('./fixtures/pass2/',import.meta.url);
const load2=n=>readFileSync(new URL(n+'.jsonl',dir2),'utf8').trim().split('\n').map(JSON.parse);
const ins=(rows,pred)=>rows.filter(r=>r.direction==='in'&&pred(r.frame));
const responses=(rows,subtype)=>{const ids=new Set(rows.filter(r=>r.direction==='out'&&r.frame.request?.subtype===subtype).map(r=>r.frame.request_id));return rows.filter(r=>r.direction==='in'&&r.frame.type==='control_response'&&ids.has(r.frame.response.request_id)).map(r=>r.frame.response);};
const lastResult=rows=>ins(rows,f=>f.type==='result').at(-1)?.frame;
const secret=process.env.ANTHROPIC_AUTH_TOKEN;
for(const file of readdirSync(dir2).filter(f=>f.endsWith('.jsonl')))test('pass2/'+file+' is ordered NDJSON with correlated replies, provenance and no secrets',()=>{
 const text=readFileSync(new URL(file,dir2),'utf8');assert.ok(!text.includes('sk-ant-'));if(secret&&secret.length>=8)assert.ok(!text.includes(secret));
 const rows=text.trim().split('\n').map(JSON.parse);let seq=0;const pending=new Set();
 for(const row of rows){assert.equal(row.seq,++seq);assert.ok(['in','out','meta','stderr'].includes(row.direction));const f=row.frame;
  if(f.type==='control_request')pending.add(row.direction+':'+f.request_id);
  if(f.type==='control_response')assert.ok(pending.delete((row.direction==='in'?'out':'in')+':'+f.response.request_id));
  assert.notEqual(f.event,'parse_error');assert.notEqual(f.event,'scenario_error');}
 const prov=rows.find(r=>r.frame.event==='provenance')?.frame;assert.equal(prov.charter,'docs/charter.md');assert.equal(prov.child,'C2');assert.match(prov.pin,/^[0-9a-f]{40}$/);
 const exit=rows.find(r=>r.frame.event==='exit')?.frame;assert.ok(exit);
 // Exit code 1 is the engine's print-mode status when the last result was an error or the launch was refused.
 if(exit.code!==0){assert.equal(exit.code,1);assert.ok(lastResult(rows)?.is_error||rows.some(r=>r.direction==='stderr'));}
 else assert.equal(pending.size,0);
});
test('pass2 auto mode routed: effective mode, rule escalation, server verdicts on the stream, refusal code, fork unsupported',()=>{const a=load2('auto-routed');
 assert.ok(ins(a,f=>f.type==='system'&&f.subtype==='init').every(r=>r.frame.permissionMode==='auto'));
 assert.ok(ins(a,f=>f.request?.subtype==='can_use_tool').some(r=>r.frame.request.decision_reason_type==='rule'));
 assert.ok(ins(a,f=>f.type==='stream_event'&&JSON.stringify(f).includes('"outcome":"not_flagged"')).length>0);
 assert.ok(responses(a,'set_permission_mode').some(r=>r.error_code==='auto_mode_model'));
 assert.equal(responses(a,'fork_conversation')[0].response.reason,'unsupported');});
test('pass2 unrouted: expired login blocks turns, usage has no windows, fork unsupported',()=>{const u=load2('auto-unrouted');
 assert.match(lastResult(u).result,/OAuth session expired/);const usage=responses(u,'get_usage')[0].response;assert.equal(usage.rate_limits_available,false);
 assert.equal(responses(u,'fork_conversation')[0].response.reason,'unsupported');});
test('pass2 workflow progress carries phases and agents, and the run completes',()=>{const w=load2('workflow');
 const prog=ins(w,f=>f.subtype==='task_progress'&&f.workflow_progress).at(-1).frame.workflow_progress;
 assert.ok(prog.some(e=>e.type==='workflow_phase'));assert.equal(prog.filter(e=>e.type==='workflow_agent'&&e.state==='done').length,2);
 assert.ok(ins(w,f=>f.subtype==='task_notification'&&f.status==='completed').length);});
test('pass2 rewind refuses a stale target, then truncates the live context',()=>{const r=load2('rewind');const res=responses(r,'rewind_conversation').map(x=>x.response);
 assert.equal(res[0].reason,'stale_target');assert.equal(res[1].rewound,true);assert.equal(lastResult(r).result,'APPLE');
 assert.equal(responses(r,'rewind_files')[0].response.canRewind,false);});
test('pass2 hooks: host callback round trip without lifecycle frames; command hook with lifecycle frames',()=>{const h=load2('hooks');
 assert.equal(ins(h,f=>f.request?.subtype==='hook_callback')[0].frame.request.callback_id,'maws_pre_bash');
 const started=ins(h,f=>f.subtype==='hook_started');assert.ok(started.length>0&&started.every(r=>r.frame.hook_name==='PostToolUse:Bash'));
 assert.ok(ins(h,f=>f.subtype==='hook_response'&&f.stdout==='MAWS_POSTHOOK\n').length);});
test('pass2 MCP elicitation reaches the host and the accepted content reaches the tool',()=>{const d=load2('dialogs');
 assert.equal(ins(d,f=>f.request?.subtype==='elicitation')[0].frame.request.mode,'form');assert.ok(ins(d,f=>f.type==='user'&&JSON.stringify(f).includes('ELICITED')).length);
 assert.equal(responses(d,'get_settings')[0].response.effective.dialogExpiry,'never');});
test('pass2 perTaskStopAffordance decides whether interrupt kills a background workflow',()=>{
 assert.ok(ins(load2('per-task-stop-workflow-off'),f=>f.subtype==='task_notification'&&f.status==='stopped').length);
 assert.ok(ins(load2('per-task-stop-workflow-on'),f=>f.subtype==='task_notification'&&f.status==='completed').length);
 for(const n of ['per-task-stop-off','per-task-stop-on'])assert.ok(ins(load2(n),f=>f.subtype==='task_notification'&&f.status==='completed').length);
 assert.ok(ins(load2('per-task-stop-on'),f=>JSON.stringify(f.tool_result_meta||'').includes('user-rejected')).length);});
test('pass2 trust: project rules load only after attestation or set_cwd with trust',()=>{const n=load2('trust-no-attestation');const checks=n.filter(r=>r.frame.event==='rule_check').map(r=>r.frame.hasProbeRule);
 assert.deepEqual(checks,[false,false,true]);assert.equal(responses(n,'set_cwd')[0].response.status,'needs_trust');
 const a=load2('trust-attested');assert.equal(a.find(r=>r.frame.event==='workspace_trust_recorded').frame.value,true);assert.equal(a.find(r=>r.frame.event==='rule_check').frame.hasProbeRule,true);});
test('pass2 grants: flag-settings re-application suppresses the prompt after resume; an ask rule outranks any allow rule',()=>{
 assert.equal(ins(load2('grant-reapply-resume'),f=>f.request?.subtype==='can_use_tool').length,0);
 assert.equal(ins(load2('grant-reapply-start'),f=>f.request?.subtype==='can_use_tool').length,1);
 assert.equal(ins(load2('grant-askrule-resume'),f=>f.request?.subtype==='can_use_tool').length,1);
 assert.ok(ins(load2('grant-askrule-start'),f=>JSON.stringify(f.tool_result_meta||'').includes('permission-rule')).length);});
test('pass2 resume while live: a print-mode holder is not guarded, a --bg holder is',()=>{const h=load2('resume-live-holder');const s=load2('resume-live-second');
 assert.equal(lastResult(s).session_id,lastResult(h).session_id);assert.ok(h.find(r=>r.frame.event==='jsonl_after').frame.sameSession);
 assert.ok(load2('resume-live-bg').some(r=>r.direction==='stderr'&&/running as a background session/.test(r.frame.text)));});
test('pass2 bash_command output reaches the model only through the echoed non-querying user frame',()=>{
 assert.equal(lastResult(load2('bash-context-alone')).result,'NONE');assert.equal(lastResult(load2('bash-context-echoed')).result,'MAWS_BASH_8823');});
test('pass2 prewarm: claim_session binds a parked spare to a cwd and the first turn runs',()=>{const p=load2('prewarm');
 assert.equal(responses(p,'claim_session')[0].response.status,'ok');assert.equal(lastResult(p).result,'OK');});
test('pass2 routing: user settings env routes an unrouted process; empty flag-settings env values unroute it; haiku cannot hold auto',()=>{
 assert.match(load2('routing-user-settings').find(r=>r.frame.event==='routing').frame.baseUrl,/^http:\/\/127\.0\.0\.1/);
 assert.equal(load2('routing-flag-override').find(r=>r.frame.event==='routing').frame.baseUrl,null);
 const h=load2('auto-haiku');assert.equal(h.find(r=>r.frame.event==='init_summary').frame.current_permission_mode,'default');assert.equal(h.find(r=>r.frame.event==='mode_result').frame.error_code,'auto_mode_model');});
// C8c start: pass-3 fixtures (C2's R4 workspace-diff and worktree captures, C3's live captures). Integrity for every
// file, as pass 2 checks it; the typed get_workspace_diff shapes are C3's (src/engine-host/conformance/fixtures.test.ts).
const dir3=new URL('./fixtures/pass3/',import.meta.url);
// A pass-3 journal's rows checked in order (seqs from either base with no gap, known directions, every response closing
// a pending request or echoing one byte for byte, no parse or scenario error); answers the requests left open.
function pass3Open(rows){
 // the probe numbers rows from 1, C3's live relay captures from 0 (their provenance row); either base, then no gap
 // and the engine echoes a host's can_use_tool answer back on its stdout (C3's plan-outcomes): an `in` response that
 // repeats, byte for byte, the `out` response which already closed its request is an echo, not an orphan
 // and (E11, Decision Log 5, below) a `tools/call` is closed by its MCP client's `notifications/cancelled`
 assert.ok([0,1].includes(rows[0].seq));let seq=rows[0].seq-1;const pending=new Set();const answered=new Map();const calls=new Map();
 for(const row of rows){assert.equal(row.seq,++seq);assert.ok(['in','out','meta','stderr'].includes(row.direction));const f=row.frame;
  if(f.type==='control_request')pending.add(row.direction+':'+f.request_id);
  const mcp=f.type==='control_request'&&row.direction==='in'&&f.request?.subtype==='mcp_message'?f.request:null;
  if(mcp?.message?.method==='tools/call')calls.set(mcp.server_name+':'+JSON.stringify(mcp.message.id),'in:'+f.request_id);
  if(mcp?.message?.method==='notifications/cancelled')pending.delete(calls.get(mcp.server_name+':'+JSON.stringify(mcp.message.params?.requestId)));
  if(f.type==='control_response'){const key=(row.direction==='in'?'out':'in')+':'+f.response.request_id;
   if(pending.delete(key))answered.set(row.direction+':'+f.response.request_id,JSON.stringify(f));
   else assert.equal(answered.get((row.direction==='in'?'out':'in')+':'+f.response.request_id),JSON.stringify(f),'response has pending request '+key);}
  assert.notEqual(f.event,'parse_error');assert.notEqual(f.event,'scenario_error');}
 return pending;
}
for(const file of readdirSync(dir3).filter(f=>f.endsWith('.jsonl')))test('pass3/'+file+' is ordered NDJSON with correlated replies, provenance and no secrets',()=>{
 const text=readFileSync(new URL(file,dir3),'utf8');assert.ok(!text.includes('sk-ant-'));if(secret&&secret.length>=8)assert.ok(!text.includes(secret));
 const rows=text.trim().split('\n').map(JSON.parse);const pending=pass3Open(rows);
 // any child of docs/charter.md may record a pass-3 fixture (C2, C3, C10, C8a, …); a P1 child (E0a, E8, …) names the P1
 // composite spec too, as `spec` or as `document` (docs/doperpowers/plans/2026-10-05-p1-extension.md, whose blob is the pin);
 // a P2 child (P2-0, P2-A … P2-F, P2-E1, P2-E2; 2026-10-08, docs/doperpowers/plans/2026-10-08-p2-daily-driver.md §4.10 U1, U2)
 // names the P2 composite spec or its own execution document the same way
 const prov=rows.find(r=>r.frame.event==='provenance')?.frame;assert.equal(prov.charter,'docs/charter.md');assert.match(prov.child,/^(C\d+[a-z]?|E\d+[a-z]?|P2-(0|[A-F]\d?))$/);assert.match(prov.pin,/^[0-9a-f]{40}$/);if(/^(E|P2-)/.test(prov.child))assert.match(prov.spec??prov.document,/^docs\/doperpowers\/plans\/.*\.md$/);
 // E11 S1 (2026-10-08, docs/doperpowers/plans/2026-10-06-e11-finish.md Task 6.2): as in pass 2, exit code 1 is the
 // engine's print-mode status when the last result was an error (p1-maws-ask-interrupt: the interrupted turn's
 // error_during_execution, then the host's stop); every request must still be closed
 const exit=rows.find(r=>r.frame.event==='exit')?.frame;assert.ok(exit);
 if(exit.code!==0){assert.equal(exit.code,1);assert.equal(lastResult(rows)?.is_error,true,'exit 1 only after an error result');}
 assert.equal(pending.size,0);
});
// C8c end
// E11 (2026-10-07; docs/doperpowers/plans/2026-10-06-e11-finish.md, Decision Log 5): a `tools/call` the engine's MCP
// client abandons is never answered (src/engine-host/tool-server/server.ts: the host writes nothing for a withdrawn
// call), so the client's own `notifications/cancelled` naming its JSON-RPC id (matched as sent: 5 and "5" differ) closes
// that request, on the same server. Without it a recording of an interrupted blocking ask could not be admitted. A small
// synthetic journal: the cancelled call closes; a notification naming another id, the id as a string, or another
// server's call leaves the call open.
const mcpIn=(seq,requestId,server,message)=>({seq,direction:'in',at:'',frame:{type:'control_request',request_id:requestId,request:{subtype:'mcp_message',server_name:server,message}}});
const mcpOut=(seq,requestId,response)=>({seq,direction:'out',at:'',frame:{type:'control_response',response:{subtype:'success',request_id:requestId,response:{mcp_response:response}}}});
const cancelledAsk=cancelId=>[
 mcpIn(1,'r1','maws',{jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'ask',arguments:{}}}),
 mcpIn(2,'r2','maws',{jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:cancelId,reason:'interrupted'}}),
 mcpOut(3,'r2',{jsonrpc:'2.0',result:{},id:0}),
];
test('pass3 integrity: a tools/call closed by the client-sent notifications/cancelled naming its id counts as closed',()=>{
 assert.deepEqual([...pass3Open(cancelledAsk(5))],[]);
 assert.deepEqual([...pass3Open(cancelledAsk('5'))],['in:r1']);
 assert.deepEqual([...pass3Open(cancelledAsk(6))],['in:r1']);
 const otherServer=cancelledAsk(5);otherServer[1].frame.request.server_name='other';assert.deepEqual([...pass3Open(otherServer)],['in:r1']);
});
// C8b start: the three pass-3 agent-work probes (docs/doperpowers/plans/2026-09-28-c8b-agent-work-tools.md, R1, R5, R6).
const load3=n=>readFileSync(new URL(n+'.jsonl',dir3),'utf8').trim().split('\n').map(JSON.parse);
const notes=(rows,event)=>rows.filter(r=>r.direction==='meta'&&r.frame.event===event).map(r=>r.frame);
test('pass3 relay-to-child: the parent SendMessages the child by id, the child receives it, and the held Bash defers the busy case',()=>{const r=load3('relay-to-child');
 assert.equal(notes(r,'relay_hold_missing').length,0);assert.equal(notes(r,'relay_child_gone').length,0);assert.equal(notes(r,'relay_hold_armed').length,1);
 const child=notes(r,'relay_child').find(n=>n.case==='background');assert.equal(child.is_backgrounded,true);
 const sends=ins(r,f=>f.type==='assistant'&&!f.parent_tool_use_id).flatMap(x=>x.frame.message.content).filter(b=>b.type==='tool_use'&&b.name==='SendMessage');
 assert.ok(sends.filter(b=>b.input.to===child.task_id).length>=2);
 // 2.1.283 forwards no receipt frame: the child's transcript holds a queued_command attachment with the coordinator origin
 for(const kase of ['idle','busy']){const rc=notes(r,'relay_child_receipt').find(n=>n.case===kase);assert.ok(rc.live===true||(rc.form==='attachment:queued_command'&&rc.line.origin?.kind==='coordinator'),kase+' receipt live or on disk');}
 const held=notes(r,'relay_held')[0];assert.ok(held.secondsAfterSendMessage>=15);assert.deepEqual(held.receiptWhileHeld,[]);
 assert.ok(notes(r,'relay_busy_receipt_after_release')[0].afterRelease);
 assert.equal(notes(r,'relay_foreground')[0].when,'after-child-returned');});
test('pass3 nested-agents: the grandchild starts on the parent wire at depth 2 and its sidecar names the child as parent',()=>{const r=load3('nested-agents');
 const started=ins(r,f=>f.subtype==='task_started'&&f.task_type==='local_agent').map(x=>x.frame);assert.deepEqual(started.map(f=>f.spawn_depth),[1,2]);
 const meta=JSON.parse(readFileSync(new URL('nested-agents-sidecars/agent-'+started[1].task_id+'.meta.json',dir3),'utf8'));assert.equal(meta.parentAgentId,started[0].task_id);
 const issued=ins(r,f=>f.type==='assistant'&&f.parent_tool_use_id===started[0].tool_use_id).flatMap(x=>x.frame.message.content).some(b=>b.type==='tool_use'&&b.id===started[1].tool_use_id);assert.ok(issued);});
test('pass3 stop-task: each stop emits the snapshot without the task, killed, then stopped, all after the request and before the stop_task response',()=>{const r=load3('stop-task');
 const stops=notes(r,'stop_response');assert.deepEqual(stops.map(s=>s.kind),['shell','agent','workflow']);
 const requests=r.filter(x=>x.direction==='out'&&x.frame.request?.subtype==='stop_task');
 for(const s of stops){assert.equal(s.subtype,'success');const request=requests.find(x=>x.frame.request.task_id===s.task_id);assert.ok(request.seq<s.seq);
  const frames=ins(r,f=>f.type==='system'&&(f.subtype==='task_updated'||f.subtype==='task_notification')&&f.task_id===s.task_id);
  const updated=frames.find(x=>x.frame.subtype==='task_updated'),notification=frames.find(x=>x.frame.subtype==='task_notification');
  assert.equal(updated.frame.patch.status,'killed');assert.equal(notification.frame.status,'stopped');
  assert.ok(request.seq<updated.seq&&updated.seq<notification.seq&&notification.seq<s.seq);
  const snap=ins(r,f=>f.subtype==='background_tasks_changed').filter(x=>x.seq>request.seq&&x.seq<updated.seq);
  assert.equal(snap.length,1);assert.ok(!snap[0].frame.tasks.some(t=>t.task_id===s.task_id));}
 for(const event of ['stop_missing','stop_again']){const n=notes(r,event)[0];assert.equal(n.subtype,'success');assert.deepEqual(n.framesAfter,[]);}});
test('pass3 nested-agents-sidecars carry no secrets',()=>{const side=new URL('nested-agents-sidecars/',dir3);const files=readdirSync(side);assert.equal(files.length,4);
 for(const file of files){const text=readFileSync(new URL(file,side),'utf8');assert.ok(!text.includes('sk-ant-'),file);if(secret&&secret.length>=8)assert.ok(!text.includes(secret),file);}});
// C8b end
// Debt wave 5 (C3): the transient daemon a `--bg` job starts runs the installer's launcher while the pin runs from the
// installer's versions directory, whatever PATH says or however the pin is linked; it runs the pin when the pin's real
// path is outside that directory (engine custody's copy) or XDG_DATA_HOME moves the directory.
test('pass3 bg-daemon-binary: the daemon runs the pin only when the pin is not under the versions directory',()=>{const r=load3('bg-daemon-binary');
 const version=Object.fromEntries(notes(r,'daemon_start').map(n=>[n.arm,n.version]));
 assert.deepEqual(version,{'installed-path':'2.1.285','path-shim':'2.1.285','xdg-data-home':'2.1.283','symlink-outside':'2.1.285','custody-copy':'2.1.283'});
 const exe=Object.fromEntries(notes(r,'daemon_process').map(n=>[n.arm,n.exe]));assert.equal(exe['custody-copy'],notes(r,'arm').find(n=>n.arm==='custody-copy').bin);
 assert.ok(notes(r,'daemon_exit').every(n=>n.alive===false));assert.ok(notes(r,'owner_file_check').every(n=>n.scratchProjects.length===0));});
// W7 F1 (C4; docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md): the owner's collision under a scratch home.
// MAWS's `-p` process and a terminal `claude --resume` of the same id both register as interactive holders, the engine
// refuses neither, both write the one JSONL as sibling branches, and a resume afterwards continues from the branch the
// file ends on. The pre-W7 rules (a registry reading MAWS's own record as a terminal, a follower that flips) beside W7's.
test('pass3 w7-collision: both writers register, neither is refused, the transcript forks, and a resume loses the other branch',()=>{const r=load3('w7-collision');
 const at=e=>notes(r,e)[0];const disk=new URL('w7-collision-disk/',dir3);
 const maws=at('maws_launched'),terminal=at('terminal_spawned');
 const reg=n=>JSON.parse(readFileSync(new URL(readdirSync(disk).find(f=>f.startsWith('registry-'+n+'-')),disk),'utf8'));
 assert.deepEqual([reg('maws').pid,reg('maws').kind,reg('maws').entrypoint],[maws.pid,'interactive','sdk-ts']);
 assert.deepEqual([reg('terminal').pid,reg('terminal').kind,reg('terminal').entrypoint],[terminal.pid,'interactive','cli']);
 assert.equal(reg('maws').sessionId,maws.sessionId);assert.equal(reg('terminal').sessionId,maws.sessionId);
 // pre-W7: MAWS's own record is a terminal holder, and MAWS's exit re-emits nothing; W7: only the terminal holds
 assert.deepEqual(at('registry_maws_only').before.holderEvents.map(e=>e.holder),[{kind:'terminal',pid:maws.pid}]);
 assert.deepEqual(at('registry_maws_only').after.holderEvents,[]);
 assert.deepEqual(at('registry_both').fsHolders,[{kind:'terminal',pid:terminal.pid}]);
 assert.deepEqual(at('maws_exited').before.holderEvents,[]);assert.equal(at('maws_exited').exitRow.reason,'stop');
 assert.equal(at('terminal_turn_one').after.foreignWrites.length,1);
 // the transcript: one fork, a terminal prompt and a MAWS prompt on the same parent
 const fork=at('transcript_branches').forks;assert.equal(fork.length,1);
 assert.deepEqual(fork[0].children.filter(c=>c.type==='user').map(c=>c.entrypoint).sort(),['cli','sdk-ts']);
 // pre-W7 the view flips twice (MAWS_TWO vanishes at TERMINAL_TWO); W7 holds the terminal's branch, then re-folds
 const kinds=list=>list.map(e=>e.key??e.kind);
 assert.deepEqual(kinds(at('terminal_turn_two').before.follower),['boundary.retraction','transcript_branch']);
 assert.deepEqual(kinds(at('terminal_turn_two').after.follower),['transcript_branch_held']);
 assert.ok(kinds(at('terminal_exited').after.follower).includes('boundary.retraction'));
 assert.equal(at('send_guard').verdict.live,'foreign');
 // the engine resumes from the branch the file ends on: MAWS_TWO is gone from the model's context
 const recall=at('maws_resumed_recall').answer;assert.match(recall,/TERMINAL_TWO/);assert.doesNotMatch(recall,/MAWS_TWO/);});
// W7 F2 (C10): "Take over here" against a terminal holding the session: main's release signals the verified pid, the
// interactive engine exits by its own handler (143) and unlinks its record, and MAWS resumes on top of its branch.
test('pass3 w7-take-over: SIGTERM ends an interactive holder, the registry clears, and the resume continues its branch',()=>{const r=load3('w7-take-over');
 const at=e=>notes(r,e)[0];
 assert.deepEqual(at('terminal_holds').holders,[{kind:'terminal',pid:at('terminal_holds').pid}]);
 const take=at('take_over');assert.deepEqual(take.outcome,{status:'released'});assert.equal(take.terminalExit.exitCode,143);assert.deepEqual(take.registry,[]);assert.ok(take.ms<10000);
 assert.match(at('resumed').answer,/BEFORE.*TERMINAL/);assert.equal(at('resumed').parentEntrypoint,'cli');});
// E3 M0 (docs/doperpowers/plans/2026-10-06-e3-side-threads.md; findings-pass3-e3-side-thread.txt): a side thread forked
// while the parent's turn runs, an [image, text] `next` steer in that turn, and the thread resumed by its own id.
test('pass3 p1-side-thread-live: the fork starts mid-turn and recalls, the image steer folds in and is kept on disk, the thread resumes by its id',()=>{
 const parent=load3('p1-side-thread-live'),fork=load3('p1-side-thread-live-fork'),resume=load3('p1-side-thread-live-resume');
 for(const rows of [parent,fork,resume])assert.ok(notes(rows,'check').length>0&&notes(rows,'check').every(c=>c.ok===true));
 // (a) the child's system/init came after the parent's Bash tool_use and before its result; the parent's turn completed
 const t=notes(parent,'fork_timing')[0];assert.ok(t.bashUseAt<t.childInitAt&&t.childInitAt<t.parentToolResultAt);
 const pin=notes(fork,'provenance')[0].pinnedSessionId;assert.equal(ins(fork,f=>f.type==='system'&&f.subtype==='init')[0].frame.session_id,pin);
 assert.match(lastResult(fork).result,/ZEBRA/);assert.equal(lastResult(parent).subtype,'success');
 // the child's copy closes the parent's open Bash call with the engine's interrupted placeholder before the comment
 const child=notes(fork,'jsonl_snapshot')[0].records,parentRecs=notes(parent,'jsonl_snapshot')[0].records;
 const root=recs=>recs.find(r=>r.parentUuid===null&&typeof r.uuid==='string').uuid;assert.equal(root(child),root(parentRecs));
 assert.ok(child.some(r=>r.type==='user'&&JSON.stringify(r.message.content).includes('[Tool call interrupted')));
 // (b) queued before the Bash result, started after it, one result naming both prompts; on disk a queued_command
 // attachment whose prompt keeps the image block byte for byte
 const d=notes(parent,'steer_delivery')[0];const state=s=>d.lifecycle.find(l=>l.state===s).seq;
 assert.ok(state('queued')<d.toolResultSeq&&d.toolResultSeq<state('started'));assert.equal(d.results.length,1);assert.equal(d.results[0].user_message_uuids.length,2);
 const steer=parentRecs.find(r=>r.attachment?.type==='queued_command');const sent=parent.find(r=>r.direction==='out'&&r.frame.priority==='next').frame;
 assert.equal(steer.attachment.source_uuid,sent.uuid);assert.deepEqual(steer.attachment.prompt,sent.message.content);
 // (c) the resume answers under the child's id and writes no new transcript
 assert.equal(ins(resume,f=>f.type==='system'&&f.subtype==='init')[0].frame.session_id,pin);assert.match(lastResult(resume).result,/ZEBRA/);
 assert.equal(notes(resume,'provenance')[0].pinnedSessionId,null);});
// E7 start (docs/doperpowers/plans/2026-10-06-e7-orchestration.md, M0): cross-session messages between two MAWS-launched
// print-mode sessions, live (e7-peer-a, e7-peer-b) and on disk (e7-peer-transcripts/).
const ENVELOPE_RE=/<cross-session-message from="([^"]+)"([^>]*)>\n([\s\S]*?)\n<\/cross-session-message>/;
const userText=f=>typeof f.message?.content==='string'?f.message.content:'';
test('pass3 e7-peer: the listing names B, B\'s message reaches idle A as a peer user frame, and the owner\'s relay steer becomes a SendMessage to the envelope\'s from',()=>{
 const a=load3('e7-peer-a'),b=load3('e7-peer-b');
 const listing=notes(a,'e7_listing')[0].result.structured.listing;
 assert.match(listing,/^This session is \S+ \[[0-9a-f]+\] — the name other sessions use to message it/);
 assert.match(listing,/\n\nPeer sessions \(1\):\n {2}\S+ \[[0-9a-f]+\] {2}· {2}interactive {2}· {2}idle {2}· {2}started \d+s ago$/);
 // idle: the wire frame is a replayed, synthetic user frame with a peer origin; its text is preamble, envelope, trailer
 const idle=notes(a,'e7_inbound').find(n=>n.case==='idle').inbound;
 const frame=a.find(r=>r.seq===idle.seq).frame;
 assert.equal(frame.isReplay,true);assert.equal(frame.isSynthetic,true);
 assert.deepEqual(Object.keys(frame.origin).sort(),['body','from','fromMode','kind','msg_id','name','verifiedPeerPid']);
 assert.equal(frame.origin.kind,'peer');assert.equal(frame.origin.body,'E7 probe: hello from B');
 const m=ENVELOPE_RE.exec(userText(frame));assert.ok(m);assert.equal(m[1],frame.origin.from);assert.match(m[1],/^uds:\/tmp\/cc-socks\/\d+\.sock$/);
 assert.equal(m[2],` from-name="${frame.origin.name}" from-mode="prompting"`);assert.equal(m[3],'E7 probe: hello from B');
 assert.ok(userText(frame).startsWith('Another Claude session sent a message:\n<cross-session-message '));
 assert.ok(userText(frame).endsWith('that\'s permission laundering.'));
 // the peer message starts A's turn: command_lifecycle started for the frame's uuid ahead of it
 assert.ok(a.some(r=>r.seq<idle.seq&&r.frame.type==='command_lifecycle'&&r.frame.command_uuid===frame.uuid&&r.frame.state==='started'));
 // the owner's reply: the relay steer's SendMessage carries the owner's text to the envelope's from; success structured
 const reply=notes(a,'e7_reply')[0];
 assert.equal(reply.sendMessage.input.to,idle.from);assert.equal(reply.matchesOwnerText,true);
 assert.equal(reply.result.isError,false);assert.equal(reply.result.structured.success,true);
 assert.ok(reply.result.structured.message.startsWith('“E7 probe: reply from A” → '+idle.from));
 assert.equal(notes(b,'e7_inbound').find(n=>n.case==='reply').inbound.origin.body,'E7 probe: reply from A');
});
test('pass3 e7-peer: mid-turn, the wire frame is the bare envelope right after the tool result; a send to nobody is success:false, not an error',()=>{
 const a=load3('e7-peer-a');
 const mid=notes(a,'e7_inbound').find(n=>n.case==='mid-turn');
 assert.equal(mid.arrivedBeforeBashResult,false);assert.equal(mid.inbound.seq,mid.bashResultSeq+1);
 const frame=a.find(r=>r.seq===mid.inbound.seq).frame;
 assert.equal(userText(frame),'<cross-session-message from="'+frame.origin.from+'" from-name="'+frame.origin.name+'" from-mode="prompting">\nE7 probe: second message while you work\n</cross-session-message>');
 const fail=notes(a,'e7_send_failure')[0].pairs[0].result;
 assert.equal(fail.isError,false);
 assert.deepEqual(fail.structured,{success:false,message:'No agent named \'nobody-e7\' is reachable.\nUse ListAgents to see everyone you can message.',display:'Not sent — no agent named \'nobody-e7\' is reachable.'});
});
test('pass3 e7-peer-transcripts: an idle peer message is a meta user record with a peer origin; a mid-turn one a queued_command attachment rendered as a system reminder',()=>{
 // M0's two -p sessions, and (E11 S2(c), docs/doperpowers/plans/2026-10-06-e11-finish.md) an interactive terminal's below
 const dir=new URL('e7-peer-transcripts/',dir3);const files=readdirSync(dir);assert.equal(files.length,3);
 for(const f of files){const text=readFileSync(new URL(f,dir),'utf8');assert.ok(!text.includes('sk-ant-'),f);if(secret&&secret.length>=8)assert.ok(!text.includes(secret),f);}
 const aId=notes(load3('e7-peer-a'),'provenance')[0].pinnedSessionId;
 const a=readFileSync(new URL(aId+'.jsonl',dir),'utf8').trim().split('\n').map(JSON.parse);
 const idle=a.find(r=>r.type==='user'&&r.origin?.kind==='peer');
 assert.equal(idle.isMeta,true);assert.equal(idle.promptSource,'system');assert.equal(idle.turnOrigin,'peer');assert.equal(idle.origin.body,'E7 probe: hello from B');
 assert.ok(idle.message.content.startsWith('Another Claude session sent a message:\n<cross-session-message '));
 const mid=a.find(r=>r.type==='attachment'&&r.attachment.type==='queued_command'&&r.attachment.origin?.kind==='peer');
 assert.equal(mid.attachment.prompt,'<cross-session-message from="'+mid.attachment.origin.from+'" from-name="'+mid.attachment.origin.name+'" from-mode="prompting">\nE7 probe: second message while you work\n</cross-session-message>');
 assert.equal(mid.attachment.isMeta,true);assert.equal(mid.renderedRole,'system');
 assert.match(mid.rendered[0].content,/^<system-reminder>\nAnother Claude session sent a message while you were working:\n<cross-session-message /);
 assert.match(mid.rendered[0].content,/ After completing your current task, decide whether\/how to respond \(reply via SendMessage to the `from=` address\)\.\n<\/system-reminder>$/);
 assert.ok(a.some(r=>r.type==='queue-operation'&&r.operation==='remove'&&r.reason==='absorbed_mid_turn'&&r.commandUuid===mid.attachment.source_uuid));
});
// E11 S2(c) (docs/doperpowers/plans/2026-10-06-e11-finish.md, Design §5): an interactive terminal session (entrypoint cli,
// 2.1.293, Haiku, under a scratch home) messaged by a MAWS session while idle; recorded by e2e/p1-live.spec.ts's S2(c) case,
// redacted by the live harness. Its peer record has the -p form above (isMeta, promptSource system, turnOrigin peer), its
// enqueue and dequeue beside it, and its own cost record at the end.
test('pass3 e7-peer-transcripts: an interactive terminal session writes the idle peer record in the -p form',()=>{
 const t=readFileSync(new URL('e7-peer-transcripts/07b1a2b6-2ef6-48ef-93ba-1841c4634739.jsonl',dir3),'utf8').trim().split('\n').map(JSON.parse);
 const peer=t.filter(r=>r.type==='user'&&r.origin?.kind==='peer');assert.equal(peer.length,1);
 assert.equal(peer[0].entrypoint,'cli');assert.equal(peer[0].version,'2.1.293');
 assert.equal(peer[0].isMeta,true);assert.equal(peer[0].promptSource,'system');assert.equal(peer[0].turnOrigin,'peer');
 assert.equal(peer[0].origin.body,'E11 S2c: hello from a MAWS session. No reply needed.');assert.equal(peer[0].origin.fromMode,'prompting');
 assert.ok(peer[0].message.content.startsWith('Another Claude session sent a message:\n<cross-session-message from="uds:'));
 assert.deepEqual(t.filter(r=>r.type==='queue-operation').map(r=>r.operation),['enqueue','dequeue']);
 assert.equal(t.at(-1).type,'cost-state');assert.ok(t.at(-1).totalCostUSD>0&&t.at(-1).totalCostUSD<0.05);
});
// E11 S2(d) (Design §5; Decision Log 6): the one teammate attempt, an interactive terminal under
// CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 (2.1.293, Haiku, a scratch home), spawning "scout" and calling ListAgents. A team
// formed: the listing names it under Teammates, its sidecar meta names the team, and the teammate's report reaches the
// lead as a plain user record (no origin, not isMeta) carrying a <teammate-message> envelope. The lead's transcript and
// the teammate's sidecar as the projects folder held them (transcripts, not journals: kept in a folder of their own).
test('pass3 e7-team-terminal: a team forms in an interactive terminal; ListAgents names the teammate under Teammates',()=>{
 const root=new URL('e7-team-terminal/',dir3);const id='b4b10738-4b3f-4539-906b-fcb5da9669a5';
 const files=[id+'.jsonl',id+'/subagents/agent-ascout-bcbb17e39be8c1bd.jsonl',id+'/subagents/agent-ascout-bcbb17e39be8c1bd.meta.json'];
 for(const f of files){const text=readFileSync(new URL(f,root),'utf8');assert.ok(!text.includes('sk-ant-'),f);if(secret&&secret.length>=8)assert.ok(!text.includes(secret),f);}
 const lead=readFileSync(new URL(files[0],root),'utf8').trim().split('\n').map(JSON.parse);
 const blocks=r=>Array.isArray(r.message?.content)?r.message.content:[];
 const spawn=lead.flatMap(blocks).find(b=>b.type==='tool_use'&&b.name==='Agent');
 assert.deepEqual([spawn.input.name,spawn.input.subagent_type,spawn.input.run_in_background],['scout','general-purpose',true]);
 const list=lead.flatMap(blocks).find(b=>b.type==='tool_use'&&b.name==='ListAgents');
 const listing=lead.flatMap(blocks).find(b=>b.type==='tool_result'&&b.tool_use_id===list.id).content;
 assert.match(listing,/^This session is \S+ \[[0-9a-f]+\] — the name other sessions use to message it/);
 assert.match(listing,/\n\nTeammates \(1\):\n {2}scout \[[0-9a-f]+\] {2}· {2}general-purpose {2}· {2}running {2}· {2}started \d+s ago$/);
 const meta=JSON.parse(readFileSync(new URL(files[2],root),'utf8'));
 assert.deepEqual([meta.name,meta.taskKind,meta.teamName,meta.spawnedAgentType],['scout','in_process_teammate','session-'+id.slice(0,8),'general-purpose']);
 const report=lead.find(r=>r.type==='user'&&typeof r.message?.content==='string'&&r.message.content.includes('<teammate-message '));
 assert.equal(report.isMeta,undefined);assert.equal(report.origin,undefined);
 assert.match(report.message.content,/^Another Claude session sent a message:\n<teammate-message teammate_id="scout" color="blue" summary="[^"]+">\n/);
 assert.equal(lead.at(-1).type,'cost-state');
});
test('pass3 e7-cron: CronCreate answers its id structured; a fire opens a turn with no user frame, its prompt only on disk (turnOrigin scheduled)',()=>{
 const c=load3('e7-cron');const at=e=>notes(c,e)[0];
 const creates=at('e7_cron_setup').pairs.filter(p=>p.use.name==='CronCreate');
 assert.deepEqual(creates.map(p=>Object.keys(p.result.structured).sort()),[['durable','humanSchedule','id','recurring'],['durable','humanSchedule','id','recurring']]);
 const [tick,one]=creates.map(p=>p.result);
 assert.equal(tick.text,`Scheduled recurring job ${tick.structured.id} (Every 2 minutes). Session-only (not written to disk, dies when Claude exits). Auto-expires after 7 days. Use CronDelete to cancel sooner.`);
 assert.match(one.text,/^Scheduled one-shot task [0-9a-f]{8} \(\d+ \d+ \d+ \d+ \*\)\. Session-only \(not written to disk, dies when Claude exits\)\. It will fire once then auto-delete\.$/);
 // both jobs fired (the recurring one each period, the one-shot once); the wire carries no user frame for a fire, and
 // its result names no user message
 const fires=at('e7_cron_jsonl').fires;
 assert.deepEqual(fires.map(f=>f.job).slice(0,2),[tick.structured.id,one.structured.id]);
 assert.equal(fires.filter(f=>f.job===one.structured.id).length,1);assert.ok(fires.every(f=>f.job===tick.structured.id||f.job===one.structured.id));
 for(const f of fires){assert.equal(f.userFrameInTurn,null);assert.equal(f.result.user_message_uuids,null);
  assert.equal(f.record.type,'user');assert.equal(f.record.isMeta,true);assert.equal(f.record.promptSource,'system');assert.equal(f.record.turnOrigin,'scheduled');assert.equal(f.record.origin,undefined);}
 // the one-shot fires on its minute (no jitter off :00/:30); CronDelete answers its text and {id}
 const oneShotAt=Date.parse(at('e7_cron_setup').oneShotAt);assert.ok(Math.abs(Date.parse(fires[1].at)-oneShotAt)<5000);
 const del=at('e7_cron_delete').pairs.find(p=>p.use.name==='CronDelete').result;
 assert.equal(del.text,`Cancelled job ${tick.structured.id}.`);assert.deepEqual(del.structured,{id:tick.structured.id});
});
test('pass3 e7-cron: a durable job lands in the project\'s scheduled_tasks.json, and a resume resurrects the session-only job under its id',()=>{
 const durable=JSON.parse(readFileSync(new URL('e7-cron-durable/scheduled_tasks.json',dir3),'utf8'));
 assert.equal(durable.tasks.length,1);
 assert.deepEqual(Object.keys(durable.tasks[0]).sort(),['createdAt','createdByPid','createdByProcStart','createdBySessionId','createdInProject','cron','id','prompt','recurring']);
 assert.equal(durable.tasks[0].prompt,'E7 durable weekly');
 const after=JSON.parse(readFileSync(new URL('e7-cron-durable/scheduled_tasks.after-resume.json',dir3),'utf8'));
 assert.equal(after.tasks[0].createdAt,durable.tasks[0].createdAt);assert.notEqual(after.tasks[0].createdByPid,durable.tasks[0].createdByPid);
 const nightly=notes(load3('e7-cron'),'e7_cron_durable')[0].pairs.find(p=>p.use.input?.prompt==='E7 nightly').result.structured.id;
 const listed=notes(load3('e7-cron-resume'),'e7_cron_resume')[0].pairs.find(p=>p.use.name==='CronList').result.structured.jobs;
 assert.deepEqual(listed.map(j=>[j.id,j.durable??true]).sort(),[[durable.tasks[0].id,true],[nightly,false]].sort());
});
test('pass3 e7-team: under the teams gate a named background agent keeps its name on the wire and in its sidecar, and lists under Subagents, not Teammates',()=>{
 const t=load3('e7-team');const spawn=notes(t,'e7_team_spawn')[0];
 assert.equal(spawn.nameOnWire,true);
 const listing=notes(t,'e7_team_listing')[0].listings[0].result.structured.listing;
 assert.match(listing,/\n\nSubagents \(1\):\n {2}scout \[[0-9a-f]+\] {2}· {2}general-purpose {2}· {2}completed {2}· {2}started \d+s ago$/);
 assert.doesNotMatch(listing,/Teammates/);
 const disk=notes(t,'e7_team_disk')[0];assert.equal(disk.teamsDir,null);
 assert.equal(Object.values(disk.sidecarMeta)[0].name,'scout');
});
// E7 end
// P2-C3 (2026-10-14; docs/doperpowers/plans/2026-10-08-p2-daily-driver.md, Decision Log 35): a subagent's
// mcp__maws__ask tool_use arrives in an assistant frame whose parent_tool_use_id is set, on the same stdout and before
// the tools/call that names it by _meta["claudecode/toolUseId"], with no permission round trip between them (the tool
// allowed by rule); twice, each agent backgrounded as 2.1.299 backgrounds every Agent call under MAWS's launch line.
test('pass3 p2-c3-subagent-ask: each subagent ask is framed with its parent before the server gets its call',()=>{
 const rows=load3('p2-c3-subagent-ask');
 const uses=new Map(rows.filter(r=>r.direction==='in'&&r.frame.type==='assistant').flatMap(r=>r.frame.message.content.filter(b=>b.type==='tool_use').map(b=>[b.id,{seq:r.seq,name:b.name,parent:r.frame.parent_tool_use_id}])));
 const calls=rows.filter(r=>r.direction==='in'&&r.frame.type==='control_request'&&r.frame.request.message?.method==='tools/call');
 assert.equal(calls.length,2);
 for(const call of calls){const use=uses.get(call.frame.request.message.params._meta['claudecode/toolUseId']);
  assert.ok(use);assert.equal(use.name,'mcp__maws__ask');assert.match(use.parent,/^toolu_/);assert.ok(use.seq<call.seq);}
 assert.ok(!rows.some(r=>r.frame.type==='control_request'&&r.frame.request.subtype==='can_use_tool'));
});
// P4-B4 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, M0 and M3; the P4 spec §4.6, R-2): what the pinned
// engine sends the model for MAWS's `maws` server, recorded against the scripted Messages API stand-in (stub-api.mjs,
// nothing spent). The served list and paragraph are scenarios/pass3/p4-maws-tools.json, which a unit test pins to
// src/shared/maws/tools.ts and instructions.ts, so these checks hold the wire to MAWS's own X33 texts.
const dir4=new URL('./fixtures/p4/',import.meta.url);
const load4=n=>readFileSync(new URL(n+'.jsonl',dir4),'utf8').trim().split('\n').map(JSON.parse);
const served4=JSON.parse(readFileSync(new URL('./scenarios/pass3/p4-maws-tools.json',import.meta.url),'utf8'));
const B4=['p4-b4-instructions','p4-b4-owner-style','p4-b4-append','p4-b4-no-tool-search','p4-b4-resume-first','p4-b4-resume'];
const meta4=(rows,event)=>rows.filter(r=>r.direction==='meta'&&r.frame.event===event).map(r=>r.frame);
const mainRequests4=rows=>meta4(rows,'stub_requests')[0].requests.filter(q=>q.main);
// The engine's context message (role system inside `messages`) of a request, as the stub recorded it.
const contextText4=q=>q.messages.filter(m=>m.role==='system').flatMap(m=>m.blocks).map(b=>b.text??'').join('\n');
for(const name of B4)test('p4/'+name+' is ordered NDJSON with correlated replies, P4-B4 provenance, the owner file unchanged, no secret and nothing spent',()=>{
 const text=readFileSync(new URL(name+'.jsonl',dir4),'utf8');assert.ok(!text.includes('sk-ant-'));
 const rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(pass3Open(rows).size,0); // pass 3's integrity rule, the engine's byte-for-byte echo of every host answer included
 const prov=meta4(rows,'provenance')[0];assert.equal(prov.child,'P4-B4');assert.equal(prov.served,'p4-maws-tools.json');assert.match(prov.pin,/^[0-9a-f]{40}$/);
 const owner=meta4(rows,'owner_file_check');assert.equal(owner.length,2);assert.equal(owner[1].same,true);
 assert.ok(rows.some(r=>r.frame.event==='exit'&&r.frame.code===0));
 assert.ok(meta4(rows,'spend')[0].result.total_cost_usd<0.0001);
});
test('p4 the maws server lists artifact_search exactly as MAWS describes it, read-only, and the engine connects it',()=>{
 const rows=load4('p4-b4-instructions');
 const listed=rows.find(r=>r.direction==='out'&&r.frame.type==='control_response'&&r.frame.response.response?.mcp_response?.result?.tools)?.frame.response.response.mcp_response.result.tools;
 const search=listed.find(t=>t.name==='artifact_search');const expected=served4.tools.find(t=>t.name==='artifact_search');
 assert.deepEqual(search,expected);assert.equal(search.annotations.readOnlyHint,true);assert.ok(search.description.length<4096);
 const init=meta4(rows,'init_tools')[0];assert.ok(init.maws.includes('mcp__maws__artifact_search'));assert.deepEqual(init.mcp_servers,[{name:'maws',status:'connected',source:'sdk'}]);
 // without tool search the model is given it loaded, with the description and schema as listed
 const loaded=mainRequests4(load4('p4-b4-no-tool-search'))[0].tools.find(t=>t.name==='mcp__maws__artifact_search');
 assert.equal(loaded.defer_loading,null);assert.equal(loaded.description,expected.description);assert.deepEqual(loaded.input_schema.properties,expected.inputSchema.properties);
});
test('p4 the model is given the other two wire changes as listed: show_pane\'s `at` and artifact_list\'s pointer to artifact_search',()=>{
 const tools=mainRequests4(load4('p4-b4-no-tool-search'))[0].tools;
 const pane=tools.find(t=>t.name==='mcp__maws__show_pane');const servedPane=served4.tools.find(t=>t.name==='show_pane');
 assert.ok(pane.input_schema.properties.at);assert.deepEqual(pane.input_schema.properties.at,servedPane.inputSchema.properties.at);
 const list=tools.find(t=>t.name==='mcp__maws__artifact_list');const servedList=served4.tools.find(t=>t.name==='artifact_list');
 assert.equal(list.description,servedList.description);assert.ok(list.description.includes('To find artifacts by what they contain, use artifact_search.'));
});
test('p4 R-2: the server\'s instructions reach the model under ## maws in the engine\'s context message, the owner\'s style case and tool search off included',()=>{
 for(const name of ['p4-b4-instructions','p4-b4-owner-style','p4-b4-no-tool-search','p4-b4-append']){
  const q=mainRequests4(load4(name))[0];const context=contextText4(q);
  assert.ok(context.includes('# MCP Server Instructions'),name);assert.ok(context.includes('## maws\n'+served4.instructions),name);
  assert.equal(q.system.mcpInstructions,false,name); // not in the top-level system prompt
 }
 const style=contextText4(mainRequests4(load4('p4-b4-owner-style'))[0]);assert.ok(style.includes('# Output Style: probe-to-human'));
 const append=mainRequests4(load4('p4-b4-append'))[0];assert.equal(append.system.linkMarker,true);assert.equal(append.system.contractMarker,true); // route (a)'s text would land in the top-level system
});
// P4-A3 lever 2 (docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md): a human user frame carrying a linked read
// after the words, on 2.1.304 against the stub (nothing spent). The block's form is linked-read.ts's, which
// src/shared/maws/linked-read.test.ts checks against this fixture's recorded text.
test('p4 A3 the linked read: the model gets the words then the read, unchanged, in the one user message; the echo and the transcript keep both; the edit runs with no ToolSearch',()=>{
 const rows=load4('p4-a3-linked-read');
 assert.equal(pass3Open(rows).size,0);
 const prov=meta4(rows,'provenance')[0];assert.equal(prov.child,'P4-A3');assert.equal(prov.engineVersion,'2.1.304');assert.equal(prov.served,'p4-maws-tools.json');
 assert.ok(meta4(rows,'spend')[0].result.total_cost_usd<0.0001);
 const {words:WORDS,block:BLOCK,artifact:ARTIFACT}=meta4(rows,'sent')[0]; // what the scenario wrote, kept in its fixture
 const [first,second]=mainRequests4(rows);
 const user=first.messages.find(m=>m.role==='user');
 const texts=user.blocks.filter(b=>b.type==='text'&&b.text!==undefined).map(b=>b.text);
 assert.deepEqual(texts.slice(-2),[WORDS,BLOCK]); // after the engine's own context blocks, in the order MAWS wrote them, whole
 for(const name of ['mcp__maws__artifact_read','mcp__maws__artifact_edit'])assert.equal(first.tools.find(t=>t.name===name).defer_loading,null,name);
 assert.deepEqual(meta4(rows,'transcript_tools')[0].toolUses.map(u=>u.name),['mcp__maws__artifact_edit']); // no ToolSearch, no read first
 assert.deepEqual(meta4(rows,'server_calls')[0].calls.map(c=>[c.name,c.arguments.baseRevision]),[['artifact_edit',25]]);
 assert.ok(second.messages.some(m=>m.blocks.some(b=>b.type==='tool_result'&&b.tool_use_id==='toolu_stub_edit'&&!b.is_error)));
 const replay=rows.find(r=>r.direction==='in'&&r.frame.type==='user'&&r.frame.isReplay&&Array.isArray(r.frame.message.content)&&r.frame.message.content.some(b=>b.text===WORDS));
 assert.deepEqual(replay.frame.message.content.map(b=>b.text),[WORDS,BLOCK]);
 assert.deepEqual(meta4(rows,'transcript_user')[0].records,[{isMeta:null,content:[{type:'text',same:'words',chars:WORDS.length},{type:'text',same:'block',chars:BLOCK.length}]}]);
 assert.ok(BLOCK.includes(`(maws-artifact:${ARTIFACT})`));
});
test('p4 deferral (for P4-A3): under tool search the maws tools are deferred and named for ToolSearch, alwaysLoad loads one, a direct call still runs and the model reads its JSON text',()=>{
 const rows=load4('p4-b4-instructions');const [first,second]=mainRequests4(rows);
 const names=first.tools.map(t=>t.name);assert.ok(names.includes('ToolSearch'));
 assert.ok(names.includes('mcp__maws__show_pane')); // listed with _meta["anthropic/alwaysLoad"]: true
 // P4-R7: MAWS's own message tool carries the key as MAWS lists it; P4-A3: so do the tools an edit needs (re-recorded
 // with them): every one is loaded beside show_pane, in the request's tools with no defer_loading, and none is named
 // for ToolSearch; every other maws tool stays deferred
 const alwaysLoaded=t=>t.name==='show_pane'||t._meta?.['anthropic/alwaysLoad']===true;
 assert.deepEqual(served4.tools.filter(alwaysLoaded).map(t=>t.name),['show_pane','artifact_describe_type','artifact_read','artifact_publish','artifact_edit','message']);
 for(const tool of served4.tools.filter(alwaysLoaded)){const listed=first.tools.find(t=>t.name==='mcp__maws__'+tool.name);assert.ok(listed,tool.name);assert.equal(listed.defer_loading,null,tool.name);}
 for(const tool of served4.tools.filter(t=>!alwaysLoaded(t)))assert.ok(!names.includes('mcp__maws__'+tool.name),tool.name);
 const context=contextText4(first);const from=context.indexOf('The following deferred tools are now available via ToolSearch');
 const listing=context.slice(from,context.indexOf('\n\n',from)).split('\n').slice(1); // the list alone, one name per line
 assert.ok(listing.includes('mcp__maws__artifact_search'));
 for(const tool of served4.tools.filter(alwaysLoaded))assert.ok(!listing.includes('mcp__maws__'+tool.name),tool.name);
 const calls=meta4(rows,'server_calls')[0].calls;assert.deepEqual(calls,[{name:'artifact_search',arguments:{query:'로드맵'}}]);
 const result=second.messages.flatMap(m=>m.blocks).find(b=>b.type==='tool_result'&&b.tool_use_id==='toolu_stub_search');
 assert.equal(result.is_error,false);assert.equal(JSON.parse(result.content[0].text).status,'found');
 const all=mainRequests4(load4('p4-b4-no-tool-search'))[0].tools.map(t=>t.name);
 for(const tool of served4.tools)assert.ok(all.includes('mcp__maws__'+tool.name),tool.name);
});
test('p4 resume: a resumed session keeps the paragraph it was first given; the server\'s changed text is not announced',()=>{
 const q=mainRequests4(load4('p4-b4-resume'))[0];const context=contextText4(q);
 assert.ok(context.includes('## maws\n'+served4.instructions));
 assert.ok(!JSON.stringify(q).includes('RESUMED-PARAGRAPH-CHANGED'));
});
// P4-R7 (docs/doperpowers/plans/2026-10-19-p4-smoothing.md, Decision Log 46; scenarios/pass3/p4-r7-message-tool.mjs): what a
// message the model writes before a tool call becomes on MAWS's own wire, recorded on engine 2.1.304 and claude-opus-5-5
// through the relay with a recorder between them, and what MAWS's message tool is there. Read from the recorder's
// `api_exchanges` (each main request's fields and the blocks the API streamed back, in order), the engine's frames and
// the transcript's records (`disk`).
const R7=['p4-r7-loss-short','p4-r7-loss','p4-r7-tool','p4-r7-loss-mid','p4-r7-loss-notice','p4-r7-loss-dialog','p4-r7-loss-stages','p4-r7-tool-stages'];
const exchanges7=name=>meta4(load4(name),'api_exchanges')[0].exchanges;
const blocks7=name=>exchanges7(name).map(e=>e.response.blocks);
const isMessageCall=b=>b.type==='tool_use'&&b.name==='mcp__maws__message';
for(const name of R7)test('p4/'+name+' is ordered NDJSON with correlated replies, P4-R7 provenance on the pinned engine, the owner file unchanged and no secret',()=>{
 const text=readFileSync(new URL(name+'.jsonl',dir4),'utf8');assert.ok(!text.includes('sk-ant-'));
 const rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(pass3Open(rows).size,0);
 const prov=meta4(rows,'provenance')[0];assert.equal(prov.child,'P4-R7');assert.equal(prov.engineVersion,'2.1.304');assert.equal(prov.model,'claude-opus-5-5');assert.equal(prov.pin,'08a31f8df08ed97911398057380acd9d3cd7e687');
 const owner=meta4(rows,'owner_file_check');assert.equal(owner.length,2);assert.equal(owner[1].same,true);
 assert.ok(rows.some(r=>r.frame.event==='exit'&&r.frame.code===0));
 assert.equal(meta4(rows,'turn')[0].result.subtype,'success');
});
test('p4 R7: MAWS\'s launch asks the API for adaptive thinking with display "updates" under its beta, so a progress note arrives with the API\'s paraphrase',()=>{
 for(const name of R7)for(const {request} of exchanges7(name)){
  assert.deepEqual(request.thinking,{type:'adaptive',display:'updates'},name);
  assert.ok(request.beta.split(',').includes('thinking-display-updates-2026-08-18'),name);
  assert.deepEqual(request.output_config,{effort:'high'},name);
 }
});
test('p4 R7 the loss: under contract 5 a status written between stages, before the next call, comes back as a thinking block holding a paraphrase without its tags; the next call follows it in the same response',()=>{
 const responses=blocks7('p4-r7-loss-stages');
 const lost=responses.filter(bs=>bs.some(b=>b.type==='thinking'&&b.text.trim()!=='')&&bs.at(-1).type==='tool_use');
 assert.equal(lost.length,1);
 const [note,call]=lost[0];
 assert.equal(note.type,'thinking');assert.ok(note.signatureChars>0);
 assert.ok(!note.text.includes('<message>'));assert.match(note.text,/0412, 0977, and 1203/);assert.match(note.text,/manual labeling/); // a request to the human, lost
 assert.equal(call.type,'tool_use');assert.equal(call.name,'Bash');assert.equal(call.input.command,'sh stage.sh 3');
 // the other two statuses survived as spans, so the loss is per note, not per session
 assert.equal(responses.flat().filter(b=>b.type==='text'&&b.text.includes('<message>')).length,3);
 // what every reader sees: the transcript keeps the paraphrase in a thinking block and no text before the call
 const disk=meta4(load4('p4-r7-loss-stages'),'disk')[0].records.filter(r=>r.type==='assistant').flatMap(r=>r.blocks);
 assert.ok(disk.some(b=>b.type==='thinking'&&b.text===note.text));
});
test('p4 R7: a note asked for in the prompt stays a span, short or long, first or mid-turn; the model wrote no thinking-block note there',()=>{
 for(const name of ['p4-r7-loss-short','p4-r7-loss','p4-r7-loss-mid']){
  const responses=blocks7(name);
  const before=responses.find(bs=>bs.some(b=>b.type==='text'&&b.text.includes('<message>'))&&bs.at(-1).type==='tool_use');
  assert.ok(before,name);
  assert.ok(!responses.flat().some(b=>b.type==='thinking'&&b.text.trim()!==''),name);
 }
});
test('p4 R7 the tool: mcp__maws__message is loaded under tool search through its _meta, the only maws tool in the request\'s tools, and in default mode the engine asks a permission for it unless the launch allows it',()=>{
 for(const name of ['p4-r7-tool','p4-r7-tool-stages'])for(const {request} of exchanges7(name))assert.deepEqual(request.maws,[{name:'mcp__maws__message',defer_loading:null}],name);
 const asked=n=>meta4(load4(n),'permission_asked').map(p=>p.tool);
 assert.ok(asked('p4-r7-tool').includes('mcp__maws__message')); // no allow: asked
 assert.ok(!asked('p4-r7-tool-stages').includes('mcp__maws__message')); // --allowedTools mcp__maws__message, as MAWS launches
 assert.deepEqual(meta4(load4('p4-r7-tool-stages'),'provenance')[0].allowed,['mcp__maws__message']);
});
test('p4 R7 the tool: each status is a call in the same response as the next stage\'s call, its text whole in the frames, the tools/call (with its tool-use id) and on disk, answered `sent`; the final message stays a span',()=>{
 const responses=blocks7('p4-r7-tool-stages');
 const calls=responses.flatMap(bs=>bs.filter(isMessageCall).map(call=>({call,next:bs[bs.indexOf(call)+1]})));
 assert.equal(calls.length,3);
 for(const {next} of calls){assert.equal(next.type,'tool_use');assert.equal(next.name,'Bash');assert.match(next.input.command,/^sh stage\.sh [234]$/);}
 assert.match(calls[1].call.input.text,/0412, 0977 and 1203 could not be restored and need a person to label them/);
 assert.ok(!responses.flat().some(b=>b.type==='thinking'&&b.text.trim()!==''));
 const last=responses.at(-1);assert.equal(last.at(-1).type,'text');assert.match(last.at(-1).text,/^<message>/);
 const frames=meta4(load4('p4-r7-tool-stages'),'frames')[0];
 const framed=frames.assistant.flatMap(f=>f.blocks).filter(isMessageCall);
 assert.deepEqual(framed.map(b=>b.input),calls.map(c=>c.call.input));
 assert.deepEqual(frames.calls.map(c=>({name:c.name,arguments:c.arguments,toolUseId:c.toolUseId})),framed.map(b=>({name:'message',arguments:b.input,toolUseId:b.id})));
 for(const b of framed){
  const result=frames.toolResults.find(r=>r.tool_use_id===b.id);
  assert.deepEqual({is_error:result.is_error,content:result.content},{is_error:false,content:[{type:'text',text:'sent'}]});
 }
 const disk=meta4(load4('p4-r7-tool-stages'),'disk')[0].records;
 for(const b of framed){
  assert.ok(disk.some(r=>r.type==='assistant'&&r.blocks.some(x=>isMessageCall(x)&&x.id===b.id&&x.input.text===b.input.text)));
  assert.ok(disk.some(r=>r.type==='user'&&r.blocks.some(x=>x.type==='tool_result'&&x.tool_use_id===b.id&&x.is_error===false)));
 }
});
test('p4 R7 the eval: before, 4 of 11 mid-turn messages lost to progress notes, each asking the human to act; after, 11 of 11 through the tool and none lost; every final message a span; under US$1',()=>{
 const {summary,runs}=JSON.parse(readFileSync(new URL('p4-r7-eval.json',dir4),'utf8'));
 assert.deepEqual([summary.before.midSpan,summary.before.lost,summary.before.lostNeedingAction,summary.before.midTurnMessages],[7,4,4,11]);
 assert.deepEqual([summary.after.midTool,summary.after.midSpan,summary.after.lost,summary.after.midTurnMessages],[11,0,0,11]);
 assert.deepEqual([summary.before.finalSpan,summary.after.finalSpan,summary.before.notesUnjudged,summary.after.notesUnjudged],[5,5,0,0]);
 assert.equal(runs.length,10);assert.ok(summary.before.cost+summary.after.cost<1);
 for(const r of runs.filter(r=>r.arm==='before'))for(const n of r.notes)assert.equal(n.addressed_to_human,true);
});

// P4-R7y (docs/doperpowers/plans/2026-10-19-p4-smoothing.md, after Decision Logs 48 and 49; scenarios/pass3/
// p4-r7y-session-start.mjs): which mechanism gives the model a SessionStart context at every start of a session, on the
// pinned engine 2.1.304: a host callback registered through `initialize.hooks`, or the command hook MAWS puts in its
// `--settings` (src/shared/owner/contract.ts messageToolHookGroup). Read from each launch's `step` notes (every request
// the engine sent, with each place the context appears), its `starts` note (the `hook_callback` requests, the hook
// lifecycle frames) and, on the relay, what the model answered.
const ownerContract=await import('../../src/shared/owner/contract.ts');
const R7Y_STUB=['','-plain','-resume','-resume-again','-fork'].flatMap(s=>['callback','command'].map(m=>`p4-r7y-stub-${m}${s}`));
const R7Y_RELAY=['p4-r7y-relay-control','p4-r7y-relay-resume','p4-r7y-relay-startup'];
const steps7y=name=>meta4(load4(name),'step');
// per step, the context's copies in each main-loop request (a side request, the title's, is left out)
const copies7y=name=>steps7y(name).map(s=>s.requests.filter(q=>q.main!==false&&!q.prompts[0]?.head.startsWith('<session>')).map(q=>q.copies));
const starts7y=name=>meta4(load4(name),'starts')[0];
const ran7y=name=>starts7y(name).hookFrames.filter(h=>h.subtype==='hook_response').map(h=>`${h.hook_name}:${h.outcome}`);
for(const name of [...R7Y_STUB,...R7Y_RELAY])test('p4/'+name+' is ordered NDJSON with correlated replies, P4-R7y provenance on the pinned engine, the owner file unchanged and no secret',()=>{
 const text=readFileSync(new URL(name+'.jsonl',dir4),'utf8');assert.ok(!text.includes('sk-ant-'));if(secret&&secret.length>=8)assert.ok(!text.includes(secret));
 const rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(pass3Open(rows).size,0);
 const prov=meta4(rows,'provenance')[0];assert.equal(prov.child,'P4-R7y');assert.equal(prov.engineVersion,'2.1.304');assert.equal(prov.pin,'bd54d325b4c967eeafb98fb6426049bff1c55669');assert.equal(prov.text,ownerContract.MESSAGE_TOOL_ALIAS);
 const owner=meta4(rows,'owner_file_check');assert.equal(owner.length,2);assert.equal(owner[1].same,true);
 assert.ok(rows.some(r=>r.frame.event==='exit'&&r.frame.code===0));
 for(const s of meta4(rows,'step'))assert.equal(s.result.subtype,'success',s.prompt);
});
test('p4 R7y the host callback: called at a compaction and a clear, never at startup, a resume or a fork, the engine running those starts before it reads initialize',()=>{
 assert.deepEqual(starts7y('p4-r7y-stub-callback').callbacks.map(c=>[c.callback_id,c.source]),[['maws_SessionStart_1','compact'],['maws_SessionStart_1','clear']]);
 for(const s of ['-resume','-resume-again','-fork'])assert.deepEqual(starts7y('p4-r7y-stub-callback'+s).callbacks,[],s);
 assert.equal(meta4(load4('p4-r7y-stub-callback'),'initialize_answer')[0].hooks_applied,true); // registered, only too late for the first start
 // the first turn, the compaction, the turn after it, the clear (no request), the turn after it
 assert.deepEqual(copies7y('p4-r7y-stub-callback'),[[0],[0],[1],[],[1]]);
 for(const s of ['-resume','-resume-again','-fork'])assert.deepEqual(copies7y('p4-r7y-stub-callback'+s),[[0]],s);
});
test('p4 R7y the command hook MAWS puts in --settings: it runs at every start (startup, compact, clear, resume, fork) and the next request carries the context once, as a SessionStart system message',()=>{
 const group=ownerContract.messageToolHookGroup();
 for(const name of R7Y_STUB.filter(n=>n.includes('-command')&&!n.endsWith('-plain')))assert.deepEqual(meta4(load4(name),'provenance')[0].flagSettings.hooks,{SessionStart:[group]},name);
 assert.deepEqual(ran7y('p4-r7y-stub-command'),['SessionStart:startup:success','SessionStart:compact:success','SessionStart:clear:success']);
 assert.deepEqual(copies7y('p4-r7y-stub-command'),[[1],[1],[1],[],[1]]);
 assert.deepEqual([ran7y('p4-r7y-stub-command-resume'),ran7y('p4-r7y-stub-command-fork')],[['SessionStart:resume:success'],['SessionStart:fork:success']]);
 assert.deepEqual(copies7y('p4-r7y-stub-command-plain'),[[0]]); // the session the resumes and the fork read had none
 for(const s of ['-resume','-resume-again','-fork'])assert.deepEqual(copies7y('p4-r7y-stub-command'+s),[[1]],s); // a later start's copy is not added again
 const hit=steps7y('p4-r7y-stub-command-resume')[0].requests.find(q=>q.copies===1).hits[0];
 assert.equal(hit.role,'system');assert.ok(hit.text.startsWith(`SessionStart hook additional context: ${ownerContract.MESSAGE_TOOL_ALIAS}`));
 assert.ok(meta4(load4('p4-r7y-stub-command'),'disk')[0].context.every(c=>c.hookEvent==='SessionStart'&&c.content.includes(ownerContract.MESSAGE_TOOL_ALIAS)));
});
test('p4 R7y on a real model: without the hook it names no tool for mcp__to-human__message; with it, at a resume of that session and at a new session\'s startup, it names mcp__maws__message; under US$0.25',()=>{
 const answers=name=>steps7y(name)[0].requests.filter(q=>q.prompts.some(p=>p.head.startsWith('Without calling any tool'))).map(q=>[q.copies,q.answer.trim()]);
 assert.deepEqual(answers('p4-r7y-relay-control'),[[0,'none']]);
 assert.deepEqual(answers('p4-r7y-relay-resume'),[[1,'mcp__maws__message']]);
 assert.deepEqual(answers('p4-r7y-relay-startup'),[[1,'mcp__maws__message']]);
 assert.deepEqual([ran7y('p4-r7y-relay-control'),ran7y('p4-r7y-relay-resume'),ran7y('p4-r7y-relay-startup')],[[],['SessionStart:resume:success'],['SessionStart:startup:success']]);
 const spent=R7Y_RELAY.reduce((n,name)=>n+meta4(load4(name),'spend')[0].result.total_cost_usd,0);assert.ok(spent<0.25,String(spent));
});
// P4-R8 (docs/doperpowers/plans/2026-10-19-p4-smoothing.md, routed as P4-R8; scenarios/pass3/p4-r8-mcp-servers.mjs;
// findings-p4-r8-mcp-servers.txt): the app's MCP servers through --mcp-config on MAWS's own wire, engine 2.1.306, no
// prompt. owner: the owner's config home, curated from a raw recording that was not kept; scratch: a scratch home.
const NOTION8={type:'http',url:'https://mcp.notion.com/mcp'};
const answers8=(rows,subtype)=>{const ids=new Set(rows.filter(r=>r.direction==='out'&&r.frame.request?.subtype===subtype).map(r=>r.frame.request_id));return rows.filter(r=>r.direction==='in'&&r.frame.type==='control_response'&&ids.has(r.frame.response.request_id)).map(r=>r.frame.response);};
for(const name of ['p4-r8-owner','p4-r8-scratch'])test('p4/'+name+' is ordered NDJSON with correlated replies, P4-R8 provenance, no prompt and no secret',()=>{
 const text=readFileSync(new URL(name+'.jsonl',dir4),'utf8');assert.ok(!text.includes('sk-ant-'));assert.ok(!/"(access|refresh)_?[Tt]oken"\s*:\s*"[^"]/.test(text));
 const rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(pass3Open(rows).size,0);
 const prov=meta4(rows,'provenance')[0];assert.equal(prov.child,'P4-R8');assert.equal(prov.pin,'bd54d325b4c967eeafb98fb6426049bff1c55669');assert.equal(prov.mcpConfig.mcpServers.notion.url,NOTION8.url);
 const spawn=meta4(rows,'spawn')[0];assert.equal(spawn.args[spawn.args.indexOf('--mcp-config')+1],JSON.stringify(prov.mcpConfig));
 assert.ok(!rows.some(r=>r.direction==='out'&&r.frame.type==='user'));
 assert.ok(rows.some(r=>r.frame.event==='exit'&&r.frame.code===0));
});
test('p4 R8 owner: notion from --mcp-config reads dynamic and connects in the owner\'s config home on the binary MAWS runs, the login its user-scope entry made reused; the owner\'s files kept',()=>{
 const rows=load4('p4-r8-owner');
 const prov=meta4(rows,'provenance')[0];assert.equal(prov.arm,'owner');assert.deepEqual(prov.mcpConfig,{mcpServers:{notion:NOTION8}});assert.equal(prov.engineVersion,'2.1.306');
 assert.ok(!meta4(rows,'spawn')[0].args.includes('--strict-mcp-config'));
 const [last]=answers8(rows,'mcp_status').slice(-1);const notion=last.response.mcpServers.find(s=>s.name==='notion');
 assert.deepEqual([notion.status,notion.scope,notion.config.url,notion.config.headerKeys],['connected','dynamic',NOTION8.url,[]]);assert.ok(notion.tools.length>0);
 const lines=meta4(rows,'debug_lines')[0].lines;assert.ok(lines.some(l=>l.includes('MCP server "notion": Returning tokens')));assert.ok(lines.some(l=>l.includes('MCP server "notion": Successfully connected')));
 const [before,after]=meta4(rows,'owner_snapshot');assert.ok(!before.userServers.includes('notion'));
 assert.deepEqual([after.userServersSame,after.projectKeysSame,after.projectCountSame,after.transcript],[true,true,true,false]);
 assert.ok(!meta4(rows,'dialog_seen').length);
});
test('p4 R8 scratch: the --mcp-config entry wins over user, local and project scope of the same name, and only it is connected',()=>{
 const rows=load4('p4-r8-scratch');
 const [last]=answers8(rows,'mcp_status').slice(-1);const named=last.response.mcpServers.filter(s=>s.name==='notion');
 assert.equal(named.length,1);assert.deepEqual([named[0].scope,named[0].config.url],['dynamic',NOTION8.url]);
 const paths=meta4(rows,'local_hits')[0].hits.map(h=>h.path);for(const shadowed of ['/user/mcp','/local/mcp','/project/mcp'])assert.ok(!paths.includes(shadowed),shadowed);
});
test('p4 R8 scratch: a server that needs auth reads needs-auth with no tools, an mcp_call to it is not connected, and mcp_authenticate answers the URL to open and the engine\'s own localhost callback',()=>{
 const rows=load4('p4-r8-scratch');
 const [last]=answers8(rows,'mcp_status').slice(-1);const oauth=last.response.mcpServers.find(s=>s.name==='probe-oauth');
 assert.deepEqual(Object.keys(oauth).sort(),['config','name','scope','source','status']); // no tools and no error field
 assert.deepEqual([oauth.status,oauth.scope,oauth.source],['needs-auth','dynamic','dynamic']);
 assert.equal(answers8(rows,'mcp_call')[0].error,'MCP server not connected: probe-oauth');
 const [auth,unknown]=answers8(rows,'mcp_authenticate');
 assert.equal(auth.subtype,'success');assert.deepEqual(Object.keys(auth.response).sort(),['authUrl','callbackExpected','callbackPort','redirectScheme','requiresUserAction','state']);
 assert.deepEqual([auth.response.requiresUserAction,auth.response.callbackExpected,auth.response.redirectScheme],[true,true,'localhost']);
 const url=new URL(auth.response.authUrl);assert.equal(url.searchParams.get('redirect_uri'),`http://localhost:${auth.response.callbackPort}/callback`);assert.equal(url.searchParams.get('state'),auth.response.state);
 assert.ok(meta4(rows,'local_hits')[0].hits.some(h=>h.method==='POST'&&h.path==='/register')); // registered before it answered
 assert.equal(unknown.error,'Server not found: no-such-server');
});
// P4-A2P (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2 "The per-session launch profile", acceptance R-7;
// scenarios/pass3/p4-a2p-profile.mjs; findings-p4-a2p-profile.txt): the launch profile through the launch's own flags
// (src/shared/engine/launch-profile.ts profileSettings in `--settings`; under hooks none the alias appended), on the
// installed engine 2.1.306, in a scratch home seeded from read-only copies of the owner's model, effort and style, three
// of the owner's user-scope plugins and probe-owned user hooks. Stub arms against the scripted API (each launch's `step`
// notes: every request with the alias and the user hooks' markers placed), two relay arms, and the home's manifest.
const launchProfile=await import('../../src/shared/engine/launch-profile.ts');
const A2P_STUB=['plain','plugins','style','hooks-group','hooks','hooks-resume','hooks-fork','hooks-user-kept','hooks-user','full'].map(s=>'p4-a2p-stub-'+s);
const A2P_RELAY=['p4-a2p-relay-plain','p4-a2p-relay-full'];
const A2P_PLUGINS=['designer@designer','doperpowers@doperpowers','eli5@claude-community'];
const one2p=(name,event)=>meta4(load4(name),event)[0];
const main2p=name=>meta4(load4(name),'step').map(s=>s.requests.filter(q=>q.main)); // per step, the main loop's requests
const flat2p=name=>main2p(name).flat();
const responses2p=name=>one2p(name,'hooks').frames.filter(h=>h.subtype==='hook_response').map(h=>h.hook_name);
const noneOf2p=name=>one2p(name,'provenance').profile.hooks==='none';
// MAWS's `--settings` and `--append-system-prompt` for a lane-on launch under a profile, from MAWS's own modules
const flagFor2p=prov=>({dialogExpiry:'never',...launchProfile.profileSettings(prov.profile),env:{[ownerContract.NATIVE_TO_HUMAN_ENV]:String(ownerContract.TO_HUMAN_CONTRACT_VERSION)},...(prov.group?{hooks:{SessionStart:[ownerContract.messageToolHookGroup()]}}:{})});
const appendFor2p=prov=>(prov.profile.outputStyle==='maws'?ownerContract.TO_HUMAN_CONTRACT:ownerContract.TO_HUMAN_SUPPLEMENT)+(prov.profile.hooks==='none'&&prov.group===false?`\n\n${ownerContract.MESSAGE_TOOL_ALIAS}`:'');
const argAfter2p=(args,flag)=>{const i=args.indexOf(flag);return i<0?null:args[i+1];};
for(const name of [...A2P_STUB,...A2P_RELAY])test('p4/'+name+' is ordered NDJSON with correlated replies, P4-A2P provenance on the installed engine, MAWS\'s launch under its profile, the owner file unchanged and no secret',()=>{
 const text=readFileSync(new URL(name+'.jsonl',dir4),'utf8');assert.ok(!text.includes('sk-ant-'));if(secret&&secret.length>=8)assert.ok(!text.includes(secret));
 const rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(pass3Open(rows).size,0);
 const prov=meta4(rows,'provenance')[0];assert.equal(prov.child,'P4-A2P');assert.equal(prov.pin,'246354256c404b41189c6cbeb67a7c1157a9f0e6');assert.equal(prov.engineVersion,'2.1.306');
 assert.deepEqual(launchProfile.LaunchProfileSchema.parse(prov.profile),prov.profile);assert.deepEqual(prov.profileSettings,launchProfile.profileSettings(prov.profile));
 assert.deepEqual(prov.flagSettings,flagFor2p(prov));assert.equal(prov.append,appendFor2p(prov));
 const args=meta4(rows,'spawn')[0].args;
 assert.ok(!args.includes('--model')); // the model and the effort come from the user scope
 assert.equal(argAfter2p(args,'--setting-sources'),'user,project,local');
 assert.equal(argAfter2p(args,'--settings'),JSON.stringify(prov.flagSettings));assert.equal(argAfter2p(args,'--append-system-prompt'),prov.append);
 assert.equal(argAfter2p(args,'--system-prompt-snapshot'),prov.snapshotOff?'off':null);
 assert.equal(argAfter2p(args,'--resume'),prov.resume);assert.equal(args.includes('--fork-session'),prov.fork);
 const owner=meta4(rows,'owner_file_check');assert.equal(owner.length,2);assert.equal(owner[1].same,true);
 assert.ok(rows.some(r=>r.frame.event==='exit'&&r.frame.code===0));
 for(const s of meta4(rows,'step'))assert.equal(s.result.subtype,'success',s.prompt);
});
test('p4 A2P R-7 (1): under every profile the model and the effort are the user scope\'s; init lists the user\'s plugins less the off ids and the chosen style',()=>{
 const plain=one2p('p4-a2p-stub-plain','settings');
 assert.deepEqual([plain.effective.model,plain.applied.model],['opus','claude-opus-5-5']);
 // the user's effort for the model, per model (a top-level effortLevel applies to legacy models only)
 assert.deepEqual([plain.effective.effortLevel,plain.effective.modelSettings[plain.applied.model].effortLevel,plain.applied.effort],['high','xhigh','xhigh']);
 const builtins=one2p('p4-a2p-stub-plain','inits').inits[0].plugins.filter(p=>p.source.endsWith('@builtin')).map(p=>p.source);
 const init=load4('p4-a2p-stub-plain').find(r=>r.direction==='in'&&r.frame.type==='system'&&r.frame.subtype==='init').frame;assert.ok(!('effort' in init));
 for(const name of [...A2P_STUB,...A2P_RELAY]){
  const {profile}=one2p(name,'provenance');const s=one2p(name,'settings');const inits=one2p(name,'inits').inits;const off=profile.plugins.off;
  const style=profile.outputStyle==='maws'?'default':'doperpowers:to-human';
  assert.deepEqual([s.applied.model,s.applied.effort,s.effective.outputStyle,s.effective.disableAllHooks],[plain.applied.model,plain.applied.effort,style,profile.hooks==='none'?true:null],name);
  for(const id of A2P_PLUGINS)assert.equal(s.effective.enabledPlugins[id],!off.includes(id),name);
  for(const i of inits){
   assert.deepEqual([i.model,i.output_style],[plain.applied.model,style],name);
   assert.deepEqual(i.plugins.map(p=>p.source).filter(x=>!x.endsWith('@builtin')).sort(),A2P_PLUGINS.filter(id=>!off.includes(id)),name);
   assert.deepEqual(i.plugins.filter(p=>p.source.endsWith('@builtin')).map(p=>p.source),builtins,name);
  }
  // what the model was sent: the user's effort; the owner's style (the engine's output-style message) only under it; an off plugin's skills never
  for(const q of flat2p(name)){
   assert.equal(q.effort,plain.applied.effort,name);assert.equal(q.style.body>0,style!=='default',name);
   assert.deepEqual([q.skills.doperpowers>0,q.skills.eli5>0,q.skills.designer>0],[true,!off.includes('eli5@claude-community'),!off.includes('designer@designer')],name);
  }
 }
});
test('p4 A2P R-7 (2): the user\'s hooks and the plugins\' run under the user scope; under hooks none none runs, MAWS\'s group left in the flag JSON included, and no new hook context reaches the model',()=>{
 for(const name of ['p4-a2p-stub-plain','p4-a2p-stub-plugins','p4-a2p-stub-style','p4-a2p-relay-plain']){
  // the user's printf, MAWS's group and doperpowers' kairos.sh at startup; the user's UserPromptSubmit; doperpowers' MessageDisplay
  const ran=responses2p(name);assert.equal(ran.filter(h=>h==='SessionStart:startup').length,3,name);assert.ok(ran.includes('UserPromptSubmit')&&ran.includes('MessageDisplay'),name);
  const [q]=main2p(name)[0];assert.deepEqual([q.hits.userSessionStart.messages.length,q.hits.userPromptSubmit.messages.length,q.hits.alias.messages.length,q.hits.alias.system],[1,1,1,0],name);
 }
 assert.ok(one2p('p4-a2p-stub-plain','debug_lines').lines.some(l=>l.includes('hooks module doperpowers@doperpowers loaded')));
 for(const name of [...A2P_STUB,...A2P_RELAY].filter(noneOf2p)){
  assert.deepEqual(one2p(name,'hooks').frames,[],name);
  assert.ok(one2p(name,'debug_lines').lines.some(l=>l.includes('hooks module doperpowers@doperpowers not loaded')),name);
  for(const q of flat2p(name))assert.equal(q.hits.userSessionStart.system+q.hits.userPromptSubmit.system,0,name);
 }
 // a session begun under hooks none: no marker anywhere; a resume of the user-scope session: its own history's copies, none added
 for(const name of ['p4-a2p-stub-hooks-group','p4-a2p-stub-hooks','p4-a2p-stub-hooks-resume','p4-a2p-stub-hooks-fork','p4-a2p-stub-full','p4-a2p-relay-full'])for(const q of flat2p(name))assert.deepEqual([q.hits.userSessionStart.messages.length,q.hits.userPromptSubmit.messages.length],[0,0],name);
 for(const name of ['p4-a2p-stub-hooks-user-kept','p4-a2p-stub-hooks-user'])for(const q of flat2p(name))assert.deepEqual([q.hits.userSessionStart.messages.length,q.hits.userPromptSubmit.messages.length,q.hits.alias.messages.length],[1,1,1],name);
 // MAWS's group still in the flag JSON beside disableAllHooks: it does not run, and the alias reaches the model nowhere
 const g=one2p('p4-a2p-stub-hooks-group','provenance');assert.deepEqual([g.flagSettings.disableAllHooks,g.flagSettings.hooks],[true,{SessionStart:[ownerContract.messageToolHookGroup()]}]);
 for(const q of flat2p('p4-a2p-stub-hooks-group'))assert.deepEqual([q.hits.alias.system,q.hits.alias.messages.length,q.appendWhole],[0,0,true]);
});
test('p4 A2P R-7 (2) the route: under hooks none the alias appended after the supplement or the contract is in the system prompt at startup, after /compact and /clear, at a --resume and a --fork-session with snapshot off, and at a snapshot-off resume of a user-scope session',()=>{
 const sys=name=>main2p(name).map(qs=>qs.map(q=>q.hits.alias.system));
 assert.deepEqual(sys('p4-a2p-stub-hooks'),[[1],[1],[1],[],[1]]); // the first turn, the compaction's own request, the turn after it, the clear (no request), the turn after it
 for(const name of ['p4-a2p-stub-hooks-resume','p4-a2p-stub-hooks-fork','p4-a2p-stub-hooks-user','p4-a2p-stub-full','p4-a2p-relay-full'])assert.deepEqual(sys(name),[[1]],name);
 for(const name of ['p4-a2p-stub-hooks','p4-a2p-stub-hooks-resume','p4-a2p-stub-hooks-fork','p4-a2p-stub-hooks-user','p4-a2p-stub-full','p4-a2p-relay-full'])for(const q of flat2p(name))assert.deepEqual([q.appendWhole,q.appended],[true,one2p(name,'provenance').profile.outputStyle==='maws'?'contract:7':'supplement:2'],name);
 // in a session begun under hooks none the system prompt is the one place it is
 for(const name of ['p4-a2p-stub-hooks','p4-a2p-stub-hooks-resume','p4-a2p-stub-hooks-fork','p4-a2p-stub-full','p4-a2p-relay-full'])for(const q of flat2p(name))assert.equal(q.hits.alias.messages.length,0,name);
 // the compaction left a boundary; the clear began the session the resume and the fork read
 const ids=[...new Set(meta4(load4('p4-a2p-stub-hooks'),'step').map(s=>s.session_id))];assert.equal(ids.length,2);
 for(const name of ['p4-a2p-stub-hooks-resume','p4-a2p-stub-hooks-fork'])assert.equal(one2p(name,'provenance').resume,ids[1],name);
 const disk=one2p('p4-a2p-stub-hooks','disk').sessions;assert.equal(disk.find(s=>s.sessionId===ids[0]).boundaries,1);assert.ok(disk.every(s=>s.snapshots.length>0&&s.snapshots.every(x=>x.alias===1)));
});
test('p4 A2P R-7 (2): without snapshot off a resume reuses the recorded system prompt, dropping the new append; a launch with snapshot off records no snapshot of its own',()=>{
 const [plain]=main2p('p4-a2p-stub-plain')[0];const [kept]=main2p('p4-a2p-stub-hooks-user-kept')[0];const [live]=main2p('p4-a2p-stub-hooks-user')[0];
 assert.deepEqual([kept.hits.alias.system,kept.appendWhole,kept.appended,kept.systemChars],[0,false,'supplement:2',plain.systemChars]);
 assert.deepEqual([live.hits.alias.system,live.appendWhole,live.systemChars-plain.systemChars],[1,true,`\n\n${ownerContract.MESSAGE_TOOL_ALIAS}`.length]);
 const id=one2p('p4-a2p-stub-plain','inits').inits[0].session_id;
 for(const name of ['p4-a2p-stub-hooks-user-kept','p4-a2p-stub-hooks-user'])assert.equal(one2p(name,'provenance').resume,id,name);
 // after both resumes the user-scope session's transcript holds its first launch's snapshots only, neither with the alias
 const t=one2p('p4-a2p-home','transcripts').sessions.find(s=>s.sessionId===id);
 assert.deepEqual(t.snapshots,one2p('p4-a2p-stub-plain','disk').sessions[0].snapshots.map(({alias,appended})=>({alias,appended})));assert.ok(t.snapshots.every(s=>s.alias===0));
});
test('p4 A2P on a real model: asked which tool stands for mcp__to-human__message, the user scope (the alias from MAWS\'s group) and the full profile (the alias only in the appended prompt) both name mcp__maws__message; under US$1',()=>{
 const answers=name=>main2p(name)[0].map(q=>[q.status,q.answer.replace(/<\/?message>/g,'').trim()]);
 assert.deepEqual(answers('p4-a2p-relay-plain'),[[200,'mcp__maws__message']]);assert.deepEqual(answers('p4-a2p-relay-full'),[[200,'mcp__maws__message']]);
 const [p]=main2p('p4-a2p-relay-plain')[0];const [f]=main2p('p4-a2p-relay-full')[0];
 assert.deepEqual([p.hits.alias.system,p.hits.alias.messages.length,f.hits.alias.system,f.hits.alias.messages.length],[0,1,1,0]);
 const spent=A2P_RELAY.reduce((n,name)=>n+one2p(name,'spend').result.total_cost_usd,0);assert.ok(spent<1,String(spent));
});
test('p4 A2P R-7 (3): the scratch home\'s seeded files are read-only and byte-identical after the last launch, and every other change is a write the engine makes for a session',()=>{
 const rows=load4('p4-a2p-home');
 const prov=meta4(rows,'provenance')[0];assert.deepEqual([prov.child,prov.pin,prov.engineVersion,prov.arms],['P4-A2P','246354256c404b41189c6cbeb67a7c1157a9f0e6','2.1.306',['stub','relay']]);
 const seeded=meta4(rows,'seeded')[0];
 // the owner's model, effort and style; the copied plugins; the probe's own hooks (nothing of the owner's hooks, env or permissions)
 assert.deepEqual(Object.keys(seeded.settings).sort(),['effortLevel','enabledPlugins','hooks','model','modelSettings','outputStyle']);
 assert.deepEqual(Object.keys(seeded.settings.hooks).sort(),['SessionStart','UserPromptSubmit']);
 for(const [event,groups] of Object.entries(seeded.settings.hooks))assert.deepEqual(groups,[{hooks:[{type:'command',command:'/usr/bin/printf',args:['%s',JSON.stringify({hookSpecificOutput:{hookEventName:event,additionalContext:`PROBE_USER_HOOK_${event}`}})]}]}],event);
 assert.deepEqual([Object.keys(seeded.settings.enabledPlugins).sort(),Object.keys(seeded.registry.plugins).sort()],[A2P_PLUGINS,A2P_PLUGINS]);
 assert.ok(Object.values(seeded.markets).every(m=>!('autoUpdate' in m))); // nothing to fetch
 assert.ok(seeded.readOnly);assert.ok(seeded.files>1000);
 const [before,after]=meta4(rows,'manifest');assert.deepEqual([after.seededDigest,after.seededSame,after.seededChanged],[before.seededDigest,true,[]]);
 const {changes,other}=meta4(rows,'changes')[0];assert.deepEqual(other,[]);
 assert.deepEqual([...new Set(changes.map(c=>c.class))].sort(),['auto memory directory','file checkpoints','global config','global config backup','plugin data','plugin in-use marker','plugin in-use sweep stamp','session environment','session registry','transcript']);
 assert.deepEqual(changes.filter(c=>c.kind!=='added').map(c=>c.path),['.claude.json']); // nothing removed; the one changed file the engine's own state
 assert.deepEqual(changes.filter(c=>c.path.startsWith('plugins/cache/')).map(c=>c.path.split('/').at(-1)),['.in_use','.in_use','.in_use']);
});

// P4-AGG M4's sign-in spike on the Mac mini (spikes/p4-aggregator/m4-signin-spike.mjs, findings-m4.txt; gate run
// 40175924834): the control exchanges of the engine's own MCP sign-in against the engine-mode OAuth fixture. Every
// request answered (or timed out, recorded), no OAuth value retained, and the answers the verdict rests on.
test('p4/p4-agg-m4-signin: the engine\'s own sign-in over the control protocol, every request answered, no OAuth value', () => {
 const text = readFileSync(new URL('p4-agg-m4-signin.jsonl', dir4), 'utf8');
 assert.ok(!/(?:[?&](?:code|state|code_challenge|client_id)=)(?!%5Bredacted%5D)[^&"]/.test(text), 'an OAuth query value');
 assert.ok(!/access_token|refresh_token/.test(text));
 // X8 rows (the replay index lists the file as a journal); each question's engine opens with its own `spawn` meta row,
 // and its frames follow it until the next one
 let engine = null;
 const rows = text.trim().split('\n').map(JSON.parse).map((r) => {
  assert.deepEqual(Object.keys(r).sort(), ['at', 'direction', 'frame', 'seq']);
  if (r.direction === 'meta' && r.frame.event === 'spawn') engine = r.frame.engine;
  return { ...r, engine };
 });
 const out = rows.filter((r) => r.direction === 'out').map((r) => r.frame);
 const answers = new Map(rows.filter((r) => r.direction === 'in').map((r) => [r.frame.response.request_id, r.frame.response]));
 for (const f of out) assert.ok(answers.has(f.request_id), f.request.subtype);
 const answered = (engine, subtype) => rows.filter((r) => r.engine === engine && r.direction === 'out' && r.frame.request.subtype === subtype).map((r) => answers.get(r.frame.request_id));
 // custom: MAWS's 127.0.0.1 redirect accepted, the callback URL taken, and mcp_reconnect then reads connected
 assert.equal(answered('custom', 'mcp_authenticate')[0].response.redirectScheme, 'custom');
 assert.equal(answered('custom', 'mcp_oauth_callback_url')[0].subtype, 'success');
 assert.equal(answered('custom', 'mcp_reconnect')[0].subtype, 'success');
 assert.equal(answered('custom', 'mcp_status').at(-1).response.mcpServers.find((s) => s.name === 'fx-custom').status, 'connected');
 // localhost: the engine's own listener completes the flow and the status moves without a reconnect
 const local = answered('localhost', 'mcp_authenticate')[0].response;
 assert.equal(local.redirectScheme, 'localhost');
 assert.ok(Number.isInteger(local.callbackPort));
 assert.equal(answered('localhost', 'mcp_status').at(-1).response.mcpServers.find((s) => s.name === 'fx-localhost').status, 'connected');
 // pending: a second authenticate starts a new flow; the first flow's callback is then refused
 assert.equal(answered('pending', 'mcp_authenticate')[1].subtype, 'success');
 const firstCallback = answered('pending', 'mcp_oauth_callback_url')[0];
 assert.match(firstCallback.error, /OAuth state mismatch/);
 // cancel: a retry completes; the abandoned flow's callback after it answers no active flow
 assert.match(answered('cancel', 'mcp_oauth_callback_url').at(-1).error, /^No active OAuth flow for server: fx-cancel$/);
 // late: a server added to the file configuration after the start is not in mcp_status, yet mcp_authenticate starts
 assert.equal(answered('late', 'mcp_authenticate')[0].subtype, 'success');
 // pathA: mcp_set_servers removes the session's SDK server, whatever it names
 assert.deepEqual(answered('pathA', 'mcp_set_servers')[0].response.removed, ['spike-sdk']);
 // next: every server signed in above reads connected in a fresh file-configured session
 const next = answered('next', 'mcp_status').at(-1).response.mcpServers;
 for (const name of ['fx-custom', 'fx-localhost', 'fx-pending', 'fx-cancel', 'fx-dynamic']) assert.equal(next.find((s) => s.name === name).status, 'connected', name);
});
