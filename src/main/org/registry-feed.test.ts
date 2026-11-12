// The app's Registry feed (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §F, §H's
// FEED_BACKOFF_MS and M1's Proves): the hub's parts joined, its frames typed and the rest ignored, the socket held only
// while the session has a hub and reopened when the hub's address or headers change, the jittered backoff and its reset
// on a probe, a 4403 close and the refused upgrades (Access's and the Worker's) parked until the session's next change.
// A fake socket drives all of it under fake timers; one case runs the default `ws` adapter against a real server.
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { Listing, Signed } from '../../../apps/org-protocol/src/index.ts';
import { DEFAULT_HEARTBEAT_MS } from '../../endpoint/hub-link';
import { fakeReach, fakeWake } from '../../../test/support/wake-reach';
import type { Reach } from '../net/reach';
import type { WakeSource } from '../net/wake';
import { BUILD_HEADER } from './hub-client';
import { CLOSE_REMOVED, createRegistryFeed, MAX_PART_SETS, MAX_PART_TEXT, REGISTRY_APP_PATH, type RegistryFeed, type WebSocketLike } from './registry-feed';
import { heldOrgSession, type SignedIn } from './session';
import { ORG_TIMING } from './timing';

type Listener = (...args: never[]) => void;

class FakeSocket implements WebSocketLike {
  readonly #listeners = new Map<string, Listener[]>();
  /** The app ended it (§G rule 5: always a terminate). */
  terminated = false;
  /** A `close()` call, which the app never makes of its own socket (§G rule 5). */
  closeCalls = 0;
  pings = 0;
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}
  on(event: string, listener: Listener): void {
    this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
  }
  ping(): void {
    this.pings++;
  }
  terminate(): void {
    this.terminated = true;
  }
  close(): void {
    this.closeCalls++;
  }
  #emit(event: string, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args);
  }
  open(): void {
    this.#emit('open');
  }
  pong(): void {
    this.#emit('pong');
  }
  send(frame: unknown): void {
    this.#emit('message', typeof frame === 'string' ? frame : JSON.stringify(frame));
  }
  end(code: number, reason = ''): void {
    this.#emit('close', code, reason);
  }
  refuse(status: number, headers: Record<string, string> = {}): void {
    this.#emit('refused', status, headers);
  }
  fail(message: string): void {
    this.#emit('error', new Error(message));
  }
}

const HUB = 'https://hub.example.com';
const HEADERS = { 'cf-access-token': 'one' };

function signedIn(url: string | null, headers: Record<string, string> = HEADERS): SignedIn {
  return {
    identity: {} as SignedIn['identity'],
    view: {} as SignedIn['view'],
    stepUp: {} as SignedIn['stepUp'],
    hub: url === null ? null : { url, headers: () => Promise.resolve({ ...headers }) },
  };
}

/** Lets a reconcile's awaited headers resolve. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function harness(initial: SignedIn | null = signedIn(HUB), random: () => number = () => 0.5, around: { wake?: WakeSource; reach?: Reach } = {}) {
  const session = heldOrgSession(initial);
  const sockets: FakeSocket[] = [];
  const lines: string[] = [];
  const feed = createRegistryFeed({
    session,
    socket: (url, headers) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      return socket;
    },
    ...around,
    random,
    log: (line) => lines.push(line),
  });
  const seen = { open: 0, close: 0, removed: 0, credentials: 0, state: [] as number[], listings: [] as Array<{ records: Signed<Listing>[]; last: boolean }>, listing: [] as Signed<Listing>[] };
  feed.onOpen(() => seen.open++);
  feed.onClose(() => seen.close++);
  feed.onRemoved(() => seen.removed++);
  feed.onCredentialsEnded(() => seen.credentials++);
  feed.onState((version) => seen.state.push(version));
  feed.onListings((page) => seen.listings.push(page));
  feed.onListing((record) => seen.listing.push(record));
  const last = () => sockets[sockets.length - 1];
  return { session, sockets, lines, feed, seen, last };
}

/** Advances the clock by `ms` and lets the reconcile it starts finish. */
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};

const record = (id: string) => ({ body: { session: id }, sig: 'sig' }) as unknown as Signed<Listing>;

let feed: RegistryFeed | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  feed?.close();
  feed = null;
  vi.useRealTimers();
});

describe('the socket', () => {
  it('opens to the hub’s app path with the hub’s headers, and onOpen tells it', async () => {
    const h = harness();
    feed = h.feed;
    await flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.last().url).toBe(`wss://hub.example.com${REGISTRY_APP_PATH}`);
    expect(h.last().headers).toEqual(HEADERS);
    expect(h.feed.connected()).toBe(false);
    h.last().open();
    expect(h.seen.open).toBe(1);
    expect(h.feed.connected()).toBe(true);
  });

  it('maps an http hub with a trailing slash to ws', async () => {
    const h = harness(signedIn('http://127.0.0.1:8787/'));
    feed = h.feed;
    await flush();
    expect(h.last().url).toBe(`ws://127.0.0.1:8787${REGISTRY_APP_PATH}`);
  });

  it('is held only while current()?.hub is non-null, and dropped (told closed, never retried) when it turns null', async () => {
    const h = harness(null);
    feed = h.feed;
    await flush();
    expect(h.sockets).toHaveLength(0);
    h.session.set(signedIn(null));
    await flush();
    expect(h.sockets).toHaveLength(0);

    h.session.set(signedIn(HUB));
    await flush();
    expect(h.sockets).toHaveLength(1);
    h.last().open();

    h.session.set(null);
    await flush();
    expect(h.last().terminated).toBe(true);
    expect(h.feed.connected()).toBe(false);
    expect(h.seen.close).toBe(1);
    // the dropped socket's own close arrives later: it schedules nothing and is not told twice
    h.last().end(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.seen.close).toBe(1);
    await advance(60_000);
    expect(h.sockets).toHaveLength(1);
    h.feed.probe();
    await flush();
    expect(h.sockets).toHaveLength(1);
  });

  it('is kept when a change leaves the hub’s url and headers as they were', async () => {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().open();
    h.session.changed();
    h.session.set(signedIn(HUB, { ...HEADERS }));
    await flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].terminated).toBe(false);
    expect(h.seen.close).toBe(0);
  });

  it('is reopened when a change moves the hub’s headers or url', async () => {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().open();

    h.session.set(signedIn(HUB, { 'cf-access-token': 'two' }));
    await flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[0].terminated).toBe(true);
    expect(h.seen.close).toBe(1);
    expect(h.feed.connected()).toBe(false);
    expect(h.last().headers).toEqual({ 'cf-access-token': 'two' });
    h.sockets[0].end(1000);
    expect(vi.getTimerCount()).toBe(0);

    h.session.set(signedIn('https://other.example.com', { 'cf-access-token': 'two' }));
    await flush();
    expect(h.sockets).toHaveLength(3);
    expect(h.sockets[1].terminated).toBe(true);
    expect(h.last().url).toBe(`wss://other.example.com${REGISTRY_APP_PATH}`);
    expect(h.seen.close).toBe(1); // the second socket never opened
  });

  it('opens only for the newest change when an older one’s headers resolve late', async () => {
    let release: (headers: Record<string, string>) => void = () => {};
    const slow: SignedIn = { ...signedIn(HUB), hub: { url: 'https://slow.example.com', headers: () => new Promise((resolve) => (release = resolve)) } };
    const h = harness(slow);
    feed = h.feed;
    await flush();
    h.session.set(signedIn(HUB));
    await flush();
    release(HEADERS);
    await flush();
    expect(h.sockets.map((socket) => socket.url)).toEqual([`wss://hub.example.com${REGISTRY_APP_PATH}`]);
  });

  it('close() stops everything: the socket, a pending retry, later changes and probes', async () => {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().end(1006);
    expect(vi.getTimerCount()).toBe(1);
    h.feed.close();
    expect(vi.getTimerCount()).toBe(0);
    h.session.set(signedIn('https://other.example.com'));
    h.feed.probe();
    await advance(60_000);
    expect(h.sockets).toHaveLength(1);

    const g = harness();
    feed = g.feed;
    await flush();
    g.last().open();
    g.feed.close();
    expect(g.last().terminated).toBe(true);
    expect(g.feed.connected()).toBe(false);
    g.last().end(1000);
    expect(g.seen.close).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('frames', () => {
  async function opened() {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().open();
    return h;
  }

  it('types state, listings and listing frames', async () => {
    const h = await opened();
    h.last().send({ t: 'state', version: 7 });
    h.last().send({ t: 'listings', records: [record('a'), record('b')], last: false });
    h.last().send({ t: 'listings', records: [], last: true });
    h.last().send({ t: 'listing', record: record('c') });
    expect(h.seen.state).toEqual([7]);
    expect(h.seen.listings).toEqual([
      { records: [record('a'), record('b')], last: false },
      { records: [], last: true },
    ]);
    expect(h.seen.listing).toEqual([record('c')]);
  });

  it('ignores grid, summary, unknown and malformed frames, and ill-typed known ones', async () => {
    const h = await opened();
    for (const frame of [
      { t: 'grid', machines: [] },
      { t: 'summary', sessions: 3 },
      { t: 'something-new', version: 9 },
      { t: 'state', version: '8' },
      { t: 'state', version: 1.5 },
      { t: 'listings', records: 'none' },
      { t: 'listing', record: [record('x')] },
      'not json',
      '[1, 2]',
      'null',
    ]) h.last().send(frame);
    expect(h.seen).toMatchObject({ state: [], listings: [], listing: [] });
    h.last().send({ t: 'state', version: 8 });
    expect(h.seen.state).toEqual([8]);
  });

  it('reads a listings page with no `last` as not the last', async () => {
    const h = await opened();
    h.last().send({ t: 'listings', records: [record('a')] });
    expect(h.seen.listings).toEqual([{ records: [record('a')], last: false }]);
  });

  it('joins a set of parts arriving out of order into the listings frame they carry, other frames passing between', async () => {
    const h = await opened();
    const text = JSON.stringify({ t: 'listings', records: [record('a'), record('b'), record('c')], last: true });
    const third = Math.ceil(text.length / 3);
    const slices = [text.slice(0, third), text.slice(third, 2 * third), text.slice(2 * third)];
    const part = (index: number) => ({ t: 'part', id: 'p1', index, count: 3, data: slices[index] });
    h.last().send(part(2));
    h.last().send({ t: 'state', version: 4 });
    h.last().send(part(0));
    expect(h.seen.listings).toEqual([]);
    expect(h.seen.state).toEqual([4]);
    h.last().send(part(1));
    expect(h.seen.listings).toEqual([{ records: [record('a'), record('b'), record('c')], last: true }]);
    // the set is spent: its parts again start a new one
    h.last().send(part(1));
    expect(h.seen.listings).toHaveLength(1);
  });

  it('holds at most MAX_PART_SETS incomplete sets: one more drops them all, logged, and later sets join again', async () => {
    const h = await opened();
    const whole = (version: number) => JSON.stringify({ t: 'state', version });
    const half = (id: string, version: number, index: number) => ({ t: 'part', id, index, count: 2, data: index === 0 ? whole(version).slice(0, 5) : whole(version).slice(5) });
    for (let i = 0; i < MAX_PART_SETS; i++) h.last().send(half(`s${i}`, i + 1, 0));
    h.last().send(half('one-more', 9, 0));
    expect(h.lines.some((l) => l.includes(`more than ${MAX_PART_SETS} sets of parts are incomplete`))).toBe(true);
    h.last().send(half('s0', 1, 1));
    expect(h.seen.state).toEqual([]);
    h.last().send(half('again', 7, 0));
    h.last().send(half('again', 7, 1));
    expect(h.seen.state).toEqual([7]);
  });

  it('holds at most MAX_PART_TEXT of incomplete parts: a set past it is dropped, logged', async () => {
    const h = await opened();
    const text = JSON.stringify({ t: 'state', version: 5, pad: 'x'.repeat(MAX_PART_TEXT + 1024) });
    const size = Math.ceil(text.length / 5);
    for (let i = 0; i < 5; i++) h.last().send({ t: 'part', id: 'big', index: i, count: 5, data: text.slice(i * size, (i + 1) * size) });
    expect(h.seen.state).toEqual([]);
    expect(h.lines.some((l) => l.includes('incomplete sets of parts hold more than'))).toBe(true);
  });

  it('drops a set whose joined text is not JSON, and ignores ill-formed parts', async () => {
    const h = await opened();
    h.last().send({ t: 'part', id: 'bad', index: 0, count: 2, data: '{"t":"sta' });
    h.last().send({ t: 'part', id: 'bad', index: 1, count: 2, data: 'te", oops' });
    h.last().send({ t: 'part', id: 'q', index: 2, count: 2, data: '{}' });
    h.last().send({ t: 'part', id: 'q', index: 0, count: 0, data: '{}' });
    h.last().send({ t: 'part', id: 7, index: 0, count: 1, data: '{}' });
    expect(h.seen).toMatchObject({ state: [], listings: [], listing: [] });
    const whole = JSON.stringify({ t: 'state', version: 3 });
    h.last().send({ t: 'part', id: 'ok', index: 0, count: 1, data: whole });
    expect(h.seen.state).toEqual([3]);
  });

  it('passes a listener’s throw to the log and still tells the others', async () => {
    const h = await opened();
    h.feed.onState(() => {
      throw new Error('boom');
    });
    h.last().send({ t: 'state', version: 2 });
    expect(h.seen.state).toEqual([2]);
    expect(h.lines.some((line) => line.includes('boom'))).toBe(true);
  });
});

describe('the backoff', () => {
  it('steps through FEED_BACKOFF_MS, jittered by ±20%, the last step repeated', async () => {
    const draws = [0, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.25];
    const h = harness(signedIn(HUB), () => draws.shift() ?? 0.5);
    feed = h.feed;
    await flush();
    const waits = [800, 2_400, 4_000, 8_000, 16_000, 30_000, 30_000, 27_000];
    for (const [i, wait] of waits.entries()) {
      h.last().end(1006);
      await advance(wait - 1);
      expect(h.sockets).toHaveLength(i + 1);
      await advance(1);
      expect(h.sockets).toHaveLength(i + 2);
    }
  });

  it('starts over after a socket opens, and onClose tells an open socket’s end', async () => {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().end(1006);
    await advance(1_000);
    h.last().end(1006);
    await advance(2_000);
    expect(h.sockets).toHaveLength(3);
    h.last().open();
    h.last().end(1001);
    expect(h.seen.close).toBe(1);
    expect(h.feed.connected()).toBe(false);
    await advance(1_000);
    expect(h.sockets).toHaveLength(4);
  });

  it('retries a socket that errors before it opens, once though a close follows', async () => {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().fail('ECONNREFUSED');
    h.last().end(1006);
    expect(vi.getTimerCount()).toBe(1);
    expect(h.seen.close).toBe(0);
    await advance(1_000);
    expect(h.sockets).toHaveLength(2);
    // opened, an error then its close: told closed once, retried once
    h.last().open();
    h.last().fail('ECONNRESET');
    expect(h.seen.close).toBe(0);
    h.last().end(1006);
    expect(h.seen.close).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('a probe reconnects at once and resets the steps; it does nothing while a socket is held', async () => {
    const h = harness();
    feed = h.feed;
    await flush();
    for (let i = 0; i < 3; i++) {
      h.last().end(1006);
      await advance([1_000, 2_000, 4_000][i]);
    }
    expect(h.sockets).toHaveLength(4);
    h.last().end(1006); // the next wait is 8 s
    h.feed.probe();
    await flush();
    expect(h.sockets).toHaveLength(5);
    expect(vi.getTimerCount()).toBe(0);
    h.feed.probe();
    await flush();
    expect(h.sockets).toHaveLength(5);
    h.last().end(1006);
    await advance(1_000);
    expect(h.sockets).toHaveLength(6);
  });
});

describe('the ends that wait for the session', () => {
  it('a 4403 close tells onRemoved and retries nothing, probes included, until the session’s next change', async () => {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().open();
    h.last().end(CLOSE_REMOVED, 'removed');
    expect(h.seen.removed).toBe(1);
    expect(h.seen.close).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    h.feed.probe();
    await advance(120_000);
    expect(h.sockets).toHaveLength(1);
    h.session.changed();
    await flush();
    expect(h.sockets).toHaveLength(2);
  });

  it.each([401, 403, 302])('an upgrade refused %i without X-Desk-Build tells onCredentialsEnded and parks', async (status) => {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().refuse(status, { location: 'https://team.cloudflareaccess.com/' });
    expect(h.seen.credentials).toBe(1);
    expect(h.seen.removed).toBe(0);
    expect(h.seen.close).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    h.feed.probe();
    await advance(120_000);
    expect(h.sockets).toHaveLength(1);
    h.session.set(signedIn(HUB, { 'cf-access-token': 'fresh' }));
    await flush();
    expect(h.sockets).toHaveLength(2);
  });

  it('the Worker’s own 403 on the upgrade tells onRemoved and parks', async () => {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().refuse(403, { [BUILD_HEADER]: '2026.10.28' });
    expect(h.seen.removed).toBe(1);
    expect(h.seen.credentials).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await advance(120_000);
    expect(h.sockets).toHaveLength(1);
    h.session.changed();
    await flush();
    expect(h.sockets).toHaveLength(2);
  });

  it.each([
    [503, { [BUILD_HEADER]: '2026.10.28' }],
    [401, { [BUILD_HEADER]: '2026.10.28' }],
    [502, {}],
    [500, {}],
  ])('another refused upgrade (%i, %o) is retried on the backoff', async (status, headers) => {
    const h = harness();
    feed = h.feed;
    await flush();
    h.last().refuse(status, headers);
    expect(h.seen).toMatchObject({ removed: 0, credentials: 0 });
    await advance(999);
    expect(h.sockets).toHaveLength(1);
    await advance(1);
    expect(h.sockets).toHaveLength(2);
  });
});

// P5 O15 M2b §G: the five rules. A wake of WAKE_DROP_MS or more drops the socket in the turn it is heard and reopens
// it behind the reach's answer or its floor, one socket at a time; a protocol ping every HUB_PING_MS, answered within
// HUB_PONG_MS or dropped; an open in the window has HUB_WINDOW_OPEN_MS; the app's own end is a terminate.
describe('after a wake, and the pings (P5 O15 M2b §G)', () => {
  function woken(options: { open?: boolean; session?: SignedIn | null } = {}) {
    const wake = fakeWake();
    const reach = fakeReach({ open: options.open });
    const h = harness(options.session === undefined ? signedIn(HUB) : options.session, () => 0.5, { wake: wake.source, reach: reach.reach });
    feed = h.feed;
    /** The sockets the feed has not terminated. */
    const live = () => h.sockets.filter((socket) => !socket.terminated);
    return { ...h, wake, reach, live };
  }

  it('holds the ping period to mawsd’s own heartbeat to the hub', () => {
    expect(ORG_TIMING.HUB_PING_MS).toBe(DEFAULT_HEARTBEAT_MS);
    expect(ORG_TIMING).toMatchObject({ HUB_PING_MS: 15_000, HUB_PONG_MS: 5_000, HUB_WINDOW_OPEN_MS: 2_000 });
  });

  it('a wake of 10 s terminates the open socket in the same turn, tells its end once, and opens exactly one socket when the hub answers', async () => {
    const h = woken();
    await flush();
    h.last().open();
    h.wake.wake(10_000);
    expect(h.sockets[0].terminated).toBe(true);
    expect(h.seen.close).toBe(1);
    expect(h.feed.connected()).toBe(false);
    expect(h.reach.windows).toEqual(['wake']);
    expect(h.lines).toContain('[org-feed] wake after 10000 ms: dropped the socket');
    await flush();
    expect(h.sockets).toHaveLength(1); // waiting on the hub's path
    expect(h.reach.waiting.map((waiter) => waiter.target)).toEqual([HUB]);
    h.sockets[0].end(1006); // the old socket's own end, later: nothing more is told or scheduled
    expect(h.seen.close).toBe(1);
    h.reach.answer(true);
    await flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.last().url).toBe(`wss://hub.example.com${REGISTRY_APP_PATH}`);
    h.last().open();
    expect(h.seen.open).toBe(2);
    await advance(10_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('a wake with no socket says so and opens behind the hub’s answer, its backoff back at the first step', async () => {
    const h = woken();
    await flush();
    for (const wait of [1_000, 2_000, 4_000]) {
      h.last().end(1006);
      await advance(wait);
    }
    h.last().end(1006); // the next wait would be 8 s
    expect(h.sockets).toHaveLength(4);
    h.wake.wake(3_600_000);
    expect(h.lines).toContain('[org-feed] wake after 3600000 ms: no socket');
    await flush();
    h.reach.answer(true);
    await flush();
    expect(h.sockets).toHaveLength(5);
    h.last().end(1006);
    await advance(999);
    expect(h.sockets).toHaveLength(5);
    await advance(1); // the first step, then the reach
    expect(h.reach.waiting).toHaveLength(1);
    expect(h.sockets).toHaveLength(5);
    h.reach.answer(true);
    await flush();
    expect(h.sockets).toHaveLength(6);
  });

  it('holds no second socket while one is opening or awaited, whatever is heard meanwhile', async () => {
    const h = woken();
    await flush();
    h.last().open();
    h.wake.wake(10_000);
    await flush();
    h.feed.probe();
    h.session.changed();
    await flush();
    expect(h.lines).toContain('[org-feed] probe: opening');
    expect(h.reach.waiting).toHaveLength(1);
    h.reach.answer(true);
    await flush();
    expect(h.live()).toHaveLength(1);
    h.feed.probe();
    h.session.changed();
    h.wake.wake(5_000);
    await flush();
    expect(h.live()).toHaveLength(1);
    expect(h.sockets).toHaveLength(2);
    // a wake while that socket opens drops it (never open, so nothing told) and waits again
    h.wake.wake(20_000);
    expect(h.live()).toHaveLength(0);
    expect(h.seen.close).toBe(1);
    await flush();
    h.reach.answer(true);
    await flush();
    expect(h.live()).toHaveLength(1);
  });

  it('pings every 15 s from the open: a pong within 5 s keeps the socket, none drops it and opens again', async () => {
    const h = woken();
    await flush();
    await advance(20_000);
    expect(h.last().pings).toBe(0); // nothing before the open
    h.last().open();
    await advance(14_999);
    expect(h.last().pings).toBe(0);
    await advance(1);
    expect(h.last().pings).toBe(1);
    await advance(4_999);
    h.last().pong();
    await advance(10_001);
    expect(h.last().pings).toBe(2);
    expect(h.last().terminated).toBe(false);
    await advance(4_999);
    expect(h.last().terminated).toBe(false);
    await advance(1);
    expect(h.sockets[0].terminated).toBe(true);
    expect(h.seen.close).toBe(1);
    expect(h.lines).toContain('[org-feed] no pong within 5000 ms: dropped the socket');
    expect(h.sockets).toHaveLength(2); // no window open: today's open, at once
    h.sockets[0].pong(); // a late pong answers nothing
    expect(h.sockets).toHaveLength(2);
  });

  it('only a pong answers a ping: a frame from the hub does not', async () => {
    const h = woken();
    await flush();
    h.last().open();
    await advance(15_000);
    h.last().send({ t: 'state', version: 3 });
    await advance(5_000);
    expect(h.sockets[0].terminated).toBe(true);
  });

  it('a wake of 9 s pings an open socket and drops nothing; with no socket it opens now', async () => {
    const h = woken();
    await flush();
    h.last().open();
    h.wake.wake(9_000);
    expect(h.last().pings).toBe(1);
    expect(h.last().terminated).toBe(false);
    expect(h.reach.windows).toEqual([]);
    expect(h.lines).toContain('[org-feed] wake after 9000 ms: ping sent');
    h.last().pong();
    await advance(5_000);
    expect(h.last().terminated).toBe(false);
    h.last().end(1006);
    expect(h.sockets).toHaveLength(1);
    h.wake.wake(9_000); // the 1 s backoff not waited out
    await flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.lines).toContain('[org-feed] wake after 9000 ms: no socket');
  });

  it('probe(), and the unlock, ping an open socket and reconnect when there is none', async () => {
    const h = woken();
    await flush();
    h.last().open();
    h.feed.probe();
    expect(h.last().pings).toBe(1);
    expect(h.lines).toContain('[org-feed] probe: ping sent');
    h.wake.unlock();
    expect(h.last().pings).toBe(2);
    h.last().end(1006);
    h.wake.unlock();
    await flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.lines).toContain('[org-feed] probe: no socket');
  });

  it('an open made in the window that gets no answer ends at 2 s and takes the backoff', async () => {
    const h = woken({ open: true });
    await flush();
    h.reach.answer(true);
    await flush();
    expect(h.sockets).toHaveLength(1);
    await advance(1_999);
    expect(h.last().terminated).toBe(false);
    await advance(1);
    expect(h.last().terminated).toBe(true);
    expect(h.lines).toContain('[org-feed] the open had no answer within 2000 ms');
    await advance(999);
    expect(h.reach.waiting).toHaveLength(0);
    await advance(1);
    expect(h.reach.waiting).toHaveLength(1);
    // outside the window an open keeps wsSocket's own deadline
    h.reach.closeWindow();
    await flush();
    expect(h.sockets).toHaveLength(2);
    await advance(60_000);
    expect(h.last().terminated).toBe(false);
  });

  it('opens anyway once it has waited 10 s on the reach, and the hub’s answer before that open opened terminates it for one more', async () => {
    const h = woken({ open: true });
    await flush();
    await advance(9_999);
    expect(h.sockets).toHaveLength(0);
    await advance(1);
    expect(h.sockets).toHaveLength(1);
    expect(h.reach.waiting).toHaveLength(1); // the floor's open keeps its wait
    h.reach.answer(true);
    await flush();
    expect(h.sockets[0].terminated).toBe(true);
    expect(h.sockets).toHaveLength(2);
    expect(h.live()).toHaveLength(1);
    expect(h.seen.close).toBe(0);
    h.last().open();
    expect(h.feed.connected()).toBe(true);
  });

  it('a floor’s open that opens ends its wait', async () => {
    const h = woken({ open: true });
    await flush();
    await advance(10_000);
    h.last().open();
    expect(h.reach.waiting).toHaveLength(0);
    await advance(14_000); // no second floor, before the first ping
    expect(h.sockets).toHaveLength(1);
    expect(h.feed.connected()).toBe(true);
  });

  it('a floor’s open that ends with nothing from the hub waits again with no backoff; one the hub refused takes the backoff', async () => {
    const h = woken({ open: true });
    await flush();
    await advance(10_000);
    h.last().fail('ECONNREFUSED');
    expect(h.reach.waiting).toHaveLength(1);
    await advance(9_999);
    expect(h.sockets).toHaveLength(1);
    await advance(1);
    expect(h.sockets).toHaveLength(2); // the next floor, ten seconds on
    await advance(2_000); // its 2 s in the window: nothing from the hub either
    expect(h.last().terminated).toBe(true);
    expect(h.reach.waiting).toHaveLength(1);
    await advance(10_000);
    expect(h.sockets).toHaveLength(3);
    h.last().refuse(503, { [BUILD_HEADER]: '2026.11.10' });
    expect(h.reach.waiting).toHaveLength(0);
    await advance(999);
    expect(h.reach.waiting).toHaveLength(0);
    await advance(1);
    expect(h.reach.waiting).toHaveLength(1);
    expect(h.sockets).toHaveLength(3);
  });

  it('the app’s own ends are a terminate, never a close(): a wake, a missed pong, the hub gone, a new hub, close()', async () => {
    const h = woken();
    await flush();
    h.last().open();
    h.wake.wake(60_000);
    await flush();
    h.reach.answer(true);
    await flush();
    h.last().open();
    await advance(20_000); // a ping with no pong
    h.reach.answer(true); // the window is still open: each open waits on the hub's path
    await flush();
    h.last().open();
    h.session.set(signedIn('https://other.example.com'));
    await flush();
    h.reach.answer(true);
    await flush();
    h.last().open();
    h.session.set(null);
    await flush();
    h.session.set(signedIn(HUB));
    await flush();
    h.reach.answer(true);
    await flush();
    h.feed.close();
    expect(h.sockets).toHaveLength(5);
    expect(h.sockets.every((socket) => socket.terminated)).toBe(true);
    expect(h.sockets.map((socket) => socket.closeCalls)).toEqual([0, 0, 0, 0, 0]);
  });

  it('counts the listings pages since the open and says so at the last', async () => {
    const h = woken();
    await flush();
    h.last().open();
    h.last().send({ t: 'listings', records: [record('a'), record('b')], last: false });
    h.last().send({ t: 'listings', records: [record('c')], last: true });
    expect(h.lines).toContain('[org-feed] listings: last page, 3 records in 2 pages');
    expect(h.seen.listings).toHaveLength(2);
    h.last().end(1006);
    await advance(1_000);
    h.last().open();
    h.last().send({ t: 'listings', records: [], last: true });
    expect(h.lines).toContain('[org-feed] listings: last page, 0 records in 1 pages');
  });

  it('a parked feed hears a wake and opens nothing', async () => {
    const h = woken();
    await flush();
    h.last().open();
    h.last().end(CLOSE_REMOVED);
    h.wake.wake(3_600_000);
    h.wake.wake(9_000);
    h.wake.unlock();
    await advance(60_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.reach.windows).toEqual([]);
    expect(h.lines).toContain('[org-feed] wake after 3600000 ms: parked');
  });

  it('close() leaves the wake source', async () => {
    const h = woken();
    await flush();
    expect(h.wake.listeners()).toBe(2);
    h.feed.close();
    expect(h.wake.listeners()).toBe(0);
  });
});

describe('the default ws adapter', () => {
  it('sends the headers, delivers a text frame, and sees a refused upgrade’s status and headers', async () => {
    vi.useRealTimers();
    const received: Array<Record<string, string | string[] | undefined>> = [];
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      verifyClient: (info, answer) => {
        const token = info.req.headers['cf-access-token'];
        if (token === 'good') answer(true);
        else if (token === 'removed') answer(false, 403, 'Forbidden', { [BUILD_HEADER]: 'test' });
        else answer(false, 401, 'Unauthorized');
      },
    });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const serverEnds: number[] = [];
    let serverPings = 0;
    server.on('connection', (socket, request) => {
      received.push({ ...request.headers, url: request.url });
      socket.on('close', (code) => serverEnds.push(code));
      socket.on('ping', () => serverPings++);
      socket.send(Buffer.from(JSON.stringify({ t: 'state', version: 99 })), { binary: true });
      socket.send(JSON.stringify({ t: 'state', version: 5 }));
    });
    const hub = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const session = heldOrgSession(signedIn(hub, { 'cf-access-token': 'good' }));
    const lines: string[] = [];
    const live = createRegistryFeed({ session, log: (line) => lines.push(line) });
    try {
      const versions: number[] = [];
      await new Promise<void>((resolve) =>
        live.onState((version) => {
          versions.push(version);
          resolve();
        }),
      );
      expect(versions).toEqual([5]); // the binary frame was not read
      expect(live.connected()).toBe(true);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ 'cf-access-token': 'good', url: REGISTRY_APP_PATH });
      // §G: a probe is a protocol ping, which the server's stack answers itself; the app's own end is a terminate,
      // which the server reads as 1006, no close frame sent
      const before = lines.length;
      live.probe();
      await new Promise<void>((resolve) => {
        const check = () => (serverPings === 1 ? resolve() : setTimeout(check, 5));
        check();
      });
      expect(lines.slice(before)).toEqual(['[org-feed] probe: ping sent']);

      const ended = new Promise<void>((resolve) => live.onCredentialsEnded(resolve));
      session.set(signedIn(hub, { 'cf-access-token': 'expired' }));
      await ended;
      expect(live.connected()).toBe(false);
      await new Promise<void>((resolve) => {
        const check = () => (serverEnds.length > 0 ? resolve() : setTimeout(check, 5));
        check();
      });
      expect(serverEnds).toEqual([1006]);

      const removed = new Promise<void>((resolve) => live.onRemoved(resolve));
      session.set(signedIn(hub, { 'cf-access-token': 'removed' }));
      await removed;
      expect(lines.some((line) => line.includes('Access answered the upgrade 401'))).toBe(true);
      expect(lines.some((line) => line.includes('refused the upgrade 403'))).toBe(true);
    } finally {
      live.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
