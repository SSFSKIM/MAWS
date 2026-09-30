import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { applyStatusToDigest, costLedger, emptyDigest, foldDigest, foldEvents } from './digest';
import { status } from '../../../test/support/builders'; // C12
import { ev } from '../../../test/support/events';
import { framesOf, loadJournal } from '../../../test/support/fixtures';
import { Normalizer } from '../../engine-host/normalizer'; // C12

const APP = 'app-1' as AppSessionId;
const CHILD = { agentId: 'agent-a', parentToolUseId: 'toolu_parent' };
const run = (events: SessionEvent[], from = emptyDigest(APP)) => events.reduce(foldDigest, from);

const parentTurn = [
  ev('turn.started', { at: '2026-09-28T10:00:00Z' }),
  ev('tool.use', { toolName: 'Bash', input: { command: 'git status' } }),
  ev('tool.result', {}),
  ev('assistant.block.complete', { block: { type: 'text', text: 'Done.\nMore' } }),
];
const parentEnd = ev('turn.ended', { costUsd: 0.12, at: '2026-09-28T10:01:00Z' });

describe('digest fold', () => {
  it('folds a parent turn to idle with its last line and cost', () => {
    const digest = run([...parentTurn, parentEnd]);
    expect(digest).toMatchObject({
      phase: 'idle',
      activity: null,
      lastAssistantLine: 'Done.',
      turnStartedAt: '2026-09-28T10:00:00Z',
      lastTurnEndedAt: '2026-09-28T10:01:00Z',
      cost: { totalUsd: 0.12 },
    });
  });

  it('describes what a working session is doing', () => {
    const at = (event: SessionEvent) => run([ev('turn.started', {}), event]).activity;
    expect(run([ev('turn.started', {})])).toMatchObject({ phase: 'working', activity: 'Thinking' });
    expect(at(ev('tool.use', { toolName: 'Bash', input: { command: `bun test ${'x'.repeat(80)}` } }))).toBe(`Running bun test ${'x'.repeat(51)}`);
    expect(at(ev('tool.use', { toolName: 'Edit', input: { file_path: '/r/src/app.ts' } }))).toBe('Editing app.ts');
    expect(at(ev('tool.use', { toolName: 'Read', input: { file_path: '/r/docs/charter.md' } }))).toBe('Reading charter.md');
    expect(at(ev('tool.use', { toolName: 'Grep', input: { pattern: 'x' } }))).toBe('Searching');
    expect(at(ev('tool.use', { toolName: 'WebFetch', input: { url: 'https://example.com/a' } }))).toBe('Fetching example.com');
    expect(at(ev('tool.use', { toolName: 'mcp__x__y', input: {} }))).toBe('Running mcp__x__y');
    expect(at(ev('tool.result', {}))).toBe('Working');
    expect(at(ev('boundary.compaction', {}))).toBe('Compacting');
    expect(at(ev('session.reconnect', { phase: 'attempting' }))).toBe('Reconnecting');
  });

  it('follows session.state and pending requests', () => {
    const waiting = run([ev('turn.started', {}), ev('permission.requested', {}), ev('session.state', { state: 'requires_action' })]);
    expect(waiting).toMatchObject({ phase: 'waiting', pendingRequests: 1 });
    expect(run([ev('permission.resolved', {}), ev('session.state', { state: 'running' })], waiting)).toMatchObject({ phase: 'working', pendingRequests: 0 });
  });

  it('marks a failed turn failed, but not an aborted one', () => {
    expect(run([ev('turn.started', {}), ev('turn.ended', { isError: true, terminalReason: 'max_turns' })]).phase).toBe('failed');
    expect(run([ev('turn.started', {}), ev('turn.ended', { isError: true, terminalReason: 'aborted_streaming' })]).phase).toBe('idle');
  });

  // Debt wave 5 (C5 · C6): an interrupt while a tool runs ends the turn `error_during_execution` with `aborted_tools`
  // (pass2/per-task-stop-off.jsonl: the foreground `sleep 20` interrupted at seq 67, its result at seq 72), which is the
  // human's stop, not a failure: the row and tab read idle, as the transcript's divider reads Stopped.
  it('an interrupt during a tool (the recorded aborted_tools result) reads idle, not failed', () => {
    const normalizer = new Normalizer({ appSessionId: APP, launchId: 'LAUNCH01', sessionId: null });
    const events = loadJournal('pass2', 'per-task-stop-off').filter((row) => row.seq <= 72).flatMap((row) => normalizer.push(row));
    const ended = events.findLast((e) => e.kind === 'turn.ended');
    expect(ended).toMatchObject({ isError: true, terminalReason: 'aborted_tools' });
    expect(run(events).phase).toBe('idle');
  });

  // C12 start: the engine's state frames, which X6 turns on from C12 M5 (CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS), read
  // honestly beside the turn's own events (pass3/launch-env-state-events.jsonl: running, requires_action with its
  // can_use_tool, running, the result, then idle).
  it('with the recorded state frames, a turn with a permission reads working, waiting, working, then idle, then exited at the end_session', () => {
    const normalizer = new Normalizer({ appSessionId: APP, launchId: 'LAUNCH01', sessionId: null });
    const events = loadJournal('pass3', 'launch-env-state-events').flatMap((row) => normalizer.push(row));
    expect(events.filter((e) => e.kind === 'session.state').map((e) => (e as Extract<SessionEvent, { kind: 'session.state' }>).state)).toEqual(['running', 'requires_action', 'running', 'idle']);
    const phases: string[] = [];
    events.reduce((d, e) => {
      const next = foldDigest(d, e);
      if (phases.at(-1) !== next.phase) phases.push(next.phase);
      return next;
    }, emptyDigest(APP));
    expect(phases).toEqual(['idle', 'working', 'waiting', 'working', 'idle', 'exited']); // the probe ended the process
  });

  it("the engine's idle after a failed turn keeps the failure; its running for the next turn clears it", () => {
    const failed = run([ev('session.state', { state: 'running' }), ev('turn.started', {}), ev('turn.ended', { isError: true, terminalReason: 'max_turns' }), ev('session.state', { state: 'idle' })]);
    expect(failed.phase).toBe('failed');
    expect(run([ev('session.state', { state: 'running' })], failed).phase).toBe('working');
  });
  // C12 end

  it('ends on process exit, failed on a crash', () => {
    expect(run([ev('turn.started', {}), ev('process.exited', { reason: 'quit' })])).toMatchObject({ phase: 'exited', activity: null });
    expect(run([ev('process.exited', { reason: 'crash' })]).phase).toBe('failed');
  });

  it('takes context and cost samples', () => {
    const digest = run([
      ev('context.sample', { totalTokens: 410000, maxTokens: 1000000, percentage: 41, autoCompactThreshold: 950000 }),
      ev('usage.sample', { costUsd: 0.5 }),
    ]);
    expect(digest.context).toEqual({ percent: 41, totalTokens: 410000, maxTokens: 1000000, autoCompactThreshold: 950000 });
    expect(digest.cost?.totalUsd).toBe(0.5);
  });

  it('names no auto-compact threshold when the engine reports autocompact off', () => {
    const off = run([ev('context.sample', { totalTokens: 180000, maxTokens: 200000, percentage: 90, autoCompactThreshold: 167000, isAutoCompactEnabled: false })]);
    expect(off.context).toEqual({ percent: 90, totalTokens: 180000, maxTokens: 200000, autoCompactThreshold: null });
    // and a later sample with it back on names it again
    expect(run([ev('context.sample', { totalTokens: 1, maxTokens: 200000, percentage: 0, autoCompactThreshold: 167000, isAutoCompactEnabled: true })], off).context?.autoCompactThreshold).toBe(167000);
  });

  it('treats the engine’s cost as the process’s running total, not an increment', () => {
    // The probe's results report a cumulative total_cost_usd (pass2/rewind: 0.0555, 0.0614, 0.0674).
    const digest = run([ev('turn.ended', { costUsd: 0.0555 }), ev('turn.ended', { costUsd: 0.0614 }), ev('turn.ended', { costUsd: 0.0674 })]);
    expect(digest.cost?.totalUsd).toBe(0.0674);
  });

  it('keeps a finished process’s cost when a new process restarts its running total at zero', () => {
    const ledger = costLedger(emptyDigest(APP));
    const seen = new Set<string>();
    const totals: number[] = [];
    let digest = emptyDigest(APP);
    for (const batch of [
      [ev('turn.started', {}), ev('turn.ended', { costUsd: 0.3 })],
      [ev('process.exited', { reason: 'quit' })],
      [ev('turn.started', {}), ev('turn.ended', { costUsd: 0.05 })], // the resumed process counts from zero
      [ev('usage.sample', { costUsd: 0.07 })],
    ]) {
      digest = foldEvents(digest, seen, batch, ledger);
      totals.push(digest.cost?.totalUsd ?? 0);
    }
    expect(totals).toEqual([0.3, 0.3, 0.35, 0.37]);
    expect(ledger).toEqual({ finishedUsd: 0.3, restoredUsd: 0, runningUsd: 0.07, awaitingFirst: false });
  });

  // Each journal's result totals as the engine reported them, one process per journal, an exit between processes.
  const processes = (...names: string[]) =>
    names.map((name) => [
      ...framesOf(loadJournal(name.includes('/') ? 'pass2' : 'pass1', name.replace(/^pass2\//, '')), 'in')
        .filter(({ frame }) => (frame as { type?: string }).type === 'result')
        .flatMap(({ seq, frame }) => [ev('turn.started', {}), ev('turn.ended', { seq, costUsd: (frame as { total_cost_usd: number }).total_cost_usd })]),
      ev('process.exited', { reason: 'quit' }),
    ]);
  const costAfterEach = (batches: SessionEvent[][]) => {
    const ledger = costLedger(emptyDigest(APP));
    const seen = new Set<string>();
    let digest = emptyDigest(APP);
    return batches.map((batch) => (digest = foldEvents(digest, seen, batch, ledger)).cost?.totalUsd);
  };

  it('a resumed process’s total continues the restored one, so it replaces the restored part rather than adding to it (resume-fork-*)', () => {
    // resume-fork-start ends at 0.0266824; its two resumes of the same id report 0.0295122 and 0.0322007, each total
    // carrying what the processes before it spent (the engine's modelUsage grows 920 → 930 → 940 input tokens)
    expect(costAfterEach(processes('resume-fork-start', 'resume-fork-no-replay', 'resume-fork-replay'))).toEqual([0.0266824, 0.0295122, 0.0322007].map((usd) => expect.closeTo(usd, 9)));
  });

  it('a resumed process that restored nothing (pass2/resume-live-second, resumed while its holder still ran) counts from zero', () => {
    // the holder ends at 0.061483; the resume's first total, 0.0060484, is its own turn alone (modelUsage 2 input tokens)
    expect(costAfterEach(processes('pass2/resume-live-holder', 'pass2/resume-live-second'))).toEqual([0.061483, 0.061483 + 0.0060484].map((usd) => expect.closeTo(usd, 9)));
  });

  it('a synthesised turn end (C4’s backfill, no accounting on disk) leaves the cost alone', () => {
    const live = run([ev('turn.started', {}), ev('turn.ended', { costUsd: 0.4 })]);
    expect(run([ev('turn.started', { seq: null }), ev('turn.ended', { seq: null, costUsd: 0 })], live).cost?.totalUsd).toBe(0.4);
  });

  it('child traffic and echo receipts leave the parent alone', () => {
    const interleaved = [
      ...parentTurn,
      ev('subagent.started', {}),
      ev('turn.started', CHILD),
      ev('assistant.block.complete', { ...CHILD, block: { type: 'text', text: 'child says' } }),
      ev('turn.ended', { ...CHILD, costUsd: 9 }),
    ];
    expect(run(interleaved)).toMatchObject({ phase: 'working', lastAssistantLine: 'Done.', childAgents: { active: 1, done: 0 }, cost: null });
    const finished = run([...interleaved, ev('subagent.finished', {})]);
    expect(finished.childAgents).toEqual({ active: 0, done: 1 });

    const during = run([ev('turn.started', {})]);
    expect(run([ev('turn.ended', { isEchoReceipt: true }), ev('user.message', { origin: 'bash_echo' })], during)).toEqual(during);
  });

  it('counts a child’s request as blocking the session', () => {
    expect(run([ev('permission.requested', CHILD)]).pendingRequests).toBe(1);
    expect(run([ev('subagent.started', CHILD)]).childAgents).toEqual({ active: 0, done: 0 });
  });

  it('a C4-shaped child backfill during a live parent turn leaves it working', () => {
    const working = run([ev('turn.started', {})]);
    const backfill = [
      ev('turn.started', { id: 'uuid-1', seq: null, agentId: 'agent-b', parentToolUseId: null }),
      ev('turn.ended', { id: 'uuid-1#1', seq: null, agentId: 'agent-b', parentToolUseId: null }),
    ];
    expect(run(backfill, working).phase).toBe('working');
  });

  it('a repeated batch counts once', () => {
    const batch = [...parentTurn, parentEnd];
    const once = foldEvents(emptyDigest(APP), new Set(), batch);
    const seen = new Set<string>();
    const first = foldEvents(emptyDigest(APP), seen, batch);
    const twice = foldEvents(first, seen, batch);
    expect(twice).toEqual(once);
    expect(twice.cost?.totalUsd).toBe(0.12);
  });

  it('keeps a bounded window of seen ids', () => {
    const seen = new Set<string>();
    const many = Array.from({ length: 2100 }, (_, i) => ev('tool.result', { id: `e${i}` }));
    foldEvents(emptyDigest(APP), seen, many);
    expect(seen.size).toBe(2000);
    expect(seen.has('e2099')).toBe(true);
    expect(seen.has('e0')).toBe(false);
  });
});

// C12 start: the memory budget's released mark (C12 execution document, Interfaces "X2 additions", SessionDigest.released).
// A release reads idle with the mark, not exited; the next launch clears it.
describe('a budget exit reads idle with the released mark', () => {
  const RELEASE = { limitKiB: 8_388_608, totalKiB: 9_100_000 };
  const releasedStatus = () => ({ ...status(APP, { process: 'exited', exit: { reason: 'budget', release: RELEASE } }), exit: { code: 0, signal: null, reason: 'budget' as const, at: '2026-09-29T14:02:00.000Z', release: RELEASE } });

  it('the exited status of a release maps to idle with the mark, keeping an existing mark', () => {
    const working = { ...emptyDigest(APP), phase: 'working' as const, activity: 'Thinking' };
    const released = applyStatusToDigest(working, releasedStatus());
    expect(released).toMatchObject({ phase: 'idle', activity: null, released: { at: '2026-09-29T14:02:00.000Z', limitKiB: 8_388_608 } });
    const earlier = { ...released, released: { at: '2026-09-29T13:00:00.000Z', limitKiB: 4_194_304 } };
    expect(applyStatusToDigest(earlier, releasedStatus()).released).toEqual({ at: '2026-09-29T13:00:00.000Z', limitKiB: 4_194_304 });
  });

  it('every other exit keeps today’s mapping, with no mark', () => {
    for (const reason of ['stop', 'quit', 'archive', 'unknown'] as const) {
      const d = applyStatusToDigest(emptyDigest(APP), status(APP, { process: 'exited', exit: { reason } }));
      expect(d.phase).toBe('exited');
      expect(d.released).toBeUndefined();
    }
  });

  it('the process.exited event of a release folds to idle with the mark and no pending requests', () => {
    const exited = ev('process.exited', { reason: 'budget', budget: RELEASE, at: '2026-09-29T14:02:00.000Z' });
    expect(run([ev('turn.started', {}), ev('turn.ended', {}), exited])).toMatchObject({ phase: 'idle', activity: null, pendingRequests: 0, released: { at: '2026-09-29T14:02:00.000Z', limitKiB: 8_388_608 } });
    expect(run([ev('process.exited', { reason: 'stop' })]).released).toBeUndefined();
  });

  it('a launch clears the mark: starting and initializing drop it', () => {
    const released = applyStatusToDigest(emptyDigest(APP), releasedStatus());
    for (const process of ['starting', 'initializing'] as const) {
      const d = applyStatusToDigest(released, status(APP, { process }));
      expect(d.phase).toBe('starting');
      expect(d.released).toBeUndefined();
    }
  });
});
// C12 end
