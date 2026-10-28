// The connection to the browser's own database (P5 O3-A; the O3 document §4), the stores' one way in: statements cached
// by SQL text and `transaction` as `BEGIN IMMEDIATE` … `COMMIT` (a nested call joins the outer one), as the index's
// wrapper has them, over a connection that exists only once the browser may use its tables (BrowserData, index.ts).
// Until then the wrapper is `inert`, and every store reads nothing and records nothing. Main's browser is the file's one
// writer, so the connection has no busy timeout: a lock some other process holds fails a write at once (SQLITE_BUSY,
// which each caller logs) and never stalls main's event loop.
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';

export class BrowserDb {
  private connection: DatabaseSync | null = null;
  private readonly statements = new Map<string, StatementSync>();

  // Not open yet (the index below 14, or the file a newer build's), or closed: nothing may be read or written.
  get inert(): boolean {
    return this.connection === null;
  }

  // The connection, opened, migrated and promoted (index.ts), from now until `close`.
  use(connection: DatabaseSync): void {
    this.connection = connection;
  }

  prepare(sql: string): StatementSync {
    const db = this.open();
    let statement = this.statements.get(sql);
    if (!statement) this.statements.set(sql, (statement = db.prepare(sql)));
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

  transaction<T>(fn: () => T): T {
    const db = this.open();
    if (db.isTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.statements.clear();
    if (this.connection?.isOpen) this.connection.close();
    this.connection = null;
  }

  private open(): DatabaseSync {
    if (!this.connection) throw new Error('the browser data is not open');
    return this.connection;
  }
}
