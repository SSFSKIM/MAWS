import { createConnection, createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenTemp, type TempSocket } from '../../../test/support/socket-lines';
import { createHostRuntime, type HostEmit } from './runtime';
import { SocketPort } from './socket-port';

// A connected pair over a real Unix socket in a temp directory: `server` is the accepted end, `client` the dialer.
let temp: TempSocket | null = null;
afterEach(async () => {
  await temp?.dispose();
  temp = null;
});

async function pair(): Promise<{ server: Socket; client: Socket }> {
  let accept!: (socket: Socket) => void;
  const accepted = new Promise<Socket>((resolve) => (accept = resolve));
  temp = await listenTemp(createServer((socket) => accept(socket)));
  const client = createConnection(temp.path);
  await new Promise((resolve) => client.once('connect', resolve));
  return { server: await accepted, client };
}

function receiving(port: SocketPort) {
  const received: unknown[] = [];
  port.on('message', ({ data }) => void received.push(data));
  return received;
}

const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { timeout: 3_000, interval: 5 });

describe('SocketPort', () => {
  it('carries JSON lines both ways, delivering the handshake’s leftover first and nothing before start()', async () => {
    const { server, client } = await pair();
    const serverPort = new SocketPort(server, Buffer.from('{"t":"req","id":"0"}\n{"t":"re'));
    const clientPort = new SocketPort(client, Buffer.alloc(0));
    const atServer = receiving(serverPort);
    const atClient = receiving(clientPort);
    client.write('ady"}\n');
    clientPort.postMessage({ t: 'req', id: '1', name: 'engine.ping', input: null });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(atServer).toEqual([]); // queued until the runtime starts the port, as a MessagePort's messages are
    serverPort.start();
    clientPort.start();
    await until(() => atServer.length === 3);
    expect(atServer).toEqual([{ t: 'req', id: '0' }, { t: 'ready' }, { t: 'req', id: '1', name: 'engine.ping', input: null }]);
    serverPort.postMessage({ t: 'evt', name: 'x', payload: { text: 'héllo ✓' } });
    await until(() => atClient.length === 1);
    expect(atClient).toEqual([{ t: 'evt', name: 'x', payload: { text: 'héllo ✓' } }]);
  });

  it('closes the connection on a line that is not JSON, with a log line', async () => {
    const { server, client } = await pair();
    const log = vi.fn();
    const port = new SocketPort(server, Buffer.alloc(0), { log });
    const received = receiving(port);
    const closed = vi.fn();
    port.onClose(closed);
    port.start();
    client.write('{"t":"req","id":"1"}\nnot json\n{"t":"req","id":"2"}\n');
    await until(() => closed.mock.calls.length === 1);
    expect(received).toEqual([{ t: 'req', id: '1' }]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not JSON'));
  });

  it('closes the connection on a line over the cap, with a log line', async () => {
    const { server, client } = await pair();
    const log = vi.fn();
    const port = new SocketPort(server, Buffer.alloc(0), { log, lineCap: 64 });
    const received = receiving(port);
    const closed = vi.fn();
    port.onClose(closed);
    port.start();
    client.write(`{"t":"req","id":"1"}\n{"t":"req","id":"${'x'.repeat(100)}"}\n`);
    await until(() => closed.mock.calls.length === 1);
    expect(received).toEqual([{ t: 'req', id: '1' }]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('over 64 bytes'));
  });

  it('closes a peer that has stalled past the writable cap', async () => {
    const { server, client } = await pair();
    client.pause(); // the peer reads nothing
    const log = vi.fn();
    const port = new SocketPort(server, Buffer.alloc(0), { log, writableCap: 64 * 1024 });
    const closed = vi.fn();
    port.onClose(closed);
    const big = 'y'.repeat(256 * 1024);
    for (let i = 0; i < 8 && closed.mock.calls.length === 0; i++) port.postMessage({ t: 'evt', name: 'x', payload: big });
    await until(() => closed.mock.calls.length === 1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('stalled'));
    port.postMessage({ t: 'evt', name: 'x', payload: 'after' }); // a write after the close is a no-op, not a throw
  });

  it('reports the peer’s death through onClose, and to a listener registered after it', async () => {
    const { server, client } = await pair();
    const port = new SocketPort(server, Buffer.alloc(0));
    const closed = vi.fn();
    port.onClose(closed);
    client.destroy();
    await until(() => closed.mock.calls.length === 1);
    const late = vi.fn();
    port.onClose(late);
    await until(() => late.mock.calls.length === 1);
  });

  it('close() ends the connection; the peer sees it close', async () => {
    const { server, client } = await pair();
    const port = new SocketPort(server, Buffer.alloc(0));
    const peerClosed = new Promise((resolve) => client.on('close', resolve));
    client.resume();
    port.close();
    await peerClosed;
  });

  it('serves the host protocol through createHostRuntime: req and res, and evt once the client is ready', async () => {
    const { server, client } = await pair();
    let emit!: HostEmit;
    const runtime = createHostRuntime((on, e) => {
      on('engine.ping', async () => ({ pid: 42, uptimeMs: 1, hostVersion: 'test' }));
      on('session.renameSession', async () => undefined); // a void output crosses as a res with no value
      emit = e;
    });
    runtime.serve(new SocketPort(server, Buffer.alloc(0)));
    const clientPort = new SocketPort(client, Buffer.alloc(0));
    const atClient = receiving(clientPort);
    clientPort.start();

    clientPort.postMessage({ t: 'req', id: '1', name: 'engine.ping', input: undefined });
    clientPort.postMessage({ t: 'req', id: '2', name: 'session.renameSession', input: { appSessionId: 'app-1', title: 't' } });
    await until(() => atClient.length === 2);
    expect(atClient).toEqual([
      { t: 'res', id: '1', ok: true, value: { pid: 42, uptimeMs: 1, hostVersion: 'test' } },
      { t: 'res', id: '2', ok: true },
    ]);

    const items = { appSessionId: 'app-1', items: [] };
    expect(emit('session.brokerItems', items as never)).toBe(false); // before ready: dropped
    clientPort.postMessage({ t: 'ready' });
    await until(() => runtime.hasClient());
    expect(emit('session.brokerItems', items as never)).toBe(true);
    await until(() => atClient.length === 3);
    expect(atClient[2]).toEqual({ t: 'evt', name: 'session.brokerItems', payload: items });
  });
});
