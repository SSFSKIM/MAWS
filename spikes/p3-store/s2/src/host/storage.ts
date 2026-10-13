// S2 → P3-A's `DocumentStorage` (§4.10) and its local SQLite backend in the engine host (§4.2, X24, X29). The host
// opens this database alone. Tables (advisory layout, the spike's subset of §4.1's list):
//   updates     one row per integrated update: seq (the live revision), docId, actor, at, bytes (V1)
//   versions    full V2 states (gc on): seq is the last update folded in
//   provenance  (docId, seq, op insert|delete, clientId, clockStart, clockEnd, actor, at), written with each update and
//               never deleted by compaction, so authorship outlives the update rows
//   actors      the actor keys seen, with their JSON
// Writes go through `appendInBatch`, which opens a transaction lazily; `commit()` ends it with one fsync (group commit).
// The service sends nothing that reveals a batched row until the commit returns.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ClockRange } from '../yjs-seam';

export type Actor = { kind: 'human' } | { kind: 'session'; appSessionId: string };
export const actorKey = (actor: Actor): string => (actor.kind === 'human' ? 'human' : `session:${actor.appSessionId}`);

export interface StoredDoc {
  version: { seq: number; state: Uint8Array } | null;
  updates: { seq: number; bytes: Uint8Array }[]; // after the version, in order
}

export interface Authorship {
  actor: string;
  at: number;
  seq: number;
}

// The interface the document service needs; P4's network backend implements the same.
export interface DocumentStorage {
  load(docId: string): StoredDoc;
  appendInBatch(docId: string, actor: Actor, at: number, update: Uint8Array, inserts: ClockRange[], deletes: ClockRange[]): number;
  commit(): void; // ends the open batch durably; a no-op when none is open
  rollback(): void;
  compact(docId: string, upToSeq: number, state: Uint8Array, at: number, actor: Actor): void;
  whoInserted(docId: string, client: number, clock: number): Authorship | null;
  whoDeleted(docId: string, client: number, clock: number): Authorship[];
  revision(docId: string): number;
  close(): void;
}

export interface SqliteOptions {
  fullfsync?: boolean; // macOS: F_FULLFSYNC on commit; plain fsync does not flush the drive's cache
}

export class SqliteDocumentStorage implements DocumentStorage {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private open = false; // a batch transaction is open
  private readonly knownActors = new Set<string>();

  constructor(path: string, options: SqliteOptions = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA fullfsync = ${options.fullfsync ? 'ON' : 'OFF'};`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, docId TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL, bytes BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS updates_doc ON updates (docId, seq);
      CREATE TABLE IF NOT EXISTS versions (docId TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, state BLOB NOT NULL, PRIMARY KEY (docId, seq));
      CREATE TABLE IF NOT EXISTS provenance (docId TEXT NOT NULL, seq INTEGER NOT NULL, op TEXT NOT NULL, clientId INTEGER NOT NULL, clockStart INTEGER NOT NULL, clockEnd INTEGER NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS provenance_range ON provenance (docId, clientId, clockStart);
      CREATE TABLE IF NOT EXISTS actors (key TEXT PRIMARY KEY, json TEXT NOT NULL);
    `);
  }

  private sql(text: string): StatementSync {
    let statement = this.statements.get(text);
    if (!statement) this.statements.set(text, (statement = this.db.prepare(text)));
    return statement;
  }

  load(docId: string): StoredDoc {
    const version = this.sql('SELECT seq, state FROM versions WHERE docId = ? ORDER BY seq DESC LIMIT 1').get(docId) as { seq: number; state: Uint8Array } | undefined;
    const after = version?.seq ?? 0;
    const updates = this.sql('SELECT seq, bytes FROM updates WHERE docId = ? AND seq > ? ORDER BY seq').all(docId, after) as { seq: number; bytes: Uint8Array }[];
    return { version: version ? { seq: version.seq, state: version.state } : null, updates };
  }

  appendInBatch(docId: string, actor: Actor, at: number, update: Uint8Array, inserts: ClockRange[], deletes: ClockRange[]): number {
    if (!this.open) {
      this.db.exec('BEGIN IMMEDIATE');
      this.open = true;
    }
    const key = actorKey(actor);
    if (!this.knownActors.has(key)) {
      this.sql('INSERT OR IGNORE INTO actors (key, json) VALUES (?, ?)').run(key, JSON.stringify(actor));
      this.knownActors.add(key);
    }
    const seq = Number(this.sql('INSERT INTO updates (docId, actor, at, bytes) VALUES (?, ?, ?, ?)').run(docId, key, at, update).lastInsertRowid);
    const provenance = this.sql('INSERT INTO provenance (docId, seq, op, clientId, clockStart, clockEnd, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of inserts) provenance.run(docId, seq, 'insert', r.client, r.clockStart, r.clockEnd, key, at);
    for (const r of deletes) provenance.run(docId, seq, 'delete', r.client, r.clockStart, r.clockEnd, key, at);
    return seq;
  }

  commit(): void {
    if (!this.open) return;
    this.open = false;
    this.db.exec('COMMIT');
  }

  rollback(): void {
    if (!this.open) return;
    this.open = false;
    this.db.exec('ROLLBACK');
  }

  // Folds every update ≤ upToSeq into one version state and deletes those rows, in one transaction. Provenance stays.
  compact(docId: string, upToSeq: number, state: Uint8Array, at: number, actor: Actor): void {
    this.commit();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.sql('INSERT INTO versions (docId, seq, at, actor, kind, state) VALUES (?, ?, ?, ?, ?, ?)').run(docId, upToSeq, at, actorKey(actor), 'auto', state);
      this.sql('DELETE FROM updates WHERE docId = ? AND seq <= ?').run(docId, upToSeq);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // An import (seed) is a version with no update rows behind it.
  importVersion(docId: string, state: Uint8Array, at: number, actor: Actor): void {
    this.commit();
    this.sql('INSERT INTO versions (docId, seq, at, actor, kind, state) VALUES (?, ?, ?, ?, ?, ?)').run(docId, this.revision(docId), at, actorKey(actor), 'import', state);
  }

  whoInserted(docId: string, client: number, clock: number): Authorship | null {
    const row = this.sql('SELECT actor, at, seq FROM provenance WHERE docId = ? AND op = ? AND clientId = ? AND clockStart <= ? AND clockEnd > ? ORDER BY seq LIMIT 1')
      .get(docId, 'insert', client, clock, clock) as Authorship | undefined;
    return row ?? null;
  }

  whoDeleted(docId: string, client: number, clock: number): Authorship[] {
    return this.sql('SELECT actor, at, seq FROM provenance WHERE docId = ? AND op = ? AND clientId = ? AND clockStart <= ? AND clockEnd > ? ORDER BY seq')
      .all(docId, 'delete', client, clock, clock) as unknown as Authorship[];
  }

  revision(docId: string): number {
    const u = this.sql('SELECT MAX(seq) AS s FROM updates WHERE docId = ?').get(docId) as { s: number | null };
    const v = this.sql('SELECT MAX(seq) AS s FROM versions WHERE docId = ?').get(docId) as { s: number | null };
    return Math.max(u.s ?? 0, v.s ?? 0);
  }

  // Spike-only reads for the harness's checks.
  query<T>(text: string, ...params: (string | number)[]): T[] {
    return this.sql(text).all(...params) as T[];
  }

  close(): void {
    this.commit();
    this.db.close();
  }
}
