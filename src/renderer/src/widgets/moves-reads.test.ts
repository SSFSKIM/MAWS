// C12 M5: C7's MOVES_READS with the engine's state frames present (X6 sets CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS from
// C12 M5 on). The recorded turn (spikes/protocol-probe/fixtures/pass3/launch-env-state-events.jsonl: running, a
// can_use_tool with requires_action, running, the result, idle) is replayed through C3's session and every status it
// emits is keyed as a widget's read keys it: a read repeats exactly where the session's facts move (the turn opening,
// the engine waiting on the permission and resuming, the turn closing, the engine's own turn-over), never on the
// statuses in between (activity, queue, context).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { RequestId } from '@shared/graph/ids';
import { scriptedSession } from '../../../engine-host/conformance/session-harness';
import { MOVES_READS } from './read';

const FIXTURE = join(__dirname, '../../../../spikes/protocol-probe/fixtures/pass3/launch-env-state-events.jsonl');
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MOVES_READS with the engine state frames', () => {
  it('moves at the turn, the permission wait and its end, the turn end and the engine idle, and nowhere else', async () => {
    const engine = readFileSync(FIXTURE, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { seq: number; direction: string; frame: Record<string, unknown> })
      .filter((r) => r.direction === 'in' && r.frame.type !== 'control_response'); // the engine's echo of the host's answer is the host's
    const s = scriptedSession();
    await s.session.start();
    const statuses: EngineSessionStatus[] = [];
    s.session.on('status', (st) => statuses.push(st));
    for (const row of engine) {
      s.transport.push({ ...row.frame, session_id: 's' });
      await flush();
      if (row.frame.type === 'control_request') expect(await s.session.answer(row.frame.request_id as RequestId, { kind: 'permission', decision: 'allow', scope: 'once' })).toBe('delivered');
    }
    const keys = statuses.map(MOVES_READS).filter((key, i, all) => i === 0 || key !== all[i - 1]);
    const facts = keys.map((key) => {
      const [, process, turn, state] = key.split('|');
      return `${process}|${turn === '' ? 'no turn' : 'turn'}|${state}`;
    });
    expect(facts).toEqual(['ready|no turn|running', 'ready|turn|running', 'ready|turn|requires_action', 'ready|turn|running', 'ready|no turn|running', 'ready|no turn|idle']);
    expect(statuses.length).toBeGreaterThan(keys.length); // statuses that move nothing a read depends on repeat no read
  });
});
