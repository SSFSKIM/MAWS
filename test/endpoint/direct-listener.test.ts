// The direct listener (O10 M4; RL §4.1, P5 Decision Log 39), over a fake interface table: it binds only the tailnet's
// addresses the table names (here each is listened on at 127.0.0.1, so no real tailnet, wildcard or LAN address is
// ever bound and no firewall prompt is raised), advertises them, rebinds when they change, reads nothing but the
// handshake before it verifies, and answers past its rate limit `busy`.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { canonicalize, generateEphemeral, generateSigningKey, HANDSHAKE_PAGE_BYTES, memoryOrgView, type ByteDuplex, type SignedOrgState, type SigningKey } from 'org-protocol';
import WebSocket from 'ws';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import { Channels } from '../../src/endpoint/channels';
import { DirectListener, HandshakeLimiter, type DirectListenerOptions } from '../../src/endpoint/direct-listener';
import type { InterfaceTable } from '../../src/endpoint/tailnet';
import { mintRef } from './fake-services';
import { genesis, memberId, newDevice, successor, type TestDevice } from './org-fixtures';

const ORG = 'org-m4-direct';
const REF = mintRef();
const A = memberId();
let machineKey: SigningKey;
let a1: TestDevice;
let chain: SignedOrgState[];

const v4 = (address: string): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null });
const v6 = (address: string): NetworkInterfaceInfo => ({ address, family: 'IPv6', internal: false, netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', mac: '00:00:00:00:00:00', scopeid: 0, cidr: null });

beforeAll(async () => {
  machineKey = await generateSigningKey();
  a1 = await newDevice('a1');
  const g = await genesis(ORG, A, a1, await generateSigningKey());
  chain = [g, await successor(g, [a1], (s) => {
    s.machines.push({ name: 'mini', ref: REF, pub: machineKey.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref: REF });
  })];
});

type Fixture = {
  listener: DirectListener;
  /** Every address the listener asked to listen on, in order. */
  requested: string[];
  /** Each advertised address's loopback port: what the suite dials in its place. */
  ports: Map<string, number>;
  /** The server last listened for each address. */
  servers: Map<string, Server>;
  reports: string[][];
  log: string[];
  table: { current: InterfaceTable };
  reads: { count: number };
  channels: Channels;
};
const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.channels.closeAll('restart');
    await f.listener.stop();
  }
});

/** Listens on 127.0.0.1 in the address's place: the fake table's tailnet addresses aren't this machine's. */
function loopback(requested: string[], ports: Map<string, number>, servers: Map<string, Server>, failing: Set<string>): NonNullable<DirectListenerOptions['listen']> {
  return (server: Server, address: string) =>
    new Promise<number>((resolve, reject) => {
      requested.push(address);
      if (failing.delete(address)) return reject(Object.assign(new Error(`listen EADDRNOTAVAIL ${address}`), { code: 'EADDRNOTAVAIL' }));
      servers.set(address, server);
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port;
        ports.set(address, port);
        resolve(port);
      });
    });
}

async function fixture(options: { table?: InterfaceTable; limits?: DirectListenerOptions['limits']; failing?: string[] } = {}): Promise<Fixture> {
  const requested: string[] = [];
  const ports = new Map<string, number>();
  const servers = new Map<string, Server>();
  const reports: string[][] = [];
  const log: string[] = [];
  const table = { current: options.table ?? { utun4: [v4('100.101.102.103'), v6('fd7a:115c:a1e0::abcd')], en0: [v4('192.168.1.20')], lo0: [v4('127.0.0.1')] } };
  const reads = { count: 0 };
  const view = memoryOrgView({ chain: [...chain] });
  const channels = new Channels({
    identity: () => ({ ref: REF, key: machineKey, build: 'm4-direct', capabilities: [] }),
    org: () => view,
    adopt: () => Promise.resolve(),
    rights: () => Promise.resolve([]),
    hold: () => () => {},
    counts: () => {},
    log: (line) => void log.push(line),
  });
  const listener = new DirectListener({
    port: 47830,
    interfaces: () => {
      reads.count++;
      return table.current;
    },
    listen: loopback(requested, ports, servers, new Set(options.failing)),
    connection: (io) => void channels.accept('direct', io, { deadlineMs: 10_000 }),
    addresses: (urls) => void reports.push(urls),
    log: (line) => void log.push(line),
    limits: options.limits,
  });
  const f = { listener, requested, ports, servers, reports, log, table, reads, channels };
  fixtures.push(f);
  await listener.start();
  return f;
}

/** A raw WebSocket to the listener's loopback stand-in for `address`. */
function raw(f: Fixture, address = '100.101.102.103'): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${f.ports.get(address)}`);
}

const opened = (socket: WebSocket) => new Promise<void>((resolve, reject) => socket.once('open', () => resolve()).once('error', reject));
/**
 * Dials the loopback port `address` had and answers whether the server the listener had there took the connection.
 * The kernel may give a freed port to another server at once (a parallel suite's, or this listener's next bind), which
 * then answers the dial: the let-go server's own connections are what is judged, not whether the dial opened.
 */
async function reachesLetGo(f: Fixture, address: string): Promise<boolean> {
  const server = f.servers.get(address)!;
  let reached = false;
  const seen = () => void (reached = true);
  server.on('connection', seen);
  const socket = new WebSocket(`ws://127.0.0.1:${f.ports.get(address)}`);
  await opened(socket).then(
    () => socket.terminate(),
    () => {},
  );
  server.off('connection', seen);
  return reached;
}

const closedOf = (socket: WebSocket) => new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));

/** The device's carrier over a WebSocket. */
async function dial(url: string): Promise<ByteDuplex> {
  const socket = new WebSocket(url);
  await opened(socket);
  const closes: Array<(reason: string) => void> = [];
  socket.on('close', (_code, reason) => closes.forEach((l) => l(reason.toString() || 'closed')));
  return {
    send: (bytes) => socket.send(bytes),
    onBytes: (l) => void socket.on('message', (data: Buffer) => l(new Uint8Array(data))),
    onClose: (l) => void closes.push(l),
    close: () => socket.close(1000),
  };
}

async function validH1(): Promise<string> {
  const e = await generateEphemeral();
  const n = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  return canonicalize({ t: 'h1', protocol: { major: 1, minor: 0 }, build: 'raw', capabilities: [], org: ORG, machine: REF, member: A, device: 'a1', clientClass: 'native-mac', stateVersion: 2, e: e.pub, n });
}

describe('binding', () => {
  it('binds each tailnet address the table names and nothing else, never a wildcard, and advertises them', async () => {
    const f = await fixture();
    expect(f.requested).toEqual(['100.101.102.103', 'fd7a:115c:a1e0::abcd']);
    for (const wildcard of ['0.0.0.0', '::', '', '127.0.0.1', '192.168.1.20']) expect(f.requested).not.toContain(wildcard);
    expect(f.reports).toEqual([[`ws://100.101.102.103:${f.ports.get('100.101.102.103')}`, `ws://[fd7a:115c:a1e0::abcd]:${f.ports.get('fd7a:115c:a1e0::abcd')}`]]);
    expect(f.listener.bound).toBe(true);
  });

  it('binds nothing, and advertises nothing, on a machine with no tailnet address', async () => {
    const f = await fixture({ table: { en0: [v4('192.168.1.20')], lo0: [v4('127.0.0.1'), v6('::1')] } });
    expect(f.requested).toEqual([]);
    expect(f.reports).toEqual([]);
    expect(f.listener.bound).toBe(false);
  });

  it('rebinds when the addresses change and advertises the new set, and stays put when they don’t', async () => {
    const f = await fixture();
    const before = raw(f, 'fd7a:115c:a1e0::abcd');
    await opened(before);
    before.close();
    const oldPort = f.ports.get('100.101.102.103');
    f.table.current = { utun4: [v4('100.101.102.103'), v4('100.90.1.2')] };
    await f.listener.rescan();
    expect(f.requested.slice(2)).toEqual(['100.90.1.2']);
    expect(f.reports.at(-1)).toEqual([`ws://100.101.102.103:${oldPort}`, `ws://100.90.1.2:${f.ports.get('100.90.1.2')}`]);
    // The address let go takes no connection: its server listens no more, and a dial to its port never reaches it.
    expect(f.servers.get('fd7a:115c:a1e0::abcd')!.listening).toBe(false);
    expect(await reachesLetGo(f, 'fd7a:115c:a1e0::abcd')).toBe(false);
    await f.listener.rescan();
    expect(f.reports).toHaveLength(2);
    expect(f.requested).toHaveLength(3);
  });

  it('lets an address go at once though a WebSocket on it is open: the socket is ended, the new set bound and advertised, and stop() not held', async () => {
    const f = await fixture();
    const live = raw(f, 'fd7a:115c:a1e0::abcd');
    await opened(live);
    const ended = closedOf(live);
    f.table.current = { utun4: [v4('100.101.102.103'), v4('100.90.1.2')] };
    const bounded = <T>(work: Promise<T>, what: string) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} held past 2 s`)), 2000))]);
    await bounded(f.listener.rescan(), 'the rescan');
    expect(f.reports.at(-1)).toEqual([`ws://100.101.102.103:${f.ports.get('100.101.102.103')}`, `ws://100.90.1.2:${f.ports.get('100.90.1.2')}`]);
    await bounded(ended, 'the vanished address’s socket');
    const staying = raw(f);
    await opened(staying);
    await bounded(f.listener.stop(), 'stop()');
    await bounded(closedOf(staying), 'the socket at stop');
  });

  it('reads the interfaces again at once on a bind error, and tries the failed address again only at the next periodic read', async () => {
    const f = await fixture({ failing: ['fd7a:115c:a1e0::abcd'] });
    expect(f.log.some((line) => line.includes('EADDRNOTAVAIL'))).toBe(true);
    expect(f.reads.count).toBe(2);
    expect(f.requested).toEqual(['100.101.102.103', 'fd7a:115c:a1e0::abcd']);
    expect(f.reports).toEqual([[`ws://100.101.102.103:${f.ports.get('100.101.102.103')}`]]);
    await f.listener.rescan();
    expect(f.requested).toEqual(['100.101.102.103', 'fd7a:115c:a1e0::abcd', 'fd7a:115c:a1e0::abcd']);
    expect(f.reports.at(-1)).toHaveLength(2);
  });

  it('stops listening at stop()', async () => {
    const f = await fixture();
    await f.listener.stop();
    expect(f.listener.bound).toBe(false);
    for (const address of ['100.101.102.103', 'fd7a:115c:a1e0::abcd']) {
      expect(f.servers.get(address)!.listening).toBe(false);
      expect(await reachesLetGo(f, address)).toBe(false);
    }
  });
});

describe('a connection', () => {
  it('carries RL2 to a device: `caps` comes first', async () => {
    const f = await fixture();
    const dev = new Device({ identity: { org: ORG, member: A, device: 'a1', clientClass: 'native-mac', channelKey: a1.channel, build: 'device', capabilities: [] }, org: memoryOrgView({ chain: [...chain] }) });
    const channel = await dev.open(() => dial(`ws://127.0.0.1:${f.ports.get('100.101.102.103')}`), REF);
    const first = await new Promise((resolve) => channel.onMessage(resolve));
    expect(first).toMatchObject({ t: 'caps', member: A, device: 'a1', machine: { grades: [] } });
    channel.close('done');
  });

  it('closes on a `call` sent before the handshake verifies', async () => {
    const f = await fixture();
    const socket = raw(f);
    await opened(socket);
    const closed = closedOf(socket);
    const h2 = new Promise<void>((resolve) => socket.once('message', () => resolve()));
    socket.send(Buffer.from(await validH1()));
    await h2;
    socket.send(Buffer.from(JSON.stringify({ t: 'call', id: '1', name: 'daemon.status', input: {} })));
    await closed;
  });

  it('closes on a text message', async () => {
    const f = await fixture();
    const socket = raw(f);
    await opened(socket);
    const closed = closedOf(socket);
    socket.send(await validH1());
    await closed;
  });

  it('closes on an `h3` over a handshake page', async () => {
    const f = await fixture();
    const socket = raw(f);
    await opened(socket);
    const closed = closedOf(socket);
    const h2 = new Promise<void>((resolve) => socket.once('message', () => resolve()));
    socket.send(Buffer.from(await validH1()));
    await h2;
    socket.send(Buffer.alloc(HANDSHAKE_PAGE_BYTES + 1, 0x20));
    await closed;
  });

  it('answers a source past its burst `503 busy` at the upgrade', async () => {
    const f = await fixture();
    const answers: number[] = [];
    for (let i = 0; i < 4; i++) {
      const socket = raw(f);
      answers.push(await new Promise<number>((resolve) => {
        socket.once('open', () => {
          resolve(101);
          socket.close();
        });
        socket.once('unexpected-response', (_request, response) => {
          let body = '';
          response.on('data', (chunk: Buffer) => (body += chunk.toString()));
          response.on('end', () => resolve(body === '{"error":"busy"}' ? (response.statusCode ?? 0) : -1));
        });
        socket.once('error', () => {});
      }));
    }
    expect(answers).toEqual([101, 101, 101, 503]);
  });
});

describe('the handshake limiter', () => {
  it('lets a source burst 3 and then 5 a minute, and every source together 60 a minute', () => {
    let now = 0;
    const limiter = new HandshakeLimiter(undefined, () => now);
    expect([1, 2, 3, 4].map(() => limiter.take('100.64.0.1'))).toEqual([true, true, true, false]);
    expect(limiter.take('100.64.0.2')).toBe(true);
    now += 11_999;
    expect(limiter.take('100.64.0.1')).toBe(false);
    now += 1;
    expect(limiter.take('100.64.0.1')).toBe(true);
    expect(limiter.take('100.64.0.1')).toBe(false);

    now = 0;
    const overall = new HandshakeLimiter(undefined, () => now);
    let admitted = 0;
    for (let source = 0; source < 100; source++) if (overall.take(`100.64.1.${source}`)) admitted++;
    expect(admitted).toBe(60);
    now += 1000;
    expect(overall.take('100.64.2.1')).toBe(true);
    expect(overall.take('100.64.2.2')).toBe(false);
  });

  it('forgets a source once its bucket is full again', () => {
    let now = 0;
    const limiter = new HandshakeLimiter(undefined, () => now);
    for (let source = 0; source < 50; source++) limiter.take(`100.64.3.${source}`);
    expect(limiter.sources).toBe(50);
    now += 60_000;
    limiter.take('100.64.4.1');
    expect(limiter.sources).toBe(1);
  });
});

