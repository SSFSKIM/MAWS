// P5 O15 M2b §E (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): the burst window and its probes, on a fake
// `connect`, a fake `lookup` and vitest's fake clock; two cases dial a real loopback listener through the defaults.
import { createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReach, NO_REACH, PROBE_CONNECT_MS, PROBE_STAGGER_MS, REACH_WINDOW_MS, WINDOW_FLOOR_MS } from './reach';

type Call = { host: string; port: number; signal: AbortSignal; ended: boolean; resolve(): void; reject(error: unknown): void };

/** A `connect` whose every try waits for the test: connected by `resolve`, failed by `reject`, destroyed by its signal. */
function fakeConnect(answer?: (call: Call) => void) {
  const calls: Call[] = [];
  const connect = (host: string, port: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const call: Call = {
        host,
        port,
        signal,
        ended: false,
        resolve: () => ((call.ended = true), resolve()),
        reject: (error) => ((call.ended = true), reject(error)),
      };
      calls.push(call);
      answer?.(call);
    });
  /** The tries in flight: neither connected, failed nor destroyed. */
  const live = () => calls.filter((call) => !call.ended && !call.signal.aborted);
  return { calls, connect, live };
}

type Address = { address: string; family: number };
type Asked = { host: string; ended: boolean; resolve(answer: readonly Address[]): void; reject(error: unknown): void };

/** A `lookup` whose every question waits for the test, unless `answer` answers it. */
function fakeLookup(answer?: (asked: Asked) => void) {
  const asked: Asked[] = [];
  const lookup = (host: string) =>
    new Promise<readonly Address[]>((resolve, reject) => {
      const question: Asked = {
        host,
        ended: false,
        resolve: (addresses) => ((question.ended = true), resolve(addresses)),
        reject: (error) => ((question.ended = true), reject(error)),
      };
      asked.push(question);
      answer?.(question);
    });
  /** The lookups of `host` not answered yet. */
  const outstanding = (host: string) => asked.filter((question) => question.host === host && !question.ended).length;
  return { asked, lookup, outstanding };
}

function reach(answer?: (call: Call) => void, answerLookup?: (asked: Asked) => void) {
  const fake = fakeConnect(answer);
  const resolver = fakeLookup(answerLookup);
  const lines: string[] = [];
  const subject = createReach({ connect: fake.connect, lookup: resolver.lookup, log: (line) => void lines.push(line) });
  return { ...fake, ...resolver, lines, reach: subject };
}

/** Every reaction queued now has run, a lookup's answer and the probe it starts among them. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A promise's answer, or 'pending', once every queued reaction has run. */
async function settled<T>(promise: Promise<T>): Promise<T | 'pending'> {
  const pending = Symbol('pending');
  const winner = await Promise.race([promise, new Promise<typeof pending>((resolve) => setImmediate(() => resolve(pending)))]);
  return winner === pending ? 'pending' : (winner as T);
}

const MACHINE = 'ws://100.64.0.7:47830/rl2';
const refused = () => Object.assign(new Error('connect ECONNREFUSED 100.64.0.7:47830'), { code: 'ECONNREFUSED' });
const HUB = 'wss://hub.example.com/api/registry/socket?app=1';
const HUB_V4 = { address: '203.0.113.5', family: 4 };

afterEach(() => void vi.useRealTimers());

describe('the reach (§E)', () => {
  it('names its constants as §E and §F state them', () => {
    expect([REACH_WINDOW_MS, PROBE_STAGGER_MS, PROBE_CONNECT_MS, WINDOW_FLOOR_MS]).toEqual([60_000, 100, 3_000, 10_000]);
  });

  it('answers false at once and connects nothing while no window is open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { calls, reach: subject } = reach();
    expect(subject.windowOpen()).toBe(false);
    expect(await settled(subject.reachable(MACHINE))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('probes at once and then every 100 ms while someone waits, never a thirty-first in flight, a hanging probe destroyed at 3 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { calls, live, lines, reach: subject } = reach();
    subject.openWindow('wake');
    expect(subject.windowOpen()).toBe(true);
    expect(lines).toEqual(['[reach] window open for 60 s (wake)']);
    const answer = subject.reachable(MACHINE);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ host: '100.64.0.7', port: 47830 });
    vi.advanceTimersByTime(PROBE_STAGGER_MS);
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(PROBE_CONNECT_MS - 2 * PROBE_STAGGER_MS); // 2.9 s: thirty started, none ended
    expect(calls).toHaveLength(30);
    expect(live()).toHaveLength(30);
    for (let step = 0; step < 50; step++) {
      vi.advanceTimersByTime(PROBE_STAGGER_MS);
      expect(live().length).toBeLessThanOrEqual(30);
    }
    expect(calls[0]!.signal.aborted).toBe(true); // destroyed at 3 s
    expect(calls).toHaveLength(80);
    expect(await settled(answer)).toBe('pending');
    subject.close();
  });

  it('keeps each probe’s 3 s and the thirty in flight through a backward correction of the wall clock', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { calls, live, reach: subject } = reach();
    subject.openWindow('wake');
    const answer = subject.reachable(MACHINE);
    vi.advanceTimersByTime(PROBE_CONNECT_MS - PROBE_STAGGER_MS); // thirty hanging, the k-th started at k × 100 ms
    expect(live()).toHaveLength(30);
    vi.setSystemTime(Date.now() - 30_000); // the wall clock set back; elapsed time goes on
    for (let elapsed = PROBE_CONNECT_MS; elapsed <= 8_000; elapsed += PROBE_STAGGER_MS) {
      vi.advanceTimersByTime(PROBE_STAGGER_MS);
      expect(live().length).toBeLessThanOrEqual(30);
      calls.forEach((call, k) => expect(call.signal.aborted).toBe(k * PROBE_STAGGER_MS + PROBE_CONNECT_MS <= elapsed)); // each destroyed at its own 3 s
    }
    expect(calls).toHaveLength(81); // one every 100 ms, from 0 through 8 s
    expect(await settled(answer)).toBe('pending');
    subject.close();
  });

  it('answers every waiter of a key at its first connect, destroys the key’s other probes and probes it no more', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { calls, live, lines, reach: subject } = reach();
    subject.openWindow('network');
    const first = subject.reachable(MACHINE);
    vi.advanceTimersByTime(2 * PROBE_STAGGER_MS);
    const second = subject.reachable('ws://100.64.0.7:47830/another-path');
    vi.advanceTimersByTime(2 * PROBE_STAGGER_MS); // five probes, all hanging
    expect(calls).toHaveLength(5);
    calls[2]!.resolve();
    expect(await settled(first)).toBe(true);
    expect(await settled(second)).toBe(true);
    expect(live()).toEqual([]);
    expect(calls.every((call) => call.signal.aborted)).toBe(true); // the one that connected is destroyed too
    vi.advanceTimersByTime(10 * PROBE_STAGGER_MS);
    expect(calls).toHaveLength(5);
    expect(lines).toContain('[reach] 100.64.0.7:47830: reachable after 5 probes, 400 ms');
    subject.close();
  });

  it('starts a new round, with its own line, when someone waits on a key again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { calls, lines, reach: subject } = reach((call) => call.resolve());
    subject.openWindow('wake');
    expect(await settled(subject.reachable(MACHINE))).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(await settled(subject.reachable(MACHINE))).toBe(true);
    expect(calls).toHaveLength(2);
    expect(lines.filter((line) => line.includes('reachable after'))).toEqual([
      '[reach] 100.64.0.7:47830: reachable after 1 probes, 0 ms',
      '[reach] 100.64.0.7:47830: reachable after 1 probes, 0 ms',
    ]);
    subject.close();
  });

  it('keys a target by its host and port: two URLs of one host and port share a prober, and a URL with no port takes its scheme’s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { asked, calls, reach: subject } = reach(undefined, (question) => question.resolve([HUB_V4]));
    subject.openWindow('wake');
    const feed = subject.reachable(HUB);
    const relay = subject.reachable('https://hub.example.com/api/machines/m/socket');
    const plain = subject.reachable('ws://hub.example.com/');
    const web = subject.reachable('http://hub.example.com:8787/');
    const v6 = subject.reachable('ws://[fd7a:115c:a1e0::7]:47830/rl2');
    await flush();
    expect(asked.map((question) => question.host)).toEqual(['hub.example.com']); // one lookup for the host's three keys
    expect(calls.map((call) => `${call.host} ${call.port}`)).toEqual(['fd7a:115c:a1e0::7 47830', '203.0.113.5 443', '203.0.113.5 80', '203.0.113.5 8787']);
    calls[1]!.resolve();
    expect(await settled(feed)).toBe(true);
    expect(await settled(relay)).toBe(true);
    expect(await settled(plain)).toBe('pending');
    expect(await settled(web)).toBe('pending');
    calls[0]!.resolve();
    expect(await settled(v6)).toBe(true);
    subject.close();
  });

  it('connects to an IP literal as it is, and looks nothing up for it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { asked, calls, reach: subject } = reach();
    subject.openWindow('wake');
    void subject.reachable(MACHINE);
    void subject.reachable('ws://[fd7a:115c:a1e0::7]:47830/rl2');
    vi.advanceTimersByTime(PROBE_CONNECT_MS);
    await flush();
    expect(asked).toEqual([]);
    expect(new Set(calls.map((call) => call.host))).toEqual(new Set(['100.64.0.7', 'fd7a:115c:a1e0::7']));
    subject.close();
  });

  it('keeps at most one lookup of a name outstanding at every instant while the resolver stalls the whole window, and probes nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { asked, calls, lines, outstanding, reach: subject } = reach();
    subject.openWindow('wake');
    const feed = subject.reachable(HUB);
    const web = subject.reachable('http://hub.example.com:8787/'); // another key of the same host
    let leaving = new AbortController();
    const left = subject.reachable('ws://hub.example.com:9000/', leaving.signal);
    for (let elapsed = PROBE_STAGGER_MS; elapsed <= REACH_WINDOW_MS; elapsed += PROBE_STAGGER_MS) {
      vi.advanceTimersByTime(PROBE_STAGGER_MS);
      await flush();
      expect(outstanding('hub.example.com')).toBeLessThanOrEqual(1);
      if (elapsed === 10_000) {
        leaving.abort(); // the round ends with its lookup outstanding
        expect(await settled(left)).toBe(false);
        leaving = new AbortController();
        void subject.reachable('ws://hub.example.com:9000/', leaving.signal); // a new round of that key
      }
    }
    expect(await settled(feed)).toBe(false);
    expect(await settled(web)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(lines).toContain('[reach] hub.example.com:443: window closed after 0 probes, none connected (no answer from the lookup of hub.example.com)');
    subject.openWindow('network'); // the next window's round takes the same lookup's answer
    void subject.reachable(HUB);
    vi.advanceTimersByTime(1_000);
    expect(asked).toHaveLength(1);
    asked[0]!.resolve([HUB_V4]);
    await flush();
    expect(calls.map((call) => `${call.host} ${call.port}`)).toEqual(['203.0.113.5 443']);
    subject.close();
  });

  it('drops the answer of a lookup that was outstanding when its round ended', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { asked, calls, reach: subject } = reach();
    subject.openWindow('wake');
    const leaving = new AbortController();
    void subject.reachable(HUB, leaving.signal);
    leaving.abort();
    asked[0]!.resolve([HUB_V4]);
    await flush();
    vi.advanceTimersByTime(1_000);
    expect(calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(1); // the window's own timer
    subject.close();
  });

  it('probes a name from the moment it resolves late, at once and then every 100 ms, to the addresses it resolved to', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { asked, calls, lines, reach: subject } = reach();
    subject.openWindow('wake');
    const answer = subject.reachable(HUB);
    vi.advanceTimersByTime(5_000);
    expect(calls).toEqual([]);
    asked[0]!.resolve([HUB_V4]);
    await flush();
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(10 * PROBE_STAGGER_MS);
    expect(calls).toHaveLength(11);
    expect(calls.every((call) => call.host === '203.0.113.5' && call.port === 443)).toBe(true);
    expect(asked).toHaveLength(1);
    calls[10]!.resolve();
    expect(await settled(answer)).toBe(true);
    expect(lines).toContain('[reach] hub.example.com:443: reachable after 11 probes, 6000 ms');
    subject.close();
  });

  it('probes both families of a name that resolved to both, so a path of either one answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const answerOf = [
      { address: '2001:db8::5', family: 6 },
      { address: '2001:db8::6', family: 6 },
      { address: '203.0.113.5', family: 4 },
    ];
    for (const working of [4, 6]) {
      const { calls, reach: subject } = reach(undefined, (question) => question.resolve(answerOf));
      subject.openWindow('wake');
      const answer = subject.reachable(HUB);
      await flush();
      vi.advanceTimersByTime(3 * PROBE_STAGGER_MS);
      expect(calls.map((call) => call.host)).toEqual(['2001:db8::5', '203.0.113.5', '2001:db8::6', '2001:db8::5']); // the families alternate
      for (const call of calls) if (call.host.includes(':') !== (working === 6)) call.reject(refused());
      expect(await settled(answer)).toBe('pending');
      calls.find((call) => call.host.includes(':') === (working === 6))!.resolve();
      expect(await settled(answer)).toBe(true);
      subject.close();
    }
  });

  it('looks a name up again at the next tick when its lookup fails, one at a time, with the failure as the round’s last error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const notFound = () => Object.assign(new Error('getaddrinfo ENOTFOUND hub.example.com'), { code: 'ENOTFOUND' });
    const { asked, calls, lines, reach: subject } = reach(undefined, (question) => question.reject(notFound()));
    subject.openWindow('wake');
    const answer = subject.reachable(HUB);
    await flush();
    expect(asked).toHaveLength(1);
    for (let step = 1; step <= 5; step++) {
      vi.advanceTimersByTime(PROBE_STAGGER_MS);
      await flush();
      expect(asked).toHaveLength(1 + step);
    }
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(REACH_WINDOW_MS);
    expect(await settled(answer)).toBe(false);
    expect(lines.at(-1)).toBe('[reach] hub.example.com:443: window closed after 0 probes, none connected (getaddrinfo ENOTFOUND hub.example.com (ENOTFOUND))');
  });

  it('looks a name up again once a probe to each address it resolved to has failed, and probes the old ones until the new answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const moved = { address: '203.0.113.9', family: 4 };
    const { asked, calls, outstanding, reach: subject } = reach((call) => {
      if (call.host === HUB_V4.address) call.reject(refused());
    });
    subject.openWindow('network');
    const answer = subject.reachable(HUB);
    asked[0]!.resolve([HUB_V4]);
    await flush();
    expect(calls.map((call) => call.host)).toEqual([HUB_V4.address]); // refused at once
    expect(asked).toHaveLength(2); // the name again, because its one address stopped answering
    for (let step = 0; step < 20; step++) {
      vi.advanceTimersByTime(PROBE_STAGGER_MS);
      await flush();
      expect(outstanding('hub.example.com')).toBe(1);
    }
    expect(calls).toHaveLength(21);
    expect(calls.every((call) => call.host === HUB_V4.address)).toBe(true);
    asked[1]!.resolve([moved]);
    await flush();
    vi.advanceTimersByTime(PROBE_STAGGER_MS);
    expect(calls.at(-1)!.host).toBe(moved.address);
    calls.at(-1)!.resolve();
    expect(await settled(answer)).toBe(true);
    subject.close();
  });

  it('stops probing a key when its last waiter’s signal aborts, answering each one that left false', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { calls, live, lines, reach: subject } = reach();
    subject.openWindow('wake');
    const one = new AbortController();
    const two = new AbortController();
    const first = subject.reachable(MACHINE, one.signal);
    const second = subject.reachable(MACHINE, two.signal);
    vi.advanceTimersByTime(PROBE_STAGGER_MS);
    one.abort();
    expect(await settled(first)).toBe(false);
    vi.advanceTimersByTime(PROBE_STAGGER_MS);
    expect(calls).toHaveLength(3); // the other still waits
    two.abort();
    expect(await settled(second)).toBe(false);
    expect(live()).toEqual([]);
    vi.advanceTimersByTime(10 * PROBE_STAGGER_MS);
    expect(calls).toHaveLength(3);
    expect(lines).toEqual(['[reach] window open for 60 s (wake)']); // no line for a round that was left
    subject.close();
  });

  it('answers false at once for a signal already aborted, probing nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { calls, reach: subject } = reach();
    subject.openWindow('wake');
    expect(await settled(subject.reachable(MACHINE, AbortSignal.abort()))).toBe(false);
    expect(calls).toEqual([]);
    subject.close();
  });

  it('answers every waiter false when the window closes, with the round’s line and the last error’s words', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { calls, live, lines, reach: subject } = reach((call) => call.reject(refused()));
    subject.openWindow('wake');
    vi.advanceTimersByTime(50);
    const answer = subject.reachable(MACHINE);
    vi.advanceTimersByTime(REACH_WINDOW_MS - 50 - 1);
    expect(await settled(answer)).toBe('pending');
    vi.advanceTimersByTime(1);
    expect(await settled(answer)).toBe(false);
    expect(subject.windowOpen()).toBe(false);
    expect(lines.at(-1)).toBe('[reach] 100.64.0.7:47830: window closed after 600 probes, none connected (connect ECONNREFUSED 100.64.0.7:47830 (ECONNREFUSED))');
    vi.advanceTimersByTime(1_000);
    expect(calls).toHaveLength(600);
    expect(live()).toEqual([]);
    expect(await settled(subject.reachable(MACHINE))).toBe(false);
  });

  it('names a probe that hung as the last error when none failed otherwise', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { live, lines, reach: subject } = reach();
    subject.openWindow('wake');
    vi.advanceTimersByTime(REACH_WINDOW_MS - 4_000);
    const answer = subject.reachable(MACHINE);
    vi.advanceTimersByTime(4_000);
    expect(await settled(answer)).toBe(false);
    expect(live()).toEqual([]);
    expect(lines.at(-1)).toBe('[reach] 100.64.0.7:47830: window closed after 40 probes, none connected (no connect within 3000 ms)');
  });

  it('starts the 60 s again when the window is opened while open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { lines, reach: subject } = reach();
    subject.openWindow('wake');
    vi.advanceTimersByTime(50_000);
    subject.openWindow('network');
    const answer = subject.reachable(MACHINE);
    vi.advanceTimersByTime(REACH_WINDOW_MS - 1);
    expect(subject.windowOpen()).toBe(true);
    expect(await settled(answer)).toBe('pending');
    vi.advanceTimersByTime(1);
    expect(subject.windowOpen()).toBe(false);
    expect(await settled(answer)).toBe(false);
    expect(lines.slice(0, 2)).toEqual(['[reach] window open for 60 s (wake)', '[reach] window open for 60 s (network)']);
  });

  it('answers its waiters false and destroys its probes at close(), and opens no window after it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { live, reach: subject } = reach();
    subject.openWindow('wake');
    const answer = subject.reachable(MACHINE);
    vi.advanceTimersByTime(PROBE_STAGGER_MS);
    subject.close();
    expect(await settled(answer)).toBe(false);
    expect(live()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    subject.openWindow('wake');
    expect(subject.windowOpen()).toBe(false);
  });

  it('rejects a target that is not a URL it can key', async () => {
    const { reach: subject } = reach();
    subject.openWindow('wake');
    await expect(subject.reachable('100.64.0.7:47830')).rejects.toThrow(TypeError);
    await expect(subject.reachable('ftp://hub.example.com/')).rejects.toThrow(TypeError);
    subject.close();
  });

  it('dials a real TCP listener through node:net by default, and closes the socket it opened', async () => {
    const server = createServer();
    const accepted = new Promise<Socket>((resolve) => server.once('connection', resolve));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const subject = createReach({ log: () => {} });
    try {
      subject.openWindow('wake');
      expect(await subject.reachable(`ws://127.0.0.1:${port}/rl2`)).toBe(true);
      const socket = await accepted;
      await new Promise<void>((resolve) => (socket.closed ? resolve() : socket.once('close', () => resolve())));
    } finally {
      subject.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('looks a name up through node:dns by default and probes the addresses it gives', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const subject = createReach({ log: () => {} });
    try {
      subject.openWindow('wake');
      expect(await subject.reachable(`ws://localhost:${port}/rl2`)).toBe(true); // ::1, where localhost has it, is refused
    } finally {
      subject.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('NO_REACH never opens its window', async () => {
    NO_REACH.openWindow('wake');
    expect(NO_REACH.windowOpen()).toBe(false);
    expect(await NO_REACH.reachable(MACHINE)).toBe(false);
    NO_REACH.close();
  });
});
