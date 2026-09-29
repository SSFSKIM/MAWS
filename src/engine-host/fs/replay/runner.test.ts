import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId, SessionId } from '@shared/graph/ids';
import type { ReplayProgress } from '@shared/ipc/schema/session';
import type { JournalRow } from '@shared/wire/journal';
import { currentChain, parseTranscriptRecord } from '@shared/wire/transcript';
import { loadJournal, loadTranscriptFixture } from '../../../../test/support/fixtures';
import { createBackfillContext, recordToEvents } from '../backfill';
import { ReplayClock } from './clock';
import { REPLAY_BATCH, ReplayRunner, type RowNormalizer } from './runner';

const APP = 'app-replay-1' as AppSessionId;
const RUN = 'rp_00000000-0000-4000-8000-000000000001' as SessionId;

const unknownEvent = (row: JournalRow): SessionEvent => ({
  id: `row:${row.seq}` as EventId,
  sessionId: RUN,
  at: row.at,
  seq: row.seq,
  agentId: null,
  parentToolUseId: null,
  kind: 'frame.unknown',
  frameType: String((row.frame as { type?: unknown }).type ?? 'unknown'),
  subtype: null,
});

// A normaliser that records every row it is handed and answers one event per row.
function collecting(): RowNormalizer & { rows: JournalRow[] } {
  const rows: JournalRow[] = [];
  return {
    rows,
    normalize(row) {
      rows.push(row);
      return [unknownEvent(row)];
    },
  };
}

function harness(speed: ConstructorParameters<typeof ReplayClock>[0]['speed'] = 'instant') {
  const batches: SessionEvent[][] = [];
  const progress: ReplayProgress[] = [];
  const clock = new ReplayClock({ speed });
  const runner = new ReplayRunner({ appSessionId: APP, sessionId: RUN, clock, emit: (events) => void batches.push(events), progress: (p) => void progress.push(p) });
  return { runner, clock, batches, progress, events: () => batches.flat(), states: () => progress.map((p) => p.state) };
}

const row = (seq: number, atMs: number, direction: JournalRow['direction'] = 'in', frame: unknown = { type: 'assistant', session_id: 'orig' }): JournalRow => ({
  seq,
  direction,
  at: new Date(Date.UTC(2026, 8, 28, 10) + atMs).toISOString(),
  frame,
});

describe('replay runner plays a journal through the normaliser', () => {
  afterEach(() => void vi.useRealTimers());

  it('hands the normaliser exactly the in and out rows of pass2/rewind.jsonl, in order, with the run\'s session id', async () => {
    const rows = loadJournal('pass2', 'rewind');
    const normalizer = collecting();
    const { runner, progress } = harness();
    await runner.runJournal(rows, normalizer);
    const played = rows.filter((r) => r.direction === 'in' || r.direction === 'out');
    expect(normalizer.rows.filter((r) => r.direction === 'in')).toHaveLength(rows.filter((r) => r.direction === 'in').length);
    expect(normalizer.rows.filter((r) => r.direction === 'out')).toHaveLength(rows.filter((r) => r.direction === 'out').length);
    expect(normalizer.rows.map((r) => r.seq)).toEqual(played.map((r) => r.seq));
    const original = new Set(rows.map((r) => (r.frame as { session_id?: unknown }).session_id).filter((id) => typeof id === 'string'));
    expect(original.size).toBeGreaterThan(0);
    for (const handed of normalizer.rows) {
      const frame = handed.frame as { session_id?: unknown };
      if ('session_id' in frame) expect(frame.session_id).toBe(RUN);
    }
    // The fixture itself is untouched.
    expect(rows.some((r) => original.has((r.frame as { session_id?: string }).session_id ?? ''))).toBe(true);
    expect(progress.at(-1)).toMatchObject({ appSessionId: APP, state: 'done', index: played.length, total: played.length, speed: 'instant', message: null });
  });

  it("'instant' over 3,300 rows completes in under 200 ms in batches of at most 500", async () => {
    const rows = Array.from({ length: 3300 }, (_, i) => row(i + 1, i * 1000));
    const { runner, batches, events, progress } = harness('instant');
    // The bound is on the work the run costs (this process's CPU time), so a loaded machine's scheduling does not decide
    // it; the wall clock only has to show that no timer paced the run.
    const cpu = process.cpuUsage();
    const started = performance.now();
    await runner.runJournal(rows, collecting());
    const spent = process.cpuUsage(cpu);
    expect((spent.user + spent.system) / 1000).toBeLessThan(200);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(events()).toHaveLength(3300);
    expect(batches.length).toBeGreaterThanOrEqual(7);
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(REPLAY_BATCH);
    expect(new Set(events().map((e) => e.id)).size).toBe(3300);
    expect(progress[0]).toMatchObject({ state: 'running', index: 0, total: 3300 });
    expect(progress.at(-1)).toMatchObject({ state: 'done', index: 3300 });
    // Progress every 25 rows and on every state change (the last row's is the `done`).
    expect(progress.filter((p) => p.state === 'running').map((p) => p.index)).toEqual([0, ...Array.from({ length: 131 }, (_, i) => (i + 1) * 25)]);
    expect(runner.materialized()).toEqual(events());
  });

  it("'instant' yields after every batch: a record whose events cross the 500 boundary leaves its remainder for the next turn", async () => {
    const rows = [...Array.from({ length: 499 }, (_, i) => row(i + 1, i)), row(500, 499, 'in', { type: 'assistant', twoEvents: true }), ...Array.from({ length: 3 }, (_, i) => row(501 + i, 500 + i))];
    const normalizer: RowNormalizer = {
      normalize: (r) => ((r.frame as { twoEvents?: boolean }).twoEvents ? [unknownEvent(r), { ...unknownEvent(r), id: `row:${r.seq}#1` as EventId }] : [unknownEvent(r)]),
    };
    // Two batches emitted in one turn of the event loop would share a turn number.
    let turn = 0;
    let turning = false;
    const turns: number[] = [];
    const sizes: number[] = [];
    const clock = new ReplayClock({ speed: 'instant' });
    const runner = new ReplayRunner({
      appSessionId: APP,
      sessionId: RUN,
      clock,
      emit: (events) => {
        if (!turning) {
          turning = true;
          turn += 1;
          setImmediate(() => (turning = false));
        }
        turns.push(turn);
        sizes.push(events.length);
      },
      progress: () => {},
    });
    await runner.runJournal(rows, normalizer);
    expect(sizes).toEqual([500, 4]);
    expect(new Set(turns).size).toBe(turns.length);
    expect(runner.materialized().map((e) => e.id).slice(498, 501)).toEqual(['row:499', 'row:500', 'row:500#1']);
  });

  it('paces rows by their recorded time, and the first progress follows the start by a turn of the event loop', async () => {
    vi.useFakeTimers();
    const { runner, events, progress } = harness(1);
    const done = runner.runJournal([row(1, 0), row(2, 1000), row(3, 1500, 'out', { type: 'user', session_id: 'orig' })], collecting());
    expect(progress).toEqual([]); // nothing before the launch has answered
    await vi.advanceTimersByTimeAsync(1);
    expect(progress[0]).toMatchObject({ state: 'running', index: 0, total: 3, at: null, speed: 1 });
    expect(events().map((e) => e.seq)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(998);
    expect(events()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(events().map((e) => e.seq)).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(events().map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(progress.at(-1)).toMatchObject({ state: 'done', index: 3, at: row(3, 1500).at });
  });

  it('pause, resume, a speed change and stop reach the clock and are reported', async () => {
    vi.useFakeTimers();
    const { runner, events, progress, states } = harness(1);
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, i * 1000));
    const done = runner.runJournal(rows, collecting());
    await vi.advanceTimersByTimeAsync(1000);
    expect(events()).toHaveLength(2);
    runner.control('pause');
    await vi.advanceTimersByTimeAsync(5000);
    expect(events()).toHaveLength(2);
    runner.control('resume');
    runner.control(undefined, 4);
    expect(progress.at(-1)).toMatchObject({ state: 'running', speed: 4 });
    await vi.advanceTimersByTimeAsync(250);
    expect(events()).toHaveLength(3);
    runner.control('stop');
    await done;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events()).toHaveLength(3);
    expect(states()).toEqual(['running', 'paused', 'running', 'running', 'stopped']);
    expect(runner.state).toBe('stopped');
    runner.control('resume'); // a stopped run stays stopped
    expect(states().at(-1)).toBe('stopped');
  });

  it('a stop before the first row is played reports stopped and plays nothing', async () => {
    vi.useFakeTimers();
    const { runner, events, states } = harness(1);
    const done = runner.runJournal([row(1, 0)], collecting());
    runner.control('stop');
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(events()).toEqual([]);
    expect(states()).toEqual(['stopped']);
  });

  it('a done run can still be stopped; a normaliser that throws ends the run in error', async () => {
    const ok = harness();
    await ok.runner.runJournal([row(1, 0)], collecting());
    ok.runner.control('pause');
    ok.runner.control('stop');
    expect(ok.states()).toEqual(['running', 'done', 'stopped']);

    const bad = harness();
    await bad.runner.runJournal([row(1, 0), row(2, 10)], {
      normalize: (r) => {
        if (r.seq === 2) throw new Error('unexpected frame');
        return [unknownEvent(r)];
      },
    });
    expect(bad.progress.at(-1)).toMatchObject({ state: 'error', index: 1, message: 'unexpected frame' });
    expect(bad.events()).toHaveLength(1);
  });
});

describe('replay runner plays a transcript through the backfill', () => {
  it('emits the backfill mapping of the chain under the run\'s session id, every event with seq null', async () => {
    const records = loadTranscriptFixture('subagent-parent');
    const { runner, events, progress } = harness('instant');
    await runner.runTranscript(records, null);
    const chain = currentChain(records).chain;
    const ctx = createBackfillContext({ sessionId: RUN, agent: null });
    const expected = chain.flatMap((record) => recordToEvents(parseTranscriptRecord({ ...record, sessionId: RUN }), ctx));
    expect(events()).toEqual(expected);
    for (const event of events()) {
      expect(SessionEventSchema.parse(event)).toEqual(event);
      expect(event.sessionId).toBe(RUN);
      expect(event.seq).toBeNull();
    }
    expect(events()[0]).toMatchObject({ kind: 'session.started', id: `session:${RUN}:started` });
    expect(progress.at(-1)).toMatchObject({ state: 'done', index: chain.length, total: chain.length, at: chain.at(-1)!.timestamp });
  });

  it('paces records by timestamp; a record without one inherits the previous', async () => {
    vi.useFakeTimers();
    try {
      const user = (uuid: string, parentUuid: string | null, timestamp?: string) =>
        parseTranscriptRecord({ type: 'user', uuid, parentUuid, cwd: '/w', sessionId: 'orig', ...(timestamp ? { timestamp } : {}), message: { role: 'user', content: uuid } });
      const { runner, events } = harness(1);
      const done = runner.runTranscript([user('u1', null, '2026-09-28T10:00:00.000Z'), user('u2', 'u1'), user('u3', 'u2', '2026-09-28T10:00:01.500Z')], null);
      await vi.advanceTimersByTimeAsync(1);
      const messages = () => events().filter((e) => e.kind === 'user.message').map((e) => (e as { messageUuid: string }).messageUuid);
      expect(messages()).toEqual(['u1', 'u2']);
      await vi.advanceTimersByTimeAsync(1498);
      expect(messages()).toEqual(['u1', 'u2']);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(messages()).toEqual(['u1', 'u2', 'u3']);
    } finally {
      vi.useRealTimers();
    }
  });
});
