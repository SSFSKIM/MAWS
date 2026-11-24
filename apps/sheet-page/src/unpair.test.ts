// The person's own Unpair (§P; T10, T19): told to mawsd only over a proven connection, forgotten here whatever the
// answer, and its outcome kept apart: revoked, revoked for now but not saved, or forgotten here alone.
import { describe, expect, it } from 'vitest';
import type { Done } from './api';
import { unpairThisBrowser } from './unpair';

function run(answer: Done) {
  const order: string[] = [];
  const outcome = unpairThisBrowser({
    unpair: async () => (order.push('told'), answer),
    close: () => void order.push('closed'),
    forget: () => void order.push('forgot'),
  });
  return { outcome, order };
}

describe('unpairThisBrowser', () => {
  it('tells mawsd first, then ends the connection and forgets every key, whatever the answer', async () => {
    for (const answer of [{ ok: true }, { ok: false, why: 'not-saved' }, { ok: false, why: 'unproven' }, { ok: false, why: 'failed' }] as Done[]) {
      const { outcome, order } = run(answer);
      await outcome;
      expect(order, JSON.stringify(answer)).toEqual(['told', 'closed', 'forgot']);
    }
  });

  it('keeps the three outcomes apart', async () => {
    expect(await run({ ok: true }).outcome).toBe('revoked');
    expect(await run({ ok: false, why: 'not-saved' }).outcome).toBe('not-saved');
    expect(await run({ ok: false, why: 'unproven' }).outcome).toBe('local');
    expect(await run({ ok: false, why: 'failed' }).outcome).toBe('local');
  });
});
