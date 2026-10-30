// Two clients of the services front over a real machine.sock (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-
// cutover.md, acceptance 4's exactly-once half, Interfaces §C): each follows its sessions, leaves and comes back with
// its cursors, and holds every event of each session exactly once, in order, across its own disconnects, the other's,
// and a drop of the engine-host link; a cursor whose range the host no longer holds is answered `missing`. The front is
// mawsd's, served as the daemon serves it (`many`, one runtime per welcomed client); the engine host is the fake one.
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { SocketPort } from '@shared/host/socket-port';
import { SOCKET_PROTOCOL, splitLines } from '@shared/host/socket-protocol';
import { serveSocketClients, type SupervisorIdentity } from '@shared/host/socket-server';
import { WIRE_MINOR } from '@shared/ipc/wire';
import type { MachineRef } from '@shared/machine/ref';
import { createServicesFront, type ServicesFront } from '../../src/mawsd/front';
import { FakeEngineHost } from './fake-engine-host';

const TOKEN = 'two-clients-token';
const IDENTITY: SupervisorIdentity = { protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, buildId: 'test', capabilities: [], wire: 'test', pid: process.pid, startedAt: new Date().toISOString() };
const MACHINE = { ref: 'TestMachineRef00000000' as MachineRef, name: 'test machine', project: { key: 'machine:TestMachineRef00000000', name: 'test machine', smnsId: null } };

type Cursor = { launchId: string; seq: number; idx: number };
type Evt = { t: 'evt'; name: string; payload: { appSessionId?: string; events?: SessionEvent[] } };

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function lab() {
  const dir = mkdtempSync(join(tmpdir(), 'mc-')); // a socket path stays under the 104-byte bound
  const path = join(dir, 'machine.sock');
  const host = new FakeEngineHost();
  const front: ServicesFront = createServicesFront({
    spine: { ensure: async () => ({}) as never },
    hosts: host.hosts,
    intercept: () => null,
    daemon: async () => undefined,
    identity: () => MACHINE,
    isApp: () => false,
    log: () => {},
  });
  const server: Server = createServer();
  serveSocketClients(server, {
    many: { runtimeFor: (client) => front.runtimeFor(client) },
    badToken: 'close',
    identity: () => IDENTITY,
    counts: () => ({ liveSessions: 0, rows: 0 }),
    token: () => TOKEN,
    onExit: () => {},
    log: () => {},
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(() => (front.close(), server.close(), rmSync(dir, { recursive: true, force: true })));
  return { host, connect: (appPid: number) => connect(path, appPid) };
}

// A machine.sock client: the hello, the welcome, `ready`, then C1's envelope over the socket port
async function connect(path: string, appPid: number) {
  const socket = createConnection(path);
  cleanups.push(() => socket.destroy());
  const rest = await new Promise<Buffer>((resolve, reject) => {
    const splitter = splitLines(
      (line) => {
        const first = JSON.parse(line) as { t: string };
        if (first.t !== 'welcome') reject(new Error(`no welcome: ${line}`));
        return 'stop';
      },
      () => reject(new Error('a handshake line past the cap')),
    );
    const onData = (chunk: Buffer) => {
      splitter.push(chunk);
      socket.off('data', onData);
      resolve(splitter.rest());
    };
    socket.on('data', onData);
    socket.on('connect', () => socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token: TOKEN, minor: WIRE_MINOR, build: 'test', capabilities: [], appPid })}\n`));
  });
  const port = new SocketPort(socket, rest, { log: () => {} });
  const events: Evt[] = [];
  const answers = new Map<string, Record<string, unknown>>();
  port.on('message', ({ data }) => {
    const message = data as { t?: string; id?: string };
    if (message.t === 'evt') events.push(data as Evt);
    else if (message.t === 'res') answers.set(message.id!, data as Record<string, unknown>);
  });
  port.start();
  port.postMessage({ t: 'ready' });
  let next = 0;
  return {
    events,
    async request(name: string, input: unknown): Promise<Record<string, unknown>> {
      const id = `r${++next}`;
      port.postMessage({ t: 'req', id, name, input });
      await vi.waitFor(() => expect(answers.has(id)).toBe(true));
      return answers.get(id)!;
    },
    leave: () => socket.destroy(),
  };
}

type Client = Awaited<ReturnType<typeof connect>>;

/** What a client holds of `app`: every event of its batches, in order, kept across its connections. */
const batched = (client: Client, app: string) => client.events.flatMap((m) => (m.name === 'session.eventBatch' && m.payload.appSessionId === app ? m.payload.events! : []));
const ids = (events: readonly SessionEvent[]) => events.map((e) => e.id);
const cursorOf = (event: SessionEvent): Cursor => {
  const [, launchId, seq, idx] = event.id.split(':');
  return { launchId, seq: Number(seq), idx: Number(idx) };
};

describe('two clients of machine.sock', () => {
  it('each receives every event of its sessions exactly once, in order, across its disconnects, the other’s and a link drop', async () => {
    const { host, connect } = await lab();
    host.add('s1');
    host.add('s2');
    const written: Record<string, SessionEvent[]> = { s1: [], s2: [] };
    const write = (app: string, count: number, options?: { cut?: number[] }) => void written[app].push(...host.row(app, count, options));
    write('s1', 2);
    write('s2', 1);

    // each client's events across its connections, and its cursor at the last one it received
    const held: Record<string, Record<string, SessionEvent[]>> = { a: { s1: [], s2: [] }, b: { s1: [] } };
    const follows = { a: ['s1', 's2'], b: ['s1'] } as const;
    const cursors: Record<string, Record<string, Cursor | null>> = { a: { s1: null, s2: null }, b: { s1: null } };
    let a = await connect(11);
    let b = await connect(12);
    const follow = (who: 'a' | 'b', client: Client) =>
      client.request('session.follow', { sessions: follows[who].map((app) => ({ appSessionId: app, cursor: cursors[who][app] })), live: false });
    const settle = async (who: 'a' | 'b', client: Client, counts: Record<string, number>) => {
      await vi.waitFor(() => {
        for (const [app, count] of Object.entries(counts)) expect(held[who][app].length + batched(client, app).length).toBeGreaterThanOrEqual(count);
      });
    };
    const bank = (who: 'a' | 'b', client: Client) => {
      for (const app of follows[who]) {
        held[who][app].push(...batched(client, app));
        cursors[who][app] = held[who][app].length > 0 ? cursorOf(held[who][app].at(-1)!) : cursors[who][app];
      }
    };
    expect(await follow('a', a)).toMatchObject({ ok: true, value: { streams: [{ appSessionId: 's1', mode: 'live' }, { appSessionId: 's2', mode: 'live' }] } });
    expect(await follow('b', b)).toMatchObject({ ok: true, value: { streams: [{ appSessionId: 's1', mode: 'live' }] } });
    // `from: now`: neither holds the rows written before it followed (their batches went out before)
    const base = { s1: written.s1.length, s2: written.s2.length };

    write('s1', 3, { cut: [1] });
    write('s2', 2);
    await settle('a', a, { s1: 3, s2: 2 });
    await settle('b', b, { s1: 3 });

    // a leaves; meanwhile the host writes, b goes on
    bank('a', a);
    a.leave();
    write('s1', 2);
    write('s2', 1);
    await settle('b', b, { s1: 5 });

    // the engine-host link drops with b still connected; the host writes across the drop; a comes back meanwhile
    host.drop();
    write('s1', 1);
    write('s2', 2);
    a = await connect(11);
    expect(await follow('a', a)).toMatchObject({ value: { streams: [{ appSessionId: 's1', mode: 'replay' }, { appSessionId: 's2', mode: 'replay' }] } });
    host.reconnect();
    write('s1', 2, { cut: [1] });

    // b leaves and comes back after the link is back
    await settle('b', b, { s1: 8 });
    bank('b', b);
    b.leave();
    write('s1', 1);
    b = await connect(12);
    expect(await follow('b', b)).toMatchObject({ value: { streams: [{ appSessionId: 's1', mode: 'replay' }] } });
    write('s1', 1);
    write('s2', 1);

    const s1 = written.s1.slice(base.s1);
    const s2 = written.s2.slice(base.s2);
    await settle('a', a, { s1: s1.length, s2: s2.length });
    await settle('b', b, { s1: s1.length });
    bank('a', a);
    bank('b', b);
    expect(ids(held.a.s1)).toEqual(ids(s1));
    expect(ids(held.a.s2)).toEqual(ids(s2));
    expect(ids(held.b.s1)).toEqual(ids(s1));
  });

  it('answers `missing` to a client whose cursor’s range the host no longer holds, while the other’s stream goes on', async () => {
    const { host, connect } = await lab();
    const s = host.add('s1');
    const first = host.row('s1', 1);
    const a = await connect(21);
    const b = await connect(22);
    expect(await b.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: cursorOf(first[0]) }], live: false })).toMatchObject({ value: { streams: [{ mode: 'replay' }] } });
    const later = [...host.row('s1', 1), ...host.row('s1', 2)];
    s.evicted = { seq: 2, idx: 0 }; // the ring dropped the start of the range, and the journal cannot be read back
    s.journal = false;
    expect(await a.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: cursorOf(first[0]) }], live: false })).toMatchObject({ value: { streams: [{ appSessionId: 's1', mode: 'missing', launchId: s.launchId }] } });
    const live = host.row('s1', 1);
    await vi.waitFor(() => expect(batched(a, 's1')).toHaveLength(1));
    expect(ids(batched(a, 's1'))).toEqual(ids(live));
    await vi.waitFor(() => expect(batched(b, 's1')).toHaveLength(4));
    expect(ids(batched(b, 's1'))).toEqual(ids([...later, ...live]));
  });
});
