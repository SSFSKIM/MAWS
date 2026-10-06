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
for(const file of readdirSync(dir3).filter(f=>f.endsWith('.jsonl')))test('pass3/'+file+' is ordered NDJSON with correlated replies, provenance and no secrets',()=>{
 const text=readFileSync(new URL(file,dir3),'utf8');assert.ok(!text.includes('sk-ant-'));if(secret&&secret.length>=8)assert.ok(!text.includes(secret));
 // the probe numbers rows from 1, C3's live relay captures from 0 (their provenance row); either base, then no gap
 // and the engine echoes a host's can_use_tool answer back on its stdout (C3's plan-outcomes): an `in` response that
 // repeats, byte for byte, the `out` response which already closed its request is an echo, not an orphan
 const rows=text.trim().split('\n').map(JSON.parse);assert.ok([0,1].includes(rows[0].seq));let seq=rows[0].seq-1;const pending=new Set();const answered=new Map();
 for(const row of rows){assert.equal(row.seq,++seq);assert.ok(['in','out','meta','stderr'].includes(row.direction));const f=row.frame;
  if(f.type==='control_request')pending.add(row.direction+':'+f.request_id);
  if(f.type==='control_response'){const key=(row.direction==='in'?'out':'in')+':'+f.response.request_id;
   if(pending.delete(key))answered.set(row.direction+':'+f.response.request_id,JSON.stringify(f));
   else assert.equal(answered.get((row.direction==='in'?'out':'in')+':'+f.response.request_id),JSON.stringify(f),'response has pending request '+key);}
  assert.notEqual(f.event,'parse_error');assert.notEqual(f.event,'scenario_error');}
 // any child of docs/charter.md may record a pass-3 fixture (C2, C3, C10, C8a, …); a P1 child (E0a, E8, …) names the P1
 // composite spec too, as `spec` or as `document` (docs/doperpowers/plans/2026-10-05-p1-extension.md, whose blob is the pin)
 const prov=rows.find(r=>r.frame.event==='provenance')?.frame;assert.equal(prov.charter,'docs/charter.md');assert.match(prov.child,/^(C\d+[a-z]?|E\d+[a-z]?)$/);assert.match(prov.pin,/^[0-9a-f]{40}$/);if(/^E/.test(prov.child))assert.match(prov.spec??prov.document,/^docs\/doperpowers\/plans\/.*\.md$/);
 assert.equal(rows.find(r=>r.frame.event==='exit')?.frame.code,0);assert.equal(pending.size,0);
});
// C8c end
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
