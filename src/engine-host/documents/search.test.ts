// P4-B4 M2 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "Freshness", "The snippet and `read`"; Decision
// Log 3): the search mirror over A's real store. The catch-up within its budget and the hint's count, the refresher on
// the change feed (settled, one artifact per macrotask), the sweep after the store opens (filling what the migration
// left empty, dropping deleted artifacts' rows), a read-only store searching what the mirror holds, a lost batch taking
// the mirror's row back with the write it was read from, and the timers gone at close. The tool's acceptance is
// artifact-search.test.ts's.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { parseQuery } from '@shared/artifacts/search-query';
import type { Section } from '@artifacts/library/sections';
import { HUMAN, openWorld, type World } from '../tool-server/artifact-world.fixture';
import { STORE_MIGRATIONS, openStore } from './migrations';
import { ArtifactSearch, CATCHUP_SLICE_MS, MIRROR_BACKGROUND_MAX_BYTES, MIRROR_QUIET_MS, MIRROR_SETTLE_MS, MIRROR_SWEEP_DELAY_MS, searchQuery, snippetAndRead, startArtifactSearch, type SearchRequest, type SearchTimers } from './search';
import { hostWorkBetween, watchHostWork } from './host-work'; // P4-R6
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';
import { ArtifactStore } from './store';

let w: World;
const searches: ArtifactSearch[] = [];
beforeEach(() => {
  w = openWorld();
});
afterEach(() => {
  for (const search of searches.splice(0)) search.close();
  w.close();
});

const turns = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const html = (text: string) => ({ bytes: new TextEncoder().encode(`<p>${text}</p>`), name: 'index.html' });
const page = async (title: string, text: string) => (await w.store.create({ kind: 'html', title, content: html(text) }, HUMAN)).id;
const rows = () => (w.storage.db.prepare('SELECT artifactId, revision, title FROM artifact_text_rows ORDER BY artifactId').all() as { artifactId: string; revision: number; title: string }[]);
const mirrored = (id: string) => rows().find((row) => row.artifactId === id) ?? null;
const current = (id: string) => mirrored(id)?.revision === w.store.revision(id);
const find = (search: ArtifactSearch, query: string, limit = 10) => search.search({ terms: parseQuery(query).terms, limit });
const foundIds = async (search: ArtifactSearch, query: string) => (await find(search, query)).hits.map((hit) => hit.id);
// what the mirror holds now, with no catch-up
const foundIdsIn = async (store: ArtifactStore, query: string) => (await new ArtifactSearch(store, { catchUpMs: 0 }).search({ terms: parseQuery(query).terms, limit: 10 })).hits.map((hit) => hit.id);

// Timers the test runs one at a time, in the order they fall due on its own clock.
function manualTimers(): SearchTimers & { advance(ms: number): Promise<void>; pass(ms: number): void; runNext(): Promise<boolean>; readonly pending: number } {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; run: () => void }>();
  const earliest = () => [...due.entries()].sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
  const timers = {
    setTimeout: (run: () => void, ms: number) => {
      const id = next++;
      due.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (handle: unknown) => void due.delete(handle as number),
    get pending() {
      return due.size;
    },
    // runs the earliest timer due by now, then lets its batch commit
    async runNext() {
      const first = earliest();
      if (!first || first[1].at > now) return false;
      due.delete(first[0]);
      first[1].run();
      await turns();
      return true;
    },
    // moves the clock without running anything
    pass(ms: number) {
      now += ms;
    },
    // moves the clock and runs everything due, what those runs schedule for now included
    async advance(ms: number) {
      now += ms;
      while (await timers.runNext());
    },
  };
  return timers;
}

const started = (timers: SearchTimers, store: ArtifactStore = w.store) => {
  const search = startArtifactSearch(store, { timers, log: (line) => w.logs.push(line) });
  searches.push(search);
  return search;
};
const unstarted = (options: ConstructorParameters<typeof ArtifactSearch>[1] = {}, store: ArtifactStore = w.store) => {
  const search = new ArtifactSearch(store, { log: (line) => w.logs.push(line), ...options });
  searches.push(search);
  return search;
};

describe('the search catch-up', () => {
  it('brings every stale candidate up to date before it queries, so a write committed in the host is found by the next search', async () => {
    const search = unstarted();
    const id = await page('Status', 'alpha');
    expect(rows()).toEqual([]);
    expect(await foundIds(search, 'alpha')).toEqual([id]);
    expect(current(id)).toBe(true);
    await w.store.writeContent(id, html('omega'), HUMAN);
    expect(current(id)).toBe(false);
    expect(await foundIds(search, 'omega')).toEqual([id]);
    expect(await find(search, 'omega')).toMatchObject({ searchedAsBefore: 0 });
  });

  it('within its budget, refreshes newest first and counts what it left, which is searched as it was', async () => {
    const older = await page('Older', 'first text');
    const newer = await page('Newer', 'first text');
    await find(unstarted(), 'first'); // both mirrored
    await w.store.writeContent(older, html('first text, then second'), HUMAN);
    await w.store.writeContent(newer, html('first text, then second'), HUMAN);
    w.storage.db.prepare('UPDATE artifacts SET updatedAt = ? WHERE id = ?').run(1_000, older);
    w.storage.db.prepare('UPDATE artifacts SET updatedAt = ? WHERE id = ?').run(2_000, newer);
    // the clock passes the budget once the newer artifact's row is current
    const search = unstarted({ now: () => (current(newer) ? 10_000 : 0) });
    const answer = await find(search, 'first');
    expect(answer.searchedAsBefore).toBe(1);
    expect(current(newer)).toBe(true);
    expect(current(older)).toBe(false);
    expect(answer.hits.map((hit) => hit.id).sort()).toEqual([newer, older].sort()); // the older one as it was
    expect(await foundIds(unstarted({ catchUpMs: 0 }), 'second')).toEqual([newer]);
  });

  it('yields between slices of extraction, each slice committed before the next', async () => {
    expect(CATCHUP_SLICE_MS).toBeLessThan(400);
    for (let n = 0; n < 4; n++) await page(`Page ${n}`, 'sliced text');
    // every extraction takes a whole slice: each slice is one artifact, committed before the next starts
    const commits: number[] = [];
    const commit = w.storage.commit.bind(w.storage);
    w.storage.commit = () => {
      if (w.storage.batchOpen) commits.push(rows().length);
      commit();
    };
    const search = unstarted({ now: () => rows().length * CATCHUP_SLICE_MS });
    const answer = await find(search, 'sliced');
    expect(answer.hits).toHaveLength(4);
    expect(commits).toEqual([1, 2, 3, 4]);
  });
});

// P4-R6: what shared an agent's batch is named from the host's work record, so each refresh is in it with what it did
describe('the host’s work record', () => {
  it('names a search’s catch-up and the background refresh apart, each with what it extracted', async () => {
    const unwatch = watchHostWork();
    try {
      const id = await page('Status', 'alpha');
      await foundIds(unstarted(), 'alpha');
      expect(hostWorkBetween(0, Infinity).work.filter((entry) => entry.what.startsWith('mirror'))).toEqual([expect.objectContaining({ what: 'mirror catch-up', detail: 'html text, 5 characters' })]);
      await w.store.writeContent(id, html('omega words'), HUMAN);
      const timers = manualTimers();
      started(timers);
      await timers.advance(MIRROR_SWEEP_DELAY_MS + MIRROR_QUIET_MS);
      expect(current(id)).toBe(true);
      expect(hostWorkBetween(0, Infinity).work.filter((entry) => entry.what === 'mirror')).toEqual([expect.objectContaining({ detail: 'html text, 11 characters' })]);
    } finally {
      unwatch();
    }
  });

  // P4-R6: an agent's read links the artifact `viewed`, which the mirror counts as the host being busy, so the batch an
  // agent sends right after its read never shares the loop with a background extraction
  it('holds a due extraction off for MIRROR_QUIET_MS after a session’s read links an artifact', async () => {
    const id = await page('Read', 'before');
    const timers = manualTimers();
    started(timers);
    await timers.advance(MIRROR_SWEEP_DELAY_MS + MIRROR_QUIET_MS);
    expect(current(id)).toBe(true);
    await w.store.writeContent(id, html('after'), HUMAN);
    await turns();
    await timers.advance(MIRROR_SETTLE_MS - 1);
    await w.store.link(id, 'perf-agent-1' as AppSessionId, 'viewed'); // an agent's read, the moment before the settle
    await turns();
    await timers.advance(1); // settled: due, but the link restarted the quiet window
    expect(current(id)).toBe(false);
    await timers.advance(MIRROR_QUIET_MS - 2);
    expect(current(id)).toBe(false);
    await timers.advance(1);
    expect(current(id)).toBe(true);
  });
});

describe('the refresher and the sweep', () => {
  it('fills the rows the migration left empty after MIRROR_SWEEP_DELAY_MS, one artifact per macrotask, newest first', async () => {
    const ids = [await page('A', 'one'), await page('B', 'two'), await page('C', 'three')];
    ids.forEach((id, n) => w.storage.db.prepare('UPDATE artifacts SET updatedAt = ? WHERE id = ?').run(1_000 + n, id));
    const timers = manualTimers();
    started(timers);
    await timers.advance(MIRROR_SWEEP_DELAY_MS - 1);
    expect(timers.pending).toBe(1);
    timers.pass(1);
    expect(await timers.runNext()).toBe(true); // the sweep: it queues them
    expect(rows()).toEqual([]);
    const order: string[] = [];
    while (await timers.runNext()) {
      const now = rows().map((row) => row.artifactId);
      expect(now).toHaveLength(order.length + 1); // one artifact per macrotask
      order.push(now.find((id) => !order.includes(id))!);
    }
    expect(order).toEqual([ids[2], ids[1], ids[0]]);
    expect(timers.pending).toBe(0);
  });

  it('drops the rows of artifacts deleted while the mirror was not following', async () => {
    const id = await page('Gone', 'text');
    await find(unstarted(), 'text');
    expect(mirrored(id)).not.toBeNull();
    await w.store.delete(id);
    const timers = manualTimers();
    started(timers);
    await timers.advance(MIRROR_SWEEP_DELAY_MS);
    expect(rows()).toEqual([]);
    expect(w.storage.db.prepare('SELECT COUNT(*) AS n FROM artifact_text').get()).toEqual({ n: 0 });
  });

  it('re-extracts a changed artifact once its changes settle, a newer change restarting the wait', async () => {
    const id = await page('Live', 'before');
    const timers = manualTimers();
    started(timers);
    await timers.advance(MIRROR_SWEEP_DELAY_MS);
    expect(current(id)).toBe(true);
    await w.store.writeContent(id, html('during'), HUMAN);
    await turns();
    await timers.advance(MIRROR_SETTLE_MS - 1);
    await w.store.writeContent(id, html('after'), HUMAN);
    await turns();
    await timers.advance(MIRROR_SETTLE_MS - 1);
    expect(current(id)).toBe(false);
    await timers.advance(1);
    expect(current(id)).toBe(true);
    // a rename moves no revision: the row's title follows without a new extraction
    await w.store.update(id, { title: 'Renamed' });
    await timers.advance(MIRROR_SETTLE_MS);
    expect(mirrored(id)).toMatchObject({ title: 'Renamed' });
  });

  it('leaves a document the service holds loaded to the search, and refreshes it once it unloads (Decision Log 18)', async () => {
    // a store whose service unloads a document nobody holds after 30 ms, so the test sees the unload
    const storage = SqliteDocumentStorage.open(join(w.userData, 'loaded', 'store.sqlite'), { log: () => {} });
    const service = new DocumentService(storage, { kindOf: (artifactId) => storage.kindOf(artifactId), log: () => {}, idleUnloadMs: 30 });
    const store = new ArtifactStore(service, storage, { root: join(w.userData, 'loaded'), log: () => {} });
    try {
      const id = (await store.create({ kind: 'dashboard', title: 'Board', initial: (doc) => doc.get('charts').insert(0, 'alpha') }, HUMAN)).id;
      const replica = service.replica('app-holder' as AppSessionId, id); // an agent's replica holds it open
      await replica.whenSynced();
      const textRows = () => storage.db.prepare('SELECT artifactId FROM artifact_text_rows').all();
      const timers = manualTimers();
      started(timers, store);
      await timers.advance(MIRROR_SWEEP_DELAY_MS); // the sweep reaches it: held, so skipped
      expect(textRows()).toEqual([]);
      await service.writeAs(id, HUMAN, (doc) => doc.get('charts').insert(5, ' beta'));
      await turns();
      await timers.advance(MIRROR_SETTLE_MS); // its change settles: still held, still skipped
      expect(textRows()).toEqual([]);
      expect(service.loaded(id)).not.toBeNull();
      service.closeSession('app-holder' as AppSessionId);
      for (let i = 0; i < 200 && service.loaded(id) !== null; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(service.loaded(id)).toBeNull();
      await timers.advance(0); // Decision Log 24: an unload goes through the settle, so nothing is extracted at once
      expect(textRows()).toEqual([]);
      await timers.advance(MIRROR_SETTLE_MS);
      expect(textRows()).toEqual([{ artifactId: id }]);
      expect(await foundIdsIn(store, 'beta')).toEqual([id]);
    } finally {
      store.close();
      service.close();
      storage.close();
    }
  });

  it('never extracts a large artifact in the background (the sweep, a settle, an unload); a search still catches it up (Decision Log 25)', async () => {
    expect(MIRROR_BACKGROUND_MAX_BYTES).toBe(16 * 1024);
    const storage = SqliteDocumentStorage.open(join(w.userData, 'large', 'store.sqlite'), { log: () => {} });
    const service = new DocumentService(storage, { kindOf: (artifactId) => storage.kindOf(artifactId), log: () => {}, idleUnloadMs: 30 });
    const store = new ArtifactStore(service, storage, { root: join(w.userData, 'large'), log: () => {} });
    try {
      const bulk = (word: string) => Array.from({ length: 40_000 }, (_, n) => `${word}${n}`).join(' '); // about 400 KB stored
      const bigDoc = (await store.create({ kind: 'dashboard', title: 'Big board', initial: (doc) => doc.get('charts').insert(0, `bigdoc ${bulk('w')}`) }, HUMAN)).id;
      const bigPage = (await store.create({ kind: 'html', title: 'Big page', content: html(`bigpage ${bulk('p')}`) }, HUMAN)).id;
      const small = (await store.create({ kind: 'html', title: 'Small page', content: html('smallpage') }, HUMAN)).id;
      const smallDoc = (await store.create({ kind: 'dashboard', title: 'Small board', initial: (doc) => doc.get('charts').insert(0, 'smalldoc') }, HUMAN)).id;
      const rowOf = (artifactId: string) => storage.db.prepare('SELECT revision FROM artifact_text_rows WHERE artifactId = ?').get(artifactId) as { revision: number } | undefined;
      const replica = service.replica('app-holder' as AppSessionId, bigDoc); // held, so the sweep sets it aside
      await replica.whenSynced();
      for (let i = 0; i < 200 && service.loaded(smallDoc) !== null; i++) await new Promise((resolve) => setTimeout(resolve, 10)); // the small one unloaded
      const timers = manualTimers();
      started(timers, store);
      await timers.advance(MIRROR_SWEEP_DELAY_MS + MIRROR_QUIET_MS);
      expect(rowOf(small)).toBeDefined();
      expect(rowOf(smallDoc)).toBeDefined();
      expect(rowOf(bigPage)).toBeUndefined(); // the sweep passed it over
      await store.writeContent(bigPage, html(`bigpage again ${bulk('q')}`), HUMAN); // a settled change passes it over
      await turns();
      await timers.advance(MIRROR_SETTLE_MS + MIRROR_QUIET_MS);
      expect(rowOf(bigPage)).toBeUndefined();
      service.closeSession('app-holder' as AppSessionId); // an unload's re-queue passes it over
      for (let i = 0; i < 200 && service.loaded(bigDoc) !== null; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(service.loaded(bigDoc)).toBeNull();
      await timers.advance(MIRROR_SETTLE_MS + MIRROR_QUIET_MS);
      expect(rowOf(bigDoc)).toBeUndefined();
      // the search-time catch-up still brings both up to date
      expect(await new ArtifactSearch(store).search({ terms: parseQuery('bigdoc').terms, limit: 10 })).toMatchObject({ hits: [{ id: bigDoc }], searchedAsBefore: 0 });
      expect((await new ArtifactSearch(store).search({ terms: parseQuery('again').terms, limit: 10 })).hits.map((hit) => hit.id)).toEqual([bigPage]);
    } finally {
      store.close();
      service.close();
      storage.close();
    }
  });

  it('withdraws an artifact already queued when it unloads, so its extraction waits for the unload’s own settle', async () => {
    const storage = SqliteDocumentStorage.open(join(w.userData, 'requeued', 'store.sqlite'), { log: () => {} });
    const service = new DocumentService(storage, { kindOf: (artifactId) => storage.kindOf(artifactId), log: () => {}, idleUnloadMs: 30 });
    const store = new ArtifactStore(service, storage, { root: join(w.userData, 'requeued'), log: () => {} });
    try {
      const id = (await store.create({ kind: 'dashboard', title: 'Board', initial: (doc) => doc.get('charts').insert(0, 'alpha') }, HUMAN)).id;
      const other = (await store.create({ kind: 'html', title: 'Other', content: html('other') }, HUMAN)).id;
      const replica = service.replica('app-holder' as AppSessionId, id);
      await replica.whenSynced();
      const rowOf = (artifactId: string) => storage.db.prepare('SELECT artifactId FROM artifact_text_rows WHERE artifactId = ?').get(artifactId);
      const timers = manualTimers();
      started(timers, store);
      await timers.advance(MIRROR_SWEEP_DELAY_MS); // held: set aside
      expect(rowOf(id)).toBeUndefined();
      await store.update(id, { title: 'Renamed' }); // its settle, 2 s on
      await turns();
      await timers.advance(MIRROR_SETTLE_MS - 500);
      await store.update(other, { title: 'Busy' }); // keeps the host busy past that settle
      await turns();
      await timers.advance(500); // the rename settled: queued, waiting for the quiet window
      expect(rowOf(id)).toBeUndefined();
      service.closeSession('app-holder' as AppSessionId);
      for (let i = 0; i < 200 && service.loaded(id) !== null; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(service.loaded(id)).toBeNull(); // the unload's settle starts now
      await timers.advance(MIRROR_QUIET_MS - 500); // the quiet window ends: the other artifact goes, this one does not
      expect(rowOf(other)).toBeDefined();
      expect(rowOf(id)).toBeUndefined();
      await timers.advance(500); // the unload's settle
      expect(rowOf(id)).toBeDefined();
    } finally {
      store.close();
      service.close();
      storage.close();
    }
  });

  it('waits for the host to be quiet: a commit inside MIRROR_QUIET_MS of the settle defers the extraction (Decision Log 24)', async () => {
    const id = await page('Live', 'before');
    const other = await page('Other', 'other text');
    const timers = manualTimers();
    started(timers);
    await timers.advance(MIRROR_SWEEP_DELAY_MS);
    expect(current(id) && current(other)).toBe(true);
    await w.store.writeContent(id, html('after'), HUMAN);
    await turns();
    await timers.advance(MIRROR_SETTLE_MS - 500);
    await w.store.writeContent(other, html('busy'), HUMAN); // another artifact's commit: the host is not quiet
    await turns();
    await timers.advance(500); // the first change has settled, but the quiet window runs another 1,500 ms
    expect(current(id)).toBe(false);
    await timers.advance(MIRROR_QUIET_MS - 501);
    expect(current(id)).toBe(false);
    await timers.advance(1);
    expect(current(id)).toBe(true);
  });

  it('defers the sweep while the host is busy, and runs it once the host is quiet', async () => {
    const ids = [await page('A', 'one'), await page('B', 'two')];
    const timers = manualTimers();
    started(timers);
    await timers.advance(MIRROR_SWEEP_DELAY_MS - 1_000);
    const busy = await page('C', 'three'); // a commit 1 s before the sweep is due
    await turns();
    await timers.advance(1_000);
    expect(rows()).toEqual([]);
    await timers.advance(MIRROR_QUIET_MS - 1_000);
    expect(rows().map((row) => row.artifactId).sort()).toEqual([...ids, busy].sort());
  });

  it('extracts nothing while a batch is open, and goes on once it commits', async () => {
    const id = await page('Live', 'before');
    const timers = manualTimers();
    started(timers);
    await timers.advance(MIRROR_SWEEP_DELAY_MS - 1);
    timers.pass(1);
    void w.store.service.inBatch(() => {}); // a batch opened by someone else, not yet committed
    expect(w.storage.batchOpen).toBe(true);
    await timers.runNext(); // the sweep, deferred: the batch is open
    expect(w.storage.batchOpen).toBe(false); // it committed meanwhile
    await timers.advance(0);
    expect(mirrored(id)).toBeNull(); // a quiet window first
    await timers.advance(MIRROR_QUIET_MS);
    expect(current(id)).toBe(true);
  });

  it('stops every timer and listener at close', async () => {
    await page('A', 'one');
    const timers = manualTimers();
    const search = started(timers);
    expect(timers.pending).toBe(1); // the sweep
    search.close();
    expect(timers.pending).toBe(0);
    await page('B', 'two');
    await turns();
    expect(timers.pending).toBe(0);
  });

  it('is closed with the documents the host opens, before the store', async () => {
    const { openDocuments } = await import('.');
    const documents = openDocuments(join(w.userData, 'opened'), () => {})!;
    const closed = vi.spyOn(ArtifactSearch.prototype, 'close');
    const storeClosed = vi.spyOn(documents.store, 'close');
    documents.close();
    expect(closed).toHaveBeenCalledOnce();
    expect(closed.mock.invocationCallOrder[0]).toBeLessThan(storeClosed.mock.invocationCallOrder[0]!);
    closed.mockRestore();
  });
});

describe('the store’s discipline', () => {
  it('takes the mirror’s row back with a lost batch, so the mirror and the store still agree after it', async () => {
    const id = await page('Status', 'alpha');
    const search = unstarted();
    await find(search, 'alpha');
    const before = mirrored(id);
    const commit = w.storage.commit.bind(w.storage);
    w.storage.commit = () => {
      w.storage.commit = commit;
      throw new Error('disk I/O error');
    };
    const write = w.store.writeContent(id, html('omega'), HUMAN); // the batch both join, lost at its commit
    const lost = await find(search, 'omega');
    await expect(write).rejects.toThrow(/failed to commit/);
    expect(lost.hits).toEqual([]);
    expect(lost.searchedAsBefore).toBe(1);
    expect(mirrored(id)).toEqual(before);
    expect(current(id)).toBe(true); // the write is gone too
    expect(await find(search, 'alpha')).toMatchObject({ searchedAsBefore: 0, hits: [{ id }] });
  });

  it('on a read-only store (a newer app’s file) searches what the mirror holds, writes nothing and starts nothing', async () => {
    const id = await page('Status', 'alpha');
    await find(unstarted(), 'alpha');
    await w.store.writeContent(id, html('omega'), HUMAN);
    const path = join(w.userData, 'artifacts', 'store.sqlite');
    w.store.close();
    w.service.close();
    w.storage.close();
    const storage = new SqliteDocumentStorage(openStore(path, STORE_MIGRATIONS.slice(0, 3), () => {}));
    const service = new DocumentService(storage, { kindOf: (artifactId) => storage.kindOf(artifactId), log: () => {} });
    const store = new ArtifactStore(service, storage, { root: join(w.userData, 'artifacts'), log: () => {} });
    try {
      expect(storage.readOnly).toBe(true);
      const timers = manualTimers();
      const search = started(timers, store);
      expect(timers.pending).toBe(0);
      expect(await search.search({ terms: parseQuery('alpha').terms, limit: 10 })).toMatchObject({ hits: [{ id }], searchedAsBefore: 0 });
      expect(await search.search({ terms: parseQuery('omega').terms, limit: 10 })).toMatchObject({ hits: [] });
    } finally {
      store.close();
      service.close();
      storage.close();
    }
  });
});

describe('the query plan', () => {
  // With a MATCH term, the FTS table must be the outer loop whatever the filters: a plan that starts from `artifacts`
  // (the Space's partial index, the session links) restarts the FTS cursor per artifact, and bm25 re-reads the term's
  // postings each time (M2's review: 62 ms unfiltered, 2.1 s with a spaceId over the same library).
  it('scans artifact_text first for every filter and scope when a term goes through the index', async () => {
    const space = await w.store.createSpace({ name: 'Research' });
    for (let n = 0; n < 40; n++) {
      const id = (await w.store.create({ kind: 'html', title: `Page ${n}`, ...(n % 3 === 0 && { spaceId: space.id }), content: html(`launch plan ${n}`) }, HUMAN)).id;
      if (n % 4 === 0) await w.store.link(id, 'app-self' as AppSessionId, 'viewed');
    }
    await find(unstarted(), 'launch');
    w.storage.db.exec('ANALYZE');
    const filters: Omit<SearchRequest, 'terms' | 'limit'>[] = [{}, { kind: 'html' }, { spaceId: space.id }, { linkedTo: ['app-self'] }, { kind: 'html', spaceId: space.id }, { kind: 'html', spaceId: space.id, linkedTo: ['app-self', 'app-parent'] }];
    for (const filter of filters) {
      for (const query of ['launch', 'launch plan', 'launch 12']) {
        const { sql, params } = searchQuery({ ...filter, terms: parseQuery(query).terms, limit: 10 });
        const plan = w.storage.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
        const loops = plan.map((row) => row.detail).filter((detail) => /^(SCAN|SEARCH) /.test(detail));
        expect(loops[0], `${JSON.stringify(filter)} ${query}: ${loops.join(' | ')}`).toMatch(/^SCAN artifact_text VIRTUAL TABLE/);
      }
    }
  });
});

describe('the snippet and read', () => {
  const terms = (query: string) => parseQuery(query).terms;
  const plain = (body: string) => ({ body, sections: [[0, null]] as [number, null][] });

  it('anchors at the first occurrence of the longest term the body holds, case-insensitively', () => {
    const body = 'An intro. Then the Roadmap appears, and a plan; the roadmap again.';
    expect(snippetAndRead(plain(body), terms('plan ROADMAP')).snippet).toBe(body);
    const long = `${'word '.repeat(40)}target ${'tail '.repeat(60)}`.trim();
    const { snippet } = snippetAndRead(plain(long), terms('target'));
    expect(snippet!.startsWith('…word')).toBe(true);
    expect(snippet!.endsWith('tail…')).toBe(true);
    expect(snippet).toContain('target');
  });

  it('counts code points, so an astral character is one, and snaps an end to whitespace within 16', () => {
    const before = '😀'.repeat(100);
    const { snippet } = snippetAndRead(plain(`${before}목표`), terms('목표'));
    expect([...snippet!].length).toBe(1 + 80 + 2); // the ellipsis, 80 emoji (no whitespace to snap to), the term
    const spaced = `${'abcdefghi '.repeat(20)}목표`;
    expect(snippetAndRead(plain(spaced), terms('목표')).snippet!.startsWith('…abcdefghi')).toBe(true);
  });

  it('anchors inside the first section holding every term, else at the longest term’s first occurrence', () => {
    const text = {
      body: 'Tab\nthe plan for later\na budget line\nthe budget plan, at last',
      sections: [[0, { tab: 't' }], [4, { tab: 't', from: 'b1' }], [23, { tab: 't', from: 'b2' }], [37, { tab: 't', from: 'b3' }]] as [number, { tab: string; from?: string }][],
    };
    const both = snippetAndRead(text, terms('plan budget'));
    expect(both.read).toEqual({ tab: 't', from: 'b3' });
    expect(both.snippet).toBe('the budget plan, at last'); // that section's text alone (Decision Log 20)
    // no section holds both: the longest term's first occurrence in the body
    expect(snippetAndRead(text, terms('later budget')).read).toEqual({ tab: 't', from: 'b2' });
    expect(snippetAndRead(text, terms('LATER plan')).read).toEqual({ tab: 't', from: 'b1' });
  });

  // Decision Log 20: a document's (a file model's) snippet is the passage `read` opens, never its neighbours' text
  const blocks = (...lines: string[]) => {
    const sections: [number, { tab: string; from?: string }][] = [];
    let offset = 0;
    lines.forEach((line, n) => {
      sections.push([offset, n === 0 ? { tab: 't' } : { tab: 't', from: `b${n}` }]);
      offset += line.length + 1;
    });
    return { body: lines.join('\n'), sections };
  };

  it('anchors in a tab title only when no other section holds a term', () => {
    const titled = blocks('Roadmap review', 'An opening line.', 'The roadmap ships in December.', 'A review of the plan.');
    expect(snippetAndRead(titled, terms('roadmap')).read).toEqual({ tab: 't', from: 'b2' });
    expect(snippetAndRead(titled, terms('roadmap review')).read).toEqual({ tab: 't', from: 'b2' }); // no block holds both: the longest outside titles
    expect(snippetAndRead(titled, terms('review opening')).read).toEqual({ tab: 't', from: 'b1' }); // the longer, "opening", outside titles
    const onlyTitle = blocks('Roadmap review', 'Nothing here.');
    // the document's first tab title is its own title again: matched there alone, the hit is title-only (the lead, no read)
    expect(snippetAndRead(onlyTitle, terms('roadmap'))).toEqual({ snippet: 'Nothing here.' });
    // a later tab's title is the anchor when nothing else holds the term, and opens that tab
    const second = { body: 'Plan\nNothing here.\nRoadmap tab\nOther text.', sections: [[0, { tab: 't' }], [5, { tab: 't', from: 'b1' }], [19, { tab: 't2' }], [31, { tab: 't2', from: 'c1' }]] as Section[] };
    expect(snippetAndRead(second, terms('roadmap'))).toEqual({ snippet: 'Roadmap tab', read: { tab: 't2' } });
  });

  it('keeps the snippet inside the anchor’s section: a short block alone, with no ellipsis', () => {
    const text = blocks('Plan', 'lorem ipsum dolor sit amet '.repeat(6).trim(), 'The 결론 is short.', 'consectetur adipiscing elit sed do '.repeat(6).trim());
    expect(snippetAndRead(text, terms('결론'))).toEqual({ snippet: 'The 결론 is short.', read: { tab: 't', from: 'b2' } });
  });

  it('shows only the anchor block’s text when the next block holds the answer (the live run’s shape)', () => {
    const text = blocks('회의록', '지난주 목요일 회의에서 하반기 제품 로드맵을 팀장들과 함께 검토했다.', '모바일 앱 개편은 11월 첫째 주로 미루기로 했다.', '검색 기능 출시일은 12월 9일로 확정했다.');
    const hit = snippetAndRead(text, terms('하반기 로드맵'));
    expect(hit).toEqual({ snippet: '지난주 목요일 회의에서 하반기 제품 로드맵을 팀장들과 함께 검토했다.', read: { tab: 't', from: 'b1' } });
  });

  it('cuts inside a long section with an ellipsis only where it cut, and gives a title-only hit its first block with text', () => {
    const long = `${'word '.repeat(40)}target ${'tail '.repeat(60)}`.trim();
    const text = blocks('Tab title', 'before block', long, 'after block');
    const { snippet } = snippetAndRead(text, terms('target'));
    expect(snippet!.startsWith('…word') && snippet!.endsWith('tail…')).toBe(true);
    expect(snippet).not.toMatch(/before|after/);
    const atStart = blocks('Tab', `target ${'tail '.repeat(60)}`.trim(), 'after block');
    expect(snippetAndRead(atStart, terms('target')).snippet!.startsWith('target')).toBe(true); // the section's start: no ellipsis
    // the tab's title is the document's own title again: the lead starts at the first section holding body text and,
    // with no `read` to stay true to, runs on across sections
    const lead = snippetAndRead(text, terms('absent'));
    expect(lead.snippet!.startsWith('before block word word')).toBe(true);
    expect(lead.snippet!.endsWith('…')).toBe(true);
    expect([...lead.snippet!].length).toBeLessThanOrEqual(241);
    expect(lead).not.toHaveProperty('read');
    expect(snippetAndRead({ body: 'Only a tab', sections: [[0, { tab: 't' }]] }, terms('absent'))).toEqual({ snippet: 'Only a tab' });
    expect(snippetAndRead({ body: 'A page', sections: [[0, null]] }, terms('absent'))).toEqual({ snippet: 'A page' }); // no tab titles: unchanged
  });

  it('names the place of the section holding the anchor, and none for a title-only hit or an empty body', () => {
    const text = { body: 'Tab\nfirst block\nsecond block', sections: [[0, { tab: 't' }], [4, { tab: 't', from: 'b1' }], [16, { tab: 't', from: 'b2' }]] as [number, { tab: string; from?: string }][] };
    expect(snippetAndRead(text, terms('second')).read).toEqual({ tab: 't', from: 'b2' });
    expect(snippetAndRead(text, terms('absent')).read).toBeUndefined();
    expect(snippetAndRead({ body: '', sections: [] }, terms('absent'))).toEqual({});
  });
});
