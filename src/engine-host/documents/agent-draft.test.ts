// UX wave U10b (M4; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.1, §C.2, §C.5): the agent's delete of
// its own draft, through the real storage, document service and store over a SQLite file. The mark (`agentDraft:<id>` in
// `meta`): a session's create writes it, a session's write advances it, and a person's write, or any row it did not
// account for (an older build's), breaks it for good, so that after a checkpoint and a prune of the log the delete is
// still refused. The delete's rules run in the batch that sets `deletedAt`; the fence that batch raises refuses a frame
// and a replica's open of a deleted artifact, whoever deleted it; the undelete brings back only what an agent's delete
// removed. Every assertion of rows and of the key reads the committed file.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KindAdapter } from '@artifacts/host';
import { applyV2, diffV1, idAt, newDoc, stateVector, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { ArtifactStoreError } from './errors';
import { provided, type ProvidedReplica } from './provided-replica.fixture';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';
import { ArtifactStore, type ArtifactChanged } from './store';

const DAY = 24 * 3_600_000;
const sid = (id: string) => id as AppSessionId;
const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: sid('app-1') };
const parent: Actor = { kind: 'session', appSessionId: sid('app-parent') };
const other: Actor = { kind: 'session', appSessionId: sid('app-2') };
const LINEAGE = [sid('app-1')];

// A design whose stored shape is one step behind its model: opening it writes the step (a design's migration at an open).
const designs: KindAdapter = {
  kind: 'design',
  migrate: (doc: Doc) => {
    const model = doc.get('model');
    if (model.toString() === 'v2') return false;
    model.insert(0, 'v2');
    return true;
  },
} as KindAdapter;

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let now: number;
let changes: ArtifactChanged[];

function make(): void {
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { now: () => now, log: () => {}, kindOf: (id) => storage.kindOf(id), adapters: [designs] });
  store = new ArtifactStore(service, storage, { root: dir, now: () => now, log: () => {} });
  store.onChange((change) => void changes.push(change));
}
function close(): void {
  store.close();
  service.close();
  storage.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-agent-draft-'));
  now = Date.UTC(2026, 10, 15, 9, 0);
  changes = [];
  make();
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

const committed = (sql: string, ...params: (string | number)[]) => {
  const db = new DatabaseSync(join(dir, 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as Record<string, unknown>[];
  } finally {
    db.close();
  }
};
const mark = (artifactId: string): Record<string, unknown> | null => {
  const [row] = committed('SELECT value FROM meta WHERE key = ?', `agentDraft:${artifactId}`);
  return row ? (JSON.parse(row.value as string) as Record<string, unknown>) : null;
};
const deletedAt = (artifactId: string) => committed('SELECT deletedAt FROM artifacts WHERE id = ?', artifactId)[0]?.deletedAt ?? null;
const rows = (artifactId: string) => committed('SELECT seq, actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq', artifactId) as { seq: number; actor: string }[];
const userVersion = () => (committed('PRAGMA user_version')[0] as { user_version: number }).user_version;
const write = (artifactId: string, actor: Actor, edit: (doc: Doc) => void) => service.writeAs(artifactId, actor, edit);
const text = (artifactId: string) => {
  const doc = newDoc();
  applyV2(doc, service.readState(artifactId).state);
  return doc.get('t').toString();
};
// The agent's delete as the tool makes it: its refusal's `why`, or 'deleted'.
const agentDelete = async (artifactId: string, lineage: readonly AppSessionId[] = LINEAGE): Promise<string> => {
  try {
    await store.writeCommitted(() => store.deleteOwnDraft(artifactId, lineage));
    return 'deleted';
  } catch (error) {
    if (error instanceof ArtifactStoreError) return error.code === 'designSystemInUse' ? 'designSystemInUse' : String(error.data.why ?? error.code);
    throw error;
  }
};
// A checkpoint and a prune: every log row the head covers that is past the log's keep, but each document's newest.
const checkpointAndPrune = async () => {
  now += 8 * DAY;
  await store.maintenance.run();
};
// A draft the agent made and wrote to.
async function draft(kind: 'document' | 'design' = 'document', by: Actor = agent): Promise<string> {
  const { id } = await store.create({ kind, title: 'Draft plan' }, by);
  await write(id, by, (doc) => doc.get('t').insert(0, 'An agent wrote this.'));
  return id;
}
// Frames moved both ways until nothing moves (the service commits on its own deferred turn).
async function settle(...replicas: ProvidedReplica[]): Promise<void> {
  for (let i = 0; i < 50; i++) {
    let moved = 0;
    for (const replica of replicas) moved += replica.deliver();
    await new Promise((resolve) => setImmediate(resolve));
    if (moved === 0 && !storage.batchOpen) return;
  }
}
// A person's editor on the artifact, synced.
async function editor(artifactId: string): Promise<ProvidedReplica> {
  const replica = provided(service, artifactId, human);
  await settle(replica);
  expect(replica.provider.state).toMatchObject({ phase: 'live', synced: true });
  return replica;
}
const type = (replica: ProvidedReplica, words: string) => replica.doc.get('t').insert(0, words);
// What the mark is for: once its key is committed broken, an agent's write after the person's (to each document of the
// pair that has rows) and a checkpoint and a prune leave none of the person's rows in the store's file, and the key read
// from the file still says broken. Everything is read through a separate read-only connection (`committed`).
async function outlivesTheLog(id: string, broken: 'person' | 'unaccounted'): Promise<void> {
  expect(mark(id)).toMatchObject({ broken });
  const suggestion = `${id}:suggest`; // its key, without opening it
  await write(id, agent, (doc) => doc.get('t').insert(0, 'The agent again. '));
  if (rows(suggestion).length > 0) await write(suggestion, agent, (doc) => doc.get('t').insert(0, 'And proposes. '));
  await checkpointAndPrune();
  expect([...rows(id), ...rows(suggestion)].map((row) => row.actor)).not.toContain('human');
  expect(mark(id)).toMatchObject({ broken });
}

describe('the mark', () => {
  it('is written by a session’s create and advanced by each of its writes, in the batch the row joins', async () => {
    const { id } = await store.create({ kind: 'document', title: 'Draft plan' }, agent);
    expect(mark(id)).toEqual({ by: 'session:app-1', seq: 0 });
    await write(id, agent, (doc) => doc.get('t').insert(0, 'One.'));
    expect(mark(id)).toEqual({ by: 'session:app-1', seq: rows(id).at(-1)!.seq });
    await write(id, other, (doc) => doc.get('t').insert(0, 'Two. '));
    expect(mark(id)).toEqual({ by: 'session:app-1', seq: rows(id).at(-1)!.seq }); // any session's accounted write
    const page = await store.create({ kind: 'html', title: 'Draft page', content: { bytes: new TextEncoder().encode('<p>draft</p>') } }, agent);
    expect(mark(page.id)).toEqual({ by: 'session:app-1', seq: rows(page.id).at(-1)!.seq }); // a byte kind's first content
    expect(mark((await store.create({ kind: 'document', title: 'Mine' }, human)).id)).toBeNull();
  });

  it('is broken by a person’s insert, and the delete is refused after a checkpoint and a prune', async () => {
    const id = await draft();
    await write(id, human, (doc) => doc.get('t').insert(0, 'The person typed. '));
    await outlivesTheLog(id, 'person');
    expect(rows(id).map((row) => row.actor)).toEqual(['session:app-1']); // only the newest row is left
    expect(await agentDelete(id)).toBe('edited');
    expect(deletedAt(id)).toBeNull();
  });

  it('is broken by a person’s deletion alone', async () => {
    const id = await draft();
    await write(id, human, (doc) => doc.get('t').delete(0, 3));
    await outlivesTheLog(id, 'person');
    expect(await agentDelete(id)).toBe('edited');
  });

  it('is broken by a person’s accept of the agent’s suggestion, and by a person’s reject of one', async () => {
    for (const settled of ['accept', 'reject'] as const) {
      const id = await draft();
      const key = service.suggestionDoc(id);
      await write(key, agent, (doc) => doc.get('t').insert(0, 'Proposed. '));
      expect(mark(id)).not.toHaveProperty('broken'); // the agent's proposal is its write
      const live = service.live(key).get('t');
      const range = [{ start: idAt(live, 0)!, end: idAt(live, 9)! }];
      if (settled === 'accept') await service.acceptSuggestion(id, range, human);
      else await service.rejectSuggestion(id, range, human);
      await outlivesTheLog(id, 'person');
      expect([settled, await agentDelete(id)]).toEqual([settled, 'edited']);
    }
  });

  it('is broken by a person’s restore of a version', async () => {
    const id = await draft();
    const version = (await store.createVersion(id, { kind: 'named', actor: agent, label: 'First' }))!;
    await write(id, agent, (doc) => doc.get('t').insert(0, 'Second. '));
    await store.restore(id, version, human);
    await outlivesTheLog(id, 'person');
    expect(await agentDelete(id)).toBe('edited');
  });

  it('is broken by a design’s migration at a person’s open', async () => {
    const id = await draft('design');
    await store.ensureMigrated(id, human);
    expect(rows(id).at(-1)!.actor).toBe('human');
    await outlivesTheLog(id, 'person');
    expect(await agentDelete(id)).toBe('edited');
  });

  it('refuses an artifact a person made, one a person copied, and one with no key', async () => {
    const mine = await draft('document', human);
    const copy = await store.duplicate(await draft(), {}, human);
    const keyless = await draft();
    const db = new DatabaseSync(join(dir, 'store.sqlite'));
    db.prepare('DELETE FROM meta WHERE key = ?').run(`agentDraft:${keyless}`); // as a draft an older build made
    db.close();
    expect(await agentDelete(mine)).toBe('byUser');
    expect(await agentDelete(copy.id)).toBe('byUser');
    expect(await agentDelete(keyless)).toBe('unknown');
  });

  // The same statement an older build's storage runs (`appendInBatch` in src/engine-host/documents/storage.ts, read at
  // 2c7044231 and f1852de3a and byte-identical there): it appends a row and never touches the key.
  const OLDER_BUILD_APPEND = 'INSERT INTO artifact_updates (artifactId, actor, at, bytes) VALUES (?, ?, ?, ?)';

  it('does not stand after a stay under an older build that appended a row, and breaks at this build’s next row', async () => {
    const id = await draft();
    const before = newDoc();
    applyV2(before, service.readState(id).state);
    const sv = stateVector(before);
    before.get('t').insert(0, 'Typed under the older build. ');
    const update = diffV1(before, sv);
    close();
    const db = new DatabaseSync(join(dir, 'store.sqlite'));
    db.prepare(OLDER_BUILD_APPEND).run(id, 'human', now, update);
    db.close();
    make();
    expect(text(id)).toBe('Typed under the older build. An agent wrote this.');
    // the stay left the key as it was, behind the newest row: not broken yet, and not standing
    expect(mark(id)).not.toHaveProperty('broken');
    expect(mark(id)!.seq).toBeLessThan(rows(id).at(-1)!.seq);
    expect(await agentDelete(id)).toBe('unknown');
    // this build's next row breaks it, and the break outlives the older build's row
    await write(id, agent, (doc) => doc.get('t').insert(0, 'Back here. '));
    await outlivesTheLog(id, 'unaccounted');
    expect(await agentDelete(id)).toBe('unknown');
  });
});

describe('the agent’s delete', () => {
  it('deletes a draft the session made, sets `deletedAt` and records itself in the mark', async () => {
    const id = await draft();
    expect(await agentDelete(id)).toBe('deleted');
    expect(deletedAt(id)).toBe(now);
    expect(mark(id)).toMatchObject({ by: 'session:app-1', deleted: { at: now, by: 'session:app-1' } });
    expect(store.get(id)).toBeNull();
    expect(changes.filter((change) => change.artifactId === id).at(-1)).toMatchObject({ change: 'deleted' });
  });

  it('deletes from a side thread a draft its parent made, and refuses one another session made', async () => {
    const theirs = await draft('document', parent);
    expect(await agentDelete(theirs, [sid('app-1'), sid('app-parent')])).toBe('deleted');
    expect(mark(theirs)).toMatchObject({ deleted: { by: 'session:app-1' } });
    const another = await draft('document', other);
    expect(await agentDelete(another)).toBe('otherSession');
    expect(deletedAt(another)).toBeNull();
  });

  it('refuses a design system still in use, as the person’s delete does', async () => {
    const system = await store.create({ kind: 'design_system', title: 'House draft' }, agent);
    await store.create({ kind: 'document', title: 'Styled', designSystemId: system.id }, agent);
    expect(await agentDelete(system.id)).toBe('designSystemInUse');
    expect(deletedAt(system.id)).toBeNull();
  });
});

describe('the fence', () => {
  it('a person’s update just before the agent’s delete: a row of the person’s, and the delete refused', async () => {
    const id = await draft();
    const replica = await editor(id);
    type(replica, 'Typed first. ');
    replica.deliver(); // admitted, in the open batch
    const refused = agentDelete(id);
    expect(await refused).toBe('edited');
    await settle(replica);
    expect(rows(id).at(-1)!.actor).toBe('human');
    expect(deletedAt(id)).toBeNull();
    expect(replica.provider.state).toMatchObject({ phase: 'live', unsaved: 0 });
  });

  it('a person’s update just before the Library’s delete: the delete goes through, the update in the deleted state', async () => {
    const id = await draft();
    const replica = await editor(id);
    type(replica, 'Typed first. ');
    replica.deliver();
    await store.writeCommitted(() => store.delete(id));
    await settle(replica);
    expect(deletedAt(id)).not.toBeNull();
    expect(rows(id).at(-1)!.actor).toBe('human');
    expect(text(id)).toBe('Typed first. An agent wrote this.');
  });

  for (const by of ['agent', 'Library'] as const) {
    it(`a person’s update just after the ${by}’s delete: refused, the connection closed, no row, no ack, the update kept unacknowledged`, async () => {
      const id = await draft();
      const replica = await editor(id);
      const before = rows(id).length;
      const deleting = by === 'agent' ? agentDelete(id) : store.writeCommitted(() => store.delete(id)).then(() => 'deleted');
      type(replica, 'Typed after. ');
      await settle(replica);
      expect(await deleting).toBe('deleted');
      expect(replica.closed).toBe(true);
      expect(rows(id)).toHaveLength(before);
      expect(replica.provider.state).toMatchObject({ phase: 'off', unsaved: 1 });
      expect(service.stats.rejected.at(-1)?.reason).toBe('deleted: the artifact was deleted');
      expect(text(id)).toBe('An agent wrote this.');
    });
  }

  it('refuses a new open of a deleted artifact’s document, and of its suggestion document', async () => {
    const id = await draft();
    expect(await agentDelete(id)).toBe('deleted');
    const replica = provided(service, id, human);
    await settle(replica);
    expect(replica.closed).toBe(true);
    expect(service.stats.rejected.at(-1)?.reason).toBe('deleted: the artifact was deleted');
    const suggestions = provided(service, `${id}:suggest`, human);
    await settle(suggestions);
    expect(suggestions.closed).toBe(true);
  });

  it('refuses a host-originated write to a deleted artifact, whoever deleted it', async () => {
    const id = await draft();
    await store.writeCommitted(() => store.delete(id));
    const before = rows(id).length;
    await expect(write(id, agent, (doc) => doc.get('t').insert(0, 'Too late. '))).rejects.toThrow(/deleted: the artifact was deleted/);
    expect(rows(id)).toHaveLength(before);
  });
});

describe('the undelete', () => {
  it('of an agent’s delete clears `deletedAt`, announces `created`, keeps the mark standing; the held edit then lands as the person’s', async () => {
    const id = await draft();
    const replica = await editor(id);
    const deleting = agentDelete(id);
    type(replica, 'Typed after. ');
    await settle(replica);
    expect(await deleting).toBe('deleted');
    expect(replica.provider.state).toMatchObject({ phase: 'off', unsaved: 1 });
    const seq = mark(id)!.seq;
    now += 60_000;
    await store.writeCommitted(() => store.undelete(id));
    expect(deletedAt(id)).toBeNull();
    expect(committed('SELECT updatedAt FROM artifacts WHERE id = ?', id)[0]!.updatedAt).toBe(now);
    expect(mark(id)).toEqual({ by: 'session:app-1', seq });
    expect(changes.filter((change) => change.artifactId === id).at(-1)).toMatchObject({ change: 'created' });
    expect(store.deletion(id)).toBeNull();
    replica.reconnect();
    await settle(replica);
    expect(replica.provider.state).toMatchObject({ phase: 'live', unsaved: 0 });
    expect(rows(id).at(-1)!.actor).toBe('human');
    expect(text(id)).toBe('Typed after. An agent wrote this.');
    expect(mark(id)).toMatchObject({ broken: 'person' });
    expect(await agentDelete(id)).toBe('edited');
  });

  it('refuses an artifact deleted in the Library and leaves it deleted', async () => {
    const id = await draft();
    await store.writeCommitted(() => store.delete(id));
    expect(store.deletion(id)).toEqual({ title: 'Draft plan', kind: 'document', undoable: false });
    const refusal = await store.writeCommitted(() => store.undelete(id)).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ArtifactStoreError);
    expect(refusal).toMatchObject({ code: 'invalid', message: 'this artifact was deleted in the Library, not by an agent' });
    expect(deletedAt(id)).not.toBeNull();
  });

  it('of a live artifact answers success and writes nothing; of an unknown id, notFound', async () => {
    const id = await draft();
    const before = committed('SELECT updatedAt FROM artifacts WHERE id = ?', id);
    changes.length = 0;
    await store.writeCommitted(() => store.undelete(id));
    await store.writeCommitted(() => store.undelete(id));
    expect(committed('SELECT updatedAt FROM artifacts WHERE id = ?', id)).toEqual(before);
    expect(changes).toEqual([]);
    await expect(store.writeCommitted(() => store.undelete('99999999-9999-4999-8999-999999999999'))).rejects.toMatchObject({ code: 'notFound' });
  });

  it('says of a deleted artifact that it was deleted and whether that can be undone; nothing of a live one', async () => {
    const id = await draft();
    expect(store.deletion(id)).toBeNull();
    expect(await agentDelete(id)).toBe('deleted');
    expect(store.deletion(id)).toEqual({ title: 'Draft plan', kind: 'document', undoable: true });
    await store.writeCommitted(() => store.undelete(id));
    expect(store.deletion(id)).toBeNull();
    expect(userVersion()).toBe(4);
  });
});
