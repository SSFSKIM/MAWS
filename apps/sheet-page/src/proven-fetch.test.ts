// T28 across the two halves (live.ts and api.ts, as App.tsx joins them): a tab proven with one pairing can never send
// another's credential. Two tabs that paired in turn: the first, proven with A, finds B stored by the second; it makes
// no request on A's proof with B, nor with A once storage no longer holds A, and proves B before it sends anything.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApi } from './api';
import { connect, RETRY_MS, type LiveSocket } from './live';
import { CREDENTIAL_KEY, readPairing, writePairing } from './credential';
import { macOf, proofKeyOf } from './proof';
import { testStorage } from './test-support/storage';
import { unpairScreen } from './unpair';

const A = { id: '0a1b2c3d', credential: Buffer.alloc(32, 1).toString('base64url') };
const B = { id: 'ffffffff', credential: Buffer.alloc(32, 2).toString('base64url') };

class Socket implements LiveSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code: 1005 });
  }
  // the real mawsd, which knows both browsers
  serve(pairings: (typeof A)[]) {
    this.readyState = 1;
    this.onopen?.();
    const hello = JSON.parse(this.sent[0]!) as { id: string; nonce: string };
    const known = pairings.find((pairing) => pairing.id === hello.id)!;
    this.onmessage?.({ data: JSON.stringify({ t: 'proof', mac: macOf(proofKeyOf(known.credential), 'http://x', hello.id, hello.nonce) }) });
    this.onmessage?.({ data: JSON.stringify({ t: 'paired' }) });
  }
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

it('replacing the stored pairing cannot authorize a fetch on the old proof', async () => {
  let stored: typeof A | null = A;
  const sockets: Socket[] = [];
  const live = connect({ url: 'ws://x/live', origin: 'http://x', pairing: () => stored, onPaired: () => {}, onState: () => {}, open: () => (sockets.push(new Socket()), sockets.at(-1)!) });
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const api = createApi({ proven: () => live.proven(), fetch });
  sockets[0]!.serve([A, B]);

  stored = B; // the second tab paired
  expect(await api.unpair()).toEqual({ ok: false, why: 'unproven' });
  expect(fetch).not.toHaveBeenCalled();

  vi.advanceTimersByTime(RETRY_MS[0]!);
  sockets[1]!.serve([A, B]); // proves B, then sends B's credential
  expect(await api.unpair()).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('authorization')).toBe(`Bearer ${B.credential}`);
});

it('Unpair acts on the pairing the screen shows: another tab’s newer pairing, stored before this tab heard of it, is neither revoked nor forgotten (B4)', async () => {
  const storage = testStorage();
  writePairing(A, storage);
  storage.setItem('maws.sheet.draft.s.q1', JSON.stringify({ v: 1, touchedAt: 1, draft: {} }));
  const sockets: Socket[] = [];
  const live = connect({ url: 'ws://x/live', origin: 'http://x', pairing: () => readPairing(storage), onPaired: () => {}, onState: () => {}, open: () => (sockets.push(new Socket()), sockets.at(-1)!) });
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const api = createApi({ proven: () => live.proven(), fetch });
  sockets[0]!.serve([A, B]); // this tab shows A, proven
  writePairing(B, storage); // another tab paired anew; this tab has not processed the storage event
  expect(await unpairScreen({ shown: A, api, close: () => live.close(), storage })).toBe('local');
  expect(fetch).not.toHaveBeenCalled(); // the live proof is not A's any more: nothing is revoked
  expect(readPairing(storage)).toEqual(B);
  expect(storage.getItem(CREDENTIAL_KEY)).not.toBeNull();
  expect(storage.getItem('maws.sheet.draft.s.q1')).not.toBeNull(); // B's memory now
});

it('Unpair revokes and forgets the pairing on screen when the live proof is that pairing’s (B4)', async () => {
  const storage = testStorage();
  writePairing(A, storage);
  const sockets: Socket[] = [];
  const live = connect({ url: 'ws://x/live', origin: 'http://x', pairing: () => readPairing(storage), onPaired: () => {}, onState: () => {}, open: () => (sockets.push(new Socket()), sockets.at(-1)!) });
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const api = createApi({ proven: () => live.proven(), fetch });
  sockets[0]!.serve([A]);
  expect(await unpairScreen({ shown: A, api, close: () => live.close(), storage })).toBe('revoked');
  expect(new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('authorization')).toBe(`Bearer ${A.credential}`);
  expect(storage.length).toBe(0);
});
