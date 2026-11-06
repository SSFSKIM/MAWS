// The Project socket's client (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's Touches for
// project-socket.ts and Proves for project-socket.test.ts): `resume` from the cached offset at each `welcome`, `more`
// followed, the log live after `caught-up`, a device's `human` sent and its `human-ack` or `refused` answered, the hub's
// parts joined, a reconnect on M1's backoff resuming from the last offset, and the ends that wait for the session's next
// change: a `4403` close ("removed"), an upgrade Access answered, and the Worker refusing the project. A fake socket
// under fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILD_HEADER } from '../hub-client';
import type { WebSocketLike } from '../registry-feed';
import type { HubAccess } from '../session';
import { CLOSE_CREDENTIALS, CLOSE_REMOVED, CLOSE_UNKNOWN_PROJECT, openProjectSocket, type DeviceHuman, type HumanAck, type HumanRefused, type LoggedEvent } from './project-socket';

type Listener = (...args: never[]) => void;
const PROJECT = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';

class FakeSocket implements WebSocketLike {
  readonly #listeners = new Map<string, Listener[]>();
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}
  on(event: string, listener: Listener): void {
    this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
  }
  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }
  close(): void {
    this.closed = true;
  }
  #emit(event: string, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args);
  }
  open(): void {
    this.#emit('open');
  }
  /** A frame from the hub. */
  frame(frame: unknown): void {
    this.#emit('message', typeof frame === 'string' ? frame : JSON.stringify(frame));
  }
  end(code: number): void {
    this.#emit('close', code, '');
  }
  refuse(status: number, headers: Record<string, string> = {}): void {
    this.#emit('refused', status, headers);
  }
}

const event = (offset: number, seq = offset): LoggedEvent => ({ offset, event: { writer: 'mini/s1', seq, kind: 'say', text: `say ${seq}` } });
const human = (nonce: string): DeviceHuman =>
  ({ kind: 'human', from: 'human', member: 'a'.repeat(32), to: '*', text: 'hi', created: '2026-11-06T12:00:00.000Z', nonce, sig: { alg: 'ES256', kid: 'k', sig: 's' } }) as unknown as DeviceHuman;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function harness(options: { after?: number; hub?: HubAccess | null } = {}) {
  const sockets: FakeSocket[] = [];
  const seen = { welcome: 0, logs: [] as LoggedEvent[][], caughtUp: [] as number[], answers: [] as Array<HumanAck | HumanRefused>, closed: [] as number[] };
  let hub: HubAccess | null = options.hub === undefined ? { url: 'https://hub.example.com', headers: async () => ({ 'cf-access-token': 't' }) } : options.hub;
  const client = openProjectSocket({
    hub: () => hub,
    project: PROJECT,
    after: options.after ?? 0,
    onWelcome: () => seen.welcome++,
    onLog: (events) => seen.logs.push(events),
    onCaughtUp: (offset) => seen.caughtUp.push(offset),
    onAnswer: (answer) => seen.answers.push(answer),
    onClosed: (code) => seen.closed.push(code),
    socket: (url, headers) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      return socket;
    },
    random: () => 0.5,
    log: () => {},
  });
  const last = () => sockets[sockets.length - 1];
  return { client, sockets, seen, last, setHub: (next: HubAccess | null) => void (hub = next) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the Project socket', () => {
  it("opens the project's socket with the hub's headers and resumes from the cached offset at its welcome", async () => {
    const h = harness({ after: 41 });
    await flush();
    expect(h.last().url).toBe(`wss://hub.example.com/api/projects/${PROJECT}/socket`);
    expect(h.last().headers).toEqual({ 'cf-access-token': 't' });
    h.last().open();
    expect(h.last().sent).toEqual([]);
    h.last().frame({ t: 'welcome', project: PROJECT, member: 'm', head: 50 });
    expect(h.last().sent).toEqual([{ t: 'resume', after: 41 }]);
    expect(h.seen.welcome).toBe(1);
  });

  it('follows `more` page by page, then delivers the log live after `caught-up`', async () => {
    const h = harness();
    await flush();
    h.last().open();
    h.last().frame({ t: 'welcome' });
    h.last().frame({ t: 'log', events: [event(1), event(2)] });
    h.last().frame({ t: 'more', offset: 3 });
    expect(h.last().sent).toEqual([
      { t: 'resume', after: 0 },
      { t: 'resume', after: 3 },
    ]);
    h.last().frame({ t: 'log', events: [event(4)] });
    h.last().frame({ t: 'caught-up', offset: 5 });
    h.last().frame({ t: 'log', events: [event(6)] });
    expect(h.seen.logs.map((events) => events.map((e) => e.offset))).toEqual([[1, 2], [4], [6]]);
    expect(h.seen.caughtUp).toEqual([5]);
  });

  it("joins the hub's parts, and drops events without a position and frames it doesn't know", async () => {
    const h = harness();
    await flush();
    h.last().open();
    h.last().frame({ t: 'welcome' });
    const text = JSON.stringify({ t: 'log', events: [event(1), { offset: 2, event: { kind: 'say' } }, { offset: -1, event: event(3).event }] });
    h.last().frame({ t: 'part', id: 'p', index: 1, count: 2, data: text.slice(10) });
    h.last().frame({ t: 'part', id: 'p', index: 0, count: 2, data: text.slice(0, 10) });
    h.last().frame({ t: 'session', message: {} });
    h.last().frame('not json');
    expect(h.seen.logs).toEqual([[event(1)]]);
  });

  it('sends a human once welcomed, and answers its human-ack or a refusal naming its nonce', async () => {
    const h = harness();
    await flush();
    expect(h.client.send(human('n0'))).toBe(false);
    h.last().open();
    expect(h.client.send(human('n0'))).toBe(false);
    h.last().frame({ t: 'welcome' });
    expect(h.client.send(human('n1'))).toBe(true);
    expect(h.last().sent.at(-1)).toEqual({ t: 'human', event: human('n1') });
    h.last().frame({ t: 'human-ack', nonce: 'n1', offset: 9, writer: `hub/${'a'.repeat(32)}`, seq: 1 });
    h.last().frame({ t: 'refused', refusal: { reason: 'not-reachable', nonce: 'n2' } });
    h.last().frame({ t: 'refused', refusal: { reason: 'bad-shape', message: 'no frame' } }); // no nonce: not an answer
    expect(h.seen.answers).toEqual([
      { t: 'human-ack', nonce: 'n1', offset: 9, writer: `hub/${'a'.repeat(32)}`, seq: 1 },
      { t: 'refused', refusal: { reason: 'not-reachable', nonce: 'n2' } },
    ]);
  });

  it('reconnects on the backoff after a close, resuming after the last offset it was given', async () => {
    const h = harness({ after: 2 });
    await flush();
    h.last().open();
    h.last().frame({ t: 'welcome' });
    h.last().frame({ t: 'log', events: [event(3)] });
    h.last().frame({ t: 'caught-up', offset: 7 });
    h.last().end(1006);
    expect(h.seen.closed).toEqual([1006]);
    expect(h.client.send(human('n'))).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(2);
    h.last().open();
    h.last().frame({ t: 'welcome' });
    expect(h.last().sent).toEqual([{ t: 'resume', after: 7 }]);
    expect(h.seen.welcome).toBe(2);
    // a failed attempt waits longer; a welcome resets the waits
    h.last().end(1006);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(3);
    h.last().end(1006);
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.sockets).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(4);
  });

  it('ends at a 4403 close ("removed") and reconnects no more', async () => {
    const h = harness();
    await flush();
    h.last().open();
    h.last().frame({ t: 'welcome' });
    h.last().end(4403);
    expect(h.seen.closed).toEqual([CLOSE_REMOVED]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it("ends at an upgrade Access answered, or the Worker refusing the member or the project; retries the Worker's other answers", async () => {
    const access = harness();
    await flush();
    access.last().refuse(302);
    expect(access.seen.closed).toEqual([CLOSE_CREDENTIALS]);
    const removed = harness();
    await flush();
    removed.last().refuse(403, { [BUILD_HEADER]: 'b' });
    expect(removed.seen.closed).toEqual([CLOSE_REMOVED]);
    const unknown = harness();
    await flush();
    unknown.last().refuse(404, { [BUILD_HEADER]: 'b' });
    expect(unknown.seen.closed).toEqual([CLOSE_UNKNOWN_PROJECT]);
    const busy = harness();
    await flush();
    busy.last().refuse(503, { [BUILD_HEADER]: 'b' });
    expect(busy.seen.closed).toEqual([1006]); // an attempt that failed, told as any close is
    await vi.advanceTimersByTimeAsync(60_000);
    for (const h of [access, removed, unknown]) expect(h.sockets).toHaveLength(1);
    expect(busy.sockets.length).toBeGreaterThan(1);
  });

  it('opens nothing with no hub, and stops retrying once the hub is gone', async () => {
    const none = harness({ hub: null });
    await flush();
    expect(none.sockets).toHaveLength(0);
    const h = harness();
    await flush();
    h.last().open();
    h.last().end(1006);
    h.setHub(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('closes its socket and retries nothing once closed, reporting nothing more', async () => {
    const h = harness();
    await flush();
    h.last().open();
    h.last().frame({ t: 'welcome' });
    h.client.close();
    expect(h.last().closed).toBe(true);
    h.last().end(1000);
    h.last().frame({ t: 'log', events: [event(1)] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.seen.closed).toEqual([]);
    expect(h.seen.logs).toEqual([]);
  });
});
