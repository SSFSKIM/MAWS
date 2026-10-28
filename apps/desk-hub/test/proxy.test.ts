// The stand-in's proxy (local/proxy.ts) against clients that go away during a WebSocket upgrade, in front of a hub that
// upgrades when it is told to. Node's server hands an upgrading socket over with no error listener of its own, so a
// client's reset there was the proxy's to catch: uncaught, it ended the local hub, every suite behind it failing at once
// (an endpoint that stops its hub link with the stand-in's refusal unread resets it so).
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startProxy, type Proxy } from '../local/proxy.ts';
import { AccessStandin, IDENTITY_HEADER } from '../local/standin.ts';

const ADMITTED = { [IDENTITY_HEADER]: 'owner@example.com' };
const DEAD_TOKEN = { 'CF-Access-Client-Id': 'nobody.access', 'CF-Access-Client-Secret': 'x' };
/** The hub holds its answer to an upgrade that carries this header until the suite gives it. */
const HOLD = 'x-test-hold';

let hub: Server;
let proxy: Proxy;
/** Each upgrade the hub has received, with its socket, in arrival order. */
const arrivals: Socket[] = [];
const waiting: Array<(socket: Socket) => void> = [];

beforeAll(async () => {
  hub = createServer((_, res) => res.end('ok'));
  hub.on('upgrade', (req, socket: Socket) => {
    socket.on('error', () => {});
    socket.on('end', () => socket.destroy());
    if (req.headers[HOLD] === undefined) socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    const next = waiting.shift();
    if (next) next(socket);
    else arrivals.push(socket);
  });
  await new Promise<void>((resolve) => hub.listen(0, '127.0.0.1', resolve));
  const address = hub.address() as { port: number };
  const standin = await AccessStandin.create({ issuer: 'http://127.0.0.1/standin', audience: 'desk-test', account: 'test' });
  proxy = await startProxy({ standin, upstream: () => `http://127.0.0.1:${address.port}` });
});
afterAll(async () => {
  await proxy?.close();
  hub?.closeAllConnections();
  await new Promise((resolve) => hub?.close(resolve));
});

/** The next upgrade the hub receives. */
const hubUpgrade = () => new Promise<Socket>((resolve) => (arrivals.length > 0 ? resolve(arrivals.shift()!) : waiting.push(resolve)));

/** A raw client's upgrade to the proxy, written once connected. */
async function upgrade(headers: Record<string, string>): Promise<Socket> {
  const client = connect({ host: '127.0.0.1', port: proxy.port });
  client.on('error', () => {});
  await once(client, 'connect');
  const lines = ['GET /machine/socket HTTP/1.1', 'Host: 127.0.0.1', 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='];
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
  await new Promise((resolve) => client.write(`${lines.join('\r\n')}\r\n\r\n`, resolve));
  return client;
}

/** The proxy still answers, through the stand-in and through to the hub. */
async function answers(): Promise<void> {
  expect((await fetch(`${proxy.url}/standin/certs`)).status).toBe(200);
  expect((await fetch(`${proxy.url}/api/me`, { headers: ADMITTED })).status).toBe(200);
}

describe('the stand-in\'s proxy, a client gone during its upgrade', () => {
  it('outlives a client that resets once the stand-in has refused it, as an endpoint stopping its link with the refusal unread does', async () => {
    for (let i = 0; i < 5; i++) {
      const client = await upgrade(DEAD_TOKEN);
      const [refusal] = (await once(client, 'data')) as [Buffer];
      expect(refusal.toString('utf8')).toMatch(/^HTTP\/1\.1 401 /);
      client.resetAndDestroy();
      await answers();
    }
  });

  it('outlives a client that resets before it is answered', async () => {
    for (let i = 0; i < 5; i++) {
      (await upgrade(DEAD_TOKEN)).resetAndDestroy();
      await answers();
    }
  });

  it("takes the hub's side with it, whether the hub had upgraded yet or not", async () => {
    const early = await upgrade({ ...ADMITTED, [HOLD]: '1' });
    const held = await hubUpgrade();
    early.resetAndDestroy();
    await once(held, 'close');

    const late = await upgrade(ADMITTED);
    const piped = await hubUpgrade();
    const [switched] = (await once(late, 'data')) as [Buffer];
    expect(switched.toString('utf8')).toMatch(/^HTTP\/1\.1 101 /);
    late.resetAndDestroy();
    await once(piped, 'close');
    await answers();
  });
});
