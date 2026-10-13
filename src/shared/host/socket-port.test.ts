import { createConnection, createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenTemp, type TempSocket } from '../../../test/support/socket-lines';
import { createHostRuntime, type HostEmit } from './runtime';
import { SocketPort } from './socket-port';
import { encodeDocFrame } from './socket-protocol';

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

  // E11 (tracker row E10 "keep-quit close counts in-flight lines delivered"): main's deliberate close at a keep-quit
  // writes nothing more but still delivers what the host wrote before it saw the client's end; the host's writes after
  // that end are refused, so the host counts nothing delivered that the client did not read
  it('a draining close delivers the lines the peer wrote before it saw the end; the peer’s writes after its end are refused', async () => {
    const { server, client } = await pair();
    const hostPort = new SocketPort(server, Buffer.alloc(0), { log: () => {} });
    const clientPort = new SocketPort(client, Buffer.alloc(0));
    const atClient = receiving(clientPort);
    clientPort.start();
    hostPort.start();
    const hostSawEnd = new Promise((resolve) => server.once('end', resolve));
    const clientClosed = new Promise((resolve) => clientPort.onClose(resolve));
    clientPort.close({ drain: true });
    expect(clientPort.postMessage({ t: 'ready' })).toBe(false); // nothing more is written
    for (let n = 1; n <= 3; n++) expect(hostPort.postMessage({ t: 'evt', name: 'x', payload: n })).toBe(true); // in flight: the end has not reached the host
    await hostSawEnd;
    expect(hostPort.postMessage({ t: 'evt', name: 'x', payload: 4 })).toBe(false); // after the client's end: never counted written
    await clientClosed;
    expect(atClient).toEqual([1, 2, 3].map((n) => ({ t: 'evt', name: 'x', payload: n })));
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

  it('postMessage reports whether it handed the bytes to a live socket, so emit never claims a write after a close', async () => {
    const { server } = await pair();
    let emit!: HostEmit;
    const runtime = createHostRuntime((on, e) => {
      on('engine.ping', async () => ({ pid: 42, uptimeMs: 1, hostVersion: 'test' }));
      emit = e;
    });
    const port = new SocketPort(server, Buffer.alloc(0), { log: () => {} });
    runtime.serve(port);
    runtime.setReady();
    const items = { appSessionId: 'app-1', items: [] } as never;
    expect(port.postMessage({ t: 'evt', name: 'x', payload: null })).toBe(true);
    expect(emit('session.brokerItems', items)).toBe(true);
    port.close(); // the close event has not fired yet: the runtime still has its client
    expect(runtime.hasClient()).toBe(true);
    expect(port.postMessage({ t: 'evt', name: 'x', payload: null })).toBe(false);
    expect(emit('session.brokerItems', items)).toBe(false);
  });

  it('a write that stalls the peer past the cap closes the connection and reports nothing written', async () => {
    const { server, client } = await pair();
    client.pause();
    const port = new SocketPort(server, Buffer.alloc(0), { log: () => {}, writableCap: 64 * 1024 });
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) results.push(port.postMessage({ t: 'evt', name: 'x', payload: 'z'.repeat(256 * 1024) }));
    expect(results.at(-1)).toBe(false);
    expect(results.filter((written) => !written).length).toBeGreaterThan(0);
  });
});

// P3-A M5: socket protocol 2's document frames beside the JSON lines, and the bytes codec of the line.
describe('SocketPort: document frames and bytes (P3-A M5)', () => {
  function frames(port: SocketPort) {
    const got: [number, number[]][] = [];
    port.onDoc((channel, frame) => void got.push([channel, [...frame]]));
    return got;
  }

  it('carries frames both ways in order with the lines, both queued until start(), the leftover first', async () => {
    const { server, client } = await pair();
    const leftover = Buffer.concat([encodeDocFrame(1, Uint8Array.from([1])), Buffer.from('{"t":"ready"}\n')]);
    const serverPort = new SocketPort(server, leftover);
    const clientPort = new SocketPort(client, Buffer.alloc(0));
    const order: string[] = [];
    serverPort.on('message', ({ data }) => void order.push(`line ${(data as { t: string }).t}`));
    serverPort.onDoc((channel, frame) => void order.push(`doc ${channel}:${[...frame].join(',')}`));
    expect(clientPort.postDoc(2, Uint8Array.from([0x0a, 0x00]))).toBe(true);
    clientPort.postMessage({ t: 'req', id: '1' });
    expect(clientPort.postDoc(3, new Uint8Array(0))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual([]);
    serverPort.start();
    await until(() => order.length === 5);
    expect(order).toEqual(['doc 1:1', 'line ready', 'doc 2:10,0', 'line req', 'doc 3:']);

    const atClient = frames(clientPort);
    clientPort.start();
    expect(serverPort.postDoc(0xffff_ffff, Uint8Array.from([7, 8]))).toBe(true);
    await until(() => atClient.length === 1);
    expect(atClient).toEqual([[0xffff_ffff, [7, 8]]]);
  });

  it('carries a Uint8Array in a line as bytes, and counts what it has queued for the peer', async () => {
    const { server, client } = await pair();
    const serverPort = new SocketPort(server, Buffer.alloc(0));
    const clientPort = new SocketPort(client, Buffer.alloc(0));
    const atServer = receiving(serverPort);
    serverPort.start();
    clientPort.postMessage({ t: 'req', id: '1', name: 'artifacts.uploadAsset', input: { bytes: Uint8Array.from([0, 255, 10]) } });
    await until(() => atServer.length === 1);
    expect((atServer[0] as { input: { bytes: unknown } }).input.bytes).toEqual(Uint8Array.from([0, 255, 10]));

    client.pause();
    expect(serverPort.queuedBytes()).toBe(0);
    for (let i = 0; i < 64; i++) serverPort.postDoc(1, new Uint8Array(64 * 1024));
    expect(serverPort.queuedBytes()).toBeGreaterThan(0);
  });

  it('closes the connection on a frame whose length is past the cap, with a log line', async () => {
    const { server, client } = await pair();
    const log = vi.fn();
    const port = new SocketPort(server, Buffer.alloc(0), { log });
    const got = frames(port);
    const closed = vi.fn();
    port.onClose(closed);
    port.start();
    client.write(Buffer.concat([encodeDocFrame(1, Uint8Array.from([1])), Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 1])]));
    await until(() => closed.mock.calls.length === 1);
    expect(got).toEqual([[1, [1]]]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('doc frame'));
  });

  it('writes no frame once closing or closed, or while draining', async () => {
    const { server } = await pair();
    const port = new SocketPort(server, Buffer.alloc(0), { log: () => {} });
    port.close({ drain: true });
    expect(port.postDoc(1, Uint8Array.from([1]))).toBe(false);
    const { server: other } = await pair();
    const closedPort = new SocketPort(other, Buffer.alloc(0), { log: () => {} });
    closedPort.close();
    expect(closedPort.postDoc(1, Uint8Array.from([1]))).toBe(false);
  });

  it('a frame that stalls the peer past the writable cap closes the connection and reports nothing written', async () => {
    const { server, client } = await pair();
    client.pause();
    const port = new SocketPort(server, Buffer.alloc(0), { log: () => {}, writableCap: 64 * 1024 });
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) results.push(port.postDoc(1, new Uint8Array(256 * 1024)));
    expect(results.at(-1)).toBe(false);
  });

  it('serves a byte field as bytes, and refuses a malformed base64 one as invalid input', async () => {
    const { server, client } = await pair();
    const received: unknown[] = [];
    const runtime = createHostRuntime((on) => {
      on('artifacts.uploadAsset', async ({ bytes }) => {
        received.push(bytes);
        return { assetId: '11111111-1111-4111-8111-111111111111', ref: 'assets/a.bin' };
      });
    });
    runtime.serve(new SocketPort(server, Buffer.alloc(0)));
    const clientPort = new SocketPort(client, Buffer.alloc(0));
    const answers = receiving(clientPort);
    clientPort.start();
    const input = { artifactId: '11111111-1111-4111-8111-111111111111', name: 'a.bin', mime: 'application/octet-stream' };
    clientPort.postMessage({ t: 'req', id: '1', name: 'artifacts.uploadAsset', input: { ...input, bytes: Uint8Array.from([1, 2, 3]) } });
    client.write(`${JSON.stringify({ t: 'req', id: '2', name: 'artifacts.uploadAsset', input: { ...input, bytes: { $bytes: 'not base64!' } } })}\n`);
    await until(() => answers.length === 2);
    expect(received).toEqual([Uint8Array.from([1, 2, 3])]);
    const byId = (id: string) => answers.find((answer) => (answer as { id: string }).id === id);
    expect([byId('1'), byId('2')]).toEqual([
      { t: 'res', id: '1', ok: true, value: { assetId: '11111111-1111-4111-8111-111111111111', ref: 'assets/a.bin' } },
      expect.objectContaining({ t: 'res', id: '2', ok: false, error: expect.objectContaining({ code: 'invalid_input' }) }),
    ]);
  });
});
