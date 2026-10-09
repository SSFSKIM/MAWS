import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { parseAskSteer } from '@shared/maws/ask';
import { ArtifactCreateResultSchema, ArtifactListResultSchema, ArtifactScreenshotResultSchema, ArtifactUpdateResultSchema, AskResultSchema, TOOL_ERRORS } from '@shared/maws/tools';
import { ClaimSessionResponseSchema, GetStatusResponseSchema, GetWorkspaceDiffResponseSchema, InitializeResponseSchema, UiRenderResponseSchema, RewindConversationResponseSchema, RewindFilesResponseSchema } from '@shared/wire/control';
import { FIXTURE_PASSES, listJournals, loadJournal, type FixturePass } from '../../../test/support/fixtures';
import { ownerMarkedText, sittingSeed } from '../../../test/support/r3-surface';
import { RELAY_URL } from '../launch';
import { replayFixture, type ConformanceRun } from './harness';

// A `system` subtype or frame type the fixtures may carry without an X1 mapping. Empty: every fixture frame maps to
// an event or to a "none" row of the table, and a new subtype in a future recording fails here, never silently.
// (R0 admitted the remote-surface pushes here on 2026-10-01; R1 maps them to `plugin.*`.)
// E0a (P1 spec §9, spikes/protocol-probe/findings-pass3-p1-extension.txt) admitted two frames the way R0 did; E1 maps
// the SDK MCP round trip (`control_request/mcp_message`), and E3 maps the side question's progress frame (`none`).
const UNKNOWN_ALLOWLIST: ReadonlySet<string> = new Set([]);

// Outbound requests the probe issued that the engine refused, or that the recording ended before answering.
const EXPECTED_REQUEST_FAILURES: Record<string, { subtype: string; code: string }[]> = {
  'pass2/auto-haiku': [{ subtype: 'set_permission_mode', code: 'auto_mode_model' }],
  'pass2/auto-routed': [{ subtype: 'set_permission_mode', code: 'auto_mode_model' }],
  'pass2/auto-unrouted': [{ subtype: 'set_permission_mode', code: 'auto_mode_model' }],
  'pass2/resume-live-bg': [{ subtype: 'initialize', code: 'exited' }], // the engine refused the resume on stderr and exited 1 before answering
  'pass3/mods-gate-served-off': [{ subtype: 'ui_render', code: 'unknown' }], // R0: with the rollout served off, 2.1.287 answers "Unsupported control request subtype: ui_render" with no error code
  // E0a: a bad-typed fork_conversation is refused with "fork_conversation: title must be a string" (E3 corrected the
  // side_question schema to the `{response, synthetic}` 2.1.290 answers, so its three answers parse)
  'pass3/p1-fork-start': [{ subtype: 'fork_conversation', code: 'unknown' }],
};

// The control client's warnings a fixture is expected to raise (the same schema failures as above, worded by the client;
// request ids are the harness's, minted in order).
const EXPECTED_CLIENT_WARNINGS: Record<string, string[]> = {};

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
    const wave5 = ['bg-daemon-binary']; // debt wave 5: which binary a `--bg` job's transient daemon runs (meta rows only)
    // W1: live records under a scratch config home (a blocking UserPromptSubmit and Stop hook; the Enter scheme's `next`
    // steer at an interrupt, before a `now` one, delivered with its disk copy, and withdrawn by cancel_async_message;
    // `/compact` between two turns)
    const w1 = ['compact', 'hooks-blocking', 'steer-next-cancelled', 'steer-next-disk-live', 'steer-next-interrupted', 'steer-next-then-now'];
    const w3 = ['w3-auto-fallback']; // W3: the host's fallback after a refused auto (set_permission_mode acceptEdits, get_settings on Haiku)
    const w4 = ['w4-question-none', 'w4-question-partial']; // W4: a two-question AskUserQuestion answered with one question, then none, left out (the stepper's Skip)
    const w7 = ['w7-collision', 'w7-take-over']; // W7: a terminal resuming a session MAWS holds (the transcript and registry records beside it), and "Take over here" against one (meta rows only)
    const r0 = ['mods-attach', 'mods-consent', 'mods-gate-off', 'mods-gate-served-off', 'mods-gate-unset', 'mods-pushes']; // R0: the mods probe on the installed 2.1.287 (init capability, pushes without attach, attach and render, the rollout gate, the consent dialog)
    const r2 = ['mods-surface-copy', 'mods-surface-invalidate', 'mods-surface-panes', 'mods-surface-press-input-select', 'mods-surface-prompt-access', 'mods-surface-render-sites']; // R2: the attached desktop surface (sites, presses, inputs and picks, panes, invalidate, prompt access, copy)
    const r3 = ['ask-user-question', 'assistant-message', 'command-output', 'to-human', 'tool-group', 'tool-result', 'tool-use', 'unhooked', 'user-message'].map((site) => `mods-surface-transcript-${site}`); // R3: seven transcript sites, unhooked baseline and the owner's to-human module (R3b: 7.135.0)
    const wave7 = ['hooks-flipped']; // debt wave 7: W1's blocking hooks with the forms flipped (an exit-2 Stop block, JSON prompt blocks), for the disk records beside it
    // E0a (P1 spec §9): the engine probes on the installed 2.1.290 (the SDK MCP round trip, fork_conversation beside the
    // --fork-session launch, side_question idle and mid-turn, the AskUserQuestion preview format unset and html)
    const e0a = ['p1-fork-session-flag', 'p1-fork-start', 'p1-question-preview-html', 'p1-question-preview-unset', 'p1-sdk-mcp-roundtrip', 'p1-side-question-session'];
    const e8 = ['e8-plugins-reload', 'e8-plugins-reload-settle']; // E8 (P1): reload_plugins and reload_skills on 2.1.290 around CLI writes under a scratch home, immediately and after a settle
    // E1 M2: the maws tool server recorded live through MAWS's own host (send_file, a blocking and an async ask, show_pane);
    // E11 S1: the blocking ask interrupted, recorded the same way on the installed 2.1.293
    const e1 = ['p1-maws-ask-async', 'p1-maws-ask-blocking', 'p1-maws-ask-interrupt', 'p1-maws-send-file', 'p1-maws-show-pane'];
    // E3 M0: a side thread forked while the parent's turn runs, an [image, text] `next` steer, and the thread resumed by its id (2.1.291)
    const e3 = ['p1-side-thread-live', 'p1-side-thread-live-fork', 'p1-side-thread-live-resume'];
    // E7 (P1, docs/doperpowers/plans/2026-10-06-e7-orchestration.md M0): two peer sessions messaging each other, CronCreate
    // with its fires and the resume, a named agent under the teams gate, on the installed 2.1.291
    const e7 = ['e7-cron', 'e7-cron-resume', 'e7-peer-a', 'e7-peer-b', 'e7-team'];
    // E2 start: M0's image-block probe (an SDK server's image content block on 2.1.291); M2's artifact tools recorded live
    // through MAWS's own host
    const e2 = ['p1-maws-artifacts', 'p1-sdk-mcp-image'];
    // E2 end
    // E4c start: M4's browser tools recorded live through MAWS's own host, main played by the stand-in
    const e4c = ['p1-maws-browser'];
    // E4c end
    // P2 start (2026-10-09): U1, P2-A's M0 on the installed 2.1.295 (a stopped session resumed with no user frame, and its
    // setup turn); U2, P2-C's M0 on the same engine (the system-prompt snapshot across new, resume and fork, the output
    // style as attachments, --system-prompt-snapshot off, the contract's convergence runs, the shapes); all under scratch homes
    const p2 = ['p2-no-prompt-resume-1', 'p2-no-prompt-resume-setup', 'p2-to-human-converge-s10-new', 'p2-to-human-converge-s10-resume', 'p2-to-human-converge-s10-then', 'p2-to-human-converge-s11-fork', 'p2-to-human-converge-s11-new', 'p2-to-human-converge-s12-new', 'p2-to-human-converge-s12-resume', 'p2-to-human-converge-s13-new', 'p2-to-human-fork', 'p2-to-human-new', 'p2-to-human-off', 'p2-to-human-resume', 'p2-to-human-shapes-s14-compact', 'p2-to-human-shapes-s14-new', 'p2-to-human-shapes-s15-new', 'p2-to-human-shapes-s16-new', 'p2-to-human-snapoff-s6-new', 'p2-to-human-snapoff-s6-resume', 'p2-to-human-snapoff-s6-then', 'p2-to-human-snapoff-s7-new', 'p2-to-human-snapoff-s7-resume', 'p2-to-human-snapoff-s8-new', 'p2-to-human-snapoff-s8-resume', 'p2-to-human-snapoff-s9-fork', 'p2-to-human-snapoff-s9-new', 'p2-to-human-snapshot-s1-new', 'p2-to-human-snapshot-s1-resume', 'p2-to-human-snapshot-s2-new', 'p2-to-human-snapshot-s2-resume', 'p2-to-human-snapshot-s3-new', 'p2-to-human-snapshot-s3-resume', 'p2-to-human-snapshot-s4-new', 'p2-to-human-snapshot-s4-resume', 'p2-to-human-snapshot-s5-fork', 'p2-to-human-snapshot-s5-new', 'p2-to-human-steer-cancel-disk' /* M4 */, 'p2-to-human-style'];
    // P2 end
    expect(listJournals('pass3')).toEqual(['engine-turn-release', 'fork-worktree-fork', 'fork-worktree-resume-in-b', 'fork-worktree-start', 'nested-agents', 'plan-outcomes', 'relay-to-child', 'rewind-files', 'steer-next', 'steer-now', 'steer-now-unheld', 'stop-task', 'workspace-diff-branch', 'workspace-diff-dirty', ...c10, ...wave3, ...wave4, ...c12 /* C12 */, ...wave5, ...w1, ...w3, ...w4, ...w7, ...wave7, ...r0, ...r2, ...r3, 'mods-surface-sitting', 'mods-surface-sitting-2-1-287', 'mods-surface-sitting-headers', ...e0a, ...e8, ...e1, ...e3, ...e7, ...e2, ...e4c, ...p2].sort());
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
        expect(result.clientWarnings.map((w) => `${label}: ${w}`)).toEqual((EXPECTED_CLIENT_WARNINGS[label] ?? []).map((w) => `${label}: ${w}`));
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
      'informational', 'notification', // W1: pass3/hooks-blocking (a blocked prompt's informational, the stop-hook-error notification)
      'compact_boundary', // W1: pass3/compact
      'ui_log', 'ui_status', 'ui_toast', 'ui_invalidate', // R0: pass3/mods-* on 2.1.287, the remote-surface pushes (R1 maps them to plugin.*)
      'ui_panes', 'ui_scroll', 'ui_focus', // R2: pass3/mods-surface-*, the attached surface's pushes
      'control_request_progress', // E0a: pass3/p1-side-question-session, the side question's `started` progress (E3: journaled, no event)
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
      'boundary.compaction', // W1: pass3/compact seq 43
      'session.reconnect', // P2-C U2 (2026-10-09): pass3/p2-to-human-* resumes under --system-prompt-snapshot off reconnect to the host
      'plugin.log', 'plugin.status', 'plugin.toast', 'plugin.invalidate', // R1: pass3/mods-* (no fixture carries a plugin load error or warning)
      'plugin.panes', 'plugin.scroll', 'plugin.focus', 'plugin.ask', // R2: pass3/mods-surface-*
      // E1 M2: pass3/p1-maws-*; maws.ask.cancelled from E11 S1's pass3/p1-maws-ask-interrupt (the engine's
      // notifications/cancelled withdrawing a blocking ask; the `exit` reason stays pinned over a scripted session in
      // session-maws.test.ts)
      'maws.ask.opened', 'maws.ask.answered', 'maws.ask.cancelled', 'maws.delivery.file', 'maws.pane.shown',
      'peer.message', // E7 M1: pass3/e7-peer-a and e7-peer-b (no pass journal carries an in-process agent's message: subagent.message is pinned over test/fixtures/engine/handback-pointer in normalizer.test.ts)
      // E2 start: M2's pass3/p1-maws-artifacts (a create and an update)
      'maws.delivery.artifact',
      // E2 end
      // E4c start: M4's pass3/p1-maws-browser (open, two snapshots, two fills, a click, a screenshot)
      'maws.browser.action',
      // E4c end
      // P2-C start (2026-10-09): the queue's recorded `release` rows (pass3/steer-next and the other C3/W1 live records)
      'queue.transition',
      // P2-C end
    ].sort());
    void kinds;
  });
});

// R2 (charter D-9 as amended 2026-10-01): the attached desktop surface on the installed 2.1.287 (pass3/mods-surface-*,
// findings-pass3-agent-work.md, R2 section): the pushes and the engine's requests as X1, every ui_* answer typed.
describe('normaliser: the attached surface (R2, pass3/mods-surface-*)', () => {
  it('render-sites: the roster on attach (push and read) is empty, the pane opened at turn.complete arrives after the result, and every render answer parses', async () => {
    const { events, requests } = await run('pass3', 'mods-surface-render-sites');
    const panes = ofKind(events, 'plugin.panes');
    expect(panes.map((e) => e.panes.map((p) => p.id))).toEqual([[], [], ['mods-probe-pane']]);
    expect(panes.at(-1)).toMatchObject({ shownId: 'mods-probe-pane', focusedId: null, focusRequestedId: null, panes: [{ title: 'Probe pane', plugin: 'mods-probe', closeOnEscape: false, holdToasts: false }] });
    expect(seq(panes.at(-1))).toBeGreaterThan(seq(ofKind(events, 'turn.ended')[0]));
    const renders = requests.filter((r) => r.subtype === 'ui_render');
    expect(renders.map((r) => (r.response as { hooked?: boolean }).hooked)).toEqual([true, true, true, true, true]);
    expect(requests.filter((r) => r.subtype.startsWith('ui_')).every((r) => r.ok)).toBe(true);
  });

  it('press-input-select: presses, inputs and picks change nothing in the graph but the plugin lines and the invalidates they cause', async () => {
    const { events, requests } = await run('pass3', 'mods-surface-press-input-select');
    expect(ofKind(events, 'plugin.invalidate')).toHaveLength(3);
    expect(ofKind(events, 'plugin.log').map((e) => e.text)).toEqual(expect.arrayContaining(['MODS_PROBE_PRESS 1', 'MODS_PROBE_INPUT hel', 'MODS_PROBE_SUBMIT hello', 'MODS_PROBE_SELECT two']));
    expect(requests.filter((r) => r.subtype === 'ui_select').map((r) => r.response)).toMatchObject([{ handled: true, element: 'pick', value: 'two' }, { handled: false }]);
  });

  it('panes: the focus ring and the window moves a plugin made, and the roster through show, focus and close', async () => {
    const { events } = await run('pass3', 'mods-surface-panes');
    expect(ofKind(events, 'plugin.focus').map(({ component, instanceId, plugin, key }) => ({ component, instanceId, plugin, key }))).toEqual([{ component: 'Pane', instanceId: 'mods-probe-pane', plugin: 'mods-probe', key: 'pick' }]);
    expect(ofKind(events, 'plugin.scroll').map(({ offset, followEnd }) => ({ offset, followEnd }))).toEqual([{ offset: 16, followEnd: false }, { offset: 16, followEnd: true }]);
    expect(ofKind(events, 'plugin.panes').map((e) => [e.panes.length, e.focusedId])).toEqual([[0, null], [0, null], [1, null], [1, null], [1, 'mods-probe-pane'], [1, null], [0, null]]);
  });

  it('prompt-access and copy: each request the engine sent the surface is one plugin.ask, in order, with what it carries', async () => {
    const prompt = await run('pass3', 'mods-surface-prompt-access');
    expect(ofKind(prompt.events, 'plugin.ask').map(({ ask, text, mode, plugin }) => ({ ask, text, mode, plugin }))).toEqual([
      { ask: 'prompt_read', text: null, mode: null, plugin: null },
      { ask: 'prompt_fill', text: 'MODS_PROBE_FILL', mode: 'replace', plugin: null },
      { ask: 'prompt_read', text: null, mode: null, plugin: null }, // the read that completes the fill
      { ask: 'prompt_suggest', text: 'MODS_PROBE_SUGGEST', mode: null, plugin: null },
    ]);
    const copy = await run('pass3', 'mods-surface-copy');
    expect(ofKind(copy.events, 'plugin.ask').map(({ ask, text, plugin }) => ({ ask, text, plugin }))).toEqual([{ ask: 'copy', text: 'MODS_PROBE_COPY', plugin: 'mods-probe' }]);
  });
});

// R3 wire characterization: installed-engine answers, not synthesized responses. The worker's unchanged next(e)
// still carries ref 1 and rewritten:true; only the mod-free run is hooked:false.
describe('normaliser: transcript surface recordings (R3)', () => {
  interface RecordedNode { type?: string; ref?: number; props?: Record<string, unknown>; children?: unknown[] }
  const nodesOf = (tree: unknown): RecordedNode[] => {
    if (typeof tree !== 'object' || tree === null) return [];
    const node = tree as RecordedNode;
    return [node, ...(node.children ?? []).flatMap(nodesOf)];
  };
  const refs = (tree: unknown) => nodesOf(tree).filter((node) => node.type === 'engine').map((node) => node.ref);
  const markdownBodies = (tree: unknown) => nodesOf(tree).filter((node) => node.type === 'Markdown').map((node) => node.props?.['text']);
  const rewrittenProps: Record<string, Record<string, unknown>> = {
    'user-message': { text: 'R3 rewritten text' },
    'assistant-message': { text: 'R3 rewritten text' },
    'command-output': { text: 'R3 rewritten text' },
    'tool-use': { input: { command: 'printf rewritten' } },
    'tool-result': { output: { stdout: 'R3 rewritten output', stderr: '', interrupted: false } },
    'tool-group': { isExpanded: true },
    'ask-user-question': { questions: [{ question: 'R3 rewritten question', header: 'Path', options: [{ label: 'One', description: 'First path' }, { label: 'Two', description: 'Second path' }], multiSelect: false }] },
  };
  for (const site of ['user-message', 'assistant-message', 'command-output', 'tool-use', 'tool-result', 'tool-group', 'ask-user-question']) {
    it(`${site}: preserves each recorded tree and rewrite without creating a model turn`, async () => {
      const { events, requests } = await run('pass3', `mods-surface-transcript-${site}`);
      const draws = requests.filter((r) => r.subtype === 'ui_render').map((r) => UiRenderResponseSchema.parse(r.response));
      expect(draws).toHaveLength(6);
      expect(draws.every((r) => r.hooked)).toBe(true);
      expect(draws[0]).toMatchObject({ tree: { type: 'Box', children: [{ type: 'Text' }, { type: 'engine', ref: 1 }] }, rewritten: true });
      expect(draws[1]).toMatchObject({ tree: site === 'ask-user-question' ? { type: 'engine', ref: 0 } : { type: 'Text' }, rewritten: false });
      expect(draws[2]).toMatchObject({ tree: { type: 'engine', ref: 1 }, rewritten: true });
      // A successful unchanged next(e) also reports rewritten:true: pin the actual changed member in both forms.
      for (const draw of [draws[0], draws[2]]) expect(draw?.props).toMatchObject(rewrittenProps[site]!);
      if (site === 'user-message') expect(draws[1]?.props?.['origin']).toEqual({ kind: 'sdk' });
      expect(draws[3]?.tree).toEqual(site === 'ask-user-question' ? { type: 'engine', ref: 0 } : { type: 'Box' });
      // Invalid rewrites are refused inside next(): native props survive, rather than the bad input.
      expect(draws[4]?.props).toEqual(draws[1]?.props);
      expect(draws[5]?.props).toEqual(draws[1]?.props);
      expect(ofKind(events, 'turn.started')).toEqual([]);
      expect(ofKind(events, 'user.message')).toEqual([]);
      expect(requests.every((r) => r.ok)).toBe(true);
    });
  }

  it('unhooked: all seven sites retain native ref zero and unchanged props', async () => {
    const { requests } = await run('pass3', 'mods-surface-transcript-unhooked');
    const draws = requests.filter((r) => r.subtype === 'ui_render').map((r) => UiRenderResponseSchema.parse(r.response));
    expect(draws).toHaveLength(7);
    for (const draw of draws) expect(draw).toMatchObject({ tree: { type: 'engine', ref: 0 }, hooked: false, rewritten: false });
    expect(draws[0]?.props?.['origin']).toEqual({ kind: 'sdk' });
  });

  it('owner to-human: preserves every Markdown span and unchanged folded props, and answers a draft fill without submitting', async () => {
    const { events, requests } = await run('pass3', 'mods-surface-transcript-to-human');
    const renderRequests = requests.filter((r) => r.subtype === 'ui_render');
    const draws = renderRequests.map((r) => UiRenderResponseSchema.parse(r.response));
    expect(draws).toHaveLength(14);
    const first = draws[0]!;
    expect(first).toMatchObject({ props: { text: ownerMarkedText, isFirstOfReply: true }, rewritten: false, hooked: true });
    expect(refs(first.tree)).toEqual([]);
    expect(markdownBodies(first.tree)).toEqual(['First **span**.', 'Second span.', 'Which path?']);
    expect(nodesOf(first.tree).filter((node) => node.type === 'Text').map((node) => node.children?.join('').trim())).toEqual(['● to human', 'essential', 'need input']);
    expect(nodesOf(first.tree).filter((node) => node.type === 'Button').map((node) => node.props?.['label'])).toEqual(['1: One ★', '2: Two', 'reply…', 'working record']);
    expect(ofKind(events, 'plugin.ask').map(({ ask, text, mode }) => ({ ask, text, mode }))).toEqual([
      { ask: 'prompt_read', text: null, mode: null },
      { ask: 'prompt_fill', text: 'Answering "Which path?": One', mode: 'replace' },
      { ask: 'prompt_read', text: null, mode: null },
    ]);
    for (const draw of draws.slice(1, 4)) expect(draw).toMatchObject({ tree: { type: 'Box' }, rewritten: false, hooked: true });
    for (const draw of draws.slice(1, 4)) expect(refs(draw.tree)).toEqual([]);
    expect(draws[1]?.props).toEqual({ text: 'Private follow-up record.', isFirstOfReply: false });
    expect(draws[4]).toMatchObject({ tree: { type: 'engine', ref: 0 }, rewritten: false, hooked: false, props: { tool: 'AskUserQuestion' } });
    expect(draws[5]?.props?.['text']).toContain('Private working notes.');
    expect(draws[6]?.props).toEqual({ text: 'Private follow-up record.', isFirstOfReply: false });
    for (const draw of draws.slice(5, 9)) expect(refs(draw.tree)).toEqual([1]);
    const presses = requests.filter((r) => r.subtype === 'ui_press');
    const invalidates = ofKind(events, 'plugin.invalidate');
    expect(invalidates.some((e) => e.seq !== null && e.seq < presses[0]!.seq)).toBe(true);
    expect(invalidates.some((e) => e.seq !== null && e.seq > presses[1]!.seq && e.seq < renderRequests[5]!.seq)).toBe(true);
    expect(draws[9]).toMatchObject({ tree: { type: 'engine', ref: 1 }, props: { tool: 'AskUserQuestion', output: { answers: { 'Which path?': 'One' } } } });
    // The owner's screenshot form contains two questions, in both tagged and display-hook-header history.
    for (const [folded, unfolded] of [[draws[10]!, draws[11]!], [draws[12]!, draws[13]!]]) {
      expect(folded).toMatchObject({ hooked: true, rewritten: false });
      expect(refs(folded.tree)).toEqual([]);
      expect(markdownBodies(folded.tree)).toEqual(['Here are two questions.', 'Which path?', 'When should it run?']);
      expect(nodesOf(folded.tree).filter((node) => node.type === 'Text').map((node) => node.children?.join('').trim())).toEqual(['● to human', 'need input', 'need input']);
      expect(nodesOf(folded.tree).filter((node) => node.type === 'Button').map((node) => node.props?.['label'])).toEqual(['1: One ★', '2: Two', 'reply…', '1: Now ★', '2: Later', 'reply…', 'working record']);
      expect(unfolded.props).toEqual(folded.props);
      expect(refs(unfolded.tree)).toEqual([1]);
      expect(markdownBodies(unfolded.tree)).toEqual([]);
    }
    expect(ofKind(events, 'turn.started')).toEqual([]);
    expect(ofKind(events, 'user.message')).toEqual([]);
    expect(presses.map((r) => r.response)).toMatchObject([{ handled: true }, { handled: true }, { handled: true }, { handled: true }]);
  });

  for (const fixture of ['mods-surface-sitting', 'mods-surface-sitting-2-1-287', 'mods-surface-sitting-headers']) it(`${fixture}: folded bodies include the question without engine slots or props rewrites`, async () => {
    const { events, requests, rows } = await run('pass3', fixture);
    const asked = new Map(rows.filter((row) => row.direction === 'out' && (row.frame as { request?: { subtype: string } }).request?.subtype === 'ui_render').map((row) => [row.seq, (row.frame as { request: { instance_id: string; props: { text: string; isFirstOfReply: boolean } } }).request]));
    const renders = requests.filter((request) => request.subtype === 'ui_render');
    const rawTexts = new Map(sittingSeed({ repo: '/scratch', engineId: 'conformance-sitting' }).filter((record) => record.type === 'assistant').flatMap((record) => (record.message as { content: { type: string; text?: string }[] }).content.filter((block) => block.type === 'text').map((block) => [record.uuid, block.text!] as const)));
    expect(renders).toHaveLength(fixture.endsWith('headers') ? 12 : 6);
    for (const request of renders) {
      const draw = UiRenderResponseSchema.parse(request.response);
      const input = asked.get(request.seq)!;
      expect(draw).toMatchObject({ hooked: true, rewritten: false, props: input.props });
      expect(refs(draw.tree)).toEqual([]);
      // SGR display headers carry the same spans as the raw seed; plain headers without SGR are deliberately inkless.
      const source = input.props.text.includes('\u001b') ? rawTexts.get(input.instance_id.replace(/^diagnostic:/, ''))! : input.props.text;
      const spans = Array.from(source.matchAll(/<(to-human|need-input)>([\s\S]*?)<\/\1>/g), (match) => match[2].replace(/<choice\b[^>]*>[\s\S]*?<\/choice>/g, '').trim());
      expect(markdownBodies(draw.tree)).toEqual(spans);
      if (source.includes('<need-input>')) {
        expect(spans.at(-1)).toBe('What next?');
        expect(nodesOf(draw.tree).filter((node) => node.type === 'Button')).toHaveLength(4); // three choices and reply
      }
    }
    expect(ofKind(events, 'turn.started')).toEqual([]);
    expect(ofKind(events, 'user.message')).toEqual([]);
  });
});

// E1 (E1 execution document, M1): the SDK MCP round trip maps. The handshake and the tool list are protocol (no event),
// another server's traffic is not unknown, and the probe's `echo_file` is no X9 tool, so it yields no `maws.*` event.
describe('normaliser: the maws server traffic (E1, pass3/p1-sdk-mcp-roundtrip)', () => {
  it('maps every mcp_message without an unknown frame or an event of its own', async () => {
    const { events, rows } = await run('pass3', 'p1-sdk-mcp-roundtrip');
    const mcp = rows.filter((r) => r.direction === 'in' && (r.frame as { request?: { subtype?: string } }).request?.subtype === 'mcp_message');
    expect(mcp.length).toBeGreaterThan(10); // the handshakes of maws and maws2, the re-lists and three calls
    expect(ofKind(events, 'frame.unknown')).toEqual([]);
    expect(events.filter((e) => e.kind.startsWith('maws.'))).toEqual([]);
    expect(events.filter((e) => mcp.some((r) => r.seq === e.seq))).toEqual([]);
  });
});

// E2 start: M0's probe (E2 execution document, M0; spikes/protocol-probe/findings-pass3-e2-deliverables.txt). The probe's
// `red_square` is no X9 tool, so its call yields no `maws.*` event; the tool_result carrying an image block maps as any
// tool result does.
describe('normaliser: an SDK server image block (E2 M0, pass3/p1-sdk-mcp-image)', () => {
  it('maps the image-carrying tool result with no unknown frame and no maws event', async () => {
    const { events, rows } = await run('pass3', 'p1-sdk-mcp-image');
    const mcp = rows.filter((r) => r.direction === 'in' && (r.frame as { request?: { subtype?: string } }).request?.subtype === 'mcp_message');
    expect(mcp.length).toBeGreaterThan(2); // the handshake, the list and the call
    expect(ofKind(events, 'frame.unknown')).toEqual([]);
    expect(events.filter((e) => e.kind.startsWith('maws.'))).toEqual([]);
    expect(events.filter((e) => mcp.some((r) => r.seq === e.seq))).toEqual([]);
    // the result keeps the image block, the engine's "[Image: source: <saved original>]" text right after it, then the
    // server's own text: a reader of a maws result's JSON must not assume it is the first or the only text block
    const use = ofKind(events, 'tool.use').find((e) => e.toolName === 'mcp__maws__red_square')!;
    const [result, ...more] = ofKind(events, 'tool.result').filter((e) => e.toolUseId === use.toolUseId);
    expect(more).toEqual([]);
    expect(result.isError).toBe(false);
    const blocks = result.content as { type: string; text?: string; source?: { media_type?: string } }[];
    expect(blocks.map((b) => b.type)).toEqual(['image', 'text', 'text']);
    expect(blocks[0].source?.media_type).toBe('image/png');
    expect(blocks[1].text).toMatch(/^\[Image: source: \/.*\/tool-results\/mcp-maws-blob-[^/]+\.png\]$/);
    expect(blocks[2].text).toBe('the picture');
  });
});

// M2's live recording (E2 execution document, M2; test/live/maws-artifacts.live.test.ts): the four artifact tools through
// MAWS's own host on the installed engine, the capture answered with a green 64×64 square. The generic case above admits
// it (no unknown frame, no request failure); these pin what the tool server's traffic yields.
describe('normaliser: the artifact tools recorded live (E2 M2, pass3/p1-maws-artifacts)', () => {
  type Block = { type: string; text?: string; data?: string; mimeType?: string; source?: { media_type?: string } };
  const callsOf = (rows: { seq: number; direction: string; frame: unknown }[], name: string) =>
    rows.filter((r) => r.direction === 'in' && (r.frame as { request?: { subtype?: string; message?: { method?: string; params?: { name?: string } } } }).request?.message?.params?.name === name).map((r) => ({ seq: r.seq, requestId: (r.frame as { request_id: string }).request_id }));
  const answerOf = (rows: { direction: string; frame: unknown }[], requestId: string) =>
    (rows.find((r) => r.direction === 'out' && (r.frame as { type?: string; response?: { request_id?: string } }).type === 'control_response' && (r.frame as { response: { request_id: string } }).response.request_id === requestId)?.frame as
      | { response: { response: { mcp_response: { jsonrpc: string; id: number; result: { content: Block[]; isError?: boolean } } } } }
      | undefined)?.response.response.mcp_response;
  const resultJson = (content: Block[]) => JSON.parse(content.find((b) => b.type === 'text')!.text!) as unknown;

  it('two maws.delivery.artifact events in order, create v1 then update v2, each at its admitted answer', async () => {
    const { events, rows } = await run('pass3', 'p1-maws-artifacts');
    const artifacts = ofKind(events, 'maws.delivery.artifact');
    expect(artifacts.map((e) => [e.action, e.artifactId, e.version, e.title])).toEqual([['create', 'dash', 1, 'Dashboard'], ['update', 'dash', 2, 'Dashboard']]);
    expect(seq(artifacts[0])).toBeLessThan(seq(artifacts[1]));
    expect(artifacts[1]!.deliverableId).toBe(artifacts[0]!.deliverableId);
    const [create] = callsOf(rows, 'artifact_create');
    const [update] = callsOf(rows, 'artifact_update');
    expect([artifacts[0]!.requestId, artifacts[1]!.requestId]).toEqual([create!.requestId, update!.requestId]);
    expect(ArtifactCreateResultSchema.parse(resultJson(answerOf(rows, create!.requestId)!.result.content))).toMatchObject({ status: 'created', id: 'dash', deliverableId: artifacts[0]!.deliverableId, version: 1 });
    expect(ArtifactUpdateResultSchema.parse(resultJson(answerOf(rows, update!.requestId)!.result.content))).toMatchObject({ status: 'updated', id: 'dash', version: 2 });
    for (const e of artifacts) expect(ofKind(events, 'tool.use').find((u) => u.toolUseId === e.toolUseId)?.toolName).toBe(e.action === 'create' ? 'mcp__maws__artifact_create' : 'mcp__maws__artifact_update');
    const [list] = callsOf(rows, 'artifact_list');
    expect(ArtifactListResultSchema.parse(resultJson(answerOf(rows, list!.requestId)!.result.content)).artifacts).toMatchObject([{ id: 'dash', deliverableId: artifacts[0]!.deliverableId, title: 'Dashboard', versions: 2 }]);
  });

  it("the screenshot answer is an image block then the result's JSON; the engine's tool_result inserts its pointer text between them", async () => {
    const { events, rows } = await run('pass3', 'p1-maws-artifacts');
    const [shot, ...more] = callsOf(rows, 'artifact_screenshot');
    expect(more).toEqual([]);
    const answer = answerOf(rows, shot!.requestId)!;
    expect(Object.keys(answer)).toEqual(['jsonrpc', 'id', 'result']); // the order the engine's echo reproduces
    expect(answer.result.isError).toBeUndefined();
    expect(answer.result.content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(answer.result.content[0]).toMatchObject({ mimeType: 'image/png' });
    expect(Buffer.from(answer.result.content[0]!.data!, 'base64').subarray(1, 4).toString('latin1')).toBe('PNG');
    const parsed = ArtifactScreenshotResultSchema.parse(JSON.parse(answer.result.content[1]!.text!));
    expect(parsed).toMatchObject({ status: 'captured', id: 'dash', title: 'Dashboard', version: 1, width: 64, height: 64, consoleErrors: [] });
    // no X1 event for a screenshot (Decision Log 10); the model's result as the engine delivered it
    const use = ofKind(events, 'tool.use').find((e) => e.toolName === 'mcp__maws__artifact_screenshot')!;
    const [result] = ofKind(events, 'tool.result').filter((e) => e.toolUseId === use.toolUseId);
    const blocks = result!.content as Block[];
    expect(blocks.map((b) => b.type)).toEqual(['image', 'text', 'text']);
    expect(blocks[0]!.source?.media_type).toBe('image/png');
    expect(blocks[1]!.text).toMatch(/^\[Image: source: \/.*\/tool-results\/mcp-maws-blob-[^/]+\.png\]$/);
    expect(ArtifactScreenshotResultSchema.parse(JSON.parse(blocks[2]!.text!))).toEqual(parsed);
  });

  it('the refused update is one isError tool.result with the exact text, and no event', async () => {
    const { events, rows } = await run('pass3', 'p1-maws-artifacts');
    const updates = callsOf(rows, 'artifact_update');
    expect(updates).toHaveLength(2);
    const refusedAnswer = answerOf(rows, updates[1]!.requestId)!;
    expect(refusedAnswer.result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.noArtifact('artifact_update', 'nope') }], isError: true });
    const errors = ofKind(events, 'tool.result').filter((e) => e.isError && ofKind(events, 'tool.use').find((u) => u.toolUseId === e.toolUseId)?.toolName.startsWith('mcp__maws__artifact_'));
    expect(errors).toHaveLength(1);
    expect(text(errors[0]!.content)).toBe(TOOL_ERRORS.noArtifact('artifact_update', 'nope')); // seq 418 carries exactly it
    expect(events.filter((e) => e.kind.startsWith('maws.') && (e as { requestId?: string }).requestId === updates[1]!.requestId)).toEqual([]);
  });
});
// E2 end

// E1 M2 (E1 execution document, M2 "Conformance"): the four tools recorded live through MAWS's own host on the installed
// engine. Each fixture normalises with no unknown frame and no request failure (the generic case above); these pin what
// the tool server's traffic yields.
describe('normaliser: the maws tools recorded live (E1 M2, pass3/p1-maws-*)', () => {
  const mcpResponseOf = (rows: { direction: string; frame: unknown }[], requestId: string) =>
    (rows.find((r) => r.direction === 'out' && (r.frame as { type?: string; response?: { request_id?: string } }).type === 'control_response' && (r.frame as { response: { request_id: string } }).response.request_id === requestId)?.frame as
      | { response: { response: { mcp_response: { result: { content: { text: string }[]; isError?: boolean } } } } }
      | undefined)?.response.response.mcp_response;

  it('p1-maws-send-file: one maws.delivery.file for hello.txt with its caption, at the host answer', async () => {
    const { events, rows } = await run('pass3', 'p1-maws-send-file');
    const [delivery, ...more] = ofKind(events, 'maws.delivery.file');
    expect(more).toEqual([]);
    expect(delivery).toMatchObject({ caption: 'the greeting', urgency: 'normal' });
    expect(delivery!.deliverables.map((d) => d.name)).toEqual(['hello.txt']);
    expect(JSON.parse(mcpResponseOf(rows, delivery!.requestId)!.result.content[0]!.text)).toEqual({ status: 'delivered', deliverables: delivery!.deliverables });
    expect(ofKind(events, 'tool.use').find((e) => e.toolUseId === delivery!.toolUseId)?.toolName).toBe('mcp__maws__send_file');
  });

  it('p1-maws-ask-blocking: opened precedes answered, and the response row reads as the AskResult', async () => {
    const { events, rows } = await run('pass3', 'p1-maws-ask-blocking');
    const [opened, ...moreOpened] = ofKind(events, 'maws.ask.opened');
    const [answered, ...moreAnswered] = ofKind(events, 'maws.ask.answered');
    expect([moreOpened, moreAnswered]).toEqual([[], []]);
    expect(opened).toMatchObject({ blocking: true, askId: opened!.toolUseId });
    expect(opened!.questions.map((q) => [q.id, q.modality])).toEqual([['q1', 'choice'], ['q2', 'choice'], ['q3', 'text'], ['q4', 'folder'], ['q5', 'repository']]);
    expect(answered).toMatchObject({ askId: opened!.askId, delivery: 'result' });
    expect(answered!.answers.map((a) => [a.id, a.status])).toEqual([['q1', 'answered'], ['q2', 'answered'], ['q3', 'skipped'], ['q4', 'answered'], ['q5', 'decide_for_me']]);
    expect(seq(opened)).toBeLessThan(seq(answered));
    const result = AskResultSchema.parse(JSON.parse(mcpResponseOf(rows, opened!.requestId)!.result.content[0]!.text));
    expect(result).toEqual({ status: 'answered', askId: opened!.askId, answers: answered!.answers });
  });

  it('p1-maws-ask-async: acknowledged as asked, answered by delivery steer beside the steer row', async () => {
    const { events, rows } = await run('pass3', 'p1-maws-ask-async');
    const [opened] = ofKind(events, 'maws.ask.opened');
    const [answered, ...more] = ofKind(events, 'maws.ask.answered');
    expect(more).toEqual([]);
    expect(opened).toMatchObject({ blocking: false });
    expect(AskResultSchema.parse(JSON.parse(mcpResponseOf(rows, opened!.requestId)!.result.content[0]!.text))).toEqual({ status: 'asked', askId: opened!.askId });
    expect(answered).toMatchObject({ askId: opened!.askId, delivery: 'steer', answers: [{ id: 'q1', status: 'answered', value: ['Yes'] }] });
    const steer = rows.find((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'user' && text((r.frame as { message: { content: unknown } }).message.content).startsWith(`[MAWS ask ${opened!.askId}]`))!;
    expect((steer.frame as { priority?: string }).priority).toBe('next');
    expect(parseAskSteer(text((steer.frame as { message: { content: unknown } }).message.content))?.result.answers).toEqual(answered!.answers);
    // the meta row is journaled once the steer's write settled: after the steer row, possibly after frames held meanwhile
    expect(seq(answered)).toBeGreaterThan(steer.seq);
  });

  it('p1-maws-show-pane: one pane shown opened, one with an error, and the unknown pane only as an error tool.result', async () => {
    const { events } = await run('pass3', 'p1-maws-show-pane');
    expect(ofKind(events, 'maws.pane.shown')).toMatchObject([
      { pane: 'terminal', target: null, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 'terminal:live', title: 'Terminal' }, error: null },
      { pane: 'deliverable', target: 'none', opened: null, error: TOOL_ERRORS.paneUnavailable('deliverable') },
    ]);
    const nope = ofKind(events, 'tool.use').find((e) => e.toolName === 'mcp__maws__show_pane' && (e.input as { pane?: string }).pane === 'nope')!;
    const refused = ofKind(events, 'tool.result').find((e) => e.toolUseId === nope.toolUseId)!;
    expect(refused.isError).toBe(true);
    expect(text(refused.content)).toContain(TOOL_ERRORS.unknownPane('nope'));
  });

  // E11 S1 (E11 execution document, Design §5 S1, Task 6.2): the interrupt while the blocking ask waited, on 2.1.293.
  it('p1-maws-ask-interrupt: the engine cancels the tools/call by its JSON-RPC id, the host withdraws the ask and writes it no result', async () => {
    const { events, rows } = await run('pass3', 'p1-maws-ask-interrupt');
    const [opened, ...moreOpened] = ofKind(events, 'maws.ask.opened');
    const [cancelled, ...moreCancelled] = ofKind(events, 'maws.ask.cancelled');
    expect([moreOpened, moreCancelled, ofKind(events, 'maws.ask.answered')]).toEqual([[], [], []]);
    expect(opened).toMatchObject({ blocking: true, askId: opened!.toolUseId });
    type Mcp = { type?: string; request_id?: string; request?: { subtype?: string; server_name?: string; message?: { id?: unknown; method?: string; params?: { requestId?: unknown } } } };
    const mcp = (r: { frame: unknown }) => r.frame as Mcp;
    const call = rows.find((r) => r.direction === 'in' && mcp(r).request_id === opened!.requestId)!;
    expect(mcp(call).request?.message?.method).toBe('tools/call');
    const notices = rows.filter((r) => r.direction === 'in' && mcp(r).request?.subtype === 'mcp_message' && mcp(r).request?.message?.method === 'notifications/cancelled');
    expect(notices.map((r) => [mcp(r).request?.server_name, mcp(r).request?.message?.params?.requestId])).toEqual([['maws', mcp(call).request?.message?.id]]);
    // the cancel row, then the event: reason withdrawn, after the notice and before the host's answer to it
    const meta = rows.find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'maws_ask_cancelled')!;
    expect(meta.frame).toEqual({ event: 'maws_ask_cancelled', askId: opened!.askId, toolUseId: opened!.toolUseId, reason: 'withdrawn' });
    expect(cancelled).toMatchObject({ askId: opened!.askId, toolUseId: opened!.toolUseId, reason: 'withdrawn' });
    expect(seq(cancelled)).toBe(meta.seq);
    expect(notices[0]!.seq).toBeLessThan(meta.seq);
    expect(mcpResponseOf(rows, opened!.requestId)).toBeUndefined(); // no result written for the cancelled call
    const answer = rows.find((r) => r.direction === 'out' && (r.frame as { response?: { request_id?: string } }).response?.request_id === mcp(notices[0]!).request_id)!;
    expect((answer.frame as { response: { response: unknown } }).response.response).toEqual({ mcp_response: { jsonrpc: '2.0', result: {}, id: 0 } });
    expect(ofKind(events, 'turn.ended').some((e) => e.parentToolUseId === null && !e.isEchoReceipt)).toBe(true);
  });
});

// E3 (E3 execution document, M1): the side question's wire as 2.1.290 answered it, idle, with history, and mid-turn.
describe('normaliser: side questions (E3, pass3/p1-side-question-session)', () => {
  it('parses the three answers as `{response, synthetic}`, sends history as recorded, and maps the progress frame to no event', async () => {
    const { events, requests } = await run('pass3', 'p1-side-question-session');
    const asked = requests.filter((r) => r.subtype === 'side_question');
    expect(asked.map((r) => [r.seq, r.ok, r.response])).toEqual([
      [88, true, { response: 'ZEBRA', synthetic: false }],
      [95, true, { response: 'zebra', synthetic: false }],
      [128, true, { response: 'ZEBRA', synthetic: false }],
    ]);
    const history = loadJournal('pass3', 'p1-side-question-session').find((row) => row.seq === 95)!.frame as { request: { history: unknown } };
    expect(history.request.history).toEqual([{ question: 'What word did I ask you to remember? Answer with just the word.', response: 'ZEBRA' }]);
    expect(ofKind(events, 'frame.unknown')).toEqual([]);
    expect(events.filter((e) => e.seq === 91 || e.seq === 96 || e.seq === 129)).toEqual([]); // the three `control_request_progress` rows
  });
});

// E4c start (E4c execution document, Acceptance G4; Decision Log 44 (c)): a session MAWS did not launch has no browser
// tools. A launch is MAWS's when its initialize declares the `maws` SDK server; every other recorded launch (the terminal
// arm of C12's probe, every pre-E1 fixture) names no `mcp__maws__browser_*` tool anywhere: not in its init's tool list,
// not in the tools a request to the API carried (the terminal arm's meta rows), not in a call.
describe('G4: no launch MAWS did not make lists a browser tool (E4c)', () => {
  const declaresMaws = (rows: ReturnType<typeof loadJournal>) =>
    rows.some((row) => {
      const request = (row.frame as { type?: unknown; request?: { subtype?: unknown; sdkMcpServers?: unknown } }).request;
      return row.direction === 'out' && request?.subtype === 'initialize' && Array.isArray(request.sdkMcpServers) && request.sdkMcpServers.includes('maws');
    });

  it('every non-MAWS launch fixture names no mcp__maws__browser_* tool, and its init lists none', async () => {
    const outside: string[] = [];
    for (const pass of FIXTURE_PASSES) {
      for (const name of listJournals(pass)) {
        const rows = loadJournal(pass, name);
        if (declaresMaws(rows)) continue;
        outside.push(`${pass}/${name}`);
        expect(JSON.stringify(rows).match(/mcp__maws__browser_[a-z_]*/g), `${pass}/${name}`).toBeNull();
        for (const init of ofKind((await run(pass, name)).events, 'session.init')) expect(init.tools.filter((tool) => tool.startsWith('mcp__maws__browser_')), `${pass}/${name}`).toEqual([]);
      }
    }
    expect(outside).toContain('pass3/launch-env-terminal'); // the terminal arm is among them, so the pin is not vacuous
    expect(outside.length).toBeGreaterThan(100);
  });
});

// M4's live recording (E4c execution document, Design §13, Acceptance G1; test/live/maws-browser.live.test.ts): the
// browser tools through MAWS's own host on the installed engine, main played by the stand-in from the snapshots the real
// app generated. The generic case above admits it; these pin what the browser tools' traffic yields.
describe('normaliser: the browser tools recorded live (E4c M4, pass3/p1-maws-browser)', () => {
  type Block = { type: string; text?: string; data?: string; mimeType?: string; source?: { media_type?: string } };
  const answerOf = (rows: { direction: string; frame: unknown }[], requestId: string) =>
    (rows.find((r) => r.direction === 'out' && (r.frame as { type?: string; response?: { request_id?: string } }).type === 'control_response' && (r.frame as { response: { request_id: string } }).response.request_id === requestId)?.frame as
      | { response: { response: { mcp_response: { result: { content: Block[]; isError?: boolean } } } } }
      | undefined)?.response.response.mcp_response;
  const DONE_URL = 'http://127.0.0.1:17391/done.html?name=Ada+Lovelace&email=ada%40example.test';

  it('seven maws.browser.action events, open to screenshot, each at its admitted answer with no error', async () => {
    const { events, rows } = await run('pass3', 'p1-maws-browser');
    const actions = ofKind(events, 'maws.browser.action');
    expect(actions.map((e) => [e.tool, e.action, e.tabId, e.target, e.error])).toEqual([
      ['browser_tabs', 'open', 'b_000000000001', 'http://127.0.0.1:17391/form.html', null],
      ['browser_snapshot', 'snapshot', 'b_000000000001', null, null],
      ['browser_act', 'fill', 'b_000000000001', 'e7', null],
      ['browser_act', 'fill', 'b_000000000001', 'e10', null],
      ['browser_act', 'click', 'b_000000000001', 'e12', null],
      ['browser_snapshot', 'snapshot', 'b_000000000001', null, null],
      ['browser_screenshot', 'screenshot', 'b_000000000001', 'page', null],
    ]);
    expect(actions.map((e) => [e.url, e.ms])).toEqual([
      ['http://127.0.0.1:17391/form.html', 120], ['http://127.0.0.1:17391/form.html', 60], ['http://127.0.0.1:17391/form.html', 40], ['http://127.0.0.1:17391/form.html', 40],
      [DONE_URL, 40], [DONE_URL, 60], [DONE_URL, 80],
    ]);
    expect(actions.map((e) => e.deliverableId === null)).toEqual([true, true, true, true, true, true, false]);
    for (const e of actions) {
      const use = ofKind(events, 'tool.use').find((u) => u.toolUseId === e.toolUseId);
      expect(use?.toolName).toBe(`mcp__maws__${e.tool}`);
      expect(seq(e)).toBeGreaterThan(seq(use));
      expect(answerOf(rows, e.requestId)!.result.isError).toBeUndefined();
    }
  });

  it('a snapshot answers the JSON header then the page text; the screenshot an image then its JSON, with the engine’s pointer text between in the tool_result', async () => {
    const { events, rows } = await run('pass3', 'p1-maws-browser');
    const actions = ofKind(events, 'maws.browser.action');
    const snapshots = actions.filter((e) => e.action === 'snapshot').map((e) => answerOf(rows, e.requestId)!.result.content);
    expect(snapshots.map((content) => content.map((b) => b.type))).toEqual([['text', 'text'], ['text', 'text']]);
    expect(snapshots[0]![1]!.text).toContain('button "Submit" [disabled] [ref=e12]');
    expect(snapshots[1]![1]!.text).toContain('Your reference is MAWS-7731.');
    const shot = actions.at(-1)!;
    const answer = answerOf(rows, shot.requestId)!;
    expect(answer.result.content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(Buffer.from(answer.result.content[0]!.data!, 'base64').subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(JSON.parse(answer.result.content[1]!.text!)).toMatchObject({ status: 'ok', url: DONE_URL, deliverableId: shot.deliverableId, width: 64, height: 64, mimeType: 'image/png', target: null, fullPage: false });
    const [result] = ofKind(events, 'tool.result').filter((e) => e.toolUseId === shot.toolUseId);
    const blocks = result!.content as Block[];
    expect(blocks.map((b) => b.type)).toEqual(['image', 'text', 'text']);
    expect(blocks[1]!.text).toMatch(/^\[Image: source: \/.*\/tool-results\/mcp-maws-blob-[^/]+\.png\]$/);
    // the model read the page: its one-line reply names the reference and the picture
    expect(ofKind(events, 'turn.ended').at(-1)?.resultText).toMatch(/MAWS-7731.*image/i);
  });
});
// E4c end
