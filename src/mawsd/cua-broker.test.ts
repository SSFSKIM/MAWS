import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { encodeFrame, frameDecoder, type RpcMessage } from '../main/browser/cua/framing';
import { PROFILE_NAME, PROTOCOL_VERSION } from '../main/browser/cua/connection';
import {
  BROKER_PROFILE_NAME,
  BROKER_PROTOCOL_VERSION,
  createCuaBroker,
  CUA_BROWSER_START_MS,
  CUA_COLD_BUDGET,
  CUA_COLD_BUFFER_BYTES,
  CUA_PROMOTION_MAX_BYTES,
  type BrowserDemand,
  type BrowserRouteReading,
  type BrowserTarget,
  type CuaBrokerOptions,
} from './cua-broker';

// The cold broker (P5 O17 M1; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §B, §C; acceptance 1's
// cold half and 2): over real Unix sockets and cua's real framing, an admitted connection is greeted and answered "no
// tabs" from the protocol alone; its first real primitive promotes it through `ensureBrowser` (a fake here, M5's real
// one) and is spliced into the render host's socket for the session (a stand-in that greets as MAWS does), bounded
// throughout. The route's readings are a stub (M5's browser-route.ts in production).

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;

const roots: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0).reverse()) close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const until = async (done: () => boolean, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

const helloOf = (appSessionId: string, protocolVersion: number = PROTOCOL_VERSION) => ({
  jsonrpc: '2.0',
  method: 'hello',
  params: { extensionId: 'maws', extensionInstanceId: `maws:${appSessionId}`, version: 'render-host', protocolVersion, profileName: 'MAWS' },
});
const request = (id: number, method: string, params: unknown = {}) => encodeFrame({ jsonrpc: '2.0', id, method, params });

interface Start {
  demand: BrowserDemand;
  resolve(target: BrowserTarget): void;
  reject(error: Error): void;
}

// A broker over a scratch directory: each session's socket is a test server handing its connections to the broker (as
// cua-socket.ts does after the peer check), the route's reading is the stub `readings`, and `ensureBrowser` is held by
// the test (`starts`).
function stand(options: Partial<CuaBrokerOptions> = {}) {
  const root = mkdtempSync('/tmp/mcub-');
  roots.push(root);
  const readings = new Map<AppSessionId, BrowserRouteReading>();
  const starts: Start[] = [];
  const logs: string[] = [];
  let places = 0;
  const placeLimit = { value: Number.POSITIVE_INFINITY };
  const broker = createCuaBroker({
    machine: 'mini',
    version: 'test',
    route: (appSessionId) => readings.get(appSessionId) ?? { state: 'cold', epoch: 'e1' },
    // as the route does from M5: a demand on a cold route makes it starting
    ensureBrowser: (demand) => {
      const reading = readings.get(demand.appSessionId) ?? { state: 'cold', epoch: 'e1' };
      if (reading.state === 'cold') readings.set(demand.appSessionId, { state: 'starting', epoch: reading.epoch });
      return new Promise<BrowserTarget>((resolve, reject) => void starts.push({ demand, resolve, reject }));
    },
    place: () => {
      if (places >= placeLimit.value) return null;
      places += 1;
      let freed = false;
      return () => void (freed || ((freed = true), (places -= 1)));
    },
    log: (line) => void logs.push(line),
    ...options,
  });
  closers.push(() => broker.close());
  const servers = new Map<AppSessionId, string>();
  const socketOf = async (appSessionId: AppSessionId) => {
    const existing = servers.get(appSessionId);
    if (existing) return existing;
    const path = join(root, `${appSessionId}.sock`);
    const server: Server = createServer({ pauseOnConnect: true }, (socket) => broker.admit(appSessionId, socket));
    await new Promise<void>((resolve) => server.listen(path, resolve));
    closers.push(() => server.close());
    servers.set(appSessionId, path);
    return path;
  };
  return { root, broker, readings, starts, logs, socketOf, places: () => places, placeLimit };
}

// cua's side: what it hears, decoded, and every raw byte
async function cua(path: string) {
  const socket: Socket = connect(path);
  const raw: Buffer[] = [];
  const messages: RpcMessage[] = [];
  const decode = frameDecoder();
  let closed = false;
  socket.on('data', (chunk) => {
    raw.push(chunk);
    messages.push(...decode(chunk));
  });
  socket.on('error', () => {});
  socket.on('close', () => void (closed = true));
  closers.push(() => socket.destroy());
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  return { socket, messages, raw: () => Buffer.concat(raw), closed: () => closed, answer: (id: number) => messages.find((message) => message.id === id) };
}

// The render host's socket for a session: it greets as MAWS's backend does (its hello, then `after`), and keeps every
// byte each connection sends it
async function renderHost(root: string, appSessionId: AppSessionId, { hello = helloOf(appSessionId), after = Buffer.alloc(0) }: { hello?: unknown; after?: Buffer } = {}) {
  const dir = join(root, 'render-cua');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = join(dir, `${appSessionId}.sock`);
  const connections: { socket: Socket; heard: Buffer[] }[] = [];
  const server = createServer((socket) => {
    const connection = { socket, heard: [] as Buffer[] };
    connections.push(connection);
    socket.on('data', (chunk) => void connection.heard.push(chunk));
    socket.on('error', () => {});
    socket.write(Buffer.concat([encodeFrame(hello), after]));
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  chmodSync(path, 0o600);
  closers.push(() => server.close());
  return { path, connections, heard: (index: number) => Buffer.concat(connections[index]?.heard ?? []) };
}

describe('the cold answers', () => {
  it('the hello is the one MAWS greets with, the same fields and protocol as the app’s connection', () => {
    expect(BROKER_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
    expect(BROKER_PROFILE_NAME).toBe(PROFILE_NAME);
  });

  it('an admitted connection hears one hello and then nothing: no timer, no start', async () => {
    const { starts, socketOf } = stand();
    const timers = () => process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;
    const before = timers();
    const client = await cua(await socketOf(A));
    await until(() => client.messages.length === 1);
    await settle(100);
    expect(client.messages).toEqual([{ jsonrpc: '2.0', method: 'hello', params: { extensionId: 'maws', extensionInstanceId: 'maws:A', version: 'test', protocolVersion: 1, profileName: 'MAWS' } }]);
    expect(starts).toHaveLength(0);
    expect(timers()).toBeLessThanOrEqual(before); // the broker armed none
    expect(client.closed()).toBe(false);
  });

  it('answers the inventory with no tabs, as often as asked, starting nothing', async () => {
    const { starts, socketOf } = stand();
    const client = await cua(await socketOf(A));
    client.socket.write(Buffer.concat([request(1, 'tabs.query'), request(2, 'windows.query'), request(3, 'debugger.getTargets'), request(4, 'tabs.query', { active: true })]));
    await until(() => client.messages.length === 5);
    for (const id of [1, 2, 3, 4]) expect(client.answer(id)).toEqual({ jsonrpc: '2.0', id, result: [] });
    client.socket.write(request(5, 'tabs.query'));
    await until(() => client.answer(5) !== undefined);
    expect(starts).toHaveLength(0);
  });

  it('hostRefused closes the connection with one line and starts nothing', async () => {
    const { starts, socketOf, logs } = stand();
    const client = await cua(await socketOf(A));
    client.socket.write(encodeFrame({ jsonrpc: '2.0', method: 'hostRefused', params: { code: 'already_served', message: 'x' } }));
    await until(client.closed);
    expect(starts).toHaveLength(0);
    expect(logs.filter((line) => line.includes('refused MAWS'))).toEqual(["cua's host refused MAWS on A's socket: already_served"]);
  });

  it('closes on a frame that is not JSON, and on one past the frame bound', async () => {
    const { socketOf } = stand();
    const path = await socketOf(A);
    const unreadable = await cua(path);
    const body = Buffer.from('{not json');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    unreadable.socket.write(Buffer.concat([header, body]));
    await until(unreadable.closed);
    const oversized = await cua(path);
    const big = Buffer.alloc(4);
    big.writeUInt32LE(CUA_PROMOTION_MAX_BYTES + 1, 0);
    oversized.socket.write(big);
    await until(oversized.closed);
  });
});

describe('promotion', () => {
  it('the first other primitive asks ensureBrowser once, for the session’s epoch, and is spliced at its answer', async () => {
    const { root, starts, socketOf, places } = stand();
    const host = await renderHost(root, A);
    const client = await cua(await socketOf(A));
    const trigger = request(7, 'windows.create', { url: 'about:blank' });
    client.socket.write(trigger);
    await until(() => starts.length === 1);
    expect(starts[0]!.demand).toMatchObject({ appSessionId: A, epoch: 'e1' });
    expect(starts[0]!.demand.deadline).toBeGreaterThan(performance.now() + CUA_BROWSER_START_MS - 500);
    expect(places()).toBe(1);
    starts[0]!.resolve({ epoch: 'e1', socketPath: host.path });
    await until(() => host.heard(0).length === trigger.length);
    expect(host.heard(0).equals(trigger)).toBe(true);
    expect(places()).toBe(0);
    // piped both ways from here: the render host's answer reaches cua, cua's next request reaches the render host
    host.connections[0]!.socket.write(encodeFrame({ jsonrpc: '2.0', id: 7, result: { id: 1 } }));
    await until(() => client.answer(7) !== undefined);
    expect(client.messages.filter((message) => message.method === 'hello')).toHaveLength(1);
    client.socket.write(request(8, 'tabs.query'));
    await until(() => host.heard(0).length > trigger.length);
    expect(host.heard(0).subarray(trigger.length).equals(request(8, 'tabs.query'))).toBe(true);
    // the pair ends together
    host.connections[0]!.socket.destroy();
    await until(client.closed);
  });

  it('several connections of one session share one start, each spliced with its own trigger', async () => {
    const { root, starts, socketOf } = stand();
    const host = await renderHost(root, A);
    const path = await socketOf(A);
    const clients = await Promise.all([cua(path), cua(path), cua(path)]);
    await until(() => clients.every((client) => client.messages.length === 1));
    clients.forEach((client, index) => client.socket.write(request(index + 1, 'tabs.create', { url: 'about:blank' })));
    await settle();
    expect(starts).toHaveLength(1);
    starts[0]!.resolve({ epoch: 'e1', socketPath: host.path });
    await until(() => host.connections.length === 3 && host.connections.every((_, index) => host.heard(index).length > 0));
    const heard = host.connections.map((_, index) => host.heard(index).toString('hex')).sort();
    expect(heard).toEqual([1, 2, 3].map((id) => request(id, 'tabs.create', { url: 'about:blank' }).toString('hex')).sort());
  });

  it('a fragmented trigger is delivered exactly once, after exactly one hello', async () => {
    const { root, starts, socketOf } = stand();
    const host = await renderHost(root, A);
    const client = await cua(await socketOf(A));
    await until(() => client.messages.length === 1);
    const trigger = request(3, 'tabs.create', { url: 'http://127.0.0.1:5173/' });
    for (const byte of trigger) {
      client.socket.write(Buffer.from([byte]));
      await new Promise((resolve) => setImmediate(resolve));
    }
    await until(() => starts.length === 1);
    starts[0]!.resolve({ epoch: 'e1', socketPath: host.path });
    await until(() => host.heard(0).length === trigger.length);
    await settle();
    expect(host.heard(0).equals(trigger)).toBe(true);
    expect(client.messages.filter((message) => message.method === 'hello')).toHaveLength(1);
  });

  it('a coalesced trigger with trailing bytes: the inventory before it answered cold, the trigger and everything after it delivered once, the render host’s own bytes after its hello passed on', async () => {
    const { root, starts, socketOf } = stand();
    const after = encodeFrame({ jsonrpc: '2.0', method: 'tabs.updated', params: { tabId: 1 } });
    const host = await renderHost(root, A, { after });
    const client = await cua(await socketOf(A));
    const tail = Buffer.concat([request(10, 'tabs.create', { url: 'about:blank' }), request(11, 'tabs.query'), request(12, 'debugger.attach').subarray(0, 9)]);
    client.socket.write(Buffer.concat([request(9, 'tabs.query'), tail]));
    await until(() => starts.length === 1);
    expect(client.answer(9)).toEqual({ jsonrpc: '2.0', id: 9, result: [] });
    client.socket.write(request(12, 'debugger.attach').subarray(9)); // the rest arrives while it waits
    starts[0]!.resolve({ epoch: 'e1', socketPath: host.path });
    const expected = Buffer.concat([tail, request(12, 'debugger.attach').subarray(9)]);
    await until(() => host.heard(0).length >= expected.length);
    await settle();
    expect(host.heard(0).equals(expected)).toBe(true);
    await until(() => client.messages.some((message) => message.method === 'tabs.updated'));
    expect(client.messages.filter((message) => message.method === 'hello')).toHaveLength(1);
    expect(client.answer(11)).toBeUndefined(); // the render host's to answer, not the broker's
  });

  it('in headless a still-cold connection splices at its next request, an inventory one included', async () => {
    const { root, starts, socketOf, readings } = stand();
    const host = await renderHost(root, A);
    const client = await cua(await socketOf(A));
    await until(() => client.messages.length === 1);
    readings.set(A, { state: 'headless', epoch: 'e1' });
    client.socket.write(request(1, 'tabs.query'));
    await until(() => starts.length === 1);
    starts[0]!.resolve({ epoch: 'e1', socketPath: host.path });
    await until(() => host.heard(0).length > 0);
    expect(host.heard(0).equals(request(1, 'tabs.query'))).toBe(true);
    expect(client.answer(1)).toBeUndefined();
  });

  it('a connection that closes while it waits never splices, and leaves the start to the others', async () => {
    const { root, starts, socketOf, places } = stand();
    const host = await renderHost(root, A);
    const path = await socketOf(A);
    const leaving = await cua(path);
    const staying = await cua(path);
    leaving.socket.write(request(1, 'tabs.create'));
    staying.socket.write(request(2, 'tabs.create'));
    await until(() => starts.length === 1 && places() === 2);
    leaving.socket.destroy();
    await until(() => places() === 1);
    expect(starts[0]!.demand.signal.aborted).toBe(false);
    starts[0]!.resolve({ epoch: 'e1', socketPath: host.path });
    await until(() => host.connections.length === 1 && host.heard(0).length > 0);
    await settle();
    expect(host.connections).toHaveLength(1);
    expect(host.heard(0).equals(request(2, 'tabs.create'))).toBe(true);
  });

  it('an ensureBrowser that resolves after the epoch moved never splices', async () => {
    const { root, starts, socketOf, readings, logs } = stand();
    const host = await renderHost(root, A);
    const path = await socketOf(A);
    const first = await cua(path);
    first.socket.write(request(1, 'tabs.create'));
    await until(() => starts.length === 1);
    readings.set(A, { state: 'cold', epoch: 'e2' }); // an app came and went: the route moved on
    starts[0]!.resolve({ epoch: 'e1', socketPath: host.path });
    await until(first.closed);
    expect(host.connections).toHaveLength(0);
    expect(logs.some((line) => line.includes('epoch'))).toBe(true);
    // and an answer naming another epoch than the demand's is refused the same way
    readings.set(A, { state: 'cold', epoch: 'e3' });
    const second = await cua(path);
    second.socket.write(request(2, 'tabs.create'));
    await until(() => starts.length === 2);
    starts[1]!.resolve({ epoch: 'e4', socketPath: host.path });
    await until(second.closed);
    expect(host.connections).toHaveLength(0);
    // and one that comes after the route fell back to cold in the same epoch (its start failed or overran there)
    readings.set(A, { state: 'cold', epoch: 'e5' });
    const third = await cua(path);
    third.socket.write(request(3, 'tabs.create'));
    await until(() => starts.length === 3);
    readings.set(A, { state: 'cold', epoch: 'e5' });
    starts[2]!.resolve({ epoch: 'e5', socketPath: host.path });
    await until(third.closed);
    expect(host.connections).toHaveLength(0);
  });

  it('routeChanged ends the connections of an older epoch and aborts its start; the current epoch’s live on', async () => {
    const { starts, socketOf, readings, broker, places } = stand();
    const path = await socketOf(A);
    const waiting = await cua(path);
    waiting.socket.write(request(1, 'tabs.create'));
    await until(() => starts.length === 1);
    readings.set(A, { state: 'cold', epoch: 'e2' });
    broker.routeChanged(A);
    await until(waiting.closed);
    expect(starts[0]!.demand.signal.aborted).toBe(true);
    expect(places()).toBe(0);
    const next = await cua(path);
    await until(() => next.messages.length === 1);
    broker.routeChanged(A);
    await settle();
    expect(next.closed()).toBe(false);
  });

  it('a hello from the render host of another session or protocol closes the connection, never forwards', async () => {
    for (const hello of [helloOf('B'), helloOf('A', 2), { jsonrpc: '2.0', id: 1, result: [] }]) {
      const { root, starts, socketOf, logs } = stand();
      const host = await renderHost(root, A, { hello });
      const client = await cua(await socketOf(A));
      client.socket.write(request(1, 'tabs.create'));
      await until(() => starts.length === 1);
      starts[0]!.resolve({ epoch: 'e1', socketPath: host.path });
      await until(client.closed);
      expect(host.heard(0).length).toBe(0);
      expect(logs.some((line) => line.includes('hello'))).toBe(true);
      expect(client.messages.filter((message) => message.method === 'hello')).toHaveLength(1);
    }
  });

  it('refuses a target that is not a private socket, answering the trigger', async () => {
    const { root, starts, socketOf } = stand();
    const host = await renderHost(root, A);
    chmodSync(join(root, 'render-cua'), 0o755);
    const client = await cua(await socketOf(A));
    client.socket.write(request(1, 'tabs.create'));
    await until(() => starts.length === 1);
    starts[0]!.resolve({ epoch: 'e1', socketPath: host.path });
    await until(client.closed);
    expect(client.answer(1)?.error?.message).toMatch(/^the browser on mini is refused: .*0755/);
    expect(host.connections).toHaveLength(0);
  });
});

describe('a start that fails or overruns', () => {
  it('a start timeout answers the triggering RPC with an error, then closes; a deadline is the trigger’s own timeoutMs when shorter', async () => {
    const { starts, socketOf, places } = stand();
    const client = await cua(await socketOf(A));
    client.socket.write(request(4, 'debugger.sendCommand', { debuggee: { tabId: 1 }, method: 'Page.navigate', timeoutMs: 150 }));
    await until(() => starts.length === 1);
    await until(client.closed, 1000);
    expect(client.answer(4)).toEqual({ jsonrpc: '2.0', id: 4, error: { code: 1, message: 'the browser on mini did not start within 150 ms' } });
    expect(places()).toBe(0);
  });

  it('the start’s own deadline answers every waiting trigger and lets the next demand start again', async () => {
    const { starts, socketOf } = stand({ limits: { startMs: 150 } });
    const path = await socketOf(A);
    const one = await cua(path);
    const two = await cua(path);
    one.socket.write(request(1, 'tabs.create'));
    two.socket.write(request(2, 'windows.create'));
    await until(() => one.closed() && two.closed(), 1000);
    expect(starts).toHaveLength(1);
    expect(starts[0]!.demand.signal.aborted).toBe(true);
    for (const [client, id] of [[one, 1], [two, 2]] as const) expect(client.answer(id)?.error?.message).toBe('the browser on mini did not start within 150 ms');
    const three = await cua(path);
    three.socket.write(request(3, 'tabs.create'));
    await until(() => starts.length === 2);
  });

  it('a failed start answers each trigger with its reason, then closes it', async () => {
    const { starts, socketOf, places } = stand();
    const path = await socketOf(A);
    const one = await cua(path);
    const two = await cua(path);
    one.socket.write(request(1, 'tabs.create'));
    two.socket.write(request(2, 'tabs.create'));
    await until(() => starts.length === 1 && places() === 2);
    starts[0]!.reject(new Error('the render service is unavailable on mini: no runtime'));
    await until(() => one.closed() && two.closed());
    expect(one.answer(1)?.error?.message).toBe('the render service is unavailable on mini: no runtime');
    expect(two.answer(2)?.error?.message).toBe('the render service is unavailable on mini: no runtime');
    expect(places()).toBe(0);
  });

  it('past the pending budget a trigger is answered with the reason and closed, starting nothing', async () => {
    const { starts, socketOf, placeLimit } = stand();
    placeLimit.value = 0;
    const client = await cua(await socketOf(A));
    client.socket.write(request(1, 'tabs.create'));
    await until(client.closed);
    expect(client.answer(1)?.error?.message).toMatch(/too many connections waiting for the browser on mini/);
    expect(starts).toHaveLength(0);
  });
});

describe('the bounds', () => {
  it('the constants are the spec’s', () => {
    expect({ CUA_BROWSER_START_MS, CUA_PROMOTION_MAX_BYTES, CUA_COLD_BUDGET, CUA_COLD_BUFFER_BYTES }).toEqual({
      CUA_BROWSER_START_MS: 4_000,
      CUA_PROMOTION_MAX_BYTES: 1_048_576,
      CUA_COLD_BUDGET: { session: 8, total: 64 },
      CUA_COLD_BUFFER_BYTES: 4_194_304,
    });
  });

  it('admits at most the cold budget per session and across the daemon, the excess closed with one line per burst', async () => {
    const { socketOf, logs } = stand({ limits: { cold: { session: 2, total: 3 } } });
    const a = await socketOf(A);
    const b = await socketOf(B);
    const first = await Promise.all([cua(a), cua(a)]);
    await until(() => first.every((client) => client.messages.length === 1));
    const extraA = await cua(a);
    await until(extraA.closed);
    expect(extraA.messages).toHaveLength(0);
    const inB = await cua(b);
    await until(() => inB.messages.length === 1);
    const extraB = await cua(b);
    await until(extraB.closed);
    expect(logs.filter((line) => line.includes('cold budget'))).toHaveLength(2);
    first[0]!.socket.destroy();
    await settle();
    const again = await cua(a);
    await until(() => again.messages.length === 1);
  });

  it('an inventory flood with its reader stopped: the broker stops reading, holds at its buffer budget and closes the offender alone', async () => {
    const { socketOf, broker } = stand({ limits: { connectionBytes: 8_192 } });
    const path = await socketOf(A);
    const quiet = await cua(path);
    const flood = await cua(path);
    await until(() => flood.messages.length === 1 && quiet.messages.length === 1);
    flood.socket.pause(); // its reader stopped: the answers back up
    const frames = Buffer.concat(Array.from({ length: 4_000 }, (_, index) => request(index, 'tabs.query')));
    let peak = 0;
    const sample = setInterval(() => void (peak = Math.max(peak, broker.inspect().buffered)), 1);
    for (let i = 0; i < 20; i++) flood.socket.write(frames);
    await until(flood.closed, 5000);
    clearInterval(sample);
    expect(peak).toBeLessThanOrEqual(8_192 + 65_536); // one read past the bound at most, then closed
    quiet.socket.write(request(1, 'tabs.query'));
    await until(() => quiet.answer(1) !== undefined);
  });

  it('fragmented input across many connections closes the offender at the aggregate budget', async () => {
    const { socketOf, broker } = stand();
    const path = await socketOf(A);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(CUA_PROMOTION_MAX_BYTES, 0);
    const part = Buffer.concat([header, Buffer.alloc(1_000_000, 0x20)]); // a frame never finished
    const clients = [];
    for (let i = 0; i < 4; i++) {
      const client = await cua(path);
      client.socket.write(part);
      clients.push(client);
      await until(() => broker.inspect().buffered === part.length * (i + 1), 5000);
    }
    const offender = await cua(path);
    offender.socket.write(part);
    await until(offender.closed, 5000);
    expect(clients.every((client) => !client.closed())).toBe(true);
    expect(broker.inspect().buffered).toBeLessThanOrEqual(CUA_COLD_BUFFER_BYTES);
  });

  it('a promoting connection’s input past one frame closes it, and frees its place', async () => {
    const { starts, socketOf, places } = stand();
    const client = await cua(await socketOf(A));
    client.socket.write(request(1, 'tabs.create'));
    await until(() => starts.length === 1);
    client.socket.write(Buffer.alloc(CUA_PROMOTION_MAX_BYTES + 8, 0x20));
    await until(client.closed, 5000);
    expect(places()).toBe(0);
  });
});
