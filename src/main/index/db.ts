// The index's one SQLite connection (C4 execution document, M4; residue *SQLite binding*): `node:sqlite`'s synchronous
// `DatabaseSync` behind a small wrapper, so a swap to another driver is this file. Statements are cached by SQL text;
// `transaction` is `BEGIN IMMEDIATE` … `COMMIT` (a nested call joins the outer one); work deferred with `defer` runs once
// per key after the outermost commit and is dropped on rollback, which is how the stores notify only what committed.
import { existsSync, renameSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { Migration } from './migrations';

export type Row = Record<string, SQLInputValue>;
// What a column may be given: SQLite's own values, plus booleans stored as 0/1.
export type Value = SQLInputValue | boolean;

export class Db {
  private readonly statements = new Map<string, StatementSync>();
  private deferred: Map<string, () => void> | null = null; // non-null exactly while a transaction is open

  constructor(
    private readonly db: DatabaseSync,
    readonly applied: readonly number[], // the migrations this open ran
    // Why the index cannot be used (a newer app's schema), or null. Every statement then fails with this reason.
    readonly unavailable: string | null = null,
  ) {}

  get readOnly(): boolean {
    return this.unavailable !== null;
  }

  exec(sql: string): void {
    this.usable();
    this.db.exec(sql);
  }

  prepare(sql: string): StatementSync {
    this.usable();
    let statement = this.statements.get(sql);
    if (!statement) this.statements.set(sql, (statement = this.db.prepare(sql)));
    return statement;
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | null {
    return (this.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.prepare(sql).run(...params).changes);
  }

  // `INSERT INTO <table> (<keys>) VALUES (<:keys>)`. Keys are the code's own column names, never input.
  insert(table: string, values: Record<string, Value>): void {
    const keys = Object.keys(values);
    this.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => `:${k}`).join(', ')})`).run(bind(values));
  }

  // `UPDATE <table> SET <keys> WHERE <keyColumn> = :key`; answers the number of rows changed.
  update(table: string, keyColumn: string, key: string, values: Record<string, Value>): number {
    const keys = Object.keys(values);
    if (keys.length === 0) return 0;
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE ${keyColumn} = :key__`;
    return Number(this.prepare(sql).run({ ...bind(values), key__: key }).changes);
  }

  transaction<T>(fn: () => T): T {
    this.usable();
    if (this.deferred) return fn();
    const deferred = new Map<string, () => void>();
    this.db.exec('BEGIN IMMEDIATE');
    this.deferred = deferred;
    let result: T;
    try {
      result = fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.deferred = null;
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
    this.deferred = null;
    for (const [key, run] of deferred) {
      try {
        run();
      } catch (error) {
        console.error(`[index] after-commit work ${key} failed:`, error);
      }
    }
    return result;
  }

  // Runs `fn` after the open transaction commits, once per key (the first registration wins); at once outside one.
  defer(key: string, fn: () => void): void {
    if (!this.deferred) fn();
    else if (!this.deferred.has(key)) this.deferred.set(key, fn);
  }

  private usable(): void {
    if (this.unavailable !== null) throw new Error(`index unavailable: ${this.unavailable}`);
  }

  close(): void {
    this.statements.clear();
    if (this.db.isOpen) this.db.close();
  }
}

function bind(values: Record<string, Value>): Record<string, SQLInputValue> {
  const bound: Record<string, SQLInputValue> = {};
  for (const [key, value] of Object.entries(values)) bound[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  return bound;
}

// SQLite result codes that mean the file itself is not a usable database (primary codes; extended codes carry them in
// the low byte). Everything else at open — SQLITE_BUSY from a second instance, an I/O error — is transient or
// environmental and must never cost the owner a valid index.
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

function isBrokenFile(error: unknown): boolean {
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === 'number' && [SQLITE_CORRUPT, SQLITE_NOTADB].includes(code & 0xff);
}

// Opens the index file and brings it to the newest schema (residue *Index schema and location*): a file SQLite reports
// as corrupt or not a database is moved aside as `<path>.broken-<epoch>` (with its -wal and -shm) and a fresh one
// created, never deleted; any other failure at open propagates. A file whose `user_version` is newer than the app knows
// is opened read-only, with one logged error, and marked unavailable: its schema may not be the one this app reads, so
// every statement fails with `index unavailable: <reason>` rather than reading or writing it.
export function openDb(path: string, migrations: readonly Migration[]): Db {
  const known = migrations.length;
  let db: DatabaseSync;
  let version: number;
  try {
    ({ db, version } = probe(path));
  } catch (error) {
    if (!isBrokenFile(error)) throw error;
    const aside = `${path}.broken-${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) renameSync(path + suffix, aside + suffix);
    console.error(`[index] ${path} is not a usable database (${error instanceof Error ? error.message : String(error)}); moved aside as ${aside}`);
    ({ db, version } = probe(path));
  }

  if (version > known) {
    db.close();
    const reason = `user_version ${version} is newer than this app knows (${known})`;
    console.error(`[index] ${path}: ${reason}; the index is unavailable this run and the file is left as it is`);
    const readOnly = new DatabaseSync(path, { readOnly: true });
    return new Db(readOnly, [], reason);
  }

  const pending = migrations.slice(version);
  if (pending.length > 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const migration of pending) db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${known}`);
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return new Db(
    db,
    pending.map((migration) => migration.version),
  );
}

// Opens with the index's pragmas and reads the schema version.
function probe(path: string): { db: DatabaseSync; version: number } {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON');
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    return { db, version: user_version };
  } catch (error) {
    db.close();
    throw error;
  }
}
