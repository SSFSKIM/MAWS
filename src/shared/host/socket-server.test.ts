import { createServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectLines, listenTemp, type LineClient, type TempSocket } from '../../../test/support/socket-lines';
import { createHostRuntime, type HostEmit, type HostRuntime } from './runtime';
import { serveSocketClients, type SocketClients } from './socket-server';

const TOKEN = 'a'.repeat(64);
const IDENTITY = { protocol: 1, buildId: 'build-1', wire: 'wire-1', pid: 4242, startedAt: '2026-10-06T10:00:00.000Z' };
const hello = (over: Record<string, unknown> = {}) => ({ t: 'hello', protocol: 1, token: TOKEN, buildId: 'build-1', wire: 'wire-1', appPid: 7, ...over });
const ITEMS = { appSessionId: 'app-1', items: [] };
const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { timeout: 3_000, interval: 5 });
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

let temp: TempSocket | null = null;
const clients: LineClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.destroy();
  await temp?.dispose();
  temp = null;
});

async function start(options: { helloTimeoutMs?: number; hooks?: (() => void)[] } = {}) {
  let emit!: HostEmit;
  const runtime: HostRuntime = createHostRuntime((on, e) => {
    on('engine.ping', async () => ({ pid: 4242, uptimeMs: 1, hostVersion: 'test' }));
    emit = e;
  });
  for (const hook of options.hooks ?? []) runtime.onConnect(hook);
  const exits: string[] = [];
  const changes: boolean[] = [];
  const log = vi.fn<(line: string) => void>();
  const server = createServer();
  const served: SocketClients = serveSocketClients(server, {
    runtime,
    identity: () => IDENTITY,
    counts: () => ({ liveSessions: 2, rows: 3 }),
    token: () => TOKEN,
    onExit: (when) => void exits.push(when),
    onClient: (connected) => void changes.push(connected),
    log,
    helloTimeoutMs: options.helloTimeoutMs,
  });
  temp = await listenTemp(server);
  const connect = async () => {
    const client = await connectLines(temp!.path);
    clients.push(client);
    return client;
  };
  return { runtime, emit: () => emit('session.brokerItems', ITEMS as never), exits, changes, log, served, connect };
}

describe('the socket layer handshake (server side)', () => {
  it('welcomes a valid hello with its identity and serves requests; events wait for ready, where the connect hooks run', async () => {
    const order: string[] = [];
    const host = await start({ hooks: [() => void order.push('hook')] });
    const client = await host.connect();
    client.send(hello());
    expect(await client.next()).toEqual({ t: 'welcome', ...IDENTITY, liveSessions: 2, rows: 3 });
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
    expect(await client.next()).toEqual({ t: 'refuse', reason: 'token', protocol: 1, buildId: 'build-1', wire: 'wire-1', liveSessions: 2 });
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
    client.send({ t: 'hello', protocol: 2, token: TOKEN, somethingNew: true }); // a later protocol's hello: only the preamble is read
    expect(await client.next()).toEqual({ t: 'refuse', reason: 'protocol', protocol: 1, buildId: 'build-1', wire: 'wire-1', liveSessions: 2 });
    await settle();
    expect(client.isClosed()).toBe(false);
    client.send({ t: 'exit', when: 'now' });
    await until(() => host.exits.length === 1);
    expect(host.exits).toEqual(['now']);
    expect(host.served.connected()).toBe(false);
  });

  it('refuses another wire fingerprint, keeps the connection for one exit, and closes it on anything else', async () => {
    const host = await start();
    const armed = await host.connect();
    armed.send(hello({ wire: 'wire-2' }));
    expect(await armed.next()).toMatchObject({ t: 'refuse', reason: 'wire' });
    armed.send({ t: 'exit', when: 'idle' });
    await until(() => host.exits.length === 1);
    expect(host.exits).toEqual(['idle']);

    const chatty = await host.connect();
    chatty.send(hello({ wire: 'wire-2' }));
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
    badWire.send(hello({ wire: 'other' }));
    await badWire.next();
    await settle();
    expect(first.isClosed()).toBe(false);
    expect(host.runtime.hasClient()).toBe(true);

    const second = await host.connect();
    second.send(hello({ appPid: 8 }));
    expect(await second.next()).toMatchObject({ t: 'welcome' });
    expect(await first.next((line) => (line as { t: string }).t === 'refuse')).toEqual({ t: 'refuse', reason: 'replaced', protocol: 1, buildId: 'build-1', wire: 'wire-1', liveSessions: 2 });
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
