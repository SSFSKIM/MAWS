// P5 O2 M2: the Stop callback's crons replayed through a whole EngineSession (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md,
// M2 "Proves"). Against the SYNTHETIC stand-in test/fixtures/engine/synthetic-p5-o2-stop-crons.jsonl until the probe's
// recorded fixtures (spikes/protocol-probe/fixtures/p5/p5-o2-stop-crons-*.jsonl) are promoted in its place.
import { describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import { loadEngineJournal } from '../../../test/support/fixtures';
import { replayedSession } from './session-harness';

const metaRows = (rows: JournalRow[], event: string) => rows.filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === event);
const JOB = { id: 'e6c78dde', schedule: '0 3 * * *', recurring: true, prompt: 'nightly report job' };

describe('the Stop callback replayed (P5 O2 M2, synthetic fixture)', () => {
  it('the Stop\'s list reaches status().work, answered {} before the result; a turn interrupted after a cron tool leaves the crons unknown', async () => {
    const works: NonNullable<EngineSessionStatus['work']>[] = [];
    // the first prompt is sent at its row; the second is queued during the first turn and released at its end, the
    // queue's own write matching the second `out` user row (seq 14); the control_response is the session's own answer
    const content = (fixture: JournalRow[], seq: number) => (fixture.find((r) => r.seq === seq)!.frame as { message: { content: string } }).message.content;
    const run = await replayedSession('pass3', 'synthetic-p5-o2-stop-crons', (row, { session, ready, fixture }) => {
      if (row.seq === 2) void ready().then(() => session.send(content(fixture, 2)));
    }, {
      load: () => loadEngineJournal('synthetic-p5-o2-stop-crons'),
      beforeStart: ({ session }) => {
        let queued = false;
        session.on('events', (batch) => {
          if (queued || !batch.some((e) => e.kind === 'turn.started')) return;
          queued = true;
          void session.send(content(loadEngineJournal('synthetic-p5-o2-stop-crons'), 14));
        });
        session.on('status', (s: EngineSessionStatus) => void works.push(s.work!));
      },
    });
    expect(metaRows(run.journal.rows, 'replay_mismatch')).toEqual([]);
    const outAnswer = run.journal.rows.find((r) => r.direction === 'out' && (r.frame as { type: string }).type === 'control_response')!;
    expect(outAnswer.frame).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: '44444444-4444-4444-8444-000000000008', response: {} } });
    const firstResult = run.journal.rows.find((r) => r.direction === 'in' && (r.frame as { type: string }).type === 'result')!;
    expect(outAnswer.seq).toBeLessThan(firstResult.seq);
    expect(works).toContainEqual({ crons: [JOB], unknown: null }); // after the first turn's Stop
    expect(works.at(-1)).toEqual({ crons: [JOB], unknown: 'turn_ended_without_stop' }); // the CronDelete turn sent none
    // the callback's event leaves the final text out; the journal keeps the whole frame
    const callback = run.events.find((e): e is Extract<SessionEvent, { kind: 'hook.callback_requested' }> => e.kind === 'hook.callback_requested')!;
    expect(callback.input).not.toHaveProperty('last_assistant_message');
    expect(callback.input).toMatchObject({ hook_event_name: 'Stop', session_crons: [JOB] });
  });
});
