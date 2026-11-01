// P5 O7 M3's forwarded ports over a link in memory (test/lane-b/fake-link.ts) and a real listener on 127.0.0.1: what
// bounds a connection when the machine doesn't answer, how one the machine ended is closed, and what ends a forward
// (the link's end, an act that fails its grade at the open or at a renewal).
import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandResult, CommandName } from '@shared/ipc/schema';
import { FakeLink, MINI, type FakeAct } from '../../../test/lane-b/fake-link';
import { listenLoopback, type LocalListener } from '../forwards';
import type { ActOutcome } from '../machines/remote/link';
import { FORWARD_WAITING_MAX, createRemoteForwards, type RemoteForwardsTiming } from './remote-forward';

const PORT = 5173;
const GRANTED: ActOutcome = { state: 'done', result: { forward: 'fwd-1' } };
const FAILED_GRADE: ActOutcome = { state: 'failed', error: { code: 'grade', message: 'forward.open: no shell grant' } };

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function lab(timing: Partial<RemoteForwardsTiming> = {}, answer: (act: FakeAct) => void = (act) => act.settle(GRANTED)) {
  const link = new FakeLink();
  link.peers = ['rl2.executor.machine', 'rl2.streams'];
  link.onAct = answer;
  const listeners: Array<{ port: number; closed: boolean }> = [];
  const accepted: Socket[] = [];
  // The state listeners the forwards hold on the link: a subscription let go is no longer counted.
  let watching = 0;
  const onState = link.onState.bind(link);
  link.onState = (listener) => {
    watching += 1;
    const off = onState(listener);
    return () => (watching -= 1, off());
  };
  const forwards = createRemoteForwards({
    remote: () => link,
    listen: async (onConnection) => {
      const real: LocalListener = await listenLoopback((socket) => (accepted.push(socket), onConnection(socket)));
      const seen = { port: real.port, closed: false };
      listeners.push(seen);
      return { port: real.port, close: () => ((seen.closed = true), real.close()) };
    },
    bounded: (handle) => handle.outcome,
    pendingMs: 60_000,
    timing: { forwardWaitMs: 60_000, forwardDrainMs: 60_000, ...timing },
    now: Date.now,
    log: () => {},
  });
  stops.push(() => forwards.stop());
  const open = () => forwards.open({ machine: MINI, port: PORT }) as Promise<CommandResult<CommandName>>;
  return { link, forwards, listeners, accepted, open, watching: () => watching };
}

const localPort = (result: CommandResult<CommandName>) => (result as { ok: true; value: { localPort: number } }).value.localPort;

/** A client of the local listener, connected; its end is heard as `ended` and its close as `closed`. */
async function client(port: number, options: { allowHalfOpen?: boolean } = {}) {
  const socket = connect({ port, host: '127.0.0.1', ...options });
  socket.on('error', () => {});
  const seen = { data: '', ended: false, closed: false };
  socket.on('data', (chunk) => (seen.data += chunk.toString()));
  socket.on('end', () => (seen.ended = true));
  socket.on('close', () => (seen.closed = true));
  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('error', reject));
  stops.push(() => socket.destroy());
  return { socket, seen };
}

/** Whether a connection to the port is refused (nothing listens). */
const refused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(true));
  });

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('forwarded ports (P5 O7 M3)', () => {
  it('bounds the connections waiting for their stream: one past FORWARD_WAITING_MAX is reset at once, the rest past forwardWaitMs', async () => {
    const l = lab({ forwardWaitMs: 1500 });
    const port = localPort(await l.open());
    // The machine is offline: no stream ever opens.
    const clients = await Promise.all(Array.from({ length: FORWARD_WAITING_MAX + 1 }, () => client(port)));
    await until(() => l.link.streams.length === FORWARD_WAITING_MAX && clients.some((c) => c.seen.closed));
    await sleep(200);
    expect(clients.filter((c) => c.seen.closed)).toHaveLength(1);
    expect(l.link.streams).toHaveLength(FORWARD_WAITING_MAX);
    // Past forwardWaitMs every waiting one is reset, and its stream let go.
    await until(() => clients.every((c) => c.seen.closed), 4000);
    expect(l.link.streams.every((s) => s.closed === 'closed')).toBe(true);
    // The count went back: a new connection is admitted (its stream asked for).
    await client(port);
    await until(() => l.link.streams.length === FORWARD_WAITING_MAX + 1);
  }, 15_000);

  it('closes a connection the machine ended once what it holds is written, though its peer never ends its side', async () => {
    const l = lab();
    const port = localPort(await l.open());
    const { seen } = await client(port, { allowHalfOpen: true });
    await until(() => l.link.streams.length === 1);
    const stream = l.link.streams[0];
    stream.sink.opened({ credit: 1 << 20 });
    stream.sink.data(0, new TextEncoder().encode('served'));
    stream.sink.closed('closed');
    await until(() => seen.ended && l.accepted[0].destroyed);
    expect(seen.data).toBe('served');
    expect(stream.credited).toBe(6);
  });

  it('destroys a connection the machine ended by forwardDrainMs when its peer reads none of what it holds', async () => {
    const l = lab({ forwardDrainMs: 300 });
    const port = localPort(await l.open());
    const { socket } = await client(port, { allowHalfOpen: true });
    socket.pause(); // reads nothing: the bytes back up past what the kernel buffers
    await until(() => l.link.streams.length === 1);
    const stream = l.link.streams[0];
    stream.sink.opened({ credit: 1 << 20 });
    stream.sink.data(0, new Uint8Array(32 << 20));
    stream.sink.closed('closed');
    expect(l.accepted[0].writableLength).toBeGreaterThan(0);
    await until(() => l.accepted[0].destroyed, 3000);
  }, 15_000);

  it('closes and forgets the forwards of a link that ended, and lets go of the link', async () => {
    const l = lab();
    const port = localPort(await l.open());
    expect(l.watching()).toBe(1);
    // the in-app browser's reads of the listener (src/main/browser/forwarded.ts)
    expect([l.forwards.listening(MINI, PORT), l.forwards.at(port), l.forwards.at(port + 1)]).toEqual([port, { machine: MINI, port: PORT }, null]);
    const { seen } = await client(port);
    await until(() => l.link.streams.length === 1);
    l.link.streams[0].sink.opened({ credit: 1 << 20 });
    l.link.end('closed');
    expect(l.listeners[0].closed).toBe(true);
    expect(l.link.streams[0].closed).toBe('closed');
    expect(l.watching()).toBe(0);
    expect(await refused(port)).toBe(true);
    expect([l.forwards.listening(MINI, PORT), l.forwards.at(port)]).toEqual([null, null]);
    await until(() => seen.closed);
    // The ended link opens no forward again.
    expect(await l.open()).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(l.link.acts).toHaveLength(1);
  });

  it('ends the forward when its act fails its grade at the open: the listener closes, nothing is retried', async () => {
    const l = lab({}, (act) => act.settle(FAILED_GRADE));
    const result = await l.open();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('grade');
    expect(l.listeners).toHaveLength(1);
    expect(l.listeners[0].closed).toBe(true);
    expect(await refused(l.listeners[0].port)).toBe(true);
    await sleep(100);
    expect(l.link.acts).toHaveLength(1);
  });

  it('ends the forward when the renewal of a forgotten forward fails its grade: the connection resets, the listener closes, nothing is retried', async () => {
    let answers = 0;
    const l = lab({}, (act) => act.settle(++answers === 1 ? GRANTED : FAILED_GRADE));
    const port = localPort(await l.open());
    const { seen } = await client(port);
    await until(() => l.link.streams.length === 1);
    l.link.streams[0].sink.closed('unknown'); // past the endpoint's window: the forward is forgotten
    await until(() => seen.closed);
    expect(l.link.acts).toHaveLength(2);
    expect(l.listeners[0].closed).toBe(true);
    expect(await refused(port)).toBe(true);
    await sleep(100);
    expect(l.link.acts).toHaveLength(2);
    expect(l.link.streams).toHaveLength(1);
  });
});
