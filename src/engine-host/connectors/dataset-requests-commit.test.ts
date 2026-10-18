// E3 M2 fix (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3; reviewer finding 2): an agent's refresh
// whose publication was admitted into its savepoint, while the store's flush is still deferred, over A's real store
// with the dashboard kind, the host's real sink and registry. Main's reply or the engine's withdrawal heard in that
// interval cannot settle "nothing published" while the frame then commits: the commit answers its durable record (the
// op's replay the same), and a rollback answers the end heard meanwhile, nothing published.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataset, setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { registerDashboards, type Dashboards } from '../dashboards';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { connectorDatasetSink } from './dataset-sink';
import { DatasetRefreshRequests, type DatasetRefreshSettlement } from './dataset-requests';

const human: Actor = { kind: 'human' };
const SESSION = 'app-agent' as AppSessionId;
const QUERY = { kind: 'query' as const, server: 'fixture', tool: 'rows', args: { series: 'revenue' } };
const unfetched: DatasetDescriptor = { title: 'Live', source: { ...QUERY, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: 1 } };
const ROWS = [{ t: 1, v: 107 }, { t: 2, v: 110 }];

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let dashboards: Dashboards;
let artifactId: string;
// the store's flushes run at once, or wait in `turns` while `deferring`
let deferring: boolean;
let turns: (() => void)[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-refresh-commit-'));
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  deferring = false;
  turns = [];
  service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id), defer: (run) => (deferring ? turns.push(run) : setImmediate(run)) });
  store = new ArtifactStore(service, storage, { root: dir, log: () => {} });
  dashboards = registerDashboards({ documents: { store, service } });
  artifactId = (await store.create({ kind: 'dashboard', title: 'Board' }, human)).id;
  await store.writeWithAssets(artifactId, human, [], (doc) => setDataset(doc, 'live', unfetched));
});
afterEach(() => {
  dashboards.close();
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});
const live = () => readDataset(store.service.live(artifactId), 'live');

// An agent's refresh admitted and its publication inside its savepoint, the flush that commits it deferred.
async function admittedPublication(opId: string) {
  const ids: string[] = [];
  const cancels: number[] = [];
  const requests = new DatasetRefreshRequests({ announce: (requestId) => ids.push(requestId), hasClient: () => true });
  const engine = new AbortController();
  const base = store.revision(artifactId);
  const asked = requests.ask({ artifactId, datasetId: 'live', baseRevision: base, appSessionId: SESSION, opId, ...QUERY }, engine.signal);
  let answered: DatasetRefreshSettlement | null = null;
  void asked.then((settlement) => (answered = settlement));
  const sink = connectorDatasetSink({ store: () => store, requests });
  const admission = await sink.admit({ appSessionId: SESSION, artifactId, server: QUERY.server, tool: QUERY.tool, arguments: QUERY.args, dataset: { id: 'live', baseRevision: base, requestId: ids[0]! } }, () => cancels.push(1));
  if (!('publish' in admission)) throw new Error(admission.refusal);
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); // no flush already scheduled
  deferring = true;
  const publishing = admission.publish({ kind: 'result', result: { content: '', structuredContent: { rows: ROWS } } }, () => 'held');
  publishing.catch(() => {}); // a rollback's error, read below
  await vi.waitFor(() => expect(turns.length).toBeGreaterThan(0)); // its frame is in the batch, the commit deferred
  return { requests, requestId: ids[0]!, engine, asked, answered: () => answered, cancels, publishing };
}
async function flush(): Promise<void> {
  deferring = false;
  for (const run of turns.splice(0)) run();
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}
const failNextCommit = () => {
  const commit = storage.commit.bind(storage);
  storage.commit = () => {
    storage.commit = commit;
    throw new Error('disk full');
  };
};

describe('an agent’s refresh between its admission and its deferred commit', () => {
  const ends: [string, (p: Awaited<ReturnType<typeof admittedPublication>>) => void][] = [
    ['main’s reply', (p) => expect(p.requests.answer(p.requestId, { ok: false, state: 'paused', reason: 'unavailable' })).toBe('delivered')],
    ['the engine’s withdrawal', (p) => p.engine.abort()],
  ];

  it.each(ends)('answers the committed publication when %s lands before the commit; the op’s replay agrees', async (_what, end) => {
    const opId = `${SESSION}/toolu_commit`;
    const p = await admittedPublication(opId);
    end(p);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(p.answered()).toBeNull(); // nothing claimed while the frame may still commit
    await flush();
    const settlement = await p.asked;
    expect(settlement).toMatchObject({ kind: 'published', answer: { status: 'dataset', artifactId, id: 'live', rows: 2 } });
    expect(await store.replayOf(opId)).toEqual({ found: true, result: (settlement as { answer: unknown }).answer });
    expect(live()).toMatchObject({ rows: 2, updated: { by: { kind: 'session', appSessionId: SESSION } }, state: { status: 'ok' } });
    expect(store.listAssets(artifactId)).toHaveLength(1);
    expect(p.cancels).toEqual([]);
  });

  it.each(ends)('answers %s when the commit rolls back, nothing published and no replay', async (what, end) => {
    const opId = `${SESSION}/toolu_rollback`;
    const p = await admittedPublication(opId);
    end(p);
    failNextCommit();
    await flush();
    const settlement = await p.asked;
    expect(settlement).toMatchObject(what === 'main’s reply' ? { kind: 'refused', outcome: { ok: false, state: 'paused', reason: 'unavailable' }, refusal: expect.stringContaining('not committed') } : { kind: 'withdrawn' });
    await expect(p.publishing).rejects.toThrow();
    expect(await store.replayOf(opId)).toEqual({ found: false });
    expect(live()).toEqual(unfetched);
    expect(store.listAssets(artifactId)).toEqual([]);
    expect(p.cancels).toEqual([1]);
  });

  // E3 M2 residual: the post-commit collection is best effort; the committed answer is the request's regardless
  it('answers the committed publication when the collection after the commit fails, the failure reported', async () => {
    const logs: string[] = [];
    const collect = vi.spyOn(store, 'collectRetiredAssets').mockImplementation(() => {
      throw new Error('unlink EBUSY');
    });
    const ids: string[] = [];
    const requests = new DatasetRefreshRequests({ announce: (requestId) => ids.push(requestId), hasClient: () => true });
    const base = store.revision(artifactId);
    const opId = `${SESSION}/toolu_collect`;
    const asked = requests.ask({ artifactId, datasetId: 'live', baseRevision: base, appSessionId: SESSION, opId, ...QUERY }, new AbortController().signal);
    const admission = await connectorDatasetSink({ store: () => store, requests, log: (line) => logs.push(line) }).admit({ appSessionId: SESSION, artifactId, server: QUERY.server, tool: QUERY.tool, arguments: QUERY.args, dataset: { id: 'live', baseRevision: base, requestId: ids[0]! } }, () => {});
    if (!('publish' in admission)) throw new Error(admission.refusal);
    const publication = await admission.publish({ kind: 'result', result: { content: '', structuredContent: { rows: ROWS } } }, () => 'held');
    expect(collect).toHaveBeenCalledWith(artifactId);
    const settlement = await asked;
    expect(settlement).toMatchObject({ kind: 'published', answer: { status: 'dataset', rows: 2 } });
    expect(publication).toEqual({ published: (settlement as { answer: unknown }).answer });
    expect(await store.replayOf(opId)).toEqual({ found: true, result: (settlement as { answer: unknown }).answer });
    expect(live()).toMatchObject({ rows: 2, state: { status: 'ok' } });
    expect(requests.answer(ids[0]!, { ok: false, state: 'failed', reason: 'toolError' })).toBe('not_pending'); // not stranded
    expect(logs).toEqual([expect.stringMatching(/could not be collected.*unlink EBUSY/)]);
  });

  it('writes nothing for an end heard before the admission', async () => {
    const ids: string[] = [];
    const requests = new DatasetRefreshRequests({ announce: (requestId) => ids.push(requestId), hasClient: () => true });
    const engine = new AbortController();
    const base = store.revision(artifactId);
    const asked = requests.ask({ artifactId, datasetId: 'live', baseRevision: base, appSessionId: SESSION, opId: `${SESSION}/toolu_early`, ...QUERY }, engine.signal);
    const admission = await connectorDatasetSink({ store: () => store, requests }).admit({ appSessionId: SESSION, artifactId, server: QUERY.server, tool: QUERY.tool, arguments: QUERY.args, dataset: { id: 'live', baseRevision: base, requestId: ids[0]! } }, () => {});
    if (!('publish' in admission)) throw new Error(admission.refusal);
    engine.abort();
    expect(await asked).toEqual({ kind: 'withdrawn' });
    expect(await admission.publish({ kind: 'result', result: { content: '', structuredContent: { rows: ROWS } } }, () => 'held')).toMatchObject({ discarded: 'cancelled' });
    expect(store.revision(artifactId)).toBe(base);
    expect(await store.replayOf(`${SESSION}/toolu_early`)).toEqual({ found: false });
  });
});
