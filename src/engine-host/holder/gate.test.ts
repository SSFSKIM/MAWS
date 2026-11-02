// O16 M5: the gate's server (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §E; D13, D27, D29,
// D37): OX10 on `gate.sock` over a real Unix socket, a fake observer on the other end. An observer is keyed by the
// engine session id its hello carries against each row's lineage, pid a cross-check; a hello no row matches is closed;
// an observer is healthy while its last heartbeat is recent, unhealthy once silent or gone after it was seen, absent
// until then; a turn is answered by the row's listener, `proceed` when it has none.
import { lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeObserver } from './fake-observer';
import { Gate, STOP_REASON, type GateChannel, type GateListener, type ObserverState } from './gate';

let root: string;
let gate: Gate;
let path: string;
const logs: string[] = [];
const observers: FakeObserver[] = [];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'maws-gate-'));
  path = join(root, 'supervisor', 'gate.sock');
  gate = new Gate({ log: (line) => void logs.push(line), silenceMs: 150 });
  await gate.listen(path);
});

afterEach(async () => {
  for (const o of observers.splice(0)) if (!o.isClosed) await o.close();
  await gate.close();
  rmSync(root, { recursive: true, force: true });
  logs.length = 0;
});

const connect = async (at = path) => {
  const o = await FakeObserver.connect(at);
  observers.push(o);
  return o;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean, what: string, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
};

function row(lineage: string[], pid: number | null = null) {
  const seen: number[] = [];
  const health: ObserverState[] = [];
  const channel = gate.channel({ lineage: () => new Set(lineage), pid: () => pid, seen: () => void seen.push(Date.now()) });
  channel.listen({ armed: () => {}, turn: () => 'proceed', health: (s) => void health.push(s) });
  return { channel, seen, health };
}

describe('the socket', () => {
  it('is 0600 in a 0700 directory it made', () => {
    expect(lstatSync(path).isSocket()).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, 'supervisor')).mode & 0o777).toBe(0o700);
  });

  it('refuses a path that holds something other than a socket (@shared/host/private-listen)', async () => {
    const file = join(root, 'supervisor', 'other.sock');
    writeFileSync(file, 'not a socket');
    const other = new Gate({ log: () => {} });
    await expect(other.listen(file)).rejects.toThrow(/not a socket/);
    await other.close();
  });

});

describe('hello', () => {
  it('a hello whose session is in a row’s lineage is welcomed; the observer is healthy, seen once, its child registered', async () => {
    const r = row(['old-id', 'eng-1']);
    expect(r.channel.observer).toBe('absent');
    const o = await connect();
    o.hello('eng-1', { pid: null, childPid: 812 });
    expect(await o.next()).toEqual({ t: 'welcome', protocol: 1 });
    expect(r.channel.observer).toBe('healthy');
    expect(r.channel.childPid).toBe(812);
    expect(r.seen).toHaveLength(1);
    expect(r.health).toEqual(['healthy']);
  });

  it('a hello no row holds is closed with nothing written, and so is a pid that is not the row’s', async () => {
    row(['eng-1'], 700);
    const stray = await connect();
    stray.hello('eng-other');
    await stray.closed;
    expect(stray.exchanged.filter((e) => e.from === 'host')).toEqual([]);
    const wrongPid = await connect();
    wrongPid.hello('eng-1', { pid: 701 });
    await wrongPid.closed;
    expect(wrongPid.exchanged.filter((e) => e.from === 'host')).toEqual([]);
    const rightPid = await connect();
    rightPid.hello('eng-1', { pid: 700 });
    expect((await rightPid.next()).t).toBe('welcome');
  });

  it('anything but a hello first, another protocol, or a line that is not JSON closes the connection', async () => {
    row(['eng-1']);
    for (const first of ['{"t":"hb"}', '{"t":"hello","protocol":2,"session":"eng-1"}', 'not json']) {
      const o = await connect();
      (o as unknown as { socket: { write(s: string): void } }).socket.write(`${first}\n`);
      await o.closed;
    }
  });

  it('a connection that sends no hello is closed after the window', async () => {
    await gate.close();
    gate = new Gate({ log: () => {}, helloWindowMs: 100 });
    await gate.listen(path);
    const o = await connect();
    await o.closed;
  });

  it('a row’s channel closed (its process exited) closes its observer, and a later hello for it matches nothing', async () => {
    const r = row(['eng-1']);
    const o = await connect();
    o.hello('eng-1');
    await o.next('welcome');
    r.channel.close();
    await o.closed;
    const again = await connect();
    again.hello('eng-1');
    await again.closed;
  });
});

describe('health', () => {
  it('heartbeats keep the observer healthy; silence past the window makes it unhealthy; a heartbeat is not a second hello', async () => {
    const r = row(['eng-1']);
    const o = await connect();
    o.hello('eng-1');
    await o.next('welcome');
    o.beat(50);
    await sleep(300);
    expect(r.channel.observer).toBe('healthy');
    o.stopHeartbeat();
    await until(() => r.health.includes('unhealthy'), 'silence, told'); // the getter reads the clock first
    expect(r.health).toEqual(['healthy', 'unhealthy']);
    o.hb();
    await sleep(30);
    expect(r.channel.observer).toBe('unhealthy'); // heard again only by a fresh hello
    o.hello('eng-1');
    await o.next('welcome');
    expect(r.channel.observer).toBe('healthy');
    expect(r.seen).toHaveLength(1); // seen once per process
  });

  it('is read against the clock: past the window it reads unhealthy before the silence timer runs, and a late heartbeat does not revive it', async () => {
    const r = row(['eng-1']);
    const o = await connect();
    o.hello('eng-1');
    await o.next('welcome');
    const blockedUntil = Date.now() + 200; // the event loop blocked past the 150 ms window
    while (Date.now() < blockedUntil) { /* a slow synchronous step */ }
    expect(r.channel.observer).toBe('unhealthy');
    o.hb(); // queued behind the silence
    await sleep(30);
    expect(r.channel.observer).toBe('unhealthy');
    expect(r.health).toEqual(['healthy', 'unhealthy']);
  });

  // P5 O16 M3 (D37, D53): an adopted row whose observer was seen on the process before the handover starts unhealthy,
  // not absent, and is healthy again at its observer's fresh hello (the bridge reconnects on its 5 s backoff)
  it('a row restored as seen before is unhealthy until its observer\'s hello, which is not a first sighting', async () => {
    const seen: number[] = [];
    const health: ObserverState[] = [];
    const channel = gate.channel({ lineage: () => new Set(['eng-1']), pid: () => null, seen: () => void seen.push(1), seenBefore: true });
    channel.listen({ armed: () => {}, turn: () => 'proceed', health: (s) => void health.push(s) });
    expect(channel.observer).toBe('unhealthy');
    const o = await connect();
    o.hello('eng-1');
    await o.next('welcome');
    expect(channel.observer).toBe('healthy');
    expect(health).toEqual(['healthy']);
    expect(seen).toEqual([]); // the state file already says so
  });

  it('a connection that closes leaves the observer unhealthy until a reconnect’s hello; the reconnect replaces it', async () => {
    const r = row(['eng-1']);
    const first = await connect();
    first.hello('eng-1');
    await first.next('welcome');
    await first.close();
    await until(() => r.channel.observer === 'unhealthy', 'the close');
    const second = await connect();
    second.hello('eng-1');
    await second.next('welcome');
    expect(r.channel.observer).toBe('healthy');
    const third = await connect();
    third.hello('eng-1');
    await third.next('welcome');
    await second.closed; // the older connection is replaced
    expect(r.channel.observer).toBe('healthy');
  });
});

describe('frames', () => {
  async function observed(listener: Partial<GateListener>): Promise<{ channel: GateChannel; o: FakeObserver }> {
    const channel = gate.channel({ lineage: () => new Set(['eng-1']), pid: () => null });
    channel.listen({ armed: () => {}, turn: () => 'proceed', health: () => {}, ...listener });
    const o = await connect();
    o.hello('eng-1');
    await o.next('welcome');
    return { channel, o };
  }

  it('arm and disarm reach the observer; its armed reaches the listener', async () => {
    const armed: number[] = [];
    const { channel, o } = await observed({ armed: (fence) => void armed.push(fence) });
    channel.arm(3, 10_000);
    expect(await o.next()).toEqual({ t: 'arm', fence: 3, leaseMs: 10_000 });
    o.send({ t: 'armed', fence: 3 });
    await until(() => armed.length === 1, 'armed');
    expect(armed).toEqual([3]);
    channel.disarm(3);
    expect(await o.next()).toEqual({ t: 'disarm', fence: 3 });
  });

  it('a turn is answered as the listener says: proceed, or stop with the reason text', async () => {
    const seen: [number, string, string | null][] = [];
    let answer: 'proceed' | 'stop' = 'proceed';
    const { o } = await observed({ turn: (fence, origin, delivery) => (seen.push([fence, origin, delivery]), answer) });
    o.send({ t: 'turn', fence: 1, origin: 'cron' });
    expect(await o.next()).toEqual({ t: 'proceed', fence: 1 });
    answer = 'stop';
    o.send({ t: 'turn', fence: 2, origin: 'peer', delivery: 'd-9' });
    expect(await o.next()).toEqual({ t: 'stop', fence: 2, reason: STOP_REASON });
    expect(STOP_REASON).toBe('The holder ended this session; reopening it continues the conversation.');
    expect(seen).toEqual([[1, 'cron', null], [2, 'peer', 'd-9']]);
  });

  it('a turn with no listener proceeds; arm and disarm with no observer connected are dropped', async () => {
    const channel = gate.channel({ lineage: () => new Set(['eng-2']), pid: () => null });
    channel.arm(1, 10_000); // nothing to write to
    const o = await connect();
    o.hello('eng-2');
    await o.next('welcome');
    o.send({ t: 'turn', fence: 1, origin: 'query' });
    expect(await o.next()).toEqual({ t: 'proceed', fence: 1 });
    expect(o.pending()).toEqual([]);
  });

  it('a frame of a type it does not know is ignored, so the protocol grows additively', async () => {
    const { o } = await observed({});
    o.send({ t: 'later', x: 1 });
    o.send({ t: 'turn', fence: 1, origin: 'query' });
    expect(await o.next()).toEqual({ t: 'proceed', fence: 1 });
  });
});

describe('the server’s restart', () => {
  it('a closed gate closes its observers; a new gate at the same path takes the reconnect’s second hello', async () => {
    const r = row(['eng-1']);
    const o = await connect();
    o.hello('eng-1');
    await o.next('welcome');
    await gate.close();
    await o.closed;
    mkdirSync(join(root, 'supervisor'), { recursive: true });
    gate = new Gate({ log: () => {} });
    await gate.listen(path);
    const r2 = gate.channel({ lineage: () => new Set(['eng-1']), pid: () => null });
    const again = await connect();
    again.hello('eng-1');
    expect((await again.next()).t).toBe('welcome');
    expect(r2.observer).toBe('healthy');
    expect(r.channel.observer).toBe('unhealthy');
  });
});
