// The person's own Unpair (§P; T10, T19): the revocation is asked of mawsd over a proven connection, and the pairing
// being removed is forgotten at once, whatever mawsd answers and whenever; the answer only says what became of it on
// mawsd's side: revoked, revoked for now but not saved, or not confirmed.
import { describe, expect, it } from 'vitest';
import { EMPTY_MEMORY } from '../../../src/renderer/src/sheet';
import type { Done } from './api';
import { CREDENTIAL_KEY, type StoredPairing } from './credential';
import { ENTRY_KEPT_MAX, readMemory, unkeptDraft, updateMemory } from './memory';
import { testStorage } from './test-support/storage';
import { pairingStored, unpairThisBrowser } from './unpair';

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

describe('pairingStored', () => {
  const S = '5eed0000-0000-4000-8000-0000000000aa';
  const B: StoredPairing = { id: '4e5f6a7b', credential: Buffer.alloc(32, 2).toString('base64url') };
  const stored = (pairing: StoredPairing) => JSON.stringify({ v: 1, ...pairing });

  it('forgets what this tab held at another tab’s Unpair, even when a pairing stored since is read by the time it is heard (B4)', () => {
    const store = testStorage({ [CREDENTIAL_KEY]: stored(A) });
    const long = { revision: 1, picks: [], text: 'x'.repeat(ENTRY_KEPT_MAX), images: [] };
    updateMemory(S, (current) => ({ ...current, drafts: new Map(current.drafts).set('q4', long) }), { storage: store, now: 1, target: new EventTarget() });
    expect(unkeptDraft(S, store)).toBe(true);
    // the other tab unpaired, then paired again, before this suspended tab heard the removal
    store.setItem(CREDENTIAL_KEY, stored(B));
    expect(pairingStored({ key: CREDENTIAL_KEY, newValue: null }, store)).toEqual(B); // the pairing it follows is the one stored now
    expect(unkeptDraft(S, store)).toBe(false);
    expect(readMemory(S, store)).toEqual(EMPTY_MEMORY);
  });

  it('keeps what this tab held when another tab pairs anew without an Unpair, and ignores other keys', () => {
    const store = testStorage({ [CREDENTIAL_KEY]: stored(A) });
    const long = { revision: 1, picks: [], text: 'x'.repeat(ENTRY_KEPT_MAX), images: [] };
    updateMemory(S, (current) => ({ ...current, drafts: new Map(current.drafts).set('q4', long) }), { storage: store, now: 1, target: new EventTarget() });
    expect(pairingStored({ key: 'maws.sheet.outline', newValue: '{}' }, store)).toBeUndefined();
    store.setItem(CREDENTIAL_KEY, stored(B));
    expect(pairingStored({ key: CREDENTIAL_KEY, newValue: stored(B) }, store)).toEqual(B);
    expect(unkeptDraft(S, store)).toBe(true);
  });
});
