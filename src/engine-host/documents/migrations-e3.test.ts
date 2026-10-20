// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1; E's Decision Log 48 (1)): schema 3 of the host's
// artifact store, the query-snapshot retention. `artifact_assets` gains `querySnapshot` (0 or 1, 0 for every existing
// row) and `retiredAt` (null: active); `artifact_query_snapshots` is the bounded per-query membership, its rows tied to
// their asset by a composite foreign key that cascades. H's schema-2 cases stay in migrations.test.ts (bound to V2);
// these run the schema-3 list they were written for (P4-B4's schema 4 is migrations-search.test.ts's).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore, STORE_MIGRATIONS } from './migrations';

const V2 = STORE_MIGRATIONS.slice(0, 2);
const V3 = STORE_MIGRATIONS.slice(0, 3);
let dir: string;
const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'maws-store-e3-')));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const quiet = () => {};
const artifact = "INSERT INTO artifacts (id, kind, title, createdBy, createdAt, updatedAt) VALUES ('a1', 'dashboard', 'Board', 'human', 1, 1)";
const asset = (id: string, extra = '') => `INSERT INTO artifact_assets (artifactId, assetId, name, mime, size, sha256, createdAt, createdBy${extra ? ', querySnapshot' : ''}) VALUES ('a1', '${id}', '${id}.json', 'application/json', 2, '${id}', 1, 'human'${extra ? `, ${extra}` : ''})`;
const columns = (db: DatabaseSync, table: string) => db.prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY cid`).all();

describe('openStore: schema 3 (E3, query snapshot retention)', () => {
  it('creates a fresh store at schema version 3 with the two asset columns and the membership table', () => {
    expect(V3.map((migration) => migration.version)).toEqual([1, 2, 3]);
    const { db, applied } = openStore(join(fresh(), 'store.sqlite'), V3, quiet);
    expect(applied).toEqual([1, 2, 3]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(columns(db, 'artifact_assets').slice(-2)).toEqual([
      { name: 'querySnapshot', type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0 },
      { name: 'retiredAt', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
    ]);
    expect(columns(db, 'artifact_query_snapshots')).toEqual([
      { name: 'artifactId', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
      { name: 'datasetId', type: 'TEXT', notnull: 1, dflt_value: null, pk: 2 },
      { name: 'assetId', type: 'TEXT', notnull: 1, dflt_value: null, pk: 3 },
      { name: 'lastUsedSeq', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
    ]);
    expect(db.prepare('SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list(\'artifact_query_snapshots\') ORDER BY seq').all()).toEqual([
      { table: 'artifact_assets', from: 'artifactId', to: 'artifactId', on_delete: 'CASCADE' },
      { table: 'artifact_assets', from: 'assetId', to: 'assetId', on_delete: 'CASCADE' },
    ]);
    db.prepare(artifact).run();
    db.prepare(asset('x', '1')).run();
    expect(() => db.prepare(asset('bad', '2')).run()).toThrow(/CHECK/); // 0 or 1 only
    const member = db.prepare("INSERT INTO artifact_query_snapshots (artifactId, datasetId, assetId, lastUsedSeq) VALUES ('a1', ?, ?, ?)");
    member.run('live', 'x', 5);
    member.run('other', 'x', 6); // one asset may be a member of two queries (deduplicated bytes)
    expect(() => member.run('live', 'nobody', 7)).toThrow(/FOREIGN KEY/);
    db.prepare("DELETE FROM artifact_assets WHERE assetId = 'x'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM artifact_query_snapshots').get()).toEqual({ n: 0 }); // the cascade
    db.close();
  });

  it('upgrades a populated schema-2 store in place: every existing asset ordinary and active, no membership', () => {
    const path = join(fresh(), 'store.sqlite');
    const first = openStore(path, V2, quiet);
    first.db.prepare(artifact).run();
    first.db.prepare(asset('old')).run();
    first.db.prepare("INSERT INTO artifact_connector_grants (artifactId, server, tool, fingerprint, mode, grantedAt) VALUES ('a1', 'fixture', 'rows', 'f1', 'read', 2)").run();
    first.db.close();

    const upgraded = openStore(path, V3, quiet);
    expect(upgraded.applied).toEqual([3]);
    expect(upgraded.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(upgraded.db.prepare('SELECT assetId, querySnapshot, retiredAt FROM artifact_assets').all()).toEqual([{ assetId: 'old', querySnapshot: 0, retiredAt: null }]);
    expect(upgraded.db.prepare('SELECT COUNT(*) AS n FROM artifact_query_snapshots').get()).toEqual({ n: 0 });
    expect(upgraded.db.prepare('SELECT server, tool FROM artifact_connector_grants').all()).toEqual([{ server: 'fixture', tool: 'rows' }]);
    upgraded.db.close();
    const again = openStore(path, V3, quiet);
    expect(again.applied).toEqual([]);
    again.db.close();
  });

  it('opens a schema-3 store read-only under the schema-2 list, leaving it at 3', () => {
    const path = join(fresh(), 'store.sqlite');
    openStore(path, V3, quiet).db.close();
    const older = openStore(path, V2, quiet);
    expect(older.status).toBe('readOnly');
    older.db.close();
    const after = new DatabaseSync(path);
    expect(after.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    after.close();
  });
});
