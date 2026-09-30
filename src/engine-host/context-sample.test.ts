// Debt wave 3 (tracker row "Nothing emits context.sample"): the session reads the engine's context usage once ready and
// at each turn's end, the normaliser turns the journaled answer into `context.sample`, and main's digest folds it into
// the status line's `ctx`. Replayed through pass3/context-sample, whose probe issued the read where the session does
// after each turn; the ready read is recorded into the replay (the probe's own answer to the first read, placed before
// the first prompt), since the probe sent none there.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { emptyDigest, foldDigest } from '../main/sessions/digest';
import { replayedSession } from './conformance/session-harness';

type Held = { type: string; request?: { subtype?: string }; message?: { content: string } };

// The recorded read (seq 51) and its answer (seq 53) again, before the first prompt (seq 5), under a request id of its own.
function withReadyRead(rows: JournalRow[]): JournalRow[] {
  const request = rows.find((r) => r.seq === 51)!;
  const answer = rows.find((r) => r.seq === 53)!;
  const id = (request.frame as { request_id: string }).request_id;
  const readyId = '00000000-0000-4000-8000-00000000c7c7';
  const renamed = (row: JournalRow, seq: number): JournalRow => ({ ...row, seq, frame: JSON.parse(JSON.stringify(row.frame).split(id).join(readyId)) as unknown });
  const at = rows.findIndex((r) => r.seq === 5);
  return [...rows.slice(0, at), renamed(request, 4.1), renamed(answer, 4.2), ...rows.slice(at)];
}

describe('context.sample once ready and at each turn end', () => {
  it("the session's own reads match the recorded ones, the first before any turn, and the digest's ctx follows the samples", async () => {
    const run = await replayedSession('pass3', 'context-sample', (row, { session, ready, transport }) => {
      const frame = row.frame as Held;
      if (frame.type === 'user') void ready().then(() => session.send(frame.message!.content));
      else if (frame.request?.subtype === 'end_session') void session.stop();
      else if (frame.request?.subtype !== 'get_context_usage') transport.kill('SIGTERM'); // the session issues that read itself
    }, { edit: withReadyRead });

    const outReads = run.journal.rows.filter((r) => r.direction === 'out' && (r.frame as Held).request?.subtype === 'get_context_usage');
    expect(outReads).toHaveLength(3); // ready, then after each of the two turns
    const meta = run.journal.rows.filter((r) => r.direction === 'meta').map((r) => r.frame as { event: string });
    expect(meta.filter((m) => m.event === 'replay_mismatch' || m.event === 'replay_unrecorded_read')).toEqual([]);

    const samples = run.events.filter((e) => e.kind === 'context.sample');
    expect(samples).toHaveLength(3);
    const firstTurn = run.events.find((e) => e.kind === 'turn.started')!;
    expect(samples[0]!.seq!).toBeLessThan(firstTurn.seq!); // `ctx` before the first turn has run
    const turnEnds = run.events.filter((e) => e.kind === 'turn.ended').map((e) => e.seq!);
    expect(samples.slice(1).every((s, i) => s.seq! > turnEnds[i]!)).toBe(true);
    // the ready read is the engine's estimate (its recorded answer, replayed before any turn, still names the first
    // turn's apiUsage, so it too derives); each turn-end read's total is the measured input plus the Messages estimate
    expect(samples[2]).toMatchObject({ totalTokens: 21841, maxTokens: 200000, percentage: 11, autoCompactThreshold: 167000, isAutoCompactEnabled: true });
    expect(run.rebuilt()).toEqual(run.events);

    const before = run.events.slice(0, run.events.indexOf(firstTurn)).reduce(foldDigest, emptyDigest(run.session.status().appSessionId as AppSessionId));
    expect(before.context).toEqual({ percent: 11, totalTokens: 21495, maxTokens: 200000, autoCompactThreshold: 167000 });
    const digest = run.events.reduce(foldDigest, emptyDigest(run.session.status().appSessionId as AppSessionId));
    expect(digest.context).toEqual({ percent: 11, totalTokens: 21841, maxTokens: 200000, autoCompactThreshold: 167000 });
  });
});
