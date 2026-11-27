// The person's own Unpair (§P; T10, T19): the revocation is asked of mawsd over a proven connection, and the pairing
// being removed is forgotten at once, whatever mawsd answers and whenever; the answer only says what became of it on
// mawsd's side: revoked, revoked for now but not saved, or not confirmed.
import { describe, expect, it } from 'vitest';
import type { Done } from './api';
import type { StoredPairing } from './credential';
import { unpairThisBrowser } from './unpair';

const A: StoredPairing = { id: '0a1b2c3d', credential: Buffer.alloc(32, 1).toString('base64url') };

function run(answer: Promise<Done>) {
  const order: string[] = [];
  const forgot: (StoredPairing | null)[] = [];
  const outcome = unpairThisBrowser({
    pairing: A,
    unpair: () => (order.push('asked'), answer),
    close: () => void order.push('closed'),
    forget: (pairing) => void (order.push('forgot'), forgot.push(pairing)),
  });
  return { outcome, order, forgot };
}

describe('unpairThisBrowser', () => {
  it('starts the revocation, then ends the connection and forgets the pairing being removed at once, before any answer (B4)', () => {
    const { order, forgot } = run(new Promise<Done>(() => {})); // no answer, ever
    expect(order).toEqual(['asked', 'closed', 'forgot']);
    expect(forgot).toEqual([A]); // that pairing, not whichever is stored when an answer lands
  });

  it('forgets nothing more when the answer lands late (B4)', async () => {
    let land!: (done: Done) => void;
    const { outcome, order } = run(new Promise<Done>((done) => (land = done)));
    land({ ok: true });
    expect(await outcome).toBe('revoked');
    expect(order).toEqual(['asked', 'closed', 'forgot']);
  });

  it('keeps the three outcomes apart', async () => {
    expect(await run(Promise.resolve({ ok: true })).outcome).toBe('revoked');
    expect(await run(Promise.resolve({ ok: false, why: 'not-saved' })).outcome).toBe('not-saved');
    expect(await run(Promise.resolve({ ok: false, why: 'unproven' })).outcome).toBe('local');
    expect(await run(Promise.resolve({ ok: false, why: 'failed' })).outcome).toBe('local');
  });
});
