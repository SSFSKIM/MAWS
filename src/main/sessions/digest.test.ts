import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { costLedger, emptyDigest, foldDigest, foldEvents } from './digest';
import { ev } from '../../../test/support/events';
import { framesOf, loadJournal } from '../../../test/support/fixtures';

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
