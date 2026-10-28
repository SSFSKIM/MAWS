// The registry socket's client against the DX3 double: the grid on connect, summaries as they change, and a fresh grid
// after a reconnect that replaces whatever the browser held; and, once this browser is a device, the socket opened as an
// app's (`?app=1`), its state notices and listings handed to the device.
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { ProjectSummary } from 'desk-hub/protocol';
import { HubDouble } from '../../test/double/hub-double';
import { VECTOR_KEY } from '../../test/vectors';
import { GridClient, type AppFrames } from './grid-client';

const until = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const summary = (id: string, waiting: number): ProjectSummary => ({ id, name: id.toUpperCase(), kind: 'hub', machines: 2, machines_online: 1, working: 1, waiting, live: 1 });

let double: HubDouble;
let client: GridClient | null = null;
beforeEach(async () => {
  double = await HubDouble.start({ orgKey: VECTOR_KEY });
});
afterEach(async () => {
  client?.stop();
  await double.close();
});

it('holds the grid and applies each summary as it changes', async () => {
  double.setGrid([summary('a', 0), summary('b', 1)]);
  const seen: ProjectSummary[][] = [];
  client = new GridClient({ base: double.url.replace(/^http/, 'ws'), delay: () => 20, projects: (projects) => seen.push(projects) });
  client.start();
  await until(() => seen.length === 1);
  expect(seen[0].map((p) => p.id)).toEqual(['a', 'b']);
  double.updateSummary(summary('b', 3));
  await until(() => seen.length === 2);
  expect(seen[1].find((p) => p.id === 'b')?.waiting).toBe(3);
  expect(seen[1].map((p) => p.id)).toEqual(['a', 'b']); // a change keeps the project where it was
  double.updateSummary(summary('c', 0));
  await until(() => seen.length === 3);
  expect(seen[2].map((p) => p.id)).toEqual(['a', 'b', 'c']);
});

it('replaces what it held with the grid a reconnect brings', async () => {
  double.setGrid([summary('a', 0), summary('b', 1)]);
  const seen: ProjectSummary[][] = [];
  const statuses: string[] = [];
  client = new GridClient({ base: double.url.replace(/^http/, 'ws'), delay: () => 20, projects: (projects) => seen.push(projects), status: (s) => statuses.push(s) });
  client.start();
  await until(() => seen.length === 1);
  double.setGrid([summary('b', 0)]); // the grid as it stands when the socket comes back
  await until(() => seen.length === 2);
  double.dropConnections();
  double.setGrid([summary('c', 2)]);
  await until(() => seen.length === 3 && statuses.filter((s) => s === 'open').length === 2);
  expect(seen.at(-1)!.map((p) => p.id)).toEqual(['c']);
});

it('joins a grid the hub sent in parts (composite fa7f8e8d) into one grid', async () => {
  await double.close();
  double = await HubDouble.start({ orgKey: VECTOR_KEY, frameLimit: 300 });
  const many = Array.from({ length: 40 }, (_, i) => summary(`project-${i}`, i % 3));
  double.setGrid(many);
  const seen: ProjectSummary[][] = [];
  client = new GridClient({ base: double.url.replace(/^http/, 'ws'), delay: () => 20, projects: (projects) => seen.push(projects) });
  client.start();
  await until(() => seen.length === 1);
  expect(seen[0]).toEqual(many);
  expect(double.gridTexts).toBeGreaterThan(1); // it went down as DX2 `part` frames
});

describe("the app's socket (P5 O13 M3, OX8)", () => {
  /** A registry socket that records each connection's query and sends what the case asks, after the grid. */
  async function appHub() {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const queries: string[] = [];
    const sockets: WsSocket[] = [];
    server.on('connection', (ws, request) => {
      queries.push(new URL(request.url ?? '/', 'http://hub').search);
      sockets.push(ws);
      ws.send(JSON.stringify({ t: 'grid', projects: [summary('a', 0)] }));
    });
    return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, queries, send: (frame: object) => sockets.at(-1)!.send(JSON.stringify(frame)), close: () => new Promise((r) => server.close(r)) };
  }

  it('opens as the grid alone until a device is set, then as an app, its own frames to the device and the grid drawn as before', async () => {
    const hub = await appHub();
    try {
      const seen: ProjectSummary[][] = [];
      const app: string[] = [];
      const frames: AppFrames = {
        opened: () => app.push('opened'),
        state: (f) => app.push(`state ${f.version}`),
        listings: (f) => app.push(`listings ${f.records.length} ${f.last}`),
        listing: (f) => app.push(`listing ${f.record.body.session}`),
      };
      client = new GridClient({ base: hub.url, delay: () => 20, projects: (projects) => seen.push(projects) });
      client.start();
      await until(() => seen.length === 1);
      expect(hub.queries).toEqual(['']);
      hub.send({ t: 'state', version: 9 }); // a hub that sent one anyway: the grid's socket ignores it
      client.setApp(frames);
      await until(() => hub.queries.length === 2 && app.includes('opened'));
      expect(hub.queries[1]).toBe('?app=1');
      await until(() => seen.length === 2);
      hub.send({ t: 'state', version: 3 });
      hub.send({ t: 'listings', records: [], last: true });
      hub.send({ t: 'listing', record: { body: { session: 's1' } } });
      hub.send({ t: 'summary', project: summary('a', 2) });
      await until(() => seen.length === 3 && app.length === 4);
      expect(app).toEqual(['opened', 'state 3', 'listings 0 true', 'listing s1']);
      expect(seen[2][0].waiting).toBe(2);
      client.setApp(frames); // unchanged: no new connection
      client.setApp(null);
      await until(() => hub.queries.length === 3);
      expect(hub.queries).toEqual(['', '?app=1', '']);
    } finally {
      client?.stop();
      client = null;
      await hub.close();
    }
  });
});
