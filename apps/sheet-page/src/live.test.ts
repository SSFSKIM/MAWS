// The live connection's client, the opening's half (§L, §P; T28): against a scripted socket, the tab sends its
// credential only after the server's MAC matched its own, on no other condition, and with a fresh nonce on each socket.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, PROOF_WAIT_MS, RETRY_MS, type Connection, type LiveSocket } from './live';
import { macOf, proofKeyOf } from './proof';

const ID = '0a1b2c3d';
const CREDENTIAL = Buffer.alloc(32, 7).toString('base64url');
const KEY = proofKeyOf(CREDENTIAL);

class Scripted implements LiveSocket {
  readyState = 0;
  sent: string[] = [];
  closedBy: 'tab' | 'server' | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(text: string) {
    if (this.readyState !== 1) throw new Error('sent on a socket that is not open');
    this.sent.push(text);
  }
  close() {
    if (this.readyState >= 2) return;
    this.closedBy = 'tab';
    this.readyState = 3;
    this.onclose?.({ code: 1005 });
  }
  // the server's side
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  say(message: unknown) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  end(code: number) {
    this.closedBy = 'server';
    this.readyState = 3;
    this.onclose?.({ code });
  }
  hello(): { t: string; v: number; id: string; nonce: string } {
    return JSON.parse(this.sent[0]!);
  }
  credentialSent(): boolean {
    return this.sent.some((text) => text.includes(CREDENTIAL));
  }
}

let sockets: Scripted[];
let states: Connection[];
let paired: number;
let stored: { id: string; credential: string } | null;

const live = () =>
  connect({
    url: 'ws://sheet.localhost:47590/live',
    pairing: () => stored,
    onPaired: () => void (paired += 1),
    onState: (state) => void states.push(state),
    open: (url) => {
      const socket = new Scripted(url);
      sockets.push(socket);
      return socket;
    },
  });

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  states = [];
  paired = 0;
  stored = { id: ID, credential: CREDENTIAL };
});
afterEach(() => vi.useRealTimers());

const last = () => sockets.at(-1)!;
const proofFor = (socket: Scripted) => ({ t: 'proof', mac: macOf(KEY, ID, socket.hello().nonce) });

describe('the opening', () => {
  it('says nothing before the socket opens, then the hello: its browser’s id and a fresh nonce', () => {
    live();
    expect(sockets).toHaveLength(1);
    expect(last().url).toBe('ws://sheet.localhost:47590/live');
    expect(last().sent).toEqual([]);
    last().open();
    expect(last().sent).toHaveLength(1);
    expect(last().hello()).toEqual({ t: 'hello', v: 1, id: ID, nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(last().credentialSent()).toBe(false);
  });

  it('sends the credential once the server’s MAC is its own, and is connected at paired', () => {
    const connection = live();
    last().open();
    expect(connection.state()).toBe('connecting');
    last().say(proofFor(last()));
    expect(last().sent.slice(1).map((text) => JSON.parse(text))).toEqual([{ t: 'credential', credential: CREDENTIAL }]);
    expect(paired).toBe(0);
    last().say({ t: 'paired' });
    expect(paired).toBe(1);
    expect(connection.state()).toBe('connected');
    expect(states.at(-1)).toBe('connected');
  });

  const refusedOpenings: [string, (socket: Scripted) => void][] = [
    ['a MAC under another key', (socket) => socket.say({ t: 'proof', mac: macOf(proofKeyOf(Buffer.alloc(32, 9).toString('base64url')), ID, socket.hello().nonce) })],
    ['a MAC for another nonce (a recorded proof)', (socket) => socket.say({ t: 'proof', mac: macOf(KEY, ID, Buffer.alloc(32, 1).toString('base64url')) })],
    ['a MAC for another browser', (socket) => socket.say({ t: 'proof', mac: macOf(KEY, 'ffffffff', socket.hello().nonce) })],
    ['a proof with no MAC', (socket) => socket.say({ t: 'proof' })],
    ['paired, with no proof before it', (socket) => socket.say({ t: 'paired' })],
    ['paired and ready, with no proof before them', (socket) => (socket.say({ t: 'paired' }), socket.say({ t: 'ready', v: 1, sessions: [], door: {} }))],
    ['a frame that is not JSON', (socket) => socket.say('proof')],
    ['a binary frame', (socket) => socket.onmessage?.({ data: new ArrayBuffer(4) })],
    ['nothing, past the wait', () => vi.advanceTimersByTime(PROOF_WAIT_MS)],
  ];
  it.each(refusedOpenings)('sends nothing more, and closes, on %s', (_, play) => {
    const connection = live();
    last().open();
    play(last());
    expect(last().credentialSent()).toBe(false);
    expect(last().sent).toHaveLength(1); // the hello alone
    expect(last().closedBy).toBe('tab');
    expect(connection.proven()).toBeNull();
    expect(paired).toBe(0);
  });

  it('closes when paired does not follow the credential in time, and is not connected', () => {
    const connection = live();
    last().open();
    last().say(proofFor(last()));
    vi.advanceTimersByTime(PROOF_WAIT_MS);
    expect(last().closedBy).toBe('tab');
    expect(connection.state()).not.toBe('connected');
  });

  it('opens no socket while no pairing is stored', () => {
    stored = null;
    live();
    expect(sockets).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toEqual([]);
  });
});

describe('proven()', () => {
  it('is false before the comparison, true from it until that socket closes', () => {
    const connection = live();
    expect(connection.proven()).toBeNull();
    last().open();
    expect(connection.proven()).toBeNull();
    last().say(proofFor(last()));
    expect(connection.proven()).toEqual({ id: ID, credential: CREDENTIAL });
    last().say({ t: 'paired' });
    expect(connection.proven()).toEqual({ id: ID, credential: CREDENTIAL });
    last().end(1001);
    expect(connection.proven()).toBeNull();
  });

  it('reads the socket’s own state when asked, before any close event', () => {
    const connection = live();
    last().open();
    last().say(proofFor(last()));
    last().say({ t: 'paired' });
    last().readyState = 2; // closing: the event has not come yet
    expect(connection.proven()).toBeNull();
  });

  it('is false again on the next socket until that socket’s own proof', () => {
    const connection = live();
    last().open();
    last().say(proofFor(last()));
    last().say({ t: 'paired' });
    last().end(1006);
    vi.advanceTimersByTime(RETRY_MS[0]!);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(connection.proven()).toBeNull();
  });
});

describe('the pairing it proved', () => {
  it('is the one proven() answers, and no other: a pairing stored since is not authorized by the old proof', () => {
    const connection = live();
    last().open();
    last().say(proofFor(last()));
    last().say({ t: 'paired' });
    expect(connection.proven()).toEqual({ id: ID, credential: CREDENTIAL });
    stored = { id: 'ffffffff', credential: Buffer.alloc(32, 3).toString('base64url') }; // another tab paired anew
    expect(connection.proven()).toBeNull();
    expect(last().closedBy).toBe('tab'); // the connection goes, and comes back to prove the new one
    vi.advanceTimersByTime(RETRY_MS[0]!);
    last().open();
    expect(last().hello().id).toBe('ffffffff');
    expect(connection.proven()).toBeNull();
  });

  it('is gone once no pairing is stored', () => {
    const connection = live();
    last().open();
    last().say(proofFor(last()));
    last().say({ t: 'paired' });
    stored = null;
    expect(connection.proven()).toBeNull();
  });
});

describe('after a close', () => {
  it('tries again after 1, 2, 5 and then every 10 seconds, with a new nonce each time', () => {
    expect(RETRY_MS).toEqual([1_000, 2_000, 5_000, 10_000]);
    live();
    last().open();
    const nonces = [last().hello().nonce];
    for (const wait of [1_000, 2_000, 5_000, 10_000, 10_000]) {
      last().end(1006);
      vi.advanceTimersByTime(wait - 1);
      const before = sockets.length;
      vi.advanceTimersByTime(1);
      expect(sockets.length, `after ${wait} ms`).toBe(before + 1);
      last().open();
      nonces.push(last().hello().nonce);
    }
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  it('starts the waits again after a connection that was paired', () => {
    live();
    last().open();
    last().end(1006);
    vi.advanceTimersByTime(1_000);
    last().open();
    last().end(1006);
    vi.advanceTimersByTime(2_000);
    last().open();
    last().say(proofFor(last()));
    last().say({ t: 'paired' });
    last().end(1001);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(4);
  });

  it('reads 4401 and 4403 as unpaired, and goes on trying with what is stored (T19: a refusal deletes nothing)', () => {
    for (const code of [4401, 4403]) {
      sockets = [];
      const connection = live();
      last().open();
      last().end(code);
      expect(connection.state()).toBe('unpaired');
      expect(stored).not.toBeNull();
      vi.advanceTimersByTime(1_000);
      expect(sockets).toHaveLength(2);
      last().open();
      expect(last().hello().id).toBe(ID);
      connection.close();
    }
  });

  it('reads any other close as lost', () => {
    const connection = live();
    last().open();
    last().end(1006);
    expect(connection.state()).toBe('lost');
  });

  it('uses the pairing stored when each socket opens', () => {
    live();
    last().open();
    last().end(4401);
    stored = { id: 'ffffffff', credential: Buffer.alloc(32, 3).toString('base64url') };
    vi.advanceTimersByTime(1_000);
    last().open();
    expect(last().hello().id).toBe('ffffffff');
  });

  it('close() ends the socket and tries nothing more', () => {
    const connection = live();
    last().open();
    connection.close();
    expect(last().closedBy).toBe('tab');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});
