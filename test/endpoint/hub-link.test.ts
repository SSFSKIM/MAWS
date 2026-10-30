// The hub link (O10 M3) against a stand-in hub (fake-hub.ts): the hello, the welcome read tolerantly, frames it doesn't
// know ignored with one log line per kind, each upgrade verdict and close code of P5 Decision Log 41, liveness, the
// backoff and its reset, the log plane's per-project order, parts, the channel multiplex, and the socket's send buffer
// against a hub that stops reading.
import { CHANNEL_CLOSE, decodeChannelFrame, encodeChannelFrame, RL1_PROTOCOL } from 'org-protocol';
import { toWire } from 'desk-hub/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { HubLink, reconnectDelay, RECONNECT_MAX_MS, STEADY_MS, type ChannelHandler, type HubLinkOptions, type HubStop } from '../../src/endpoint/hub-link';
import type { SendLimits } from '../../src/endpoint/send-buffer';
import { mintRef } from './fake-services';
import { FakeHub, until } from './fake-hub';

const CREDENTIAL = 'fixture-credential-value';
const hubs: FakeHub[] = [];
const links: HubLink[] = [];
const lines: string[] = [];

afterEach(async () => {
  for (const link of links.splice(0)) await link.stop();
  for (const hub of hubs.splice(0)) await hub.close();
  // No credential reaches a log line.
  expect(lines.join('\n')).not.toContain(CREDENTIAL);
  lines.length = 0;
});

async function fakeHub(): Promise<FakeHub> {
  const hub = await new FakeHub().start();
  hubs.push(hub);
  return hub;
}

/** A link to `hub` whose backoff takes its shortest waits (random 0: half of each ceiling). */
function linkTo(hub: FakeHub, options: Partial<HubLinkOptions> = {}) {
  const ref = mintRef();
  const stops: HubStop[] = [];
  const welcomes: number[] = [];
  const link = new HubLink({
    target: () => ({ hub: hub.url, credentials: { clientId: 'client-id.access', clientSecret: CREDENTIAL }, ref }),
    build: 'test-build',
    log: (line) => void lines.push(line),
    random: () => 0,
    hooks: { stopped: (reason) => void stops.push(reason), welcome: ({ generation }) => void welcomes.push(generation) },
    ...options,
  });
  links.push(link);
  return { link, ref, stops, welcomes };
}

const gap = (hub: FakeHub, i: number) => hub.upgrades[i].at - hub.upgrades[i - 1].at;

describe('the connection', () => {
  it('says hello with RL1’s protocol, its build and its ref, its credentials as headers; the next hello names the generation it held', async () => {
    const hub = await fakeHub();
    const { link, ref } = linkTo(hub);
    link.start();
    await until(() => link.connected, 'the welcome');
    expect(link.generation).toBe(1);
    expect(hub.upgrades[0].headers['cf-access-client-id']).toBe('client-id.access');
    expect(hub.upgrades[0].headers['cf-access-client-secret']).toBe(CREDENTIAL);
    expect(hub.frames('hello')[0].frame).toEqual({ t: 'hello', protocol: RL1_PROTOCOL, build: 'test-build', machine: ref });
    hub.current.close(1011, 'failed');
    await until(() => link.generation === 2, 'the second welcome');
    expect(hub.frames('hello')[1].frame).toMatchObject({ machine: ref, leaseGeneration: 1 });
  });

  it('reads the welcome for what it needs and ignores a frame it doesn’t know, with one log line per kind', async () => {
    const hub = await fakeHub();
    hub.welcomeFields = { region: 'nowhere', features: ['x'] };
    const { link } = linkTo(hub);
    link.start();
    await until(() => link.connected, 'the welcome');
    for (const t of ['mystery', 'mystery', 'mystery', 'other']) hub.current.send(JSON.stringify({ t, body: 'something' }));
    hub.current.send('not json');
    await until(() => lines.some((l) => l.includes('`other`')), 'the log line for `other`');
    expect(lines.filter((l) => l.includes('`mystery`'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('not JSON'))).toHaveLength(1);
    expect(link.connected).toBe(true);
  });

  it('hands the hub’s state notices on', async () => {
    const hub = await fakeHub();
    const versions: number[] = [];
    const { link } = linkTo(hub, { hooks: { state: (v) => void versions.push(v) } });
    link.start();
    await until(() => link.connected, 'the welcome');
    hub.current.send(JSON.stringify({ t: 'state', version: 4 }));
    hub.current.send(JSON.stringify({ t: 'state', version: 'five' }));
    hub.current.send(JSON.stringify({ t: 'state', version: 6 }));
    await until(() => versions.length === 2, 'two notices');
    expect(versions).toEqual([4, 6]);
  });

  it('gives a connection up after two unanswered heartbeats, and opens another', async () => {
    const hub = await fakeHub();
    const { link } = linkTo(hub);
    link.start();
    await until(() => link.connected, 'the welcome');
    hub.ack = false;
    await until(() => lines.some((l) => l.includes('two heartbeats went unanswered')), 'the link given up');
    hub.ack = true;
    await until(() => link.generation === 2, 'a new connection');
    // It sent two heartbeats, unanswered, before it gave up.
    expect(hub.frames('hb').filter((r) => r.conn === 0).length).toBeGreaterThanOrEqual(2);
  });

  it('gives up an upgrade that is never welcomed, within its bound', async () => {
    const hub = await fakeHub();
    hub.welcomes = false;
    const { link } = linkTo(hub);
    link.start();
    await until(() => hub.upgrades.length === 1, 'the upgrade');
    expect(link.connected).toBe(false);
    await link.stop();
    expect(hub.upgrades).toHaveLength(1);
  });
});

describe('the hub’s verdicts on an upgrade (P5 Decision Log 41)', () => {
  it('tries a 503 again with the backoff, and a 401 from Access’s edge too', async () => {
    const hub = await fakeHub();
    hub.refuse(503, 'hub-unavailable');
    hub.refuse(401, '<html>Access</html>', true);
    const { link } = linkTo(hub);
    link.start();
    await until(() => link.connected, 'the welcome after two refusals', 10_000);
    expect(hub.upgrades).toHaveLength(3);
    expect(gap(hub, 1)).toBeGreaterThanOrEqual(450);
    expect(gap(hub, 2)).toBeGreaterThanOrEqual(950);
    expect(lines.some((l) => l.includes('503 hub-unavailable'))).toBe(true);
    expect(lines.some((l) => l.includes('401 access'))).toBe(true);
  });

  it('reconnects at once after 409 stale-generation, and backs off after a second in a row', async () => {
    const hub = await fakeHub();
    hub.refuse(409, 'stale-generation');
    hub.refuse(409, 'stale-generation');
    const { link } = linkTo(hub);
    link.start();
    await until(() => link.connected, 'the welcome', 10_000);
    expect(gap(hub, 1)).toBeLessThan(300);
    expect(gap(hub, 2)).toBeGreaterThanOrEqual(450);
  });

  for (const [status, error, stop] of [
    [409, 'not-listed', 're-enroll'],
    [409, 'no-ref', 're-enroll'],
    [403, 'not-enrolled', 'revoked'],
  ] as const) {
    it(`stops on ${status} ${error} (${stop}) and tries no more`, async () => {
      const hub = await fakeHub();
      hub.refuse(status, error);
      const { link, stops } = linkTo(hub);
      link.start();
      await until(() => stops.length === 1, 'the stop');
      expect(stops).toEqual([stop]);
      expect(link.stopped).toBe(stop);
      link.start();
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(hub.upgrades).toHaveLength(1);
      // A new enrollment's credentials clear it.
      link.reset();
      link.start();
      await until(() => link.connected, 'the welcome after a reset');
    });
  }
});

describe('the hub’s closes', () => {
  it('stops on 4403 (revoked)', async () => {
    const hub = await fakeHub();
    const { link, stops } = linkTo(hub);
    link.start();
    await until(() => link.connected, 'the welcome');
    hub.current.close(4403, 'revoked');
    await until(() => stops.length === 1, 'the stop');
    expect(stops).toEqual(['revoked']);
  });

  it('reconnects at once after a 4409, and stops (`replaced`) when replaced again within a minute', async () => {
    const hub = await fakeHub();
    const { link, stops } = linkTo(hub);
    link.start();
    await until(() => link.connected, 'the welcome');
    hub.current.close(4409, 'replaced');
    await until(() => link.generation === 2, 'the reconnect');
    expect(gap(hub, 1)).toBeLessThan(300);
    hub.current.close(4409, 'replaced');
    await until(() => stops.length === 1, 'the stop');
    expect(stops).toEqual(['replaced']);
    expect(hub.upgrades).toHaveLength(2);
  });

  it('a second 4409 a minute or more after the first reconnects again', async () => {
    const hub = await fakeHub();
    let skew = 0;
    const { link, stops } = linkTo(hub, { now: () => Date.now() + skew });
    link.start();
    await until(() => link.connected, 'the welcome');
    hub.current.close(4409, 'replaced');
    await until(() => link.generation === 2, 'the reconnect');
    skew += 61_000;
    hub.current.close(4409, 'replaced');
    await until(() => link.generation === 3, 'the second reconnect');
    expect(stops).toEqual([]);
  });

  for (const [code, reason] of [
    [4412, 'parts-lost'],
    [1009, 'too-large'],
  ] as const) {
    it(`logs a ${code} with the kind of frame it followed, and reconnects`, async () => {
      const hub = await fakeHub();
      const { link } = linkTo(hub);
      link.start();
      await until(() => link.connected, 'the welcome');
      link.send({ t: 'notify', session: 's', project: 'p', kind: 'waiting', pending: 1 });
      await until(() => hub.frames('notify').length === 1, 'the notify');
      hub.current.close(code, reason);
      await until(() => link.generation === 2, 'the reconnect');
      expect(lines.some((l) => l.includes(`${code}`) && l.includes('after a `notify` frame'))).toBe(true);
    });
  }
});

describe('the backoff', () => {
  it('waits from 1 s doubling to 30 s, each wait jittered to between half and all of its ceiling', () => {
    expect(reconnectDelay(0, () => 0)).toBe(500);
    expect(reconnectDelay(0, () => 1)).toBe(1000);
    expect(reconnectDelay(3, () => 1)).toBe(8000);
    expect(reconnectDelay(40, () => 0)).toBe(RECONNECT_MAX_MS / 2);
    expect(reconnectDelay(40, () => 1)).toBe(RECONNECT_MAX_MS);
  });

  it('starts again from its shortest wait after a welcome that held a minute', async () => {
    const hub = await fakeHub();
    let skew = 0;
    hub.refuse(503, 'busy');
    hub.refuse(503, 'busy');
    const { link } = linkTo(hub, { now: () => Date.now() + skew });
    link.start();
    await until(() => link.connected, 'the welcome', 10_000);
    // Without a steady welcome, the next wait would be the third doubling's (2 s at the least).
    skew += STEADY_MS + 1000;
    hub.current.close(1011, 'failed');
    await until(() => link.generation === 2, 'the reconnect', 10_000);
    expect(gap(hub, 3)).toBeLessThan(1500);
  });

  it('keeps growing across connections that drop within a minute', async () => {
    const hub = await fakeHub();
    hub.refuse(503, 'busy');
    const { link } = linkTo(hub);
    link.start();
    await until(() => link.connected, 'the welcome', 10_000);
    hub.current.close(1011, 'failed');
    await until(() => link.generation === 2, 'the reconnect', 10_000);
    expect(gap(hub, 2)).toBeGreaterThanOrEqual(950);
  });
});

describe('the log plane', () => {
  it('says each project’s hello on every connection, and hands its frames on one at a time in the order they came', async () => {
    const hub = await fakeHub();
    const { link } = linkTo(hub);
    const seen: string[] = [];
    let have = { 'mini/s1': 3 };
    link.openProject('p1', {
      hello: () => ({ name: 'one', have }),
      down: async (frame) => {
        // The first frame's handler is slow; the second still waits for it.
        if (frame.n === 1) await new Promise((resolve) => setTimeout(resolve, 100));
        seen.push(`${frame.t}:${String(frame.n)}`);
      },
    });
    link.start();
    await until(() => hub.frames('hello').some((r) => r.frame.project === 'p1'), 'the project’s hello');
    expect(hub.frames('hello').find((r) => r.frame.project === 'p1')?.frame).toEqual({ t: 'hello', project: 'p1', name: 'one', have: { 'mini/s1': 3 } });
    expect(link.relays('p1')).toBe(true);
    expect(link.relays('p2')).toBe(false);
    hub.current.send(JSON.stringify({ t: 'events', project: 'p1', n: 1, events: [] }));
    hub.current.send(JSON.stringify({ t: 'have', project: 'p1', n: 2, have: {} }));
    hub.current.send(JSON.stringify({ t: 'events', project: 'nobody', n: 3, events: [] }));
    // A frame over 1 MiB comes as parts and is joined.
    for (const line of toWire({ t: 'events', project: 'p1', n: 4, events: [{ text: 'x'.repeat(1_200_000) }] })) hub.current.send(line);
    await until(() => seen.length === 3, 'three frames handed on');
    expect(seen).toEqual(['events:1', 'have:2', 'events:4']);
    expect(lines.some((l) => l.includes('hasn’t opened') || l.includes("hasn't opened"))).toBe(true);
    have = { 'mini/s1': 5 };
    hub.current.close(1011, 'failed');
    await until(() => hub.frames('hello').filter((r) => r.frame.project === 'p1').length === 2, 'the hello again');
    expect(hub.frames('hello').filter((r) => r.frame.project === 'p1')[1].frame.have).toEqual({ 'mini/s1': 5 });
  });

  it('sends the log plane’s frames and records only while welcomed', async () => {
    const hub = await fakeHub();
    const { link } = linkTo(hub);
    expect(link.send({ t: 'events', project: 'p1', events: [] })).toBe(false);
    link.start();
    await until(() => link.connected, 'the welcome');
    expect(link.send({ t: 'events', project: 'p1', events: [] })).toBe(true);
    await until(() => hub.frames('events').length === 1, 'the events');
  });
});

describe('the channel multiplex', () => {
  it('closes a channel an app opens while no one handles channels', async () => {
    const hub = await fakeHub();
    const { link } = linkTo(hub);
    link.start();
    await until(() => link.connected, 'the welcome');
    hub.current.send(encodeChannelFrame('open', 9, new Uint8Array([1, 2])));
    await until(() => hub.received.some((r) => 'binary' in r), 'the close');
    const frame = decodeChannelFrame(hub.received.find((r): r is { conn: number; binary: Buffer } => 'binary' in r)!.binary)!;
    expect(frame).toMatchObject({ type: 'close', channel: 9 });
    expect(Buffer.from(frame.payload)).toEqual(Buffer.from(CHANNEL_CLOSE.closed));
  });

  it('hands channels to their handler, both ways, and ends them with the connection', async () => {
    const hub = await fakeHub();
    const { link } = linkTo(hub);
    const events: string[] = [];
    const handler: ChannelHandler = {
      opened: (channel, payload) => void events.push(`open ${channel} ${payload.length}`),
      data: (channel, payload) => {
        events.push(`data ${channel} ${Buffer.from(payload).toString()}`);
        link.sendChannel(channel, payload);
      },
      closed: (channel, reason) => void events.push(`close ${channel} ${reason}`),
    };
    link.setChannels(handler);
    link.start();
    await until(() => link.connected, 'the welcome');
    hub.current.send(encodeChannelFrame('open', 3, new Uint8Array(4)));
    hub.current.send(encodeChannelFrame('data', 3, Buffer.from('hi')));
    hub.current.send(encodeChannelFrame('data', 4, Buffer.from('not open')));
    hub.current.send(encodeChannelFrame('open', 5, new Uint8Array(0)));
    hub.current.send(encodeChannelFrame('close', 5, CHANNEL_CLOSE['app-gone']));
    await until(() => events.length === 4, 'four channel events');
    await until(() => hub.received.some((r) => 'binary' in r), 'the echo');
    const echo = decodeChannelFrame(hub.received.find((r): r is { conn: number; binary: Buffer } => 'binary' in r)!.binary)!;
    expect(echo).toMatchObject({ type: 'data', channel: 3 });
    expect(link.sendChannel(5, new Uint8Array(1))).toBe(false);
    hub.current.close(1011, 'failed');
    await until(() => events.length === 5, 'the connection’s end');
    expect(events).toEqual(['open 3 4', 'data 3 hi', 'open 5 0', 'close 5 app-gone', 'close 3 endpoint-gone']);
    expect(() => link.sendChannel(3, new Uint8Array(1024 * 1024))).toThrow(RangeError);
  });
});

describe('the socket’s send buffer, against a hub that stops reading', () => {
  const limits: SendLimits = { soft: 256 * 1024, budget: 4 * 1024 * 1024, ceiling: 6 * 1024 * 1024, stallMs: 60_000 };
  const payload = new Uint8Array(128 * 1024);
  /** What a frame on the multiplex is to the hub: its type and channel. */
  const channelFrames = (hub: FakeHub, conn = 0) =>
    hub.received.filter((r): r is { conn: number; binary: Buffer } => 'binary' in r && r.conn === conn).map((r) => decodeChannelFrame(r.binary)!);

  /** A welcomed link with channels 1 and 2 open, its hub's socket paused (reading nothing), and the channels' events. */
  async function stalled(options: { heartbeatMs?: number; limits?: Partial<SendLimits> } = {}) {
    const hub = await fakeHub();
    hub.heartbeatMs = options.heartbeatMs ?? 60_000;
    const { link } = linkTo(hub, { sendLimits: { ...limits, ...options.limits } });
    const events: string[] = [];
    link.setChannels({ opened: (channel) => void events.push(`open ${channel}`), data: () => {}, closed: (channel, reason) => void events.push(`close ${channel} ${reason}`) });
    link.start();
    await until(() => link.connected, 'the welcome');
    hub.current.send(encodeChannelFrame('open', 1, new Uint8Array(0)));
    hub.current.send(encodeChannelFrame('open', 2, new Uint8Array(0)));
    await until(() => events.length === 2, 'both channels open');
    hub.current.pause();
    return { hub, link, events };
  }

  /** Channel 1's frames until the socket holds the soft cap and the kernel, its buffers full, takes no more. */
  async function fill(link: HubLink): Promise<number> {
    let sent = 0;
    for (let round = 0; round < 64; round++) {
      while (link.buffered < limits.soft && sent < 512) if (link.sendChannel(1, payload)) sent++;
      await new Promise((resolve) => setImmediate(resolve));
      if (link.buffered >= limits.soft) return sent;
    }
    throw new Error('the socket never held its soft cap');
  }

  it('holds the relayed streams while the socket is over its soft cap, sends RL1 control at once, and lets them go on once the hub reads', async () => {
    const { hub, link } = await stalled();
    // What a relayed stream does: a frame while the link is writable. Past the kernel's buffers the socket holds them.
    const sent = await fill(link);
    let writable = false;
    const drained = link.writable().then(() => void (writable = true));
    // RL1's control waits on nothing.
    expect(link.send({ t: 'events', project: 'p1', events: [] })).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(writable).toBe(false);
    hub.current.resume();
    await drained;
    expect(link.buffered).toBeLessThan(limits.soft);
    await until(() => channelFrames(hub).length === sent && hub.frames('events').length === 1, 'every frame at the hub');
    expect(link.generation).toBe(1);
    expect(link.sendChannel(1, payload)).toBe(true);
  });

  it('closes the relayed channel whose send would take the channels’ data past its budget, and keeps the connection and its other channels', async () => {
    const { hub, link, events } = await stalled();
    let sent = 0;
    while (sent < 512 && link.sendChannel(1, payload)) sent++;
    expect(sent).toBeLessThan(512);
    expect(link.buffered).toBeLessThanOrEqual(limits.budget!);
    expect(events).toEqual(['open 1', 'open 2', 'close 1 closed']);
    expect(lines.some((line) => line.includes('relayed channel 1') && line.includes('past its budget'))).toBe(true);
    expect(link.sendChannel(1, payload)).toBe(false);
    hub.current.resume();
    await link.writable();
    expect(link.sendChannel(2, payload)).toBe(true);
    await until(() => channelFrames(hub).some((f) => f.type === 'data' && f.channel === 2), 'channel 2’s frame at the hub');
    expect(channelFrames(hub).filter((f) => f.type === 'close').map((f) => f.channel)).toEqual([1]);
    expect(link.connected).toBe(true);
    expect(link.generation).toBe(1);
  });

  it('gives up a connection once what it holds, whatever sent it, would pass the ceiling: RL1’s own frames too', async () => {
    const { link } = await stalled();
    const text = 'n'.repeat(64 * 1024);
    let peak = 0;
    for (let n = 0; n < 512 && link.generation === 1; n++) {
      link.send({ t: 'events', project: 'p1', events: [{ text }] });
      peak = Math.max(peak, link.buffered);
    }
    expect(peak).toBeLessThanOrEqual(limits.ceiling);
    expect(lines.some((line) => line.includes('past its ceiling'))).toBe(true);
    await until(() => link.generation === 2, 'a new connection');
  });

  it('gives up a connection whose hub reads nothing though it keeps acknowledging heartbeats: no frame written for the stall bound', async () => {
    const { hub, link } = await stalled({ heartbeatMs: 100, limits: { stallMs: 400 } });
    const first = hub.current;
    // Acknowledgements the hub never read a heartbeat for: they keep the heartbeat's own check satisfied.
    const acks = setInterval(() => first.send(JSON.stringify({ t: 'hb-ack', generation: 1 })), 20);
    try {
      await fill(link);
      // Not `writable()`: a kernel that grows its buffers meanwhile can take the socket back under its soft cap.
      await until(() => lines.some((line) => line.includes('written nothing')), 'the stall');
      expect(lines.some((line) => line.includes('heartbeats went unanswered') || line.includes('nothing heard'))).toBe(false);
    } finally {
      clearInterval(acks);
    }
    await until(() => link.generation === 2, 'a new connection');
  });

  it('stops by closing only after what the socket holds: the hub reads every frame, then the close', async () => {
    const { hub, link } = await stalled();
    const text = 's'.repeat(64 * 1024);
    const frames = 64; // 4 MiB: past the kernel's buffers, so most of it is still held at the stop
    for (let i = 0; i < frames; i++) expect(link.send({ t: 'events', project: 'p1', events: [{ text }] })).toBe(true);
    expect(link.buffered).toBeGreaterThan(limits.soft);
    const socket = hub.current;
    const closed = new Promise<{ code: number; got: number }>((resolve) => socket.once('close', (code: number) => resolve({ code, got: hub.frames('events').length })));
    const stopped = link.stop();
    socket.resume();
    expect(await closed).toEqual({ code: 1000, got: frames });
    await stopped;
  });

  it('answers the hub’s WebSocket ping through its buffer', async () => {
    const hub = await fakeHub();
    const { link } = linkTo(hub, { sendLimits: limits });
    link.start();
    await until(() => link.connected, 'the welcome');
    const pong = new Promise<string>((resolve) => hub.current.once('pong', (data: Buffer) => resolve(data.toString())));
    hub.current.ping(Buffer.from('are you there'));
    expect(await pong).toBe('are you there');
  });
});
