import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore, STORE_MIGRATIONS } from './migrations';

const TABLES = ['actors', 'artifact_assets', 'artifact_attributions', 'artifact_head', 'artifact_ops', 'artifact_sessions', 'artifact_threads', 'artifact_updates', 'artifact_versions', 'artifacts', 'client_actors', 'meta', 'spaces'];

let dir: string;
const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'maws-store-')));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const quiet = () => {};

describe('openStore', () => {
  it('creates a fresh file at schema version 1 with every table and the pragmas of Decision Log 12', () => {
    const path = join(fresh(), 'artifacts', 'store.sqlite');
    const { db, status, applied } = openStore(path, STORE_MIGRATIONS, quiet);
    expect(status).toBe('ok');
    expect(applied).toEqual([1]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    expect(tables).toEqual(TABLES);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(db.prepare('PRAGMA auto_vacuum').get()).toEqual({ auto_vacuum: 2 }); // INCREMENTAL, set before the first table
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 }); // FULL
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it('re-opens idempotently, running nothing and keeping the rows', () => {
    const path = join(fresh(), 'store.sqlite');
    const first = openStore(path, STORE_MIGRATIONS, quiet);
    first.db.prepare("INSERT INTO spaces (id, name, createdAt) VALUES ('s1', 'Work', 1)").run();
    first.db.close();
    const again = openStore(path, STORE_MIGRATIONS, quiet);
    expect(again.applied).toEqual([]);
    expect(again.status).toBe('ok');
    expect(again.db.prepare('SELECT name FROM spaces').all()).toEqual([{ name: 'Work' }]);
    again.db.close();
  });

  it('upgrades a populated version-1 store in place when the list grows (the in-place upgrade M4 reopens)', () => {
    const path = join(fresh(), 'store.sqlite');
    const first = openStore(path, STORE_MIGRATIONS, quiet);
    first.db.prepare("INSERT INTO spaces (id, name, createdAt) VALUES ('s1', 'Work', 1)").run();
    first.db.close();
    const extended = [...STORE_MIGRATIONS, { version: 2, sql: 'ALTER TABLE spaces ADD COLUMN color TEXT' }];
    const upgraded = openStore(path, extended, quiet);
    expect(upgraded.applied).toEqual([2]);
    expect(upgraded.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(upgraded.db.prepare('SELECT name, color FROM spaces').all()).toEqual([{ name: 'Work', color: null }]);
    upgraded.db.close();
  });

  it('takes back a failing migration whole, leaving the file at its old version', () => {
    const path = join(fresh(), 'store.sqlite');
    openStore(path, STORE_MIGRATIONS, quiet).db.close();
    const broken = [...STORE_MIGRATIONS, { version: 2, sql: 'CREATE TABLE extra (id TEXT); CREATE TABLE extra (id TEXT);' }];
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
    const { db, status, reason } = openStore(path, STORE_MIGRATIONS, (line) => lines.push(line));
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
    const { db, status, applied } = openStore(path, STORE_MIGRATIONS, (line) => lines.push(line));
    expect(status).toBe('recovered');
    expect(applied).toEqual([1]);
    expect(readdirSync(dir).some((name) => name.startsWith('store.sqlite.broken-'))).toBe(true);
    expect(lines.join('\n')).toMatch(/moved aside/);
    db.close();
    expect(existsSync(path)).toBe(true);
  });
});
