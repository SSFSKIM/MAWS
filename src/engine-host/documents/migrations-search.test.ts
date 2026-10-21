// P4-B4 M2 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "The mirror"; the X15 slot "the host store's next
// schema version"): schema 4 of the host's artifact store, `artifact_search`'s full-text mirror. `artifact_text` is a
// trigram FTS5 table of main's `library_text` shape; `artifact_text_rows` remembers each row's revision, title and
// sections. The migration leaves both empty (the search's catch-up and the sweep fill them).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore, STORE_MIGRATIONS } from './migrations';

const V3 = STORE_MIGRATIONS.slice(0, 3);
let dir: string;
const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'maws-store-search-')));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const quiet = () => {};
const columns = (db: DatabaseSync, table: string) => db.prepare(`SELECT name, type, "notnull", pk FROM pragma_table_info('${table}') ORDER BY cid`).all();

describe('openStore: schema 4 (P4-B4, the search mirror)', () => {
  it('creates a fresh store at version 4 with the trigram text table and its rows table', () => {
    expect(STORE_MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4]);
    const { db, applied } = openStore(join(fresh(), 'store.sqlite'), STORE_MIGRATIONS, quiet);
    expect(applied).toEqual([1, 2, 3, 4]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    expect(columns(db, 'artifact_text_rows')).toEqual([
      { name: 'artifactId', type: 'TEXT', notnull: 0, pk: 1 },
      { name: 'textRowid', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'revision', type: 'INTEGER', notnull: 1, pk: 0 },
      { name: 'title', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'sections', type: 'TEXT', notnull: 1, pk: 0 },
    ]);
    // the trigram tokenizer: a three-character term inside a longer word, Korean and case-folded Latin alike
    const insert = db.prepare('INSERT INTO artifact_text (artifact_id, title, body) VALUES (?, ?, ?)');
    insert.run('a1', 'Roadmap', '우리는 로드맵을 논의했다');
    const match = (expression: string) => db.prepare('SELECT artifact_id FROM artifact_text WHERE artifact_text MATCH ?').all(expression);
    expect(match('"로드맵"')).toEqual([{ artifact_id: 'a1' }]);
    expect(match('"ROADMAP"')).toEqual([{ artifact_id: 'a1' }]);
    expect(match('"admap" AND "논의했"')).toEqual([{ artifact_id: 'a1' }]);
    db.close();
  });

  it('upgrades a populated schema-3 store in place, leaving the mirror empty for the sweep', () => {
    const path = join(fresh(), 'store.sqlite');
    const first = openStore(path, V3, quiet);
    first.db.prepare("INSERT INTO artifacts (id, kind, title, createdBy, createdAt, updatedAt) VALUES ('a1', 'document', 'Plan', 'human', 1, 1)").run();
    first.db.close();
    const upgraded = openStore(path, STORE_MIGRATIONS, quiet);
    expect(upgraded.applied).toEqual([4]);
    expect(upgraded.db.prepare('SELECT COUNT(*) AS n FROM artifact_text_rows').get()).toEqual({ n: 0 });
    expect(upgraded.db.prepare('SELECT COUNT(*) AS n FROM artifact_text').get()).toEqual({ n: 0 });
    expect(upgraded.db.prepare('SELECT title FROM artifacts').all()).toEqual([{ title: 'Plan' }]);
    upgraded.db.close();
  });

  it('opens a schema-4 store read-only under the schema-3 list, leaving it at 4', () => {
    const path = join(fresh(), 'store.sqlite');
    openStore(path, STORE_MIGRATIONS, quiet).db.close();
    const older = openStore(path, V3, quiet);
    expect(older.status).toBe('readOnly');
    older.db.close();
    const after = new DatabaseSync(path);
    expect(after.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    after.close();
  });
});
