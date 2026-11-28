// The page's live connection as App wires it to the store (page-live.ts): over the real client (live.ts) and the real
// store, against a scripted socket that plays the server. A revocation by the server the tab proved lets go of every
// read under that pairing (B5); `unavailable` holds the model unfresh until the next snapshot's read (B3); an ordinary
// disconnect, or a refusal before any proof, keeps the store (a reconnect of the same pairing).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetModel } from '@shared/sheet/model';
import type { ReadAnswer } from './api';
import { createApi } from './api';
import { pageSheetHost } from './host';
import { connect, RETRY_MS, type Connection, type LiveSocket } from './live';
import { pageLive } from './page-live';
import { macOf, proofKeyOf } from './proof';
import { createStore } from './store';

const S = '5eed0000-0000-4000-8000-000000000019';
const PAIRING = { id: '0a1b2c3d', credential: Buffer.alloc(32, 7).toString('base64url') };
const ORIGIN = 'http://sheet.localhost:47590';
const DOOR = { known: true as const, available: true as const };
const model = (seq: number): SheetModel => ({ v: 1, session: S, seq, open: [], hidden: [], sent: [], pending: [], closed: {} });

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
  say(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  // the real mawsd: proves itself, pairs, sends a snapshot
  serve() {
    this.readyState = 1;
    this.onopen?.();
    const hello = JSON.parse(this.sent[0]!) as { nonce: string };
    this.say({ t: 'proof', mac: macOf(proofKeyOf(PAIRING.credential), ORIGIN, PAIRING.id, hello.nonce) });
    this.say({ t: 'paired' });
    this.say({ t: 'ready', v: 1, sessions: [], door: DOOR });
  }
  end(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

let sockets: Socket[];
let reads: ((answer: ReadAnswer) => void)[];
let states: Connection[];

function wired() {
  const store = createStore({ read: () => new Promise<ReadAnswer>((done) => void reads.push(done)) });
  const live = connect({
    url: 'ws://sheet.localhost:47590/live',
    origin: ORIGIN,
    pairing: () => PAIRING,
    ...pageLive({ store, chunks: { opened: () => {} }, paired: () => {}, state: (state) => void states.push(state) }),
    open: () => (sockets.push(new Socket()), sockets.at(-1)!),
  });
  store.show(S);
  return { store, live };
}
// the page's host as Workspace makes it: writes only while the model on screen is fresh, through the proven-only api
function hostOf(store: ReturnType<typeof createStore>, live: ReturnType<typeof connect>, fetch: typeof globalThis.fetch) {
  const api = createApi({ proven: () => live.proven(), fetch });
  return pageSheetHost({ api, writable: (session) => store.state().shown?.session === session && store.state().shown?.fresh === true });
}
const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  reads = [];
  states = [];
});
afterEach(() => vi.useRealTimers());

describe('the page’s live wiring', () => {
  it('lets go of the store when the proven server unpairs the browser: a read of that pairing still out is applied nowhere (B5)', async () => {
    const { store } = wired();
    sockets[0]!.serve();
    const out = reads.at(-1)!; // the snapshot's read, still out
    sockets[0]!.end(4403);
    out({ ok: true, model: model(1), door: DOOR });
    await flush();
    expect(store.state().shown).toMatchObject({ session: S, model: undefined, fresh: false });
    expect(store.state().sessions).toBeNull();
    expect(states.at(-1)).toBe('unpaired');
  });

  it('keeps the store across a disconnect and a refusal before any proof (B5)', async () => {
    const { store } = wired();
    sockets[0]!.serve();
    reads.at(-1)!({ ok: true, model: model(1), door: DOOR });
    await flush();
    sockets[0]!.end(1006);
    vi.advanceTimersByTime(RETRY_MS[0]!);
    sockets[1]!.readyState = 1;
    sockets[1]!.onopen?.();
    sockets[1]!.end(4401); // refused at the hello: a stranger's word as much as mawsd's
    expect(store.state().shown).toMatchObject({ model: model(1) });
    expect(store.state().sessions).toEqual([]);
  });

  it('holds the model unfresh from `unavailable` until the read after the next snapshot (B3)', async () => {
    const { store } = wired();
    sockets[0]!.serve();
    reads.at(-1)!({ ok: true, model: model(1), door: DOOR });
    await flush();
    expect(store.state().shown?.fresh).toBe(true);
    sockets[0]!.say({ t: 'unavailable', why: 'yielded' });
    expect(store.state().shown?.fresh).toBe(false);
    sockets[0]!.say({ t: 'ready', v: 1, sessions: [], door: DOOR }); // the spine is back, and the tab's list answered
    reads.at(-1)!({ ok: true, model: model(2), door: DOOR });
    await flush();
    expect(store.state().shown).toMatchObject({ model: model(2), fresh: true });
  });

  it('holds a card action kept from before a lost connection, after the new socket’s proof and before its `paired` (B3)', async () => {
    const { store, live } = wired();
    sockets[0]!.serve();
    reads.at(-1)!({ ok: true, model: model(1), door: DOOR });
    await flush();
    expect(store.state().shown?.fresh).toBe(true);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 }));
    const host = hostOf(store, live, fetch);
    sockets[0]!.end(1006);
    expect(store.state().shown).toMatchObject({ model: model(1), fresh: false }); // kept on screen, not fresh
    vi.advanceTimersByTime(RETRY_MS[0]!);
    const next = sockets[1]!;
    next.readyState = 1;
    next.onopen?.();
    const hello = JSON.parse(next.sent[0]!) as { nonce: string };
    next.say({ t: 'proof', mac: macOf(proofKeyOf(PAIRING.credential), ORIGIN, PAIRING.id, hello.nonce) }); // proven, not yet paired
    expect(live.proven()).not.toBeNull();
    const dismiss = [{ v: 1 as const, key: 'page-0000000000000000000000000a', kind: 'dismiss' as const, id: 'q1', by: 'page' as const }];
    expect(await host.send(S, dismiss)).toMatchObject({ ok: false, why: 'failed' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
