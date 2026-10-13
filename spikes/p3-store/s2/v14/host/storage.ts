// S2 on Yjs v14 → P3-A's `DocumentStorage` (§4.10) and its SQLite backend (§4.2, X24, X29). Same log and versions as
// the v13 variant (s2/src/host/storage.ts); provenance is v14's native attribution instead of custom range rows.
//   updates       one row per integrated update: seq (the live revision), docId, actor, at, bytes (V1)
//   versions      full V2 states (gc on); seq is the last update folded in
//   attributions  encoded ContentMaps (who inserted and deleted which id ranges, when): one `update` row per update,
//                 written in the same batch; compaction merges every row it folds into one `merged` row (exact times),
//                 and thinning re-buckets a merged row's times (`bucketMs`) so a run of one actor's keystrokes
//                 coalesces into one range. Never deleted with the update rows, so authorship survives both.
//   actors        the actor keys seen, with their JSON
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { bucketAttribution, decodeAttribution, deletedBy, encodeAttribution, insertedBy, mergeAttributions, type AttrRange, type Authorship, type ContentMap } from '../yjs';

export type Actor = { kind: 'human' } | { kind: 'session'; appSessionId: string };
export const actorKey = (actor: Actor): string => (actor.kind === 'human' ? 'human' : `session:${actor.appSessionId}`);
export type { Authorship };

export interface StoredDoc {
  version: { seq: number; state: Uint8Array } | null;
  updates: { seq: number; bytes: Uint8Array }[];
}

export interface DocumentStorage {
  load(docId: string): StoredDoc;
  appendInBatch(docId: string, actor: Actor, at: number, update: Uint8Array, attribution: Uint8Array): number;
  commit(): void;
  rollback(): void;
  compact(docId: string, upToSeq: number, state: Uint8Array, at: number, actor: Actor): void;
  thin(docId: string, olderThanSeq: number, bucketMs: number): void;
  attribution(docId: string): ContentMap;
  whoInserted(docId: string, client: number, clock: number): Authorship | null;
  whoDeleted(docId: string, client: number, clock: number): Authorship[];
  revision(docId: string): number;
  close(): void;
}

export class SqliteDocumentStorage implements DocumentStorage {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private open = false;
  private readonly knownActors = new Set<string>();
  private readonly merged = new Map<string, ContentMap>(); // per doc, invalidated by every append

  constructor(path: string, options: { fullfsync?: boolean } = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA fullfsync = ${options.fullfsync ? 'ON' : 'OFF'};`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, docId TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL, bytes BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS updates_doc ON updates (docId, seq);
      CREATE TABLE IF NOT EXISTS versions (docId TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, state BLOB NOT NULL, PRIMARY KEY (docId, seq));
      CREATE TABLE IF NOT EXISTS attributions (docId TEXT NOT NULL, fromSeq INTEGER NOT NULL, toSeq INTEGER NOT NULL, kind TEXT NOT NULL, bucketMs INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (docId, fromSeq));
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
    const updates = this.sql('SELECT seq, bytes FROM updates WHERE docId = ? AND seq > ? ORDER BY seq').all(docId, version?.seq ?? 0) as { seq: number; bytes: Uint8Array }[];
    return { version: version ? { seq: version.seq, state: version.state } : null, updates };
  }

  appendInBatch(docId: string, actor: Actor, at: number, update: Uint8Array, attribution: Uint8Array): number {
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
    this.sql('INSERT INTO attributions (docId, fromSeq, toSeq, kind, bucketMs, bytes) VALUES (?, ?, ?, ?, ?, ?)').run(docId, seq, seq, 'update', 0, attribution);
    this.merged.delete(docId);
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
    this.merged.clear();
    this.db.exec('ROLLBACK');
  }

  // One transaction: the version row, the update rows deleted, and their attribution rows merged into one.
  compact(docId: string, upToSeq: number, state: Uint8Array, at: number, actor: Actor): void {
    this.commit();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.sql('INSERT INTO versions (docId, seq, at, actor, kind, state) VALUES (?, ?, ?, ?, ?, ?)').run(docId, upToSeq, at, actorKey(actor), 'auto', state);
      this.sql('DELETE FROM updates WHERE docId = ? AND seq <= ?').run(docId, upToSeq);
      this.mergeRows(docId, upToSeq, 'update', 0);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // Thinning: every attribution row ≤ olderThanSeq merged into one row whose times are bucketed.
  thin(docId: string, olderThanSeq: number, bucketMs: number): void {
    this.commit();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.mergeRows(docId, olderThanSeq, null, bucketMs);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private mergeRows(docId: string, upToSeq: number, onlyKind: string | null, bucketMs: number): void {
    const rows = this.sql('SELECT fromSeq, toSeq, kind, bytes FROM attributions WHERE docId = ? AND toSeq <= ? ORDER BY fromSeq').all(docId, upToSeq) as { fromSeq: number; toSeq: number; kind: string; bytes: Uint8Array }[];
    const chosen = onlyKind ? rows.filter((r) => r.kind === onlyKind || r.kind === 'merged') : rows;
    if (chosen.length <= 1 && bucketMs === 0) return;
    if (chosen.length === 0) return;
    let merged = mergeAttributions(chosen.map((r) => decodeAttribution(r.bytes)));
    if (bucketMs > 0) merged = bucketAttribution(merged, bucketMs);
    const del = this.sql('DELETE FROM attributions WHERE docId = ? AND fromSeq = ?');
    for (const r of chosen) del.run(docId, r.fromSeq);
    this.sql('INSERT INTO attributions (docId, fromSeq, toSeq, kind, bucketMs, bytes) VALUES (?, ?, ?, ?, ?, ?)').run(
      docId,
      chosen[0].fromSeq,
      chosen[chosen.length - 1].toSeq,
      'merged',
      bucketMs,
      encodeAttribution(merged),
    );
    this.merged.delete(docId);
  }

  // Every attribution row of a doc, merged (cached until the next append).
  attribution(docId: string): ContentMap {
    let map = this.merged.get(docId);
    if (!map) {
      const rows = this.sql('SELECT bytes FROM attributions WHERE docId = ? ORDER BY fromSeq').all(docId) as { bytes: Uint8Array }[];
      map = mergeAttributions(rows.map((r) => decodeAttribution(r.bytes)));
      this.merged.set(docId, map);
    }
    return map;
  }

  whoInserted(docId: string, client: number, clock: number): Authorship | null {
    return insertedBy(this.attribution(docId), client, clock);
  }

  whoDeleted(docId: string, client: number, clock: number): Authorship[] {
    const who = deletedBy(this.attribution(docId), client, clock);
    return who ? [who] : [];
  }

  importVersion(docId: string, state: Uint8Array, at: number, actor: Actor): void {
    this.commit();
    this.sql('INSERT INTO versions (docId, seq, at, actor, kind, state) VALUES (?, ?, ?, ?, ?, ?)').run(docId, this.revision(docId), at, actorKey(actor), 'import', state);
  }

  revision(docId: string): number {
    const u = this.sql('SELECT MAX(seq) AS s FROM updates WHERE docId = ?').get(docId) as { s: number | null };
    const v = this.sql('SELECT MAX(seq) AS s FROM versions WHERE docId = ?').get(docId) as { s: number | null };
    return Math.max(u.s ?? 0, v.s ?? 0);
  }

  // Harness reads (the same names on the v13 storage): table sizes, provenance's size and a per-actor summary.
  rowCounts(): { t: string; n: number }[] {
    return this.query("SELECT 'updates' AS t, COUNT(*) AS n FROM updates UNION ALL SELECT 'attributions', COUNT(*) FROM attributions UNION ALL SELECT 'versions', COUNT(*) FROM versions");
  }

  provenanceBytes(docId: string): number {
    return (this.sql('SELECT COALESCE(SUM(length(bytes)), 0) AS n FROM attributions WHERE docId = ?').get(docId) as { n: number }).n;
  }

  provenanceSummary(docId: string): { actor: string; op: string; ranges: number; clocks: number }[] {
    const map = this.attribution(docId);
    const tally = new Map<string, { actor: string; op: string; ranges: number; clocks: number }>();
    for (const [op, idmap] of [['insert', map.inserts], ['delete', map.deletes]] as const) {
      idmap.forEach((range: AttrRange) => {
        const actor = String(range.attrs?.find((a: { name: string }) => a.name === op)?.val ?? '?');
        const t = tally.get(`${actor}/${op}`) ?? { actor, op, ranges: 0, clocks: 0 };
        t.ranges += 1;
        t.clocks += range.len;
        tally.set(`${actor}/${op}`, t);
      });
    }
    return [...tally.values()];
  }

  query<T>(text: string, ...params: (string | number)[]): T[] {
    return this.sql(text).all(...params) as T[];
  }

  close(): void {
    this.commit();
    this.db.close();
  }
}
