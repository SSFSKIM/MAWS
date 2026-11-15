// UX wave U10b (M5, the architect's pin of M4's cost; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.1,
// §C.5): what the fence on a deleted artifact and the agent-draft mark's upkeep cost on the path every content row takes,
// counted in statements, never timed. For one appended content row and for one incoming content frame, the storage runs
// each of the fence's and the mark's statements a fixed number of times, and each of them is one keyed lookup (a search
// by the primary key or an index, never a scan of a table), so a change that turns either into a scan cannot land
// silently.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { provided, type ProvidedReplica } from './provided-replica.fixture';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';
import { ArtifactStore } from './store';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-1' as AppSessionId };

// The statements, as `storage.ts` writes them.
const FENCE = 'SELECT deletedAt FROM artifacts WHERE id = ?';
const MARK_READ = 'SELECT value FROM meta WHERE key = ?';
const NEWEST = 'SELECT MAX(seq) AS s FROM artifact_updates WHERE artifactId IN (?, ?)';
const MARK_WRITE = 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value';

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let ran: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-agent-draft-cost-'));
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { now: () => Date.UTC(2026, 10, 15, 9, 0), log: () => {}, kindOf: (id) => storage.kindOf(id) });
  store = new ArtifactStore(service, storage, { root: dir, now: () => Date.UTC(2026, 10, 15, 9, 0), log: () => {} });
  ran = [];
});
afterEach(() => {
  storage.onStatement = null;
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = (text: string) => ran.filter((statement) => statement === text).length;
// What the step ran, by statement text.
async function counted(step: () => Promise<unknown>): Promise<void> {
  ran = [];
  storage.onStatement = (text) => void ran.push(text);
  try {
    await step();
  } finally {
    storage.onStatement = null;
  }
}
async function settle(replica: ProvidedReplica): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const moved = replica.deliver();
    await new Promise((resolve) => setImmediate(resolve));
    if (moved === 0 && !storage.batchOpen) return;
  }
}
async function artifactBy(by: Actor): Promise<string> {
  const { id } = await store.create({ kind: 'document', title: 'Draft plan' }, by);
  await service.writeAs(id, by, (doc) => doc.get('t').insert(0, 'Written first.'));
  return id;
}
// Each row of the statement's query plan, with every parameter bound to a text.
const plan = (text: string) =>
  (storage.db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...Array.from(text.matchAll(/\?/g), () => 'x')) as { detail: string }[]).map((row) => row.detail);

describe('the cost of the fence and of the mark’s upkeep, in statements', () => {
  it('one appended content row on an agent’s draft: one fence read, one mark read, one newest-row read, one mark write', async () => {
    const id = await artifactBy(agent);
    await counted(() => service.writeAs(id, agent, (doc) => doc.get('t').insert(0, 'Again. ')));
    expect([count(FENCE), count(MARK_READ), count(NEWEST), count(MARK_WRITE)]).toEqual([1, 1, 1, 1]);
  });

  it('one appended content row on an artifact with no mark: one fence read and one mark read, nothing more', async () => {
    const id = await artifactBy(human);
    await counted(() => service.writeAs(id, human, (doc) => doc.get('t').insert(0, 'Again. ')));
    expect([count(FENCE), count(MARK_READ), count(NEWEST), count(MARK_WRITE)]).toEqual([1, 1, 0, 0]);
  });

  it('one incoming content frame from an agent’s replica: one fence read, then the mark’s three statements', async () => {
    const id = await artifactBy(agent);
    const replica = provided(service, id, agent);
    await settle(replica);
    expect(replica.provider.state).toMatchObject({ phase: 'live', synced: true });
    replica.doc.get('t').insert(0, 'Typed. ');
    await counted(() => settle(replica));
    expect(replica.provider.state).toMatchObject({ phase: 'live', unsaved: 0 });
    expect([count(FENCE), count(MARK_READ), count(NEWEST), count(MARK_WRITE)]).toEqual([1, 1, 1, 1]);
  });

  it('one incoming content frame on an artifact with no mark: one fence read and one mark read', async () => {
    const id = await artifactBy(human);
    const replica = provided(service, id, human);
    await settle(replica);
    replica.doc.get('t').insert(0, 'Typed. ');
    await counted(() => settle(replica));
    expect(replica.provider.state).toMatchObject({ phase: 'live', unsaved: 0 });
    expect([count(FENCE), count(MARK_READ), count(NEWEST), count(MARK_WRITE)]).toEqual([1, 1, 0, 0]);
  });

  it('each read of the fence and of the mark is one keyed lookup, never a scan', () => {
    for (const text of [FENCE, MARK_READ, NEWEST]) {
      const details = plan(text);
      expect(details.length, text).toBeGreaterThan(0);
      for (const detail of details) expect(detail, text).toMatch(/^SEARCH \S+ USING (INTEGER PRIMARY KEY|PRIMARY KEY|(COVERING )?INDEX \S+) \(/);
    }
    expect(plan(FENCE)).toEqual([expect.stringContaining('(id=?)')]);
    expect(plan(MARK_READ)).toEqual([expect.stringContaining('(key=?)')]);
  });
});
