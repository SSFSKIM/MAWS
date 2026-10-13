import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyV1, applyV2, attributionMap, contentIdsOf, decodeMap, deletedBy, diffV1, encodeMap, insertedBy, mergeMaps, newDoc, stateV2, stateVector } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { SqliteDocumentStorage, StoreTooNewError } from './storage';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const sid = (id: string) => id as AppSessionId;
const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: sid('app-1') };
const quiet = () => {};

let dir: string;
let path: string;
let storage: SqliteDocumentStorage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-docs-'));
  path = join(dir, 'store.sqlite');
  storage = SqliteDocumentStorage.open(path, { log: quiet });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

// One edit on `doc` as a log row with its provenance, appended to the open batch.
function append(doc: ReturnType<typeof newDoc>, edit: () => void, actor: Actor, at: number, bind: number[] = []): number {
  const before = stateVector(doc);
  edit();
  const update = diffV1(doc, before);
  const key = actor.kind === 'human' ? 'human' : `session:${actor.appSessionId}`;
  const provenance = encodeMap(attributionMap(contentIdsOf(update), { insertActor: key, deleteActor: key, at }));
  return storage.appendInBatch({ artifactId: 'a1', actor, at, update, provenance, bindClients: bind });
}

// What another connection sees: only what has committed.
const committedRows = () => {
  const other = new DatabaseSync(path, { readOnly: true });
  const { n } = other.prepare('SELECT COUNT(*) AS n FROM artifact_updates').get() as { n: number };
  other.close();
  return n;
};

describe('SqliteDocumentStorage: the log, the batch and frames', () => {
  it('appends rows in one batch, reveals none of them before commit, and loads them back in order', () => {
    const doc = newDoc();
    const s1 = append(doc, () => doc.get('t').insert(0, 'abc'), human, 1_000, [doc.clientID]);
    const s2 = append(doc, () => doc.get('t').insert(3, 'def'), human, 2_000);
    expect(s2).toBeGreaterThan(s1);
    expect(committedRows()).toBe(0);
    storage.commit();
    expect(committedRows()).toBe(2);
    expect(storage.revision('a1')).toBe(s2);
    expect(storage.revision('nothing')).toBe(0);
    const stored = storage.load('a1');
    expect(stored.head).toBeNull();
    expect(stored.updates.map((row) => row.seq)).toEqual([s1, s2]);
    const reloaded = newDoc();
    for (const row of stored.updates) applyV1(reloaded, row.bytes);
    expect(reloaded.get('t').toString()).toBe('abcdef');
    expect(stored.clients).toEqual([{ clientId: doc.clientID, actor: human, host: false }]);
    expect(stored.restored).toBeNull();
  });

  it('takes back exactly an aborted frame’s rows, keeping the batch’s earlier ones', () => {
    const doc = newDoc();
    const kept = append(doc, () => doc.get('t').insert(0, 'kept'), human, 1_000, [doc.clientID]);
    storage.beginFrame();
    const other = newDoc();
    append(other, () => other.get('t').insert(0, 'gone'), agent, 2_000, [other.clientID]);
    storage.abortFrame();
    storage.beginFrame();
    const after = append(doc, () => doc.get('t').insert(4, '!'), human, 3_000);
    storage.endFrame();
    storage.commit();
    expect(storage.load('a1').updates.map((row) => row.seq)).toEqual([kept, after]);
    expect(storage.clientActor('a1', other.clientID)).toBeNull();
    expect(storage.provenance('a1')).toHaveLength(2);
    // the aborted frame's actor row went with it, and a later batch writes it again
    const db = new DatabaseSync(path, { readOnly: true });
    expect(db.prepare('SELECT key FROM actors ORDER BY key').all()).toEqual([{ key: 'human' }]);
    db.close();
    append(other, () => other.get('t').insert(0, 'x'), agent, 4_000, [other.clientID]);
    storage.commit();
    expect(storage.clientActor('a1', other.clientID)).toEqual(agent);
  });

  it('rolls a whole batch back', () => {
    const doc = newDoc();
    append(doc, () => doc.get('t').insert(0, 'abc'), human, 1_000, [doc.clientID]);
    storage.rollback();
    storage.commit(); // a no-op: nothing is open
    expect(storage.load('a1').updates).toEqual([]);
    expect(storage.revision('a1')).toBe(0);
  });

  it('binds clientIDs at first sight, marking the host replica’s', () => {
    const doc = newDoc();
    const seq = append(doc, () => doc.get('t').insert(0, 'a'), agent, 1_000, [doc.clientID]);
    const update = diffV1(newDoc());
    storage.appendInBatch({ artifactId: 'a1', actor: agent, at: 2_000, update, provenance: encodeMap(attributionMap(contentIdsOf(update), { insertActor: 'x', deleteActor: 'x', at: 0 })), bindClients: [77], hostClient: 77 });
    storage.commit();
    expect(storage.clientActor('a1', doc.clientID)).toEqual(agent);
    expect(storage.clientActor('a2', doc.clientID)).toBeNull();
    expect(storage.load('a1').clients).toEqual(expect.arrayContaining([
      { clientId: doc.clientID, actor: agent, host: false },
      { clientId: 77, actor: agent, host: true },
    ]));
    const db = new DatabaseSync(path, { readOnly: true });
    expect(db.prepare('SELECT firstSeq FROM client_actors WHERE clientId = ?').get(doc.clientID)).toEqual({ firstSeq: seq });
    db.close();
  });

  it('reports the latest restore version as the document’s `restored`', () => {
    storage.db.prepare("INSERT INTO artifact_versions (artifactId, seq, at, actor, kind) VALUES ('a1', 4, 1, 'human', 'restore'), ('a1', 9, 2, 'human', 'restore'), ('a1', 12, 3, 'human', 'auto')").run();
    const latest = storage.db.prepare("SELECT id FROM artifact_versions WHERE seq = 9").get() as { id: number };
    expect(storage.load('a1').restored).toEqual({ revision: 9, versionId: latest.id });
  });
});

describe('SqliteDocumentStorage: the head and log pruning (Decision Log 8)', () => {
  it('loads the head plus the rows after it, keeps the revision when covered rows are pruned, and refuses a head inside a batch', () => {
    const doc = newDoc();
    const now = 30 * DAY;
    append(doc, () => doc.get('t').insert(0, 'old '), human, now - 8 * DAY, [doc.clientID]);
    const covered = append(doc, () => doc.get('t').insert(4, 'covered '), human, now - 8 * DAY);
    expect(() => storage.writeHead('a1', covered, stateV2(doc))).toThrow(/batch/);
    storage.commit();
    storage.writeHead('a1', covered, stateV2(doc));
    const young = append(doc, () => doc.get('t').insert(12, 'young '), human, now - 6 * DAY);
    const tail = append(doc, () => doc.get('t').insert(18, 'tail'), human, now - 9 * DAY); // old but after the head
    storage.commit();

    const stored = storage.load('a1');
    expect(stored.head?.seq).toBe(covered);
    expect(stored.updates.map((row) => row.seq)).toEqual([young, tail]);
    const reloaded = newDoc();
    applyV2(reloaded, stored.head!.state);
    for (const row of stored.updates) applyV1(reloaded, row.bytes);
    expect(reloaded.get('t').toString()).toBe(doc.get('t').toString());

    expect(storage.pruneLog(now)).toBe(2); // the two covered rows older than 7 days; the tail stays
    expect(storage.load('a1').updates.map((row) => row.seq)).toEqual([young, tail]);
    expect(storage.revision('a1')).toBe(tail);
    storage.writeHead('a1', tail, stateV2(doc));
    expect(storage.pruneLog(now)).toBe(1); // only the 9-day-old row: the 6-day-old one is covered but young
    expect(storage.revision('a1')).toBe(tail); // the head still names the last seq
    storage.incrementalVacuum();
  });

  it('stores the head zstd-compressed', () => {
    const doc = newDoc();
    doc.get('t').insert(0, 'repetitive '.repeat(2_000));
    const state = stateV2(doc);
    storage.writeHead('a1', 1, state);
    const { size } = storage.db.prepare("SELECT length(state) AS size FROM artifact_head WHERE artifactId = 'a1'").get() as { size: number };
    expect(size).toBeLessThan(state.length / 4);
    expect(storage.load('a1').head?.state).toEqual(state);
  });
});

describe('SqliteDocumentStorage: provenance tiering (Decision Log 5)', () => {
  it('merges update rows older than an hour into one hour row per artifact and hour, and hour rows older than 30 days into day rows, answering identically', () => {
    const now = 100 * DAY;
    const doc = newDoc();
    const ids: { client: number; clock: number }[] = [];
    const at = (t: number) => now - t;
    const times = [at(40 * DAY + 10 * MIN), at(40 * DAY + 20 * MIN), at(40 * DAY + 2 * HOUR), at(3 * HOUR + 5 * MIN), at(3 * HOUR + 50 * MIN), at(10 * MIN)];
    times.forEach((t, i) => {
      append(doc, () => {
        doc.get('t').insert(doc.get('t').length, `w${i} `);
        if (i === 4) doc.get('t').delete(0, 2); // a deletion of w0's text, by the human
      }, i % 2 === 0 ? human : agent, t, i === 0 ? [doc.clientID] : []);
      ids.push({ client: doc.clientID, clock: i * 3 });
    });
    storage.commit();
    const answers = () => {
      const map = mergeMaps(storage.provenance('a1').map(decodeMap));
      return { inserted: ids.map((id) => insertedBy(map, id)), deleted: deletedBy(map, ids[0]) };
    };
    const before = answers();
    expect(before.deleted).toEqual({ actor: 'human', at: times[4] - (times[4] % MIN) });
    expect(before.inserted[1]).toEqual({ actor: 'session:app-1', at: times[1] - (times[1] % MIN) });

    storage.tierAttributions(now);
    const tiers = () => storage.db.prepare("SELECT tier, COUNT(*) AS n FROM artifact_attributions WHERE artifactId = 'a1' GROUP BY tier ORDER BY tier").all();
    // 40 days old: two hours of edits → two hour rows → one day row; 3 hours old: one hour row; 10 minutes: its own row
    expect(tiers()).toEqual([{ tier: 'day', n: 1 }, { tier: 'hour', n: 1 }, { tier: 'update', n: 1 }]);
    expect(answers()).toEqual(before);

    // a later pass folds a late row of an hour already tiered into that hour's row, not a second one
    append(doc, () => doc.get('t').insert(0, 'late'), human, at(3 * HOUR + 55 * MIN));
    storage.commit();
    storage.tierAttributions(now);
    expect(tiers()).toEqual([{ tier: 'day', n: 1 }, { tier: 'hour', n: 1 }, { tier: 'update', n: 1 }]);
  });
});

describe('SqliteDocumentStorage: host-held values (`meta`)', () => {
  it('gets and sets a value by key, durably', () => {
    expect(storage.getMeta('maintenance.lastRun')).toBeNull();
    storage.setMeta('maintenance.lastRun', '1000');
    storage.setMeta('maintenance.lastRun', '2000');
    storage.setMeta('designSystem.defaults', '{"id":"x"}');
    storage.close();
    storage = SqliteDocumentStorage.open(path, { log: quiet });
    expect(storage.getMeta('maintenance.lastRun')).toBe('2000');
    expect(storage.getMeta('designSystem.defaults')).toBe('{"id":"x"}');
  });
});

describe('SqliteDocumentStorage on a newer app’s file', () => {
  it('reads, and refuses every write with storeTooNew', () => {
    const doc = newDoc();
    append(doc, () => doc.get('t').insert(0, 'abc'), human, 1_000, [doc.clientID]);
    storage.commit();
    storage.close();
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99');
    db.close();
    storage = SqliteDocumentStorage.open(path, { log: quiet });
    expect(storage.readOnly).toBe(true);
    expect(storage.status).toBe('readOnly');
    expect(storage.load('a1').updates).toHaveLength(1);
    expect(() => append(doc, () => doc.get('t').insert(0, 'x'), human, 2_000)).toThrow(StoreTooNewError);
    expect(() => storage.beginFrame()).toThrow(StoreTooNewError);
    expect(() => storage.writeHead('a1', 1, stateV2(doc))).toThrow(StoreTooNewError);
    expect(() => storage.tierAttributions(0)).toThrow(StoreTooNewError);
    expect(() => storage.pruneLog(0)).toThrow(StoreTooNewError);
    expect(() => storage.setMeta('k', 'v')).toThrow(StoreTooNewError);
    expect(storage.getMeta('k')).toBeNull();
  });
});
