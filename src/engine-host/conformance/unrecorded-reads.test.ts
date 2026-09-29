// Debt wave 3 (tracker row "The replay transport ends a run on any control request its fixture did not record"): a
// read another child issues against a replayed session (C7's status line `get_usage`, a model chip's `list_models`)
// is answered empty and journaled as `meta replay_unrecorded_read`, and the replay goes on; a write it never recorded
// still ends the run (replay-transport.test.ts).
import { describe, expect, it } from 'vitest';
import { getUsage, listModels, listPermissionRules } from '../controls';
import { ControlError } from '../rpc';
import { replayedSession } from './session-harness';

type Held = { type: string; request?: { subtype?: string }; message?: { content: string } };

describe('replay: a read the fixture never recorded', () => {
  it('arrives mid-replay, is answered empty and journaled, and the run continues through the recorded rows', async () => {
    const outcomes: Record<string, unknown> = {};
    const run = await replayedSession('pass1', 'reads', (row, { session, ready, transport }) => {
      const frame = row.frame as Held;
      if (frame.type === 'user') {
        void ready().then(() => session.send(frame.message!.content));
        return;
      }
      if (frame.request?.subtype !== 'get_usage') {
        transport.kill('SIGTERM');
        return;
      }
      // held at the recorded get_usage (seq 52), after the turn: two reads it never recorded, then the recorded one
      const control = session.control!;
      void (async () => {
        outcomes.listModels = await listModels(control, {}).catch((error: unknown) => error);
        outcomes.rules = await listPermissionRules(control, {}).catch((error: unknown) => error);
        outcomes.usage = await getUsage(control, {});
      })();
    });

    const meta = run.journal.rows.filter((r) => r.direction === 'meta').map((r) => r.frame as { event: string; subtype?: string });
    expect(meta.filter((m) => m.event === 'replay_mismatch')).toEqual([]);
    expect(meta.filter((m) => m.event === 'replay_unrecorded_read').map((m) => m.subtype)).toEqual(expect.arrayContaining(['list_models', 'list_permission_rules']));
    // the empty answer reaches the caller as a read that failed its schema, never as a crash of the replay
    expect(outcomes.listModels).toBeInstanceOf(ControlError);
    expect(outcomes.rules).toBeInstanceOf(ControlError);
    // the recorded read after them still matched its row and got the recorded answer
    expect(outcomes.usage).toMatchObject({ session: { total_cost_usd: expect.any(Number) as unknown }, rate_limits_available: false });
    expect(run.events.filter((e) => e.kind === 'error.raised')).toEqual([]);
    expect(run.events.some((e) => e.kind === 'turn.ended')).toBe(true);
    expect(run.rebuilt()).toEqual(run.events);
  });
});
