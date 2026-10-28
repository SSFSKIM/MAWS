import { createConnection, createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectLines, listenTemp, type LineClient, type TempSocket } from '../../../test/support/socket-lines';
import { createHostRuntime, type DocPortEnd, type DocPortHandler, type HostEmit, type HostRuntime } from './runtime';
import { SocketPort } from './socket-port';
import { encodePtyFrame, PTY_FRAMES_CAPABILITY, PTY_MARK, splitLines } from './socket-protocol';
import { serveSocketClients, type SocketClients, type SocketServerOptions } from './socket-server';

const TOKEN = 'a'.repeat(64);
const IDENTITY = { protocol: 3, minor: 2, buildId: 'build-1', capabilities: ['area.feature'], wire: 'wire-1', pid: 4242, startedAt: '2026-10-06T10:00:00.000Z' };
const hello = (over: Record<string, unknown> = {}) => ({ t: 'hello', protocol: 3, token: TOKEN, minor: 2, build: 'build-1', capabilities: [], appPid: 7, ...over });
// P5 O1 M6: protocol 2's hello, as a pre-O1 app sends it (the protocol-2 window)
const helloV2 = (over: Record<string, unknown> = {}) => ({ t: 'hello', protocol: 2, token: TOKEN, buildId: 'build-0', wire: 'wire-1', appPid: 6, ...over });
const WELCOME = { t: 'welcome', protocol: 3, minor: 2, build: 'build-1', capabilities: ['area.feature'], pid: 4242, startedAt: IDENTITY.startedAt, liveSessions: 2, rows: 3 };
const refusal = (reason: string) => ({ t: 'refuse', reason, protocol: 3, buildId: 'build-1', wire: 'wire-1', liveSessions: 2 });
const ITEMS = { appSessionId: 'app-1', items: [] };
const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { timeout: 3_000, interval: 5 });
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

let temp: TempSocket | null = null;
const clients: LineClient[] = [];
const sockets: Socket[] = []; // P3-A M5
afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.destroy();
  for (const socket of sockets.splice(0)) socket.destroy();
  await temp?.dispose();
  temp = null;
});

// P5 O2 M3: `badToken`, the many-clients mode (a runtime per connection, from `runtimeFor`) and a half-open server
interface StartOptions {
  helloTimeoutMs?: number;
  hooks?: (() => void)[];
  onDocPort?: DocPortHandler;
  docHighWater?: number;
  badToken?: 'refuse' | 'close';
  many?: { runtimeFor(): HostRuntime };
  halfOpen?: boolean;
  admitHello?: SocketServerOptions['admitHello']; // P5 O2 M5
  admit?: (socket: Socket) => boolean; // P5 O6 M3
}

async function start(options: StartOptions = {}) {
  let emit!: HostEmit;
  const runtime: HostRuntime = createHostRuntime((on, e, client) => {
    on('engine.ping', async () => ({ pid: 4242, uptimeMs: 1, hostVersion: 'test' }));
    emit = e;
    if (options.onDocPort) client.onDocPort(options.onDocPort); // P3-A M5
  });
  for (const hook of options.hooks ?? []) runtime.onConnect(hook);
  const exits: string[] = [];
  const refusedExits: string[] = []; // P5 O2 M5: the exits a refused connection asked
  const changes: boolean[] = [];
  const ends: number[] = [];
  const log = vi.fn<(line: string) => void>();
  const server = createServer({ allowHalfOpen: options.halfOpen ?? false });
  const served: SocketClients = serveSocketClients(server, {
    ...(options.many ? { many: options.many } : { runtime }),
    badToken: options.badToken,
    onClientEnd: () => void ends.push(Date.now()),
    identity: () => IDENTITY,
    counts: () => ({ liveSessions: 2, rows: 3 }),
    token: () => TOKEN,
    onExit: (when, from) => {
      exits.push(when);
      if (from?.refused) refusedExits.push(when);
    },
    onClient: (connected) => void changes.push(connected),
    admitHello: options.admitHello, // P5 O2 M5
    log,
    helloTimeoutMs: options.helloTimeoutMs,
    docHighWater: options.docHighWater, // P3-A M5
    admit: options.admit, // P5 O6 M3
  });
  temp = await listenTemp(server);
  const connect = async () => {
    const client = await connectLines(temp!.path);
    clients.push(client);
    return client;
  };
  // P3-A M5: a welcomed client whose later bytes are read as records (lines and document frames), as main reads them.
  const connectPort = async (): Promise<{ socket: Socket; port: SocketPort; lines: unknown[]; frames: [number, number[]][] }> => {
    const socket = createConnection(temp!.path);
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', resolve));
    const leftover = await new Promise<Buffer>((resolve) => {
      let welcomed = false;
      const splitter = splitLines(() => ((welcomed = true), 'stop'), () => {});
      socket.on('data', function onData(chunk: Buffer) {
        splitter.push(chunk);
        if (!welcomed) return;
        socket.off('data', onData);
        resolve(splitter.rest());
      });
      socket.write(`${JSON.stringify(hello())}\n`);
    });
    const port = new SocketPort(socket, leftover, { log: () => {} });
    const lines: unknown[] = [];
    const frames: [number, number[]][] = [];
    port.on('message', ({ data }) => void lines.push(data));
    port.onDoc((channel, frame) => void frames.push([channel, [...frame]]));
    port.start();
    return { socket, port, lines, frames };
  };
  return { runtime, emit: () => emit('session.brokerItems', ITEMS as never), exits, refusedExits, changes, ends, log, served, connect, connectPort };
}

describe('the socket layer handshake (server side)', () => {
  // P5 O6 M3: the stand-in's peer check enters here (src/main/machines/serve-standin.ts)
  it('closes a connection its admit refuses before reading a byte or starting the hello deadline, and serves one it admits', async () => {
    let verdict = false;
    const admit = vi.fn<(socket: Socket) => boolean>(() => verdict);
    const host = await start({ admit, helloTimeoutMs: 60 });
    const refused = await host.connect();
    refused.send(hello());
    await refused.closed;
    expect(admit).toHaveBeenCalledOnce();
    expect(refused.lines).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(host.log).not.toHaveBeenCalled(); // no hello was read, and no deadline ran out
    expect(host.changes).toEqual([]);

    verdict = true;
    const admitted = await host.connect();
    admitted.send(hello());
    expect(await admitted.next()).toEqual(WELCOME);
    expect(admit).toHaveBeenCalledTimes(2);
  });

  it('welcomes a valid hello with its identity and serves requests; events wait for ready, where the connect hooks run', async () => {
    const order: string[] = [];
    const host = await start({ hooks: [() => void order.push('hook')] });
    const client = await host.connect();
    client.send(hello());
    expect(await client.next()).toEqual(WELCOME);
    expect(host.served.connected()).toBe(true);
    expect(host.changes).toEqual([true]);
    expect(host.log).toHaveBeenCalledWith(expect.stringContaining('appPid 7'));

    client.send({ t: 'req', id: '1', name: 'engine.ping', input: undefined });
    expect(await client.next((line) => (line as { t: string }).t === 'res')).toEqual({ t: 'res', id: '1', ok: true, value: { pid: 4242, uptimeMs: 1, hostVersion: 'test' } });
    expect(host.emit()).toBe(false);
    expect(order).toEqual([]);

    client.send({ t: 'ready' });
    await until(() => host.runtime.hasClient());
    expect(order).toEqual(['hook']);
    expect(host.emit()).toBe(true);
    expect(await client.next((line) => (line as { t: string }).t === 'evt')).toEqual({ t: 'evt', name: 'session.brokerItems', payload: ITEMS });
    expect(client.lines.filter((line) => (line as { t: string }).t === 'evt')).toHaveLength(1);
  });

  it('hands the bytes sent right after the hello to the port: a hello, a request and ready in one write', async () => {
    const host = await start();
    const client = await host.connect();
    client.sendRaw(`${JSON.stringify(hello())}\n${JSON.stringify({ t: 'req', id: '9', name: 'engine.ping', input: undefined })}\n{"t":"ready"}\n`);
    expect(await client.next((line) => (line as { t: string }).t === 'res')).toMatchObject({ id: '9', ok: true });
    await until(() => host.runtime.hasClient());
  });

  it('refuses a wrong token and closes, reading nothing further: an exit in the same write is ignored', async () => {
    const host = await start();
    const client = await host.connect();
    client.sendRaw(`${JSON.stringify(hello({ token: 'b'.repeat(64) }))}\n${JSON.stringify({ t: 'exit', when: 'now' })}\n`);
    expect(await client.next()).toEqual(refusal('token'));
    await client.closed;
    await settle();
    expect(host.exits).toEqual([]);
    expect(host.served.connected()).toBe(false);
    expect(client.lines).toHaveLength(1);
  });

  it('refuses a missing token the same way', async () => {
    const host = await start();
    const client = await host.connect();
    const noToken: Record<string, unknown> = hello();
    delete noToken.token;
    client.send(noToken);
    expect(await client.next()).toMatchObject({ t: 'refuse', reason: 'token' });
    await client.closed;
    expect(host.exits).toEqual([]);
  });

  it('refuses another protocol but keeps the connection for one exit, and honours it', async () => {
    const host = await start();
    const client = await host.connect();
    client.send({ t: 'hello', protocol: 4, token: TOKEN, somethingNew: true }); // a later protocol's hello: only the preamble is read
    expect(await client.next()).toEqual(refusal('protocol'));
    await settle();
    expect(client.isClosed()).toBe(false);
    client.send({ t: 'exit', when: 'now' });
    await until(() => host.exits.length === 1);
    expect(host.exits).toEqual(['now']);
    expect(host.served.connected()).toBe(false);
  });

  it('refuses a protocol-2 hello of another wire fingerprint, keeps the connection for one exit, and closes it on anything else', async () => {
    const host = await start();
    const armed = await host.connect();
    armed.send(helloV2({ wire: 'wire-2' }));
    expect(await armed.next()).toMatchObject({ t: 'refuse', reason: 'wire' });
    armed.send({ t: 'exit', when: 'idle' });
    await until(() => host.exits.length === 1);
    expect(host.exits).toEqual(['idle']);

    const chatty = await host.connect();
    chatty.send(helloV2({ wire: 'wire-2' }));
    await chatty.next();
    chatty.send({ t: 'req', id: '1', name: 'engine.ping', input: undefined });
    await chatty.closed;
    expect(chatty.lines).toHaveLength(1); // the refuse, no answer
    expect(host.exits).toEqual(['idle']);
  });

  it('replaces the connected client only for a hello whose token, protocol and wire check out', async () => {
    const host = await start();
    const first = await host.connect();
    first.send(hello());
    await first.next();
    first.send({ t: 'ready' });
    await until(() => host.runtime.hasClient());

    const badToken = await host.connect();
    badToken.send(hello({ token: 'c'.repeat(64) }));
    await badToken.closed;
    const badWire = await host.connect();
    badWire.send(helloV2({ wire: 'other' }));
    await badWire.next();
    await settle();
    expect(first.isClosed()).toBe(false);
    expect(host.runtime.hasClient()).toBe(true);

    const second = await host.connect();
    second.send(hello({ appPid: 8 }));
    expect(await second.next()).toMatchObject({ t: 'welcome' });
    expect(await first.next((line) => (line as { t: string }).t === 'refuse')).toEqual(refusal('replaced'));
    await first.closed;
    expect(host.runtime.hasClient()).toBe(false); // the new client is served, not yet ready
    expect(host.served.connected()).toBe(true);
    second.send({ t: 'ready' });
    await until(() => host.runtime.hasClient());
    expect(host.emit()).toBe(true);
    await second.next((line) => (line as { t: string }).t === 'evt');
    expect(first.lines.filter((line) => (line as { t: string }).t === 'evt')).toEqual([]);
    expect(host.changes).toEqual([true, true]); // the replaced client's close does not report the new one gone
  });

  it('honours exit after a welcome', async () => {
    const host = await start();
    const client = await host.connect();
    client.send(hello());
    await client.next();
    client.send({ t: 'exit', when: 'now' });
    await until(() => host.exits.length === 1);
  });

  it('closes a client that sends a line outside the envelope after its welcome', async () => {
    const host = await start();
    const client = await host.connect();
    client.send(hello());
    await client.next();
    client.send({ t: 'evt', name: 'session.status', payload: {} });
    await client.closed;
    await until(() => !host.served.connected());
    expect(host.changes).toEqual([true, false]);
  });

  it('drops the client when the peer dies: no client, events dropped', async () => {
    const host = await start();
    const client = await host.connect();
    client.send(hello());
    await client.next();
    client.send({ t: 'ready' });
    await until(() => host.runtime.hasClient());
    client.socket.destroy();
    await until(() => !host.served.connected());
    expect(host.runtime.hasClient()).toBe(false);
    expect(host.emit()).toBe(false);
    expect(host.changes).toEqual([true, false]);
  });

  // E11 (tracker row E10 "refused connection stays open with no deadline"): the one exit a refused connection may send
  // has the hello's deadline; with none, the server closes it
  it('closes a refused connection that sends no exit within the hello deadline, and keeps one that sends it in time', async () => {
    const host = await start({ helloTimeoutMs: 80 });
    const silent = await host.connect();
    silent.send(helloV2({ wire: 'wire-2' }));
    expect(await silent.next()).toMatchObject({ t: 'refuse', reason: 'wire' });
    await silent.closed;
    expect(host.log).toHaveBeenCalledWith('closed a refused connection that sent no exit within 80 ms');
    const late = await host.connect();
    late.send({ t: 'hello', protocol: 1, token: TOKEN });
    expect(await late.next()).toMatchObject({ t: 'refuse', reason: 'protocol' });
    late.send({ t: 'exit', when: 'idle' });
    await until(() => host.exits.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 120)); // past the deadline: an exit in time disarmed it
    expect(host.log.mock.calls.filter(([line]) => line === 'closed a refused connection that sent no exit within 80 ms')).toHaveLength(1); // the silent one's only
    expect(host.exits).toEqual(['idle']);
  });

  it('closes a connection with no valid hello in time, or whose first line is not a hello', async () => {
    const host = await start({ helloTimeoutMs: 50 });
    const silent = await host.connect();
    await silent.closed;
    const wrong = await host.connect();
    wrong.send({ t: 'req', id: '1', name: 'engine.ping', input: undefined });
    await wrong.closed;
    const garbage = await host.connect();
    garbage.sendRaw('not json\n');
    await garbage.closed;
    expect(host.changes).toEqual([]);
    expect([...silent.lines, ...wrong.lines, ...garbage.lines]).toEqual([]);
  });

  // P5 O2 M3 (acceptance 9): `mawsd`'s sockets and the pty host's write nothing before a token checks out
  it('with badToken close, ends a wrong or missing token’s connection with no byte written', async () => {
    const host = await start({ badToken: 'close' });
    const wrong = await host.connect();
    const bytes: Buffer[] = [];
    wrong.socket.on('data', (chunk: Buffer) => void bytes.push(chunk));
    wrong.sendRaw(`${JSON.stringify(hello({ token: 'b'.repeat(64) }))}\n${JSON.stringify({ t: 'exit', when: 'now' })}\n`);
    await wrong.closed;
    const missing = await host.connect();
    missing.socket.on('data', (chunk: Buffer) => void bytes.push(chunk));
    const noToken: Record<string, unknown> = hello();
    delete noToken.token;
    missing.send(noToken);
    await missing.closed;
    await settle();
    expect(bytes).toEqual([]);
    expect(host.exits).toEqual([]);
    expect(host.served.connected()).toBe(false);
    expect(host.log).toHaveBeenCalledWith('closed a hello with a wrong or missing token, writing nothing');
    const right = await host.connect(); // the right token is still welcomed
    right.send(hello());
    expect(await right.next()).toMatchObject({ t: 'welcome' });
  });

  it('many clients: each is welcomed and served by its own runtime at once, none replaced', async () => {
    const runtimes: HostRuntime[] = [];
    const runtimeFor = () => {
      const pid = runtimes.length + 1; // which runtime answered
      const made = createHostRuntime((on) => on('engine.ping', async () => ({ pid, uptimeMs: 1, hostVersion: 'test' })));
      runtimes.push(made);
      return made;
    };
    const host = await start({ many: { runtimeFor } });
    const first = await host.connect();
    first.send(hello());
    expect(await first.next()).toMatchObject({ t: 'welcome' });
    const second = await host.connect();
    second.send(hello({ appPid: 8 }));
    expect(await second.next()).toMatchObject({ t: 'welcome' });
    first.send({ t: 'req', id: '1', name: 'engine.ping', input: undefined });
    second.send({ t: 'req', id: '1', name: 'engine.ping', input: undefined });
    const answer = (id: string) => (line: unknown) => (line as { t: string; id?: string }).t === 'res' && (line as { id: string }).id === id;
    expect(await first.next(answer('1'))).toMatchObject({ ok: true, value: { pid: 1 } });
    expect(await second.next(answer('1'))).toMatchObject({ ok: true, value: { pid: 2 } });
    expect(runtimes).toHaveLength(2);
    expect(first.lines.some((line) => (line as { reason?: string }).reason === 'replaced')).toBe(false);
    expect(host.served.count()).toBe(2);
    expect(host.changes).toEqual([true, true]);
    first.socket.end();
    await first.closed;
    await until(() => host.served.count() === 1);
    expect(host.changes).toEqual([true, true, false]);
    second.send({ t: 'req', id: '2', name: 'engine.ping', input: undefined });
    expect(await second.next(answer('2'))).toMatchObject({ ok: true }); // the other client is still served
    host.served.closeClient(); // every client
    await second.closed;
    await until(() => host.served.count() === 0);
  });

  it('onClientEnd: a welcomed client’s FIN on a half-open server, before its close; not for an unwelcomed one', async () => {
    const host = await start({ halfOpen: true });
    const stranger = await host.connect();
    stranger.socket.end();
    await settle();
    expect(host.ends).toHaveLength(0);
    stranger.socket.destroy();
    const client = await host.connect();
    client.send(hello());
    await client.next();
    client.socket.end(); // the draining close's FIN: it keeps reading
    await until(() => host.ends.length === 1);
    expect(host.served.connected()).toBe(true); // half-open: the server's side is still up
    expect(client.isClosed()).toBe(false);
    host.served.closeClient();
    await client.closed;
  });

  it('closeClient closes the connected client', async () => {
    const host = await start();
    const client = await host.connect();
    client.send(hello());
    await client.next();
    host.served.closeClient();
    await client.closed;
    await until(() => !host.served.connected());
  });
});

// P5 O2 M5 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, "The handshake reflects the upstream"): a relay's welcome
// waits for `admitHello`, which answers the facts it reflects, a refusal line to write as received, or a close.
describe('the socket layer’s admission (server side, P5 O2 M5)', () => {
  const UPSTREAM = { protocol: 3, minor: 1, buildId: 'upstream-build', capabilities: ['up.cap'], wire: 'wire-1', pid: 5151, startedAt: '2026-10-27T09:00:00.000Z' };

  it('holds the welcome until admit answers, then welcomes with its facts and serves what the client sent meanwhile', async () => {
    let admitNow!: () => void;
    const peers: unknown[] = [];
    const host = await start({
      admitHello: (peer) => {
        peers.push(peer);
        return new Promise((resolve) => (admitNow = () => resolve({ kind: 'welcome', identity: UPSTREAM, counts: { liveSessions: 4, rows: 6 } })));
      },
    });
    const client = await host.connect();
    client.send(hello());
    client.send({ t: 'req', id: '1', name: 'engine.ping', input: undefined }); // sent before the welcome, kept for the port
    await settle();
    expect(client.lines).toEqual([]);
    expect(host.changes).toEqual([]);
    expect(peers).toEqual([{ major: 3, minor: 2, build: 'build-1', capabilities: [] }]);
    admitNow();
    expect(await client.next()).toEqual({ t: 'welcome', protocol: 3, minor: 1, build: 'upstream-build', capabilities: ['up.cap'], pid: 5151, startedAt: UPSTREAM.startedAt, liveSessions: 4, rows: 6 });
    expect(await client.next((line) => (line as { t: string }).t === 'res')).toMatchObject({ t: 'res', id: '1', ok: true });
    expect(host.changes).toEqual([true]);
  });

  it('writes a refusal admit answers as it is, then honours one exit from that connection, marked refused', async () => {
    const line = { t: 'refuse', reason: 'protocol', protocol: 4, buildId: 'newer', wire: 'w', liveSessions: 2 } as const;
    const host = await start({ admitHello: async () => ({ kind: 'refuse', line }) });
    const client = await host.connect();
    client.send(hello());
    expect(await client.next()).toEqual(line);
    client.send({ t: 'exit', when: 'now' });
    await until(() => host.refusedExits.length === 1);
    expect(host.refusedExits).toEqual(['now']);
    expect(host.exits).toEqual(['now']);
    expect(host.changes).toEqual([]);
  });

  it('closes the connection with nothing written when admit answers close', async () => {
    const host = await start({ admitHello: async () => ({ kind: 'close', why: 'the upstream did not start within 15 s' }) });
    const client = await host.connect();
    client.send(hello());
    await client.closed;
    expect(client.lines).toEqual([]);
    expect(host.log).toHaveBeenCalledWith('closed a connection: the upstream did not start within 15 s');
  });

  it('never asks admit for a wrong token', async () => {
    const admit = vi.fn(async () => ({ kind: 'close' as const, why: 'unused' }));
    const host = await start({ admitHello: admit, badToken: 'close' });
    const client = await host.connect();
    client.send(hello({ token: 'b'.repeat(64) }));
    await client.closed;
    expect(admit).not.toHaveBeenCalled();
  });

  // M5 review: on a half-open server a FIN during admission ends the socket without destroying it
  it('welcomes nobody whose peer left while its admission was pending (a half-open server included)', async () => {
    for (const halfOpen of [true, false]) {
      let admitNow!: () => void;
      const host = await start({
        halfOpen,
        admitHello: () => new Promise((resolve) => (admitNow = () => resolve({ kind: 'welcome', identity: UPSTREAM, counts: { liveSessions: 0, rows: 0 } }))),
      });
      const client = await host.connect();
      client.send(hello());
      await settle();
      client.socket.end(); // its FIN, before the answer
      await settle();
      admitNow();
      await settle();
      expect(host.changes).toEqual([]);
      expect(host.served.connected()).toBe(false);
      expect(host.served.count()).toBe(0);
      await client.closed;
      expect(client.lines).toEqual([]);
    }
  });

  it('marks an exit on a served connection as not refused', async () => {
    const host = await start({ admitHello: async () => ({ kind: 'welcome', identity: UPSTREAM, counts: { liveSessions: 0, rows: 0 } }) });
    const client = await host.connect();
    client.send(hello());
    await client.next();
    client.send({ t: 'exit', when: 'idle' });
    await until(() => host.exits.length === 1);
    expect(host.refusedExits).toEqual([]);
  });
});

// P5 O1 M6 (OX1): the major, the tolerant reads and the protocol-2 window, server side.
describe('the socket layer’s wire major (server side, P5 O1 M6)', () => {
  it('welcomes any minor of its major with its own minor and capabilities, and keeps what the hello said of the client', async () => {
    const host = await start();
    const client = await host.connect();
    client.send(hello({ minor: 9, build: 'build-9', capabilities: ['probe.extra'] }));
    expect(await client.next()).toEqual(WELCOME);
    expect(host.served.peer()).toEqual({ major: 3, minor: 9, build: 'build-9', capabilities: ['probe.extra'] });
    expect(host.log).toHaveBeenCalledWith('client connected: appPid 7 build build-9 wire 3.9 capabilities [probe.extra]');
    client.socket.destroy();
    await until(() => !host.served.connected());
    expect(host.served.peer()).toBeNull();
  });

  it('reads a hello and the envelope tolerantly: a key a newer minor added is dropped and logged once', async () => {
    const host = await start();
    const client = await host.connect();
    client.send(hello({ newerField: true }));
    expect(await client.next()).toEqual(WELCOME);
    expect(host.log).toHaveBeenCalledWith('dropped newerField from socket hello, a field this build does not know (logged once per message and path)');
    client.send({ t: 'req', id: '1', name: 'engine.ping', input: undefined, newerEnvelope: 1 });
    expect(await client.next((line) => (line as { t: string }).t === 'res')).toMatchObject({ id: '1', ok: true });
    client.send({ t: 'ready', newerEnvelope: 1 });
    await until(() => host.runtime.hasClient());
    client.send({ t: 'exit', when: 'idle', newerExit: 1 });
    await until(() => host.exits.length === 1);
    expect(host.served.connected()).toBe(true);
  });

  it('closes a hello of its major that is malformed beyond unknown keys', async () => {
    const host = await start();
    const client = await host.connect();
    client.send(hello({ minor: -1 }));
    await client.closed;
    expect(client.lines).toEqual([]);
    expect(host.log).toHaveBeenCalledWith('closed a connection: a malformed hello');
  });

  it('the protocol-2 window: welcomes a protocol-2 hello whose fingerprint is its own with protocol 2’s welcome, and serves it', async () => {
    const host = await start();
    const client = await host.connect();
    client.send(helloV2());
    expect(await client.next()).toEqual({ t: 'welcome', protocol: 2, buildId: 'build-1', wire: 'wire-1', pid: 4242, startedAt: IDENTITY.startedAt, liveSessions: 2, rows: 3 });
    expect(host.served.peer()).toEqual({ major: 2, minor: 0, build: 'build-0', capabilities: [] });
    expect(host.log).toHaveBeenCalledWith('client connected: appPid 6 build build-0 wire 2.0 capabilities []');
    client.send({ t: 'req', id: '1', name: 'engine.ping', input: undefined });
    expect(await client.next((line) => (line as { t: string }).t === 'res')).toMatchObject({ id: '1', ok: true });
  });

  it('refuses every protocol but its own and 2 (`protocol`), naming its own in the refusal', async () => {
    const host = await start();
    for (const protocol of [1, 4]) {
      const client = await host.connect();
      client.send(hello({ protocol }));
      expect(await client.next()).toEqual(refusal('protocol'));
    }
    expect(host.log).toHaveBeenCalledWith('refused protocol 4 (this supervisor speaks 3, and 2 through its window)');
    expect(host.changes).toEqual([]);
  });
});

// P3-A M5: the client's document channels (`documents.open`, frames, `documents.close`, `documents.closed`), served
// through the runtime's document handler exactly as a utility host's parent-port doc messages are.
describe('the socket layer’s document channels (server side, P3-A M5)', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const open = (channel: number) => ({ t: 'documents.open', channel, artifactId: ID, actor: { kind: 'human' } });

  function documentHandler() {
    const opened: { channel: number; end: DocPortEnd; received: number[][]; closed: () => boolean }[] = [];
    const onDocPort: DocPortHandler = (message, end) => {
      const entry = { channel: message.channel, end, received: [] as number[][], closed: () => wasClosed };
      let wasClosed = false;
      end.on('message', ({ data }) => void entry.received.push([...(data as Uint8Array)]));
      end.on('close', () => void (wasClosed = true));
      end.start();
      opened.push(entry);
    };
    return { opened, onDocPort };
  }

  it('opens a channel per documents.open, carries frames both ways, and tells the client a channel the host ended', async () => {
    const docs = documentHandler();
    const host = await start({ onDocPort: docs.onDocPort });
    const client = await host.connectPort();
    client.port.postMessage(open(3));
    client.port.postDoc(3, Uint8Array.from([1, 2])); // in the same write as its open
    client.port.postDoc(99, Uint8Array.from([9])); // a channel never opened: dropped
    await until(() => docs.opened[0]?.received.length === 1);
    expect(docs.opened.map((o) => o.channel)).toEqual([3]);
    expect(docs.opened[0].received).toEqual([[1, 2]]);

    docs.opened[0].end.postMessage(Uint8Array.from([7]));
    await until(() => client.frames.length === 1);
    expect(client.frames).toEqual([[3, [7]]]);

    docs.opened[0].end.close(); // the service closed it (an eviction)
    await until(() => client.lines.length === 1);
    expect(client.lines).toEqual([{ t: 'documents.closed', channel: 3, reason: 'host' }]);
    expect(host.served.connected()).toBe(true);
  });

  it('ends a channel quietly at the client’s documents.close, and every channel when the client goes', async () => {
    const docs = documentHandler();
    const host = await start({ onDocPort: docs.onDocPort });
    const client = await host.connectPort();
    client.port.postMessage(open(1));
    client.port.postMessage(open(2));
    await until(() => docs.opened.length === 2);
    client.port.postMessage({ t: 'documents.close', channel: 1 });
    await until(() => docs.opened[0].closed());
    expect(docs.opened[1].closed()).toBe(false);
    client.socket.destroy();
    await until(() => docs.opened[1].closed());
    expect(client.lines).toEqual([]);
  });

  it('ends a replaced client’s channels, and resets a channel whose frames the client does not read past the high-water mark', async () => {
    const docs = documentHandler();
    const host = await start({ onDocPort: docs.onDocPort, docHighWater: 64 * 1024 });
    const first = await host.connectPort();
    first.port.postMessage(open(1));
    await until(() => docs.opened.length === 1);
    const second = await host.connectPort();
    await until(() => docs.opened[0].closed());

    second.port.postMessage(open(5));
    await until(() => docs.opened.length === 2);
    second.socket.pause(); // main reads nothing: the host's writes queue
    const end = docs.opened[1].end;
    for (let i = 0; i < 200 && !docs.opened[1].closed(); i++) end.postMessage(new Uint8Array(32 * 1024));
    expect(docs.opened[1].closed()).toBe(true);
    second.socket.resume();
    await until(() => second.lines.length === 1);
    expect(second.lines).toEqual([{ t: 'documents.closed', channel: 5, reason: 'reset' }]);
    expect(host.served.connected()).toBe(true);
  });

  it('closes every port of a channel when the host serves no documents', async () => {
    const host = await start();
    const client = await host.connectPort();
    client.port.postMessage(open(4));
    await until(() => client.lines.length === 1);
    expect(client.lines).toEqual([{ t: 'documents.closed', channel: 4, reason: 'host' }]);
  });
});

// P5 O2 M4: the server writes pty frames only to a client whose hello listed `socket.ptyFrames`; any other gets the line
describe('the pty frames capability gate (P5 O2 M4)', () => {
  const DATA = { ptyId: 'pty-1', offset: 0, data: new Uint8Array([0x68, 0x69]) };
  async function ptyServer() {
    let emit!: HostEmit;
    const runtime = createHostRuntime((on, e) => {
      on('pty.ping', async () => ({ pid: 4242, uptimeMs: 1, hostVersion: 'test' }));
      emit = e;
    });
    const server = createServer();
    serveSocketClients(server, { runtime, identity: () => ({ ...IDENTITY, capabilities: [PTY_FRAMES_CAPABILITY] }), counts: () => ({ liveSessions: 0, rows: 0 }), token: () => TOKEN, onExit: () => {}, log: () => {} });
    temp = await listenTemp(server);
    return { runtime, emit: () => emit('pty.data', DATA as never) };
  }
  // the welcome a raw client reads, and the bytes after it once the server has emitted one pty.data
  async function afterWelcome(capabilities: string[]): Promise<{ welcome: unknown; rest: Buffer }> {
    const host = await ptyServer();
    const socket = createConnection(temp!.path);
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', resolve));
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => void chunks.push(chunk));
    socket.write(`${JSON.stringify(hello({ capabilities }))}\n{"t":"ready"}\n`);
    await until(() => host.runtime.hasClient());
    expect(host.emit()).toBe(true);
    const all = () => Buffer.concat(chunks);
    await until(() => all().length > all().indexOf(0x0a) + 1);
    await settle();
    const bytes = all();
    const newline = bytes.indexOf(0x0a);
    return { welcome: JSON.parse(bytes.subarray(0, newline).toString('utf8')), rest: bytes.subarray(newline + 1) };
  }

  it('lists the capability in its welcome and frames pty.data for a client that listed it', async () => {
    const { welcome, rest } = await afterWelcome([PTY_FRAMES_CAPABILITY]);
    expect(welcome).toMatchObject({ t: 'welcome', capabilities: [PTY_FRAMES_CAPABILITY] });
    expect([...rest]).toEqual([...encodePtyFrame(DATA)!]);
  });

  it('writes the JSON line to a client that did not list it', async () => {
    const { rest } = await afterWelcome(['area.feature']);
    expect(rest[0]).not.toBe(PTY_MARK);
    expect(JSON.parse(rest.toString('utf8'))).toEqual({ t: 'evt', name: 'pty.data', payload: { ptyId: 'pty-1', offset: 0, data: { $bytes: Buffer.from(DATA.data).toString('base64') } } });
  });
});
