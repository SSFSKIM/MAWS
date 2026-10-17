import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore, STORE_MIGRATIONS } from './migrations';

// P3-H (P3 Decision Log 81(3)): A's baseline scenarios run the schema-1 list they were written for, assertions kept;
// H's schema-2 cases are below.
const V1 = STORE_MIGRATIONS.slice(0, 1);
const TABLES = ['actors', 'artifact_assets', 'artifact_attributions', 'artifact_head', 'artifact_ops', 'artifact_sessions', 'artifact_threads', 'artifact_updates', 'artifact_versions', 'artifacts', 'client_actors', 'meta', 'spaces'];

let dir: string;
const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'maws-store-')));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const quiet = () => {};

describe('openStore', () => {
  it('creates a fresh file at schema version 1 with every table and the pragmas of Decision Log 12', () => {
    const path = join(fresh(), 'artifacts', 'store.sqlite');
    const { db, status, applied } = openStore(path, V1, quiet);
    expect(status).toBe('ok');
    expect(applied).toEqual([1]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    expect(tables).toEqual(TABLES);
    expect(db.prepare("SELECT dflt_value, \"notnull\" FROM pragma_table_info('artifacts') WHERE name = 'agentEditsAsSuggestions'").get()).toEqual({ dflt_value: '0', notnull: 1 });
    // the document tables are keyed by an opaque document key, never tied to an artifacts row
    for (const table of ['artifact_updates', 'artifact_head', 'artifact_attributions', 'client_actors', 'artifact_versions']) expect(db.prepare(`SELECT * FROM pragma_foreign_key_list('${table}')`).all()).toEqual([]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(db.prepare('PRAGMA auto_vacuum').get()).toEqual({ auto_vacuum: 2 }); // INCREMENTAL, set before the first table
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 }); // FULL
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it('re-opens idempotently, running nothing and keeping the rows', () => {
    const path = join(fresh(), 'store.sqlite');
    const first = openStore(path, V1, quiet);
    first.db.prepare("INSERT INTO spaces (id, name, createdAt) VALUES ('s1', 'Work', 1)").run();
    first.db.close();
    const again = openStore(path, V1, quiet);
    expect(again.applied).toEqual([]);
    expect(again.status).toBe('ok');
    expect(again.db.prepare('SELECT name FROM spaces').all()).toEqual([{ name: 'Work' }]);
    again.db.close();
  });

  it('upgrades a populated version-1 store in place when the list grows (the in-place upgrade M4 reopens)', () => {
    const path = join(fresh(), 'store.sqlite');
    const first = openStore(path, V1, quiet);
    first.db.prepare("INSERT INTO spaces (id, name, createdAt) VALUES ('s1', 'Work', 1)").run();
    first.db.close();
    const extended = [...V1, { version: 2, sql: 'ALTER TABLE spaces ADD COLUMN color TEXT' }];
    const upgraded = openStore(path, extended, quiet);
    expect(upgraded.applied).toEqual([2]);
    expect(upgraded.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(upgraded.db.prepare('SELECT name, color FROM spaces').all()).toEqual([{ name: 'Work', color: null }]);
    upgraded.db.close();
  });

  it('takes back a failing migration whole, leaving the file at its old version', () => {
    const path = join(fresh(), 'store.sqlite');
    openStore(path, V1, quiet).db.close();
    const broken = [...V1, { version: 2, sql: 'CREATE TABLE extra (id TEXT); CREATE TABLE extra (id TEXT);' }];
    expect(() => openStore(path, broken, quiet)).toThrow();
    const reopened = new DatabaseSync(path);
    expect(reopened.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'extra'").get()).toEqual({ n: 0 });
    reopened.close();
  });

  it('opens a newer app’s store (version 99) read-only and leaves it as it is', () => {
    const path = join(fresh(), 'store.sqlite');
    const newer = new DatabaseSync(path);
    newer.exec('CREATE TABLE future (x TEXT); PRAGMA user_version = 99');
    newer.close();
    const lines: string[] = [];
    const { db, status, reason } = openStore(path, V1, (line) => lines.push(line));
    expect(status).toBe('readOnly');
    expect(reason).toMatch(/99/);
    expect(lines.join('\n')).toMatch(/read-only/);
    expect(() => db.exec("INSERT INTO future VALUES ('x')")).toThrow(/readonly/i);
    db.close();
    const after = new DatabaseSync(path);
    expect(after.prepare('PRAGMA user_version').get()).toEqual({ user_version: 99 });
    after.close();
  });

  it('moves a file that is not a database aside and creates a fresh store', () => {
    const path = join(fresh(), 'store.sqlite');
    writeFileSync(path, 'this is not a database, only some text long enough to fill a header');
    const lines: string[] = [];
    const { db, status, applied } = openStore(path, V1, (line) => lines.push(line));
    expect(status).toBe('recovered');
    expect(applied).toEqual([1]);
    expect(readdirSync(dir).some((name) => name.startsWith('store.sqlite.broken-'))).toBe(true);
    expect(lines.join('\n')).toMatch(/moved aside/);
    db.close();
    expect(existsSync(path)).toBe(true);
  });
});

// P3-H: schema 2, the connector grants beside the artifacts (P3 Decision Log 80; the X15 slot "host artifacts store
// schema 2"), over the real migration list.
// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, the authorized exemption): bound to the schema-2 list it
// was written for, as A's baseline is to V1; schema 3's cases are in migrations-e3.test.ts.
const V2 = STORE_MIGRATIONS.slice(0, 2);
describe('openStore: schema 2 (P3-H, artifact_connector_grants)', () => {
  const GRANT_COLUMNS = ['artifactId', 'server', 'tool', 'fingerprint', 'mode', 'grantedAt'];
  const tables = (db: DatabaseSync) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
  const artifact = "INSERT INTO artifacts (id, kind, title, createdBy, createdAt, updatedAt) VALUES ('a1', 'html', 'Page', 'human', 1, 1)";

  it('creates a fresh store at schema version 2 with the grants table, tied to its artifact and keyed per tool', () => {
    expect(V2.map((migration) => migration.version)).toEqual([1, 2]);
    const { db, status, applied } = openStore(join(fresh(), 'store.sqlite'), V2, quiet);
    expect(status).toBe('ok');
    expect(applied).toEqual([1, 2]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(tables(db)).toEqual([...TABLES, 'artifact_connector_grants'].sort());
    expect((db.prepare("SELECT name FROM pragma_table_info('artifact_connector_grants') ORDER BY cid").all() as { name: string }[]).map((row) => row.name)).toEqual(GRANT_COLUMNS);
    expect(db.prepare("SELECT name, pk FROM pragma_table_info('artifact_connector_grants') WHERE pk > 0 ORDER BY pk").all()).toEqual([
      { name: 'artifactId', pk: 1 },
      { name: 'server', pk: 2 },
      { name: 'tool', pk: 3 },
    ]);
    expect(db.prepare('SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list(\'artifact_connector_grants\')').all()).toEqual([{ table: 'artifacts', from: 'artifactId', to: 'id', on_delete: 'CASCADE' }]);
    db.prepare(artifact).run();
    const grant = db.prepare('INSERT INTO artifact_connector_grants (artifactId, server, tool, fingerprint, mode, grantedAt) VALUES (?, ?, ?, ?, ?, 1)');
    grant.run('a1', 'fixture', 'rows', 'f1', 'read');
    expect(() => grant.run('a1', 'fixture', 'write', 'f1', 'write')).toThrow(/CHECK/); // read | once only
    expect(() => grant.run('nobody', 'fixture', 'rows', 'f1', 'read')).toThrow(/FOREIGN KEY/);
    expect(() => grant.run('a1', 'fixture', 'rows', 'f2', 'once')).toThrow(/UNIQUE/); // one grant per artifact and tool
    db.close();
  });

  it('upgrades a populated version-1 store to version 2 in place, keeping every row and adding an empty grants table', () => {
    const path = join(fresh(), 'store.sqlite');
    const first = openStore(path, V1, quiet);
    first.db.prepare(artifact).run();
    first.db.prepare("INSERT INTO artifact_updates (artifactId, actor, at, content) VALUES ('a1', 'human', 1, '{}')").run();
    first.db.close();

    const upgraded = openStore(path, V2, quiet);
    expect(upgraded.status).toBe('ok');
    expect(upgraded.applied).toEqual([2]);
    expect(upgraded.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(upgraded.db.prepare('SELECT id, title FROM artifacts').all()).toEqual([{ id: 'a1', title: 'Page' }]);
    expect(upgraded.db.prepare('SELECT seq, artifactId FROM artifact_updates').all()).toEqual([{ seq: 1, artifactId: 'a1' }]);
    expect(upgraded.db.prepare('SELECT COUNT(*) AS n FROM artifact_connector_grants').get()).toEqual({ n: 0 });
    upgraded.db.prepare("INSERT INTO artifact_connector_grants (artifactId, server, tool, fingerprint, mode, grantedAt) VALUES ('a1', 'fixture', 'rows', 'f1', 'read', 2)").run();
    upgraded.db.close();

    const again = openStore(path, V2, quiet);
    expect(again.applied).toEqual([]);
    expect(again.db.prepare('SELECT server, tool, mode FROM artifact_connector_grants').all()).toEqual([{ server: 'fixture', tool: 'rows', mode: 'read' }]);
    again.db.close();
  });

  it('opens a schema-2 store read-only under a schema-1 list, leaving it at 2 (the rule A’s baseline proves at 99)', () => {
    const path = join(fresh(), 'store.sqlite');
    openStore(path, V2, quiet).db.close();
    const older = openStore(path, V1, quiet);
    expect(older.status).toBe('readOnly');
    older.db.close();
    const after = new DatabaseSync(path);
    expect(after.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    after.close();
  });
});
