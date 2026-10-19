// The registry socket's client against the DX3 double: the grid on connect, summaries as they change, and a fresh grid
// after a reconnect that replaces whatever the browser held.
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ProjectSummary } from 'desk-hub/protocol';
import { HubDouble } from '../../test/double/hub-double';
import { VECTOR_KEY } from '../../test/vectors';
import { GridClient } from './grid-client';

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
