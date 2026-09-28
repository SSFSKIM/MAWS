import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { ClaimSessionResponseSchema, GetStatusResponseSchema, InitializeResponseSchema, RewindConversationResponseSchema, RewindFilesResponseSchema } from '@shared/wire/control';
import { FIXTURE_PASSES, listJournals, loadJournal, type FixturePass } from '../../../test/support/fixtures';
import { RELAY_URL } from '../launch';
import { replayFixture, type ConformanceRun } from './harness';

// A `system` subtype or frame type the fixtures may carry without an X1 mapping. Empty: every fixture frame maps to
// an event or to a "none" row of the table, and a new subtype in a future recording fails here, never silently.
const UNKNOWN_ALLOWLIST: ReadonlySet<string> = new Set();

// Outbound requests the probe issued that the engine refused, or that the recording ended before answering.
const EXPECTED_REQUEST_FAILURES: Record<string, { subtype: string; code: string }[]> = {
  'pass2/auto-haiku': [{ subtype: 'set_permission_mode', code: 'auto_mode_model' }],
  'pass2/auto-routed': [{ subtype: 'set_permission_mode', code: 'auto_mode_model' }],
  'pass2/auto-unrouted': [{ subtype: 'set_permission_mode', code: 'auto_mode_model' }],
  'pass2/resume-live-bg': [{ subtype: 'initialize', code: 'exited' }], // the engine refused the resume on stderr and exited 1 before answering
};

const runs = new Map<string, Promise<ConformanceRun>>();
function run(pass: FixturePass, name: string): Promise<ConformanceRun> {
  const key = `${pass}/${name}`;
  let pending = runs.get(key);
  if (!pending) {
    pending = replayFixture(loadJournal(pass, name), { label: key });
    runs.set(key, pending);
  }
  return pending;
}

const ofKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);
const kinds = (events: SessionEvent[]) => events.map((e) => e.kind);
const idSuffix = (event: SessionEvent) => event.id.split(':').slice(-2).join(':');
const seq = (event: SessionEvent | undefined): number => event?.seq ?? -1; // every live event has a row; -1 only if a pin's lookup missed

describe('normaliser replays every probe fixture into the X1 graph', () => {
  it('sees both recorded passes and an empty pass 3', () => {
    expect(listJournals('pass1')).toHaveLength(10);
    expect(listJournals('pass2')).toHaveLength(30);
    expect(listJournals('pass3')).toEqual([]);
  });

  for (const pass of FIXTURE_PASSES) {
    for (const name of listJournals(pass)) {
      it(`${pass}/${name}`, async () => {
        const label = `${pass}/${name}`;
        const result = await run(pass, name);
        const failures: string[] = [];
        for (const event of result.events) {
          const parsed = SessionEventSchema.safeParse(event);
          if (!parsed.success) failures.push(`${label} seq ${event.seq} ${event.kind}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')}`);
        }
        expect(failures).toEqual([]);
        // every event derives from a row: seq is the row, ids are deterministic and unique
        expect(new Set(result.events.map((e) => e.id)).size).toBe(result.events.length);
        for (const event of result.events) expect(event.id).toBe(`conformance:REPLAY01:${event.seq}:${event.id.split(':').at(-1)}`);
        expect(result.events.filter((e) => e.sessionId === 'unknown').map((e) => `${label} seq ${e.seq} ${e.kind} has no session id`)).toEqual([]);
        // no frame the probe recorded is unknown to the mapping table
        const unknown = ofKind(result.events, 'frame.unknown').filter((e) => !UNKNOWN_ALLOWLIST.has(e.subtype ? `${e.frameType}/${e.subtype}` : e.frameType));
        expect(unknown.map((e) => `${label} seq ${e.seq}: ${e.frameType}/${e.subtype}`)).toEqual([]);
        expect(ofKind(result.events, 'error.raised').filter((e) => e.code === 'invalid_frame').map((e) => `${label}: ${e.message}`)).toEqual([]);
        // the replay advanced only on frames the probe saw
        expect(result.problems.map((p) => `${label}: ${p.message}`)).toEqual([]);
        expect(result.writeErrors.map((e) => `${label}: ${e}`)).toEqual([]);
        expect(result.warnings.filter((w) => w.event === 'block_pairing').map((w) => `${label} seq ${w.seq}: ${JSON.stringify(w.detail)}`)).toEqual([]);
        expect(result.clientWarnings.map((w) => `${label}: ${w}`)).toEqual([]);
        // every outbound control the probe issued parsed with its typed schema, except the refusals the probe recorded
        const expectedFailures = EXPECTED_REQUEST_FAILURES[label] ?? [];
        const failed = result.requests.filter((r) => !r.ok).map((r) => ({ subtype: r.subtype, code: r.code ?? 'unknown' }));
        expect(failed).toEqual(expectedFailures);
        expect(result.requests.length).toBe(loadJournal(pass, name).filter((r) => r.direction === 'out' && (r.frame as { type: string }).type === 'control_request').length);
        // the journal replays to the same graph through a fresh normaliser (every event derives from a row)
        const rebuilt = await import('../normalizer').then(({ Normalizer }) => {
          const n = new Normalizer({ appSessionId: 'conformance' as never, launchId: 'REPLAY01', sessionId: result.events[0]?.sessionId ?? null });
          return result.rows.flatMap((row) => n.push(row));
        });
        expect(rebuilt).toEqual(result.events);
      });
    }
  }
});

describe('normaliser: per-fixture graph facts (C2 findings restated)', () => {
  it('pass1/init yields one session.init, one human turn, thinking and text deltas, two completes and one turn.ended', async () => {
    const { events } = await run('pass1', 'init');
    expect(ofKind(events, 'session.init')).toHaveLength(1);
    expect(ofKind(events, 'turn.started').map((e) => e.origin)).toEqual(['human']);
    const deltas = ofKind(events, 'assistant.block.delta');
    expect(deltas.some((d) => d.thinkingDelta !== null)).toBe(true);
    expect(deltas.some((d) => d.textDelta === 'OK')).toBe(true);
    expect(ofKind(events, 'assistant.block.complete')).toHaveLength(2);
    expect(ofKind(events, 'turn.ended')).toMatchObject([{ origin: 'human', isEchoReceipt: false, resultText: 'OK', terminalReason: 'completed' }]);
    expect(ofKind(events, 'process.exited')).toMatchObject([{ code: 0, reason: 'unknown' }]);
  });

  it('pass1/permission-roundtrip: the prompt bubble derives from the out rows 4, 94, 192 before each system/init', async () => {
    const { events } = await run('pass1', 'permission-roundtrip');
    const starts = ofKind(events, 'turn.started');
    expect(starts.map((e) => [e.seq, e.origin, idSuffix(e)])).toEqual([[4, 'human', '4:0'], [94, 'human', '94:0'], [192, 'human', '192:0']]);
    const humans = ofKind(events, 'user.message').filter((e) => e.origin === 'human');
    expect(humans.map((e) => [e.seq, e.isReplay, idSuffix(e)])).toEqual([[4, false, '4:1'], [94, false, '94:1'], [192, false, '192:1']]);
    expect(starts.map((e) => e.userMessageUuid)).toEqual(humans.map((e) => e.messageUuid));
    const inits = ofKind(events, 'session.init').map((e) => e.seq);
    expect(inits).toEqual([7, 98, 196]);
    // nothing echoes the prompts: no user.message from an in row carries those uuids
    const inRowsWithUuid = ofKind(events, 'user.message').filter((e) => humans.some((h) => h.messageUuid === e.messageUuid && h !== e));
    expect(inRowsWithUuid).toEqual([]);
    const requested = ofKind(events, 'permission.requested');
    expect(requested.map((e) => e.decisionReasonType)).toEqual(['rule', 'rule', 'rule']);
    expect(ofKind(events, 'permission.resolved').map((e) => e.behavior)).toEqual(['allow', 'deny', 'allow']);
    const denied = requested[1]!.toolUseId;
    expect(ofKind(events, 'tool.result').find((e) => e.toolUseId === denied)).toMatchObject({ denial: 'permission-rule', isError: true });
    expect(ofKind(events, 'turn.ended').map((e) => e.userMessageUuids.length)).toEqual([1, 1, 1]);
  });

  it('pass1/question-roundtrip yields two questions and an answer with two keys', async () => {
    const { events } = await run('pass1', 'question-roundtrip');
    const [q] = ofKind(events, 'question.requested');
    expect(q?.questions).toHaveLength(2);
    expect(q?.questions[0]).toMatchObject({ question: 'Which color do you prefer?', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: 'A warm, bold color', preview: 'This is a red preview 🔴' }, { label: 'Blue' }] });
    expect(q?.questions[1]).toMatchObject({ multiSelect: true, options: [{ label: 'Apple', preview: null }, { label: 'Pear' }] });
    const [a] = ofKind(events, 'question.answered');
    expect(a?.answers).toEqual({ 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' });
    expect(a?.toolUseId).toBe(q?.toolUseId);
  });

  it('pass1/queue-and-interrupt: four user-rejected results inside an aborted turn, then RESUMED, then the bash tags', async () => {
    const { events } = await run('pass1', 'queue-and-interrupt');
    const ends = ofKind(events, 'turn.ended');
    expect(ends.map((e) => e.terminalReason)).toEqual(['aborted_streaming', 'completed']);
    const abortedAt = seq(ends[0]);
    const rejected = ofKind(events, 'tool.result').filter((e) => e.denial === 'user-rejected' && seq(e) < abortedAt);
    expect(rejected).toHaveLength(4);
    expect(ends[1]!.resultText).toContain('RESUMED');
    const bash = ofKind(events, 'user.message').filter((e) => e.bash !== null);
    expect(bash.map((e) => e.bash)).toEqual([{ part: 'input', command: 'printf BASH_MODE_OK' }, { part: 'output', stdout: 'BASH_MODE_OK', stderr: '', exitCode: 0 }]);
    expect(bash.every((e) => seq(e) > seq(ends[1]))).toBe(true);
    expect(ofKind(events, 'command.lifecycle').some((e) => e.state === 'cancelled')).toBe(true);
  });

  it('pass1/subagent: two subagents, child events attributed to the launch result agentId, two task-notification turns', async () => {
    const { events } = await run('pass1', 'subagent');
    const started = ofKind(events, 'subagent.started');
    expect(started).toHaveLength(2);
    expect(started.map((e) => e.taskId)).toEqual(['ad286defbc77bc090', 'ae75ba6ce5d866acc']);
    const children = events.filter((e) => e.parentToolUseId !== null);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) expect(started.map((s) => s.taskId as string)).toContain(child.agentId);
    expect(ofKind(events, 'assistant.block.delta').every((d) => d.parentToolUseId === null)).toBe(true);
    const childCompletes = ofKind(events, 'assistant.block.complete').filter((e) => e.parentToolUseId !== null);
    expect(childCompletes.length).toBeGreaterThan(0);
    expect(ofKind(events, 'subagent.finished')).toHaveLength(2);
    expect(ofKind(events, 'turn.ended').map((e) => e.origin)).toEqual(['human', 'task-notification', 'task-notification']);
    expect(ofKind(events, 'turn.started').map((e) => [e.seq, e.origin])).toEqual([[4, 'human'], [355, 'engine'], [425, 'engine']]);
    // block-index rule for both kinds at once
    const starts = new Map<string, { index: number; type: string }[]>();
    for (const row of loadJournal('pass1', 'subagent')) {
      const f = row.frame as { type?: string; event?: { type?: string; index?: number; content_block?: { type: string } }; parent_tool_use_id?: string | null };
      if (row.direction !== 'in' || f.type !== 'stream_event' || f.event?.type !== 'content_block_start') continue;
      const lane = f.parent_tool_use_id ?? 'main';
      starts.set(lane, [...(starts.get(lane) ?? []), { index: f.event.index!, type: f.event.content_block!.type }]);
    }
    const parentCompletes = ofKind(events, 'assistant.block.complete').filter((e) => e.parentToolUseId === null);
    expect(parentCompletes.map((e) => ({ index: e.blockIndex, type: e.block.type }))).toEqual(starts.get('main'));
    expect([...starts.keys()]).toEqual(['main']); // no token-level stream events for children
    for (const complete of parentCompletes) {
      const priorDeltas = ofKind(events, 'assistant.block.delta').filter((d) => seq(d) < seq(complete) && d.apiMessageId === complete.apiMessageId && d.blockIndex === complete.blockIndex);
      expect(priorDeltas.length).toBeGreaterThan(0);
      expect(priorDeltas.every((d) => d.blockType === complete.block.type)).toBe(true);
    }
    const perMessage = new Map<string, number[]>();
    for (const c of childCompletes) perMessage.set(c.apiMessageId, [...(perMessage.get(c.apiMessageId) ?? []), c.blockIndex]);
    for (const indices of perMessage.values()) expect(indices).toEqual(indices.map((_, i) => i));
  });

  it('pass2/workflow yields task.started local_workflow, three workflow.progress, a completed notification and an engine turn', async () => {
    const { events } = await run('pass2', 'workflow');
    expect(ofKind(events, 'task.started')).toMatchObject([{ taskType: 'local_workflow', workflowName: 'maws-probe' }]);
    expect(ofKind(events, 'workflow.progress')).toHaveLength(3);
    expect(ofKind(events, 'task.notification')).toMatchObject([{ status: 'completed' }]);
    expect(ofKind(events, 'turn.ended').map((e) => e.origin)).toEqual(['human', 'task-notification']);
    expect(ofKind(events, 'turn.started').map((e) => [e.seq, e.origin])).toEqual([[5, 'human'], [97, 'engine']]);
  });

  it('pass2/rewind yields exactly one boundary.rewind from seq 42 and the typed rewind responses parse', async () => {
    const { events, requests } = await run('pass2', 'rewind');
    const boundaries = ofKind(events, 'boundary.rewind');
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({ seq: 42, targetMessageUuid: '36a2aa44-9ae9-455e-b52b-e70b27eecde5', prefillText: 'Also remember the word BANANA. Reply OK.', precedingAssistantUuid: 'edf0f954-1b18-4bca-a53f-d3212ef6dbaa' });
    expect(idSuffix(boundaries[0]!)).toBe('42:0');
    const rewinds = requests.filter((r) => r.subtype === 'rewind_conversation');
    expect(rewinds.map((r) => r.seq)).toEqual([39, 41]);
    for (const r of rewinds) expect(() => RewindConversationResponseSchema.parse(r.response)).not.toThrow();
    expect(rewinds.map((r) => (r.response as { rewound: boolean; reason?: string }).rewound)).toEqual([false, true]);
    expect((rewinds[0]!.response as { reason: string }).reason).toBe('stale_target');
    const files = requests.find((r) => r.subtype === 'rewind_files');
    expect(RewindFilesResponseSchema.parse(files?.response)).toEqual({ canRewind: false, error: 'File rewinding is not enabled.' });
  });

  it('grant fixtures: decisionReasonType null at grant-reapply-start seq 30 and rule at grant-askrule-start seq 27', async () => {
    const reapply = await run('pass2', 'grant-reapply-start');
    expect(ofKind(reapply.events, 'permission.requested').find((e) => e.seq === 30)).toMatchObject({ decisionReasonType: null, suggestions: [{ type: 'addRules' }, { type: 'addDirectories' }, { type: 'setMode' }] });
    expect(ofKind(reapply.events, 'permission.resolved').find((e) => e.seq === 32)).toMatchObject({ behavior: 'allow', updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'session' }] });
    const askrule = await run('pass2', 'grant-askrule-start');
    expect(ofKind(askrule.events, 'permission.requested').find((e) => e.seq === 27)).toMatchObject({ decisionReasonType: 'rule' });
    const resume = await run('pass2', 'grant-reapply-resume');
    const rules = resume.requests.filter((r) => r.subtype === 'list_permission_rules');
    expect(rules).toHaveLength(2);
    expect((rules[1]!.response as { state: { rules: { rule: string; source: string }[] } }).state.rules).toMatchObject([{ rule: 'Bash(touch granted.txt)', source: 'flagSettings' }]);
    const reapplied = resume.rows.find((r) => r.direction === 'out' && (r.frame as { request?: { subtype?: string } }).request?.subtype === 'apply_flag_settings');
    expect((reapplied?.frame as { request: unknown }).request).toEqual({ subtype: 'apply_flag_settings', settings: { permissions: { allow: ['Bash(touch granted.txt)'] } } });
  });

  it('pass2/auto-classifier yields a not_flagged safeguard and the matching tool.result.safeguard', async () => {
    const { events } = await run('pass2', 'auto-classifier');
    const id = 'toolu_01PGaV2Yy3rJAGQwn445u9iH';
    expect(ofKind(events, 'tool.safeguard').find((e) => e.toolUseId === id)).toMatchObject({ verdict: 'not_flagged', lane: 'server' });
    expect(ofKind(events, 'tool.result').find((e) => e.toolUseId === id)).toMatchObject({ safeguard: 'not_flagged', denial: null });
  });

  it('pass2/auto-haiku: the auto-mode refusal rides ControlError.code', async () => {
    const { requests } = await run('pass2', 'auto-haiku');
    expect(requests.find((r) => r.subtype === 'set_permission_mode')).toMatchObject({ ok: false, code: 'auto_mode_model' });
  });

  it('pass2/hooks yields the host hook callback round trip and the settings hook lifecycle for PostToolUse:Bash only', async () => {
    const { events } = await run('pass2', 'hooks');
    expect(ofKind(events, 'hook.callback_requested')).toMatchObject([{ callbackId: 'maws_pre_bash', hookEvent: 'PreToolUse', toolUseId: 'toolu_01Pw5t8WFEWy8m7zrSCNnca1' }]);
    expect(ofKind(events, 'hook.callback_resolved')).toMatchObject([{ callbackId: 'maws_pre_bash', response: { continue: true } }]);
    expect(ofKind(events, 'hook.started').map((e) => e.hookName)).toEqual(['PostToolUse:Bash']);
    expect(ofKind(events, 'hook.finished')).toMatchObject([{ hookName: 'PostToolUse:Bash', outcome: 'success', exitCode: 0, stdout: 'MAWS_POSTHOOK\n' }]);
  });

  it('pass2/dialogs yields the elicitation round trip and the thinking/tool_use block indices under one message id', async () => {
    const { events } = await run('pass2', 'dialogs');
    expect(ofKind(events, 'elicitation.requested')).toMatchObject([{ seq: 41, mcpServerName: 'maws-elicit', mode: 'form', elicitationId: null }]);
    expect(ofKind(events, 'elicitation.resolved')).toMatchObject([{ seq: 43, action: 'accept', content: { color: 'teal' } }]);
    const msg = 'msg_011CfVeJoDd2KdQdTjTDeM4u';
    const deltas = ofKind(events, 'assistant.block.delta').filter((d) => seq(d) >= 12 && seq(d) <= 13);
    expect(deltas.map((d) => [d.seq, d.blockIndex, d.apiMessageId])).toEqual([[12, 0, msg]]); // seq 13 is a signature delta: no content
    const completes = ofKind(events, 'assistant.block.complete').filter((c) => c.apiMessageId === msg);
    expect(completes.map((c) => [c.seq, c.blockIndex, c.block.type])).toEqual([[14, 0, 'thinking'], [28, 1, 'tool_use']]);
    expect(completes[0]!.seq).toBeLessThan(15); // before the content_block_stop at seq 15
  });

  it('pass2/bash-context-echoed: two bash-tagged messages, one bash_echo from the out row, the receipt, then one human turn', async () => {
    const { events } = await run('pass2', 'bash-context-echoed');
    const users = ofKind(events, 'user.message');
    expect(users.map((u) => [u.seq, u.origin, u.bash?.part ?? null, u.isSynthetic, u.isReplay])).toEqual([
      [6, null, 'input', false, true],
      [7, null, 'output', false, true],
      [9, 'bash_echo', null, true, false],
      [16, 'human', null, false, false],
    ]);
    expect(ofKind(events, 'turn.started').map((e) => [e.seq, e.origin])).toEqual([[16, 'human']]);
    expect(ofKind(events, 'session.init').map((e) => e.seq)).toEqual([12, 19]);
    expect(ofKind(events, 'turn.ended').map((e) => [e.seq, e.isEchoReceipt])).toEqual([[13, true], [30, false]]);
    // the engine's replay of the prompt (seq 21, same uuid) is deduplicated
    expect(events.filter((e) => e.seq === 21)).toEqual([]);
  });

  it('pass2/per-task-stop-off: a background Bash result has no spill path', async () => {
    const { events } = await run('pass2', 'per-task-stop-off');
    const results = ofKind(events, 'tool.result');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.spillPath === null)).toBe(true);
    expect(ofKind(events, 'task.started')).toMatchObject([{ taskType: 'local_bash', isBackground: true }]);
  });

  it('pass2/per-task-stop-on: user-rejected inside an aborted turn, then a completed task notification', async () => {
    const { events } = await run('pass2', 'per-task-stop-on');
    const ends = ofKind(events, 'turn.ended');
    expect(ends[0]).toMatchObject({ terminalReason: 'aborted_streaming' });
    expect(ofKind(events, 'tool.result').filter((r) => seq(r) < seq(ends[0]) && r.denial === 'user-rejected')).toHaveLength(1);
    expect(ofKind(events, 'task.notification').find((e) => seq(e) > seq(ends[0]))).toMatchObject({ status: 'completed' });
    // the engine's own "[Request interrupted by user]" user frame is a plain user.message
    expect(ofKind(events, 'user.message').find((e) => e.seq === 65)).toMatchObject({ isReplay: false, isSynthetic: false, bash: null });
  });

  it('typed responses: trust-attested workspace_trust_recorded, prewarm claim_session, get_status base URL row', async () => {
    const trust = await run('pass2', 'trust-attested');
    const init = InitializeResponseSchema.parse(trust.requests.find((r) => r.subtype === 'initialize')?.response);
    expect(init.workspace_trust_recorded).toBe(true);
    const prewarm = await run('pass2', 'prewarm');
    const claim = ClaimSessionResponseSchema.parse(prewarm.requests.find((r) => r.subtype === 'claim_session')?.response);
    expect(claim.status).toBe('ok');
    const baseUrl = (r: ConformanceRun) => {
      const status = GetStatusResponseSchema.parse(r.requests.find((q) => q.subtype === 'get_status')?.response);
      return status.sections.find((s) => s.title === 'Session')?.rows.find((row) => row.label === 'Anthropic base URL')?.value ?? null;
    };
    expect(baseUrl(await run('pass2', 'routing-flag-override'))).toBeNull();
    expect(baseUrl(await run('pass2', 'auto-routed'))).toBe(RELAY_URL);
  });

  it('pass2/resume-live-bg: the refused resume ends before the initialize answer', async () => {
    const { events, requests, exit } = await run('pass2', 'resume-live-bg');
    expect(exit).toEqual({ code: 1, signal: null });
    expect(requests).toMatchObject([{ subtype: 'initialize', ok: false, code: 'exited' }]);
    expect(ofKind(events, 'process.exited')).toMatchObject([{ code: 1, reason: 'crash' }]);
  });

  it('observes exactly the system subtypes C1 fixtured, across all fixtures', async () => {
    const seen = new Set<string>();
    for (const pass of FIXTURE_PASSES) {
      for (const name of listJournals(pass)) {
        for (const row of loadJournal(pass, name)) {
          const f = row.frame as { type?: string; subtype?: string };
          if (row.direction === 'in' && f.type === 'system' && f.subtype) seen.add(f.subtype);
        }
      }
    }
    expect([...seen].sort()).toEqual([
      'background_tasks_changed', 'commands_changed', 'hook_response', 'hook_started', 'init', 'status',
      'task_notification', 'task_progress', 'task_started', 'task_updated', 'thinking_tokens',
    ]);
  });

  it('every event kind the fixtures produce is a known kind, and the kinds never produced are the ones no fixture exercises', async () => {
    const produced = new Set<string>();
    for (const pass of FIXTURE_PASSES) for (const name of listJournals(pass)) for (const e of (await run(pass, name)).events) produced.add(e.kind);
    for (const kind of produced) expect(z.enum(SessionEventSchema.options.map((o) => o.shape.kind.value) as [string, ...string[]]).safeParse(kind).success).toBe(true);
    expect([...produced].sort()).toEqual([
      'assistant.block.complete', 'assistant.block.delta', 'boundary.rewind', 'command.lifecycle', 'elicitation.requested', 'elicitation.resolved',
      'hook.callback_requested', 'hook.callback_resolved', 'hook.finished', 'hook.started', 'permission.requested', 'permission.resolved', 'process.exited',
      'question.answered', 'question.requested', 'session.commands', 'session.init', 'subagent.finished', 'subagent.progress', 'subagent.started',
      'task.notification', 'task.started', 'task.updated', 'tasks.snapshot', 'tool.result', 'tool.safeguard', 'tool.use', 'turn.ended', 'turn.started',
      'usage.sample', 'user.message', 'workflow.progress',
    ]);
    void kinds;
  });
});
