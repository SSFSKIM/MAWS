// The link's carriers (P5 O7 M1, "Carriers"): which addresses are dialled, the direct race, and the relay socket's
// multiplex against a stand-in hub on loopback.
import type { AddressInfo } from 'node:net';
import { decodeChannelFrame, encodeChannelFrame, tagBytes, CHANNEL_CLOSE, type ByteDuplex } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { CARRIER_CLOSED, dialDirect, isTailnetAddress, openRelaySocket, raceDirect, RelayUpgradeError } from './carriers';

const servers: WebSocketServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function serve(options: { verify?: (headers: Record<string, unknown>) => number | null } = {}): Promise<{ url: string; sockets: ServerSocket[] }> {
  const sockets: ServerSocket[] = [];
  const server = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    verifyClient: options.verify === undefined ? undefined : (info, done) => {
      const status = options.verify!(info.req.headers);
      done(status === null, status ?? undefined);
    },
  });
  servers.push(server);
  server.on('connection', (socket) => void sockets.push(socket));
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, sockets };
}

const until = async <T>(check: () => T | undefined | null | false, ms = 2000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('tailnet addresses', () => {
  it('dials only ws:// addresses on the tailnet’s ranges', () => {
    expect(isTailnetAddress('ws://100.64.0.1:47830')).toBe(true);
    expect(isTailnetAddress('ws://100.127.255.254:47830')).toBe(true);
    expect(isTailnetAddress('ws://[fd7a:115c:a1e0::1]:47830')).toBe(true);
    for (const address of ['ws://100.128.0.1:47830', 'ws://100.63.255.255:47830', 'ws://127.0.0.1:47830', 'ws://192.168.1.2:47830', 'wss://100.64.0.1:47830', 'http://100.64.0.1:47830', 'ws://[fd7a:115c:a1e1::1]:47830', 'ws://mini.tailnet.ts.net:47830', 'ws://u:p@100.64.0.1:47830', 'not a url']) {
      expect(isTailnetAddress(address), address).toBe(false);
    }
  });
});

describe('the direct race', () => {
  it('takes the first address to open and closes the rest', async () => {
    const closed: string[] = [];
    const carrier = (url: string): ByteDuplex => ({ send: () => {}, onBytes: () => {}, close: () => void closed.push(url) });
    const won = await raceDirect(['ws://a', 'ws://b', 'ws://c'], 1000, (url) =>
      url === 'ws://c' ? Promise.reject(new Error('refused')) : new Promise((resolve) => setTimeout(() => resolve(carrier(url)), url === 'ws://a' ? 30 : 5)),
    );
    expect(won.url).toBe('ws://b');
    await until(() => closed.length === 1);
    expect(closed).toEqual(['ws://a']);
  });

  it('rejects when none opens within the timeout', async () => {
    await expect(raceDirect(['ws://a'], 20, () => new Promise(() => {}))).rejects.toThrow(/within 20 ms/);
  });

  it('carries binary messages both ways over a real socket, and reports its end as `carrier`', async () => {
    const hub = await serve();
    const carrier = await dialDirect(hub.url, 1000);
    const got: Uint8Array[] = [];
    const ends: string[] = [];
    carrier.onBytes((bytes) => void got.push(bytes));
    carrier.onClose?.((reason) => void ends.push(reason));
    const [socket] = await until(() => (hub.sockets.length === 1 ? hub.sockets : null));
    const echoed = new Promise<Buffer>((resolve) => socket.once('message', (data) => resolve(data as Buffer)));
    carrier.send(new Uint8Array([1, 2, 3]));
    expect([...(await echoed)]).toEqual([1, 2, 3]);
    socket.send(new Uint8Array([9]), { binary: true });
    await until(() => got.length === 1);
    expect([...got[0]]).toEqual([9]);
    socket.close(4000, 'removed');
    await until(() => ends.length === 1);
    expect(ends).toEqual([CARRIER_CLOSED]);
  });
});

describe('the relay socket', () => {
  it('opens a channel by tag, maps the hub’s channel id, and ends every channel when its socket closes', async () => {
    const hub = await serve({ verify: (headers) => (headers['x-test-member'] === 'a' ? null : 401) });
    await expect(openRelaySocket(hub.url, {})).rejects.toBeInstanceOf(RelayUpgradeError);
    const relay = await openRelaySocket(hub.url, { 'x-test-member': 'a' });
    const [socket] = await until(() => (hub.sockets.length === 1 ? hub.sockets : null));
    const frames: ReturnType<typeof decodeChannelFrame>[] = [];
    socket.on('message', (data, isBinary) => {
      if (isBinary) frames.push(decodeChannelFrame(new Uint8Array(data as Buffer)));
    });
    const one = await relay.dial();
    const two = await relay.dial();
    const heard: Record<string, number[][]> = { one: [], two: [] };
    const ends: string[] = [];
    one.onBytes((b) => void heard.one.push([...b]));
    two.onBytes((b) => void heard.two.push([...b]));
    one.onClose?.((r) => void ends.push(`one ${r}`));
    two.onClose?.((r) => void ends.push(`two ${r}`));
    one.send(new Uint8Array([10]));
    two.send(new Uint8Array([20]));
    one.send(new Uint8Array([11])); // queued until the hub answers the open
    await until(() => frames.length === 2);
    expect(frames.map((f) => [f!.type, [...f!.payload]])).toEqual([
      ['open', [10]],
      ['open', [20]],
    ]);
    const [tagOne, tagTwo] = frames.map((f) => f!.channel);
    socket.send(encodeChannelFrame('open', 700, tagBytes(tagOne)), { binary: true });
    socket.send(encodeChannelFrame('open', 701, tagBytes(tagTwo)), { binary: true });
    await until(() => frames.length === 3);
    expect([frames[2]!.type, frames[2]!.channel, [...frames[2]!.payload]]).toEqual(['data', 700, [11]]);
    socket.send(encodeChannelFrame('data', 701, new Uint8Array([21])), { binary: true });
    socket.send('{"t":"presence","online":true,"pending":{}}');
    await until(() => heard.two.length === 1);
    expect(heard).toEqual({ one: [], two: [[21]] });
    socket.send(encodeChannelFrame('close', 700, CHANNEL_CLOSE['endpoint-gone']), { binary: true });
    await until(() => ends.length === 1);
    expect(ends).toEqual(['one carrier']);
    const closed: string[] = [];
    relay.onClose((r) => void closed.push(r));
    socket.terminate();
    await until(() => ends.length === 2 && closed.length === 1);
    expect(ends).toEqual(['one carrier', 'two carrier']);
    await expect(relay.dial()).rejects.toThrow(/closed/);
  });
});
