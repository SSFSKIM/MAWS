// P4-AGG M2: the catalog's disk cache and refresh (the Discover spec, Design "Caching" and "Parsing"): one source failing
// leaves the others; a failed source keeps its last copy and says offline, a never-fetched one unavailable; a copy on
// disk serves a later run with no network; records failing their schema are dropped and counted; refresh is serialised;
// a copy older than 24 h is refreshed; listeners hear once per refresh that changed anything.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PageGet } from './fetch';
import { CatalogStore, REFRESH_AGE_MS, RETRY_MS } from './store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maws-agg-store-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const SEED = 'seed:canva-skills';
const DETAILS = 'plugin-details';
const manifest = (...names: string[]) => ({ name: 'canva-skills', owner: { name: 'Canva' }, plugins: names.map((name) => ({ name, source: `./plugins/${name}` })) });
const details = (installs: number) => ({ plugins: { [`p@claude-plugins-official`]: { unique_installs: installs } } });

// A network whose answers the test sets per source: a body, or an Error to fail with. Counts the requests.
function network(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const pages: PageGet = async (key) => {
    calls.push(key);
    const answer = answers[key];
    if (answer instanceof Error || answer === undefined) throw answer ?? new Error(`${key}: offline`);
    return { body: answer, exchange: { url: key, bytes: 1, contentType: 'application/json', ms: 0 } };
  };
  return { calls, pages, answers };
}

const store = (pages: PageGet, now: () => number = () => 1_000_000, keys = [SEED, DETAILS]) => new CatalogStore({ dir, keys, pages, now, log: () => {} });
const states = (s: CatalogStore) => Object.fromEntries(s.statuses().map((status) => [status.key, status.state]));

describe('CatalogStore', () => {
  it('keeps the others when one source fails: the failed one never fetched reads unavailable', async () => {
    const net = network({ [SEED]: manifest('canva'), [DETAILS]: new Error('HTTP 503') });
    const s = store(net.pages);
    await s.ready();
    expect(states(s)).toEqual({ [SEED]: 'fresh', [DETAILS]: 'unavailable' });
    expect(s.data().seeds.get(SEED)?.entries.records.map((e) => e.name)).toEqual(['canva']);
    expect(s.data().details).toBeNull();
    expect(s.statuses().find((x) => x.key === SEED)).toMatchObject({ label: 'Canva', fetchedAt: new Date(1_000_000).toISOString(), dropped: 0 });
  });

  it('keeps a failed source’s last copy, offline with its age', async () => {
    let t = 1_000_000;
    const net = network({ [SEED]: manifest('canva'), [DETAILS]: details(5) });
    const s = store(net.pages, () => t);
    await s.refresh();
    t += 60_000;
    net.answers[SEED] = new Error('HTTP 500');
    await s.refresh();
    expect(s.statuses().find((x) => x.key === SEED)).toMatchObject({ state: 'offline', fetchedAt: new Date(1_000_000).toISOString() });
    expect(s.data().seeds.get(SEED)?.entries.records).toHaveLength(1);
  });

  it('serves a later run from its copies on disk with no network', async () => {
    await store(network({ [SEED]: manifest('canva', 'canva-code'), [DETAILS]: details(5) }).pages).refresh();
    const offline = network({});
    const later = store(offline.pages, () => 1_000_000 + 60_000);
    await later.ready();
    expect(offline.calls).toEqual([]); // fresh copies: nothing to fetch
    expect(states(later)).toEqual({ [SEED]: 'fresh', [DETAILS]: 'fresh' });
    expect(later.data().seeds.get(SEED)?.entries.records.map((e) => e.name)).toEqual(['canva', 'canva-code']);
    expect(later.data().details?.get('p@claude-plugins-official')?.installs).toBe(5);
    expect(JSON.parse(await readFile(join(dir, `${SEED}.json`), 'utf8'))).toMatchObject({ key: SEED, fetchedAt: 1_000_000, pages: [manifest('canva', 'canva-code')] });
  });

  it('refreshes a copy older than 24 hours, answering from it meanwhile', async () => {
    await store(network({ [SEED]: manifest('old'), [DETAILS]: details(1) }).pages).refresh();
    const net = network({ [SEED]: manifest('new'), [DETAILS]: details(2) });
    const later = store(net.pages, () => 1_000_000 + REFRESH_AGE_MS);
    await later.ready(); // answers at once from the stale copies; the refresh runs behind
    expect(later.data().seeds.get(SEED)?.entries.records[0]?.name).toBe('old');
    await later.refresh(); // joins the one running
    expect(net.calls.sort()).toEqual([DETAILS, SEED]);
    expect(later.data().seeds.get(SEED)?.entries.records[0]?.name).toBe('new');
    expect(states(later)).toEqual({ [SEED]: 'fresh', [DETAILS]: 'fresh' });
  });

  it('drops and counts a record that fails its schema, never the source; a document of the wrong shape fails the source', async () => {
    const net = network({ [SEED]: { ...manifest('canva'), plugins: [{ name: 'canva', source: './p' }, { source: './nameless' }, { name: 'x', source: 7 }] }, [DETAILS]: { plugins: { 'a@claude-plugins-official': { unique_installs: -1 }, 'b@claude-plugins-official': 7 } } });
    const s = store(net.pages);
    await s.refresh();
    expect(s.statuses().map((x) => [x.key, x.dropped])).toEqual([[SEED, 2], [DETAILS, 1]]);
    expect(s.data().seeds.get(SEED)?.entries.records.map((e) => e.name)).toEqual(['canva']);
    expect(s.data().details?.get('a@claude-plugins-official')?.installs).toBeNull(); // a field out of shape reads as none
    net.answers[SEED] = { name: 'canva-skills', entries: [] }; // no `plugins`: not a marketplace manifest
    await s.refresh();
    expect(states(s)[SEED]).toBe('offline');
    expect(s.data().seeds.get(SEED)?.entries.records.map((e) => e.name)).toEqual(['canva']);
  });

  it('runs one refresh at a time: a second request joins the one running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls: string[] = [];
    const pages: PageGet = async (key) => {
      calls.push(key);
      await gate;
      return { body: key === SEED ? manifest('canva') : details(1), exchange: { url: key, bytes: 1, contentType: 'application/json', ms: 0 } };
    };
    const s = store(pages);
    const first = s.refresh();
    const second = s.refresh();
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    expect(calls.sort()).toEqual([DETAILS, SEED]);
  });

  it('tells its listeners once per refresh that changed anything, and moves its revision', async () => {
    const net = network({ [SEED]: manifest('canva'), [DETAILS]: details(1) });
    const s = store(net.pages);
    let heard = 0;
    s.onChange(() => (heard += 1));
    await s.refresh();
    const revision = s.revision;
    expect(heard).toBe(1);
    await s.refresh(); // the same answers
    expect([heard, s.revision]).toEqual([1, revision]);
    net.answers[DETAILS] = details(2);
    await s.refresh();
    expect([heard, s.revision]).toEqual([2, revision + 1]);
  });

  it('retries a failed source on a read only after RETRY_MS; Refresh retries it at once', async () => {
    let t = 1_000_000;
    const net = network({ [SEED]: new Error('offline'), [DETAILS]: details(1) });
    const s = store(net.pages, () => t);
    await s.ready();
    await s.ready();
    expect(net.calls.filter((k) => k === SEED)).toHaveLength(1);
    t += RETRY_MS;
    await s.ready();
    expect(net.calls.filter((k) => k === SEED)).toHaveLength(2);
    await s.refresh();
    expect(net.calls.filter((k) => k === SEED)).toHaveLength(3);
  });

  it('ignores a copy on disk that no longer reads', async () => {
    await writeFile(join(dir, `${SEED}.json`), '{ torn');
    const net = network({ [SEED]: manifest('canva'), [DETAILS]: details(1) });
    const s = store(net.pages);
    await s.ready();
    expect(net.calls.sort()).toEqual([DETAILS, SEED]);
    expect(states(s)).toEqual({ [SEED]: 'fresh', [DETAILS]: 'fresh' });
  });
});
