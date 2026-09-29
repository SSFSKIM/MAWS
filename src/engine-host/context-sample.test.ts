// Debt wave 3 (tracker row "Nothing emits context.sample"): the session reads the engine's context usage at each
// turn's end, the normaliser turns the journaled answer into `context.sample`, and main's digest folds it into the
// status line's `ctx`. Replayed through pass3/context-sample, whose probe issued the read where the session does.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { emptyDigest, foldDigest } from '../main/sessions/digest';
import { replayedSession } from './conformance/session-harness';

type Held = { type: string; request?: { subtype?: string }; message?: { content: string } };

describe('context.sample at each turn end', () => {
  it("the session's own read after each turn matches the recorded one, and the digest's ctx follows the samples", async () => {
    const run = await replayedSession('pass3', 'context-sample', (row, { session, ready, transport }) => {
      const frame = row.frame as Held;
      if (frame.type === 'user') void ready().then(() => session.send(frame.message!.content));
      else if (frame.request?.subtype === 'end_session') void session.stop();
      else if (frame.request?.subtype !== 'get_context_usage') transport.kill('SIGTERM'); // the session issues that read itself
    });

    const outReads = run.journal.rows.filter((r) => r.direction === 'out' && (r.frame as Held).request?.subtype === 'get_context_usage');
    expect(outReads).toHaveLength(2);
    const meta = run.journal.rows.filter((r) => r.direction === 'meta').map((r) => r.frame as { event: string });
    expect(meta.filter((m) => m.event === 'replay_mismatch' || m.event === 'replay_unrecorded_read')).toEqual([]);

    const turnEnds = run.events.filter((e) => e.kind === 'turn.ended').map((e) => e.seq);
    const samples = run.events.filter((e) => e.kind === 'context.sample');
    expect(samples).toHaveLength(2);
    expect(samples.every((s, i) => s.seq! > turnEnds[i]!)).toBe(true);
    expect(samples[1]).toMatchObject({ totalTokens: 30304, maxTokens: 200000, percentage: 15, autoCompactThreshold: 167000, isAutoCompactEnabled: true });
    expect(run.rebuilt()).toEqual(run.events);

    const digest = run.events.reduce(foldDigest, emptyDigest(run.session.status().appSessionId as AppSessionId));
    expect(digest.context).toEqual({ percent: 15, totalTokens: 30304, maxTokens: 200000, autoCompactThreshold: 167000 });
  });
});
