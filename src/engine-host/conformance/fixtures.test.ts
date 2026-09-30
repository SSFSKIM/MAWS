import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { ClaimSessionResponseSchema, GetStatusResponseSchema, GetWorkspaceDiffResponseSchema, InitializeResponseSchema, RewindConversationResponseSchema, RewindFilesResponseSchema } from '@shared/wire/control';
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
const text = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content));
const seq = (event: SessionEvent | undefined): number => event?.seq ?? -1; // every live event has a row; -1 only if a pin's lookup missed

describe('normaliser replays every probe fixture into the X1 graph', () => {
  it('sees the three recorded passes', () => {
    expect(listJournals('pass1')).toHaveLength(10);
    expect(listJournals('pass2')).toHaveLength(30);
    // C10's fork-worktree and C8c's workspace-diff probes (copied from master at 644ea7a)
    // and C3's own live recordings (M6: rewind-files from 3.12, plan-outcomes from 3.20, steer-now from 3.7's passing rerun and steer-now-unheld from its first run, engine-turn-release from 3.10, steer-next from the fix wave's live check)
    // C8b's agent-work probes (Gate G1: nested-agents R5, relay-to-child R1, stop-task R6)
    // C10 start: M1's records under a scratch config home (the pinned fork's source and fork, the trust bootstrap, the
    // home directory's session-only trust and its unattested control, the exact-key check, the read-only permission round trip)
    const c10 = ['fork-pinned-id-fork', 'fork-pinned-id-start', 'home-trust-session-only', 'home-trust-unattested', 'read-only-permission', 'trust-bootstrap-recorded', 'trust-exact-key'];
    // C10 end
    const wave3 = ['context-sample', 'interrupt-text', 'question-deny']; // debt wave 3: the turn-end context read, a text block cut by an interrupt, a question skipped by a deny
    const wave4 = ['context-full', 'end-session-archive']; // debt wave 4: both context details over a growing conversation, an archive's end_session
    // C12 start: M5's launch-environment probe (the print arms, the terminal half's meta-only record, the state-event pair)
    const c12 = ['launch-env-fork', 'launch-env-state-events', 'launch-env-state-events-unset', 'launch-env-terminal', 'launch-env-todo', 'launch-env-unset'];
    // C12 end
    expect(listJournals('pass3')).toEqual(['engine-turn-release', 'fork-worktree-fork', 'fork-worktree-resume-in-b', 'fork-worktree-start', 'nested-agents', 'plan-outcomes', 'relay-to-child', 'rewind-files', 'steer-next', 'steer-now', 'steer-now-unheld', 'stop-task', 'workspace-diff-branch', 'workspace-diff-dirty', ...c10, ...wave3, ...wave4, ...c12 /* C12 */].sort());
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

  it("pass1/permission-roundtrip: the prompt bubble derives from the out rows 4, 94, 192; each turn opens at the engine's started lifecycle 6, 97, 195", async () => {
    const { events } = await run('pass1', 'permission-roundtrip');
    const starts = ofKind(events, 'turn.started');
    // coordinator ruling after M6 live 3.7: the turn boundary is the engine's acceptance, the bubble the host's write
    expect(starts.map((e) => [e.seq, e.origin, idSuffix(e)])).toEqual([[6, 'human', '6:1'], [97, 'human', '97:1'], [195, 'human', '195:1']]);
    const humans = ofKind(events, 'user.message').filter((e) => e.origin === 'human');
    expect(humans.map((e) => [e.seq, e.isReplay, idSuffix(e)])).toEqual([[4, false, '4:0'], [94, false, '94:0'], [192, false, '192:0']]);
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
    // the steer written at 146 never started (cancelled at 191): it opens no turn and joins none; 191 and 200 close nothing
    expect(ofKind(events, 'turn.started').map((e) => [e.seq, e.origin, e.userMessageUuid])).toEqual([[6, 'human', 'a5bf8381-f5c0-4394-88a8-4b04c12e4911'], [202, 'human', 'e88214f8-3ba3-4b4c-8e64-3be1595fcac0']]);
    expect(ends[0]!.userMessageUuids).toEqual(['a5bf8381-f5c0-4394-88a8-4b04c12e4911']);
    expect(ends.map((e) => e.seq).filter((n) => n === 191 || n === 200)).toEqual([]);
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
    expect(ofKind(events, 'turn.started').map((e) => [e.seq, e.origin])).toEqual([[6, 'human'], [355, 'engine'], [425, 'engine']]);
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
    expect(ofKind(events, 'turn.started').map((e) => [e.seq, e.origin])).toEqual([[7, 'human'], [97, 'engine']]);
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

  it('pass3/rewind-files: a real file restore (live 3.12): dry run, conversation rewind with its boundary, then the restore', async () => {
    const { events, requests } = await run('pass3', 'rewind-files');
    const target = '2af844ef-3dd0-4830-abe3-1f2a0e6baf36';
    expect(requests.filter((r) => r.subtype.startsWith('rewind_')).map((r) => [r.seq, r.subtype])).toEqual([[137, 'rewind_files'], [139, 'rewind_conversation'], [141, 'rewind_files']]);
    const [dry, conversation, restore] = requests.filter((r) => r.subtype.startsWith('rewind_'));
    expect(RewindFilesResponseSchema.parse(dry!.response)).toEqual({ canRewind: true, filesChanged: [expect.stringMatching(/\/notes\.txt$/)], insertions: 1, deletions: 1 });
    expect(RewindConversationResponseSchema.parse(conversation!.response)).toMatchObject({ rewound: true, targetMessageUuid: target });
    expect(RewindFilesResponseSchema.parse(restore!.response)).toEqual({ canRewind: true, skippedLinks: 0 }); // the restore answers no counts
    const boundaries = ofKind(events, 'boundary.rewind');
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({ seq: 140, targetMessageUuid: target, prefillText: 'Use the Edit tool to change notes.txt so it says BETA instead of ALPHA.', precedingAssistantUuid: '284cab33-7b4b-474a-8e6b-c6cc0f9f81c8' });
    expect(ofKind(events, 'turn.ended').map((e) => [e.seq, e.terminalReason])).toEqual([[70, 'completed'], [132, 'completed']]);
  });

  it('pass3/interrupt-text (debt wave 3): the partial text block an interrupt cuts arrives with aborted: true, every other block complete', async () => {
    const { events } = await run('pass3', 'interrupt-text');
    const blocks = ofKind(events, 'assistant.block.complete');
    expect(blocks.filter((e) => e.aborted).map((e) => [e.seq, e.blockIndex, e.block.type])).toEqual([[96, 1, 'text']]);
    expect(blocks.find((e) => e.aborted)!.block).toMatchObject({ text: expect.stringContaining('History of Tea') as unknown });
    expect(blocks.every((e) => e.supersedes.length === 0)).toBe(true);
    expect(ofKind(events, 'turn.ended').map((e) => e.terminalReason)).toEqual(['aborted_streaming', 'completed']);
  });

  it('pass3/question-deny (debt wave 3): a plain deny skips the question tool, the model reads the denial and the turn completes', async () => {
    const { events } = await run('pass3', 'question-deny');
    const [requested] = ofKind(events, 'question.requested');
    expect(requested).toMatchObject({ seq: 108, questions: [{ question: 'Red or Blue?' }] });
    // X1 has no declined form: the skip is an answer with no answers, a real answer always names each question
    expect(ofKind(events, 'question.answered')).toMatchObject([{ seq: 110, requestId: requested!.requestId, answers: {} }]);
    expect(ofKind(events, 'tool.result').find((e) => e.toolUseId === requested!.toolUseId)).toMatchObject({ seq: 112, isError: true, content: 'Denied by the user in MAWS.', denial: 'permission-rule' });
    expect(ofKind(events, 'turn.ended')).toMatchObject([{ seq: 154, result: 'success', isError: false, terminalReason: 'completed', resultText: 'SKIPPED' }]);
  });

  it('pass3/plan-outcomes: keep planning, implement, then clear and implement (live 3.20)', async () => {
    const { events, rows } = await run('pass3', 'plan-outcomes');
    const requested = ofKind(events, 'plan.requested');
    expect(requested.map((e) => e.seq)).toEqual([128, 246, 502]);
    expect(ofKind(events, 'plan.resolved').map((e) => [e.seq, e.outcome, e.feedback])).toEqual([
      [132, 'keep_planning', 'Also state that the file must end with a newline.'],
      [250, 'implement', null],
      [506, 'clear_and_implement', null],
    ]);
    // keep planning: the feedback is the tool result the model reads
    expect(ofKind(events, 'tool.result').find((e) => e.toolUseId === requested[0]!.toolUseId)).toMatchObject({ seq: 134, isError: true, content: 'Also state that the file must end with a newline.' });
    // implement: the engine restores the pre-plan mode itself (system/status at 252) and the next system/init reports it
    expect(ofKind(events, 'session.init').find((e) => e.seq === 306)).toMatchObject({ permissionMode: 'auto' });
    // clear and implement: the deny interrupts the turn, the host restores the mode, sends /clear, and the plan after its turn
    const outs = rows.filter((r) => r.direction === 'out').map((r) => [r.seq, r.frame] as const);
    expect(outs.find(([seq]) => seq === 506)?.[1]).toMatchObject({ response: { response: { behavior: 'deny', interrupt: true } } });
    expect(ofKind(events, 'turn.ended').find((e) => e.seq === 510)).toMatchObject({ terminalReason: 'aborted_tools', userMessageUuids: ['1b740363-a57a-473a-97a1-72a75a272cc8'] });
    expect(outs.find(([seq]) => seq === 512)?.[1]).toMatchObject({ request: { subtype: 'set_permission_mode', mode: 'auto' } });
    expect(outs.find(([seq]) => seq === 518)?.[1]).toMatchObject({ type: 'user', message: { content: '/clear' } });
    expect(ofKind(events, 'boundary.reset')).toMatchObject([{ seq: 521, trigger: 'clear', newConversationId: '4b753410-1ce5-4000-a1e5-72af5ac4ebc2' }]);
    // /clear starts a fresh engine session: the next system/init names a new session id
    expect(ofKind(events, 'session.init').find((e) => e.seq === 522)?.sessionId).toBe('ac8891c8-7968-455d-9e9b-d98f772f762a');
    expect(ofKind(events, 'turn.ended').find((e) => e.seq === 524)).toMatchObject({ userMessageUuids: ['4c6e1bdb-4af7-467d-a602-4775821aaeff'], numTurns: 0, terminalReason: null, isEchoReceipt: false });
    // the plan prompt (fixture seq 526; the harness journals it at 525, ahead of the get_status re-read written just before
    // it, because a user frame's row is written at once and a control request's when its write resolves)
    const implement = ofKind(events, 'turn.started').find((e) => e.userMessageUuid === '8e7fbc83-df00-48bf-a05a-6b1592924ec4');
    expect(implement).toMatchObject({ origin: 'human' });
    expect(implement!.seq).toBeGreaterThan(524);
    expect(text(ofKind(events, 'user.message').find((e) => e.messageUuid === '8e7fbc83-df00-48bf-a05a-6b1592924ec4')?.content)).toMatch(/^Implement this plan:\n\n# Plan: create second\.txt/);
    expect(ofKind(events, 'turn.ended').at(-1)).toMatchObject({ seq: 579, terminalReason: 'completed', userMessageUuids: ['8e7fbc83-df00-48bf-a05a-6b1592924ec4'] });
  });

  // Coordinator ruling after M6 live 3.7: a human turn opens at the engine's `started` lifecycle for its prompt.
  const turnLog = (events: SessionEvent[]) =>
    events.filter((e) => e.parentToolUseId === null && ((e.kind === 'turn.ended' && !e.isEchoReceipt) || e.kind === 'turn.started')).map((e) =>
      e.kind === 'turn.started' ? `start ${e.seq} ${e.origin} ${e.userMessageUuid ?? '-'}` : `end ${e.seq} ${(e as Extract<SessionEvent, { kind: 'turn.ended' }>).origin} ${(e as Extract<SessionEvent, { kind: 'turn.ended' }>).userMessageUuids.join(',') || '-'}`,
    );

  it("pass3/steer-now (live 3.7's passing rerun): a now steer preempts the running turn, the queued prompt is held until the steer's own result, and each reply keeps its own turn", async () => {
    const { events, rows } = await run('pass3', 'steer-now');
    const [count, steer, after] = ['7aa791e4-4261-41a4-9ef3-e1590591dd3c', 'e80149ac-ba3a-486a-8d42-b07a6f987698', '03797d66-6388-4e77-beb2-6f0007014054'];
    expect((rows.find((r) => r.seq === 46)!.frame as { priority?: string }).priority).toBe('now');
    expect(turnLog(events)).toEqual([
      `start 19 human ${count}`, `end 48 human ${count}`, // preempted: aborted_streaming, naming only the counting prompt
      `start 51 human ${steer}`, `end 69 human ${steer}`, // the steer's own started opens its own turn
      `start 77 human ${after}`, `end 92 human ${after}`,
    ]);
    expect(ofKind(events, 'turn.ended').map((e) => e.terminalReason)).toEqual(['aborted_streaming', 'completed', 'completed']);
    expect(ofKind(events, 'turn.ended')[1]!.resultText).toContain('STEERED');
    expect(ofKind(events, 'turn.ended')[2]!.resultText).toContain('AFTER');
    // the hold: the queued prompt's release (seq 74) comes after the steer's result (69), never while the steer is unstarted
    const releases = rows.filter((r) => r.direction === 'meta' && (r.frame as { event?: string; action?: string }).event === 'queue' && (r.frame as { action?: string }).action === 'release');
    expect(releases.map((r) => [r.seq, (r.frame as { trigger: string }).trigger])).toEqual([[15, 'send'], [74, 'turn_ended']]);
    expect(ofKind(events, 'user.message').filter((e) => e.origin === 'human').map((e) => [e.seq, e.messageUuid])).toEqual([[16, count], [46, steer], [75, after]]);
  });

  it("pass3/steer-now-unheld (live 3.7's first run, queue rows from before the hold): a prompt written while the now steer is unstarted still gets its own turn, as does the steer", async () => {
    const { events, rows } = await run('pass3', 'steer-now-unheld');
    const [count, steer, after] = ['07d1e738-414a-4630-a243-a1ee35210326', '55744f27-09fb-4141-89d5-5f0adfddffca', '6ebd79ba-a46b-4442-ac6a-716532177882'];
    expect((rows.find((r) => r.seq === 46)!.frame as { priority?: string }).priority).toBe('now');
    expect(turnLog(events)).toEqual([
      `start 19 human ${count}`, `end 48 human ${count}`, // preempted: aborted_streaming, naming only the counting prompt
      `start 55 human ${steer}`, `end 73 human ${steer}`, // the steer's own started opens its own turn
      `start 78 human ${after}`, `end 95 human ${after}`,
    ]);
    expect(ofKind(events, 'turn.ended').map((e) => e.terminalReason)).toEqual(['aborted_streaming', 'completed', 'completed']);
    expect(ofKind(events, 'turn.ended')[1]!.resultText).toContain('STEERED');
    expect(ofKind(events, 'turn.ended')[2]!.resultText).toContain('AFTER');
    // the prompts show at the write: the bubbles at 16, 46, 53
    expect(ofKind(events, 'user.message').filter((e) => e.origin === 'human').map((e) => [e.seq, e.messageUuid])).toEqual([[16, count], [46, steer], [53, after]]);
  });

  it('pass3/steer-next (fix wave live check): a next steer folds into the running turn at a tool boundary and the one result names both prompts', async () => {
    const { events, rows } = await run('pass3', 'steer-next');
    const [count, next] = ['fe091b0d-b28b-41a8-aed3-39585769623d', '42a15931-3c9a-4267-a6b2-09fa5697735d'];
    expect((rows.find((r) => r.seq === 46)!.frame as { priority?: string }).priority).toBe('next');
    expect(ofKind(events, 'command.lifecycle').filter((e) => e.commandUuid === next).map((e) => [e.seq, e.state])).toEqual([[47, 'queued'], [71, 'started'], [238, 'completed']]);
    expect(turnLog(events)).toEqual([`start 19 human ${count}`, `end 239 human ${count},${next}`]); // its started (71) joins the open turn
    const reply = ofKind(events, 'assistant.block.complete').find((e) => e.parentToolUseId === null && JSON.stringify(e.block).includes('NEXT_OK'));
    expect(reply!.seq).toBeGreaterThan(71); // answered mid-turn, after its started
    expect(ofKind(events, 'turn.ended')[0]!.resultText).toContain('COUNTED');
  });

  it('pass3/engine-turn-release (live 3.10): a pending task-notification turn runs ahead of a prompt released at idle, and each reply keeps its own turn', async () => {
    const { events } = await run('pass3', 'engine-turn-release');
    const [first, a, b] = ['458685fe-08d6-4f66-82c0-0ad0a63245ae', '562abf01-f74a-4656-b617-4166196def6e', '1a5ce608-758a-47bf-95c1-d259be2ca524'];
    expect(turnLog(events)).toEqual([
      `start 19 human ${first}`, `end 91 human ${first}`,
      `start 99 human ${a}`, `end 116 human ${a}`,
      'start 124 engine -', 'end 150 task-notification -',
      'start 154 engine -', 'end 175 task-notification -', // B was written at 152; the second notification ran first
      `start 176 human ${b}`, `end 193 human ${b}`,
    ]);
    expect(ofKind(events, 'task.notification').map((e) => e.status)).toEqual(['completed', 'completed']);
  });

  it("an origin.kind 'peer' passes through as the string 'peer' (live 3.5: journal live-d652796d/k7lvflg3.jsonl, results at seq 156 and 185)", async () => {
    const { Normalizer } = await import('../normalizer');
    const n = new Normalizer({ appSessionId: 'conformance' as never, launchId: 'PEER0001', sessionId: 's' as never });
    const at = '2026-09-28T10:00:00.000Z';
    const [init] = [{ type: 'system', subtype: 'init', cwd: '/w', session_id: 's', tools: [], mcp_servers: [], model: 'm', permissionMode: 'auto', slash_commands: [], claude_code_version: '2.1.283', uuid: 'i' }];
    const peerResult = { type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], result: 'ok', terminal_reason: 'completed', origin: { kind: 'peer' }, user_message_uuids: [], uuid: 'r' };
    const peerUser = { type: 'user', uuid: 'pu', session_id: 's', isReplay: false, origin: { kind: 'peer' }, message: { role: 'user', content: 'from a subagent' } };
    const events = [init, peerUser, peerResult].flatMap((frame, i) => n.push({ seq: i + 1, direction: 'in', at, frame }));
    expect(ofKind(events, 'turn.started')).toMatchObject([{ origin: 'engine' }]);
    expect(ofKind(events, 'user.message')).toMatchObject([{ messageUuid: 'pu', origin: 'peer' }]);
    expect(ofKind(events, 'turn.ended')).toMatchObject([{ origin: 'peer' }]);
    for (const e of events) expect(SessionEventSchema.safeParse(e).success).toBe(true);
  });

  it('pass3/context-sample (debt wave 3): the read after each turn yields context.sample with the figures the engine answered', async () => {
    const { events } = await run('pass3', 'context-sample');
    const samples = events.filter((e) => e.kind === 'context.sample');
    expect(samples.map((e) => e.seq)).toEqual([53, 148]); // the answers to the reads at seq 51 and 146, each after its turn's result (seq 50, 145)
    for (const sample of samples) expect(sample).toMatchObject({ maxTokens: 200000, autoCompactThreshold: 167000, isAutoCompactEnabled: true, model: 'claude-haiku-4-5-20251001' });
    // debt wave 4: the engine answered 30,304 (15 %) both times; the samples carry the measured input plus the Messages estimate
    expect(samples.map((e) => [e.totalTokens, e.percentage])).toEqual([[21495, 11], [21841, 11]]);
  });

  it("pass3/context-full (debt wave 4): the sample follows the conversation from the first turn, and matches detail: 'full'", async () => {
    const { events } = await run('pass3', 'context-full');
    const samples = ofKind(events, 'context.sample');
    // a summary and a full read after each of five turns (answers at 77/79, 311/313, 451/453, 527/529, 650/652)
    expect(samples.map((e) => e.seq)).toEqual([77, 79, 311, 313, 451, 453, 527, 529, 650, 652]);
    const summary = samples.filter((_, i) => i % 2 === 0);
    const full = samples.filter((_, i) => i % 2 === 1);
    // the engine's summary answered 30,305 (15 %) on the first; the rest as answered
    expect(summary.map((e) => [e.totalTokens, e.percentage])).toEqual([[21521, 11], [41880, 21], [62407, 31], [82798, 41], [103190, 52]]);
    expect(full.map((e) => e.totalTokens)).toEqual(summary.map((e) => e.totalTokens));
  });

  it("pass3/end-session-archive (debt wave 4): the engine acknowledges end_session { reason: 'archive' } and exits 0", async () => {
    type Row = { request_id?: string; request?: { subtype?: string }; response?: { request_id?: string }; event?: string };
    const journal = loadJournal('pass3', 'end-session-archive');
    const frame = (r: { frame: unknown }) => r.frame as Row;
    const request = journal.find((r) => r.direction === 'out' && frame(r).request?.subtype === 'end_session')!;
    expect(frame(request).request).toEqual({ subtype: 'end_session', reason: 'archive' });
    const answered = journal.find((r) => r.direction === 'in' && frame(r).response?.request_id === frame(request).request_id)!;
    expect(frame(answered).response).toEqual({ subtype: 'success', request_id: frame(request).request_id });
    const exit = journal.find((r) => frame(r).event === 'exit')!;
    expect(answered.seq).toBeLessThan(exit.seq);
    expect(exit.frame).toMatchObject({ code: 0, signal: null });
    // the engine logged the reason it received (its debug log, copied after the exit)
    expect(journal.find((r) => frame(r).event === 'archive_after_exit')!.frame).toMatchObject({ debugLines: ['[DEBUG] [print.ts] end_session received, reason=archive'] });
    const { events } = await run('pass3', 'end-session-archive');
    expect(ofKind(events, 'process.exited')).toMatchObject([{ code: 0 }]);
  });

  it("pass3/workspace-diff-*: every get_workspace_diff response parses with the typed schema (C8c's ask)", async () => {
    const dirty = await run('pass3', 'workspace-diff-dirty');
    const branch = await run('pass3', 'workspace-diff-branch');
    const diffs = (r: ConformanceRun) => r.requests.filter((q) => q.subtype === 'get_workspace_diff');
    expect(diffs(dirty).map((q) => [q.seq, q.ok])).toEqual([[7, true], [12, true], [17, true]]); // answered at seq 8, 13, 18
    expect(diffs(branch).map((q) => [q.ok])).toEqual([[true], [true]]); // answered at seq 7, 12
    const raw = (run: ConformanceRun, seq: number) => (loadJournal('pass3', run === dirty ? 'workspace-diff-dirty' : 'workspace-diff-branch').find((r) => r.seq === seq)!.frame as { response: { response: unknown } }).response.response;
    for (const [r, seq] of [[dirty, 8], [dirty, 13], [dirty, 18], [branch, 7], [branch, 12]] as const) {
      const parsed = GetWorkspaceDiffResponseSchema.parse(raw(r, seq));
      expect(parsed.diff?.perFileStats.every((f) => typeof f.isUntracked === 'boolean' && typeof f.isBinary === 'boolean')).toBe(true);
    }
    const dirtyDiff = GetWorkspaceDiffResponseSchema.parse(raw(dirty, 8)).diff!;
    expect(dirtyDiff.source).toEqual({ kind: 'working-tree' });
    expect(dirtyDiff.hunks[0]).toMatchObject({ path: 'alpha.txt', hunks: [{ oldStart: 1, oldLines: 7, newStart: 1, newLines: 7 }, { oldStart: 23 }] });
    expect(GetWorkspaceDiffResponseSchema.parse(raw(branch, 12)).diff).toMatchObject({
      stats: { filesCount: 1, linesAdded: 4, linesRemoved: 0 }, skippedLarge: [], restricted: [],
      source: { kind: 'branch', baseBranch: 'main', baseRef: '7726a64784915f093f448ecb56d459033d332512' },
    });
    // null outside a git repository or mid-merge (the engine's own declaration; findings-pass3-workspace-diff.md)
    expect(GetWorkspaceDiffResponseSchema.parse({ diff: null })).toEqual({ diff: null });
    const bad = structuredClone(raw(branch, 12)) as { diff: { perFileStats: Record<string, unknown>[]; source: Record<string, unknown> } };
    delete bad.diff.perFileStats[0]!.isUntracked;
    expect(GetWorkspaceDiffResponseSchema.safeParse(bad).success).toBe(false);
    const noRef = structuredClone(raw(branch, 12)) as { diff: { source: Record<string, unknown> } };
    delete noRef.diff.source.baseRef;
    expect(GetWorkspaceDiffResponseSchema.safeParse(noRef).success).toBe(false);
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
    expect(ofKind(events, 'turn.started').map((e) => [e.seq, e.origin])).toEqual([[18, 'human']]); // the prompt's started lifecycle (written at 16)
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
    // the engine's own "[Request interrupted by user]" user frame carries its own origin, never a human prompt's
    expect(ofKind(events, 'user.message').find((e) => e.seq === 65)).toMatchObject({ origin: 'interrupt-marker', isReplay: false, isSynthetic: false, bash: null });
  });

  it('pass2/auto-routed: the local-command echo after set_model carries its own origin and the tag\'s inner text', async () => {
    const { events } = await run('pass2', 'auto-routed');
    expect(ofKind(events, 'user.message').find((e) => e.seq === 153)).toMatchObject({ origin: 'local-command', content: 'Set model to `haiku (claude-haiku-4-5-20251001)`', isReplay: true, bash: null });
    expect(ofKind(events, 'turn.started').some((e) => e.seq === 153)).toBe(false);
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

  it("C7's MCP permission request: mcpServer and requiresUserInteraction project from a can_use_tool the fixtures never carried", async () => {
    // Inline until C7 ships test/fixtures/requests/mcp-permission.json (C3 Decision Log, "coordinator, C7's asks", final form).
    const { Normalizer } = await import('../normalizer');
    const n = new Normalizer({ appSessionId: 'conformance' as never, launchId: 'REPLAY01', sessionId: 'sess-mcp' as never });
    const request = {
      subtype: 'can_use_tool', tool_name: 'mcp__github__create_issue', display_name: 'create_issue', input: { title: 'Bug', body: 'Steps' }, tool_use_id: 'toolu_mcp_1',
      mcp_server: { name: 'github', source: 'user' }, requires_user_interaction: true,
    };
    const [event] = n.push({ seq: 1, direction: 'in', at: '2026-09-28T00:00:00.000Z', frame: { type: 'control_request', request_id: 'req-mcp-1', request } });
    expect(SessionEventSchema.parse(event)).toMatchObject({
      kind: 'permission.requested', toolName: 'mcp__github__create_issue', toolUseId: 'toolu_mcp_1', mcpServer: { name: 'github', source: 'user' }, requiresUserInteraction: true,
    });
    for (const key of ['decisionReason', 'suppressAlwaysAllow', 'defaultToNo', 'matchedAskRule']) expect(key in event!).toBe(false);
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
      'session_state_changed', // C12: pass3/launch-env-state-events, under CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1
    ].sort());
  });

  it('every event kind the fixtures produce is a known kind, and the kinds never produced are the ones no fixture exercises', async () => {
    const produced = new Set<string>();
    for (const pass of FIXTURE_PASSES) for (const name of listJournals(pass)) for (const e of (await run(pass, name)).events) produced.add(e.kind);
    for (const kind of produced) expect(z.enum(SessionEventSchema.options.map((o) => o.shape.kind.value) as [string, ...string[]]).safeParse(kind).success).toBe(true);
    expect([...produced].sort()).toEqual([
      'assistant.block.complete', 'assistant.block.delta', 'boundary.reset', 'boundary.rewind', 'command.lifecycle', 'elicitation.requested', 'elicitation.resolved',
      'hook.callback_requested', 'hook.callback_resolved', 'hook.finished', 'hook.started', 'permission.requested', 'permission.resolved', 'plan.requested', 'plan.resolved', 'process.exited',
      'question.answered', 'question.requested', 'session.commands', 'session.init', 'subagent.finished', 'subagent.progress', 'subagent.started',
      // tool.progress: C8b's pass3/relay-to-child, the 30 s heartbeat of the parent's `sleep 45` Bash
      'task.notification', 'task.started', 'task.updated', 'tasks.snapshot', 'tool.progress', 'tool.result', 'tool.safeguard', 'tool.use', 'turn.ended', 'turn.started',
      'usage.sample', 'user.message', 'workflow.progress',
      'notice.posted', // C10: the trust notice (pass2/trust-no-attestation, pass3/trust-exact-key)
      'context.sample', // debt wave 3: a get_context_usage answer (pass1/reads seq 57, pass3/context-sample)
      'session.state', // C12: pass3/launch-env-state-events (running, requires_action, running, idle)
    ].sort());
    void kinds;
  });
});
