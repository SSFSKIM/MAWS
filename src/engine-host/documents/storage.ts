// The SQLite `DocumentStorage` (src/artifacts/host.ts; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M2 and
// Decision Log 5, 6, 8 and 12), on `node:sqlite` as main's index is. Copied in shape from P3-0's S2
// (`spikes/p3-store/s2/v14/host/storage.ts`) with S7a's storage policy (`s7/soak/store.mjs`): the update log in one
// batch per event-loop turn, a provenance row and the clientID bindings written with each log row, a zstd head
// checkpoint a load starts from, log pruning and provenance tiering for the nightly maintenance (scheduled by M3).
//
// One connection: the entity layer (M3) writes through `db` inside the same batch, so an op row commits with the
// write's last log row (Decision Log 11).
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import type { DocumentStorage, StoredDoc, ThreadChange } from '@artifacts/host';
import { decodeMap, encodeMap, mergeMaps, PROVENANCE_STEP_MS } from '@artifacts/yjs';
import { actorKey, type Actor } from '@shared/artifacts/actor';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { StoreTooNewError } from './errors';
import { openStore, type OpenedStore, type StoreStatus } from './migrations';

export { StoreTooNewError };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const LOG_KEEP_MS = 7 * DAY; // a log row the head covers is kept this long (Decision Log 8)
const HOUR_TIER_AFTER_MS = HOUR; // per-update provenance rows merge into hour rows after this age (Decision Log 5)
const DAY_TIER_AFTER_MS = 30 * DAY; // hour rows merge into day rows after this age

const floor = (t: number, step: number) => t - (((t % step) + step) % step);
const bytes = (buffer: Buffer): Uint8Array => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

export class SqliteDocumentStorage implements DocumentStorage {
  readonly db: DatabaseSync;
  readonly status: StoreStatus;
  readonly statusReason: string | null;
  private readonly statements = new Map<string, StatementSync>();
  private open = false; // a batch is open
  private frame = false; // a frame's savepoint is open inside it
  private readonly actorsCommitted = new Set<string>();
  private readonly actorsInBatch = new Set<string>(); // inserted by this batch's committed-to-be frames
  private readonly actorsInFrame = new Set<string>();

  static open(path: string, options: { log?: (line: string) => void } = {}): SqliteDocumentStorage {
    return new SqliteDocumentStorage(openStore(path, undefined, options.log));
  }

  constructor(opened: OpenedStore) {
    this.db = opened.db;
    this.status = opened.status;
    this.statusReason = opened.reason;
  }

  get readOnly(): boolean {
    return this.status === 'readOnly';
  }

  // A frame's savepoint is open (the idempotency ledger records an op only inside one).
  get frameOpen(): boolean {
    return this.frame;
  }

  // A batch is open: rows on this connection that are not yet durable (a read here sees them, Decision Log 26j, 33).
  get batchOpen(): boolean {
    return this.open;
  }

  private sql(text: string): StatementSync {
    let statement = this.statements.get(text);
    if (!statement) this.statements.set(text, (statement = this.db.prepare(text)));
    return statement;
  }

  private writable(): void {
    if (this.readOnly) throw new StoreTooNewError(this.statusReason ?? 'a newer app wrote it');
  }

  private begin(): void {
    this.writable();
    if (this.open) return;
    this.db.exec('BEGIN IMMEDIATE');
    this.open = true;
  }

  // Maintenance and the head run in a transaction of their own, never inside the document service's batch.
  private outsideBatch<T>(what: string, run: () => T): T {
    this.writable();
    if (this.open) throw new Error(`${what} runs outside the open batch (commit first)`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  load(artifactId: string): StoredDoc {
    const head = this.sql('SELECT seq, state FROM artifact_head WHERE artifactId = ?').get(artifactId) as { seq: number; state: Uint8Array } | undefined;
    const updates = this.sql('SELECT seq, bytes FROM artifact_updates WHERE artifactId = ? AND seq > ? AND bytes IS NOT NULL ORDER BY seq').all(artifactId, head?.seq ?? 0) as { seq: number; bytes: Uint8Array }[];
    const clients = this.sql('SELECT c.clientId, c.host, a.json FROM client_actors c JOIN actors a ON a.key = c.actor WHERE c.artifactId = ? ORDER BY c.firstSeq').all(artifactId) as { clientId: number; host: number; json: string }[];
    const restored = this.sql("SELECT id, seq FROM artifact_versions WHERE artifactId = ? AND kind = 'restore' ORDER BY id DESC LIMIT 1").get(artifactId) as { id: number; seq: number } | undefined;
    return {
      head: head ? { seq: head.seq, state: bytes(zstdDecompressSync(head.state)) } : null,
      updates,
      clients: clients.map((row) => ({ clientId: row.clientId, actor: JSON.parse(row.json) as Actor, host: row.host === 1 })),
      restored: restored ? { revision: restored.seq, versionId: restored.id } : null,
    };
  }

  appendInBatch(row: { artifactId: string; actor: Actor; at: number; update: Uint8Array; provenance?: Uint8Array; bindClients: number[]; hostClient?: number; credit?: Map<number, Actor> }): number {
    this.begin();
    const key = this.actorInBatch(row.actor, row.at);
    const seq = Number(this.sql('INSERT INTO artifact_updates (artifactId, actor, at, bytes) VALUES (?, ?, ?, ?)').run(row.artifactId, key, row.at, row.update).lastInsertRowid);
    if (row.provenance) this.attributeInBatch({ artifactId: row.artifactId, seq, at: row.at, provenance: row.provenance });
    for (const clientId of row.bindClients) {
      const credited = row.credit?.get(clientId);
      const bound = credited ? this.actorInBatch(credited, row.at) : key;
      this.sql('INSERT INTO client_actors (artifactId, clientId, actor, firstSeq, host) VALUES (?, ?, ?, ?, ?)').run(row.artifactId, clientId, bound, seq, clientId === row.hostClient ? 1 : 0);
    }
    return seq;
  }

  // A byte kind's write (Decision Log 7): a log row with no update, its `content` the JSON of the stored file, so the
  // live revision is the same global seq for every kind. `content` is built from the row's seq (the file's place).
  appendContentInBatch(row: { artifactId: string; actor: Actor; at: number; content: (seq: number) => string }): number {
    this.begin();
    const key = this.actorInBatch(row.actor, row.at);
    const seq = Number(this.sql("INSERT INTO artifact_updates (artifactId, actor, at, content) VALUES (?, ?, ?, '{}')").run(row.artifactId, key, row.at).lastInsertRowid);
    this.sql('UPDATE artifact_updates SET content = ? WHERE seq = ?').run(row.content(seq), seq);
    return seq;
  }

  // The `update`-tier attribution row of log row `seq` (Decision Log 5), its time floored to the minute.
  attributeInBatch(row: { artifactId: string; seq: number; at: number; provenance: Uint8Array }): void {
    this.begin();
    const at = floor(row.at, PROVENANCE_STEP_MS);
    this.sql("INSERT INTO artifact_attributions (artifactId, fromSeq, toSeq, tier, fromAt, toAt, bytes) VALUES (?, ?, ?, 'update', ?, ?, ?)").run(row.artifactId, row.seq, row.seq, at, at, row.provenance);
  }

  // Records `actor` in `actors` once (inside the open batch) and answers its key.
  actorInBatch(actor: Actor, at: number): string {
    this.begin();
    const key = actorKey(actor);
    if (!this.actorsCommitted.has(key) && !this.actorsInBatch.has(key) && !this.actorsInFrame.has(key)) {
      this.sql('INSERT OR IGNORE INTO actors (key, json, firstAt) VALUES (?, ?, ?)').run(key, JSON.stringify(actor), at);
      (this.frame ? this.actorsInFrame : this.actorsInBatch).add(key);
    }
    return key;
  }

  writeThreads(artifactId: string, change: ThreadChange): void {
    this.begin();
    for (const t of change.upsert ?? []) {
      this.sql(
        'INSERT INTO artifact_threads (artifactId, threadId, status, quote, createdAt, updatedAt, resolvedAt, appSessionId) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (artifactId, threadId) DO UPDATE SET status = excluded.status, quote = excluded.quote, createdAt = excluded.createdAt, updatedAt = excluded.updatedAt, resolvedAt = excluded.resolvedAt, appSessionId = excluded.appSessionId',
      ).run(artifactId, t.threadId, t.status, t.quote, t.createdAt, t.updatedAt, t.resolvedAt ?? null, t.appSessionId ?? null);
    }
    for (const threadId of change.remove ?? []) this.sql('DELETE FROM artifact_threads WHERE artifactId = ? AND threadId = ?').run(artifactId, threadId);
  }

  beginFrame(): void {
    if (this.frame) throw new Error('a frame is already open');
    this.begin();
    this.db.exec('SAVEPOINT frame');
    this.frame = true;
  }

  endFrame(): void {
    if (!this.frame) return;
    this.db.exec('RELEASE frame');
    this.frame = false;
    for (const key of this.actorsInFrame) this.actorsInBatch.add(key);
    this.actorsInFrame.clear();
  }

  abortFrame(): void {
    if (!this.frame) return;
    this.db.exec('ROLLBACK TO frame');
    this.db.exec('RELEASE frame');
    this.frame = false;
    this.actorsInFrame.clear();
  }

  commit(): void {
    if (!this.open) return;
    if (this.frame) throw new Error('commit with a frame open');
    this.db.exec('COMMIT');
    this.open = false;
    for (const key of this.actorsInBatch) this.actorsCommitted.add(key);
    this.actorsInBatch.clear();
  }

  rollback(): void {
    this.frame = false;
    this.actorsInFrame.clear();
    this.actorsInBatch.clear();
    if (!this.open) return;
    this.open = false;
    if (this.db.isTransaction) this.db.exec('ROLLBACK');
  }

  // The live revision: the last seq the artifact's log reached, which the head and the versions remember once the rows
  // themselves are pruned.
  revision(artifactId: string): number {
    const row = this.sql(
      'SELECT MAX(s) AS s FROM (SELECT MAX(seq) AS s FROM artifact_updates WHERE artifactId = ? UNION ALL SELECT seq FROM artifact_head WHERE artifactId = ? UNION ALL SELECT MAX(seq) FROM artifact_versions WHERE artifactId = ?)',
    ).get(artifactId, artifactId, artifactId) as { s: number | null };
    return row.s ?? 0;
  }

  writeHead(artifactId: string, seq: number, state: Uint8Array): void {
    this.outsideBatch('the head rewrite', () => {
      this.sql('INSERT INTO artifact_head (artifactId, seq, state) VALUES (?, ?, ?) ON CONFLICT (artifactId) DO UPDATE SET seq = excluded.seq, state = excluded.state').run(artifactId, seq, zstdCompressSync(state));
    });
  }

  provenance(artifactId: string): Uint8Array[] {
    return (this.sql('SELECT bytes FROM artifact_attributions WHERE artifactId = ? ORDER BY fromSeq').all(artifactId) as { bytes: Uint8Array }[]).map((row) => row.bytes);
  }

  // The attribution rows (of any tier) overlapping the seq range [fromSeq, toSeq] (Decision Log 23a).
  attributions(artifactId: string, fromSeq: number, toSeq: number): Uint8Array[] {
    return (this.sql('SELECT bytes FROM artifact_attributions WHERE artifactId = ? AND fromSeq <= ? AND toSeq >= ? ORDER BY fromSeq').all(artifactId, toSeq, fromSeq) as { bytes: Uint8Array }[]).map((row) => row.bytes);
  }

  clientActor(artifactId: string, clientId: number): Actor | null {
    const row = this.sql('SELECT a.json FROM client_actors c JOIN actors a ON a.key = c.actor WHERE c.artifactId = ? AND c.clientId = ?').get(artifactId, clientId) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Actor) : null;
  }

  // The artifact's kind from its entity row (M3 writes it), which picks the kind's adapter; null without a row.
  kindOf(artifactId: string): ArtifactKind | null {
    const row = this.sql('SELECT kind FROM artifacts WHERE id = ?').get(artifactId) as { kind: ArtifactKind } | undefined;
    return row?.kind ?? null;
  }

  // A host-held value (`meta`): settings main relays, the last maintenance time. A set inside the open batch commits
  // with it; outside one it commits at once.
  getMeta(key: string): string | null {
    return (this.sql('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.writable();
    this.sql('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // Maintenance (Decision Log 8): deletes the Y-kind log rows a head covers that are older than `keepMs`, except each
  // artifact's newest row, which names its last writer and time (`ArtifactStore.lastWrite`, Decision Log 37a). Byte
  // kinds' rows have no head and stay. Answers the number of rows deleted.
  pruneLog(now: number, keepMs = LOG_KEEP_MS): number {
    return this.outsideBatch('log pruning', () =>
      Number(
        this.sql(
          'DELETE FROM artifact_updates WHERE at < ? AND bytes IS NOT NULL AND seq <= COALESCE((SELECT h.seq FROM artifact_head h WHERE h.artifactId = artifact_updates.artifactId), 0) AND seq < (SELECT MAX(u.seq) FROM artifact_updates u WHERE u.artifactId = artifact_updates.artifactId)',
        ).run(now - keepMs).changes,
      ),
    );
  }

  // Maintenance (Decision Log 5): `update` rows older than an hour merge, losslessly, into one `hour` row per artifact
  // and hour; `hour` rows older than 30 days into one `day` row per artifact and day. A bucket that already has a row of
  // the next tier (rows that were younger at an earlier pass) is merged into it, so each bucket keeps one row.
  tierAttributions(now: number): { merged: number; written: number } {
    return this.outsideBatch('provenance tiering', () => {
      const update = this.tier('update', 'hour', now - HOUR_TIER_AFTER_MS, HOUR);
      const hour = this.tier('hour', 'day', now - DAY_TIER_AFTER_MS, DAY);
      return { merged: update.merged + hour.merged, written: update.written + hour.written };
    });
  }

  private tier(from: 'update' | 'hour', to: 'hour' | 'day', before: number, step: number): { merged: number; written: number } {
    type Row = { artifactId: string; fromSeq: number; toSeq: number; fromAt: number; toAt: number; bytes: Uint8Array };
    const rows = this.sql('SELECT artifactId, fromSeq, toSeq, fromAt, toAt, bytes FROM artifact_attributions WHERE tier = ? AND toAt < ? ORDER BY artifactId, fromSeq').all(from, before) as Row[];
    const groups = new Map<string, { artifactId: string; bucket: number; rows: Row[] }>();
    for (const row of rows) {
      const bucket = floor(row.fromAt, step);
      const key = `${row.artifactId}\u0000${bucket}`;
      const group = groups.get(key) ?? { artifactId: row.artifactId, bucket, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    let merged = 0;
    for (const { artifactId, bucket, rows: group } of groups.values()) {
      const existing = this.sql('SELECT artifactId, fromSeq, toSeq, fromAt, toAt, bytes FROM artifact_attributions WHERE artifactId = ? AND tier = ? AND fromAt >= ? AND fromAt < ?').all(artifactId, to, bucket, bucket + step) as Row[];
      const all = [...existing, ...group];
      const map = mergeMaps(all.map((row) => decodeMap(row.bytes)));
      for (const row of all) this.sql('DELETE FROM artifact_attributions WHERE artifactId = ? AND fromSeq = ?').run(artifactId, row.fromSeq);
      const values: SQLInputValue[] = [
        artifactId,
        Math.min(...all.map((row) => row.fromSeq)),
        Math.max(...all.map((row) => row.toSeq)),
        to,
        Math.min(...all.map((row) => row.fromAt)),
        Math.max(...all.map((row) => row.toAt)),
        encodeMap(map),
      ];
      this.sql('INSERT INTO artifact_attributions (artifactId, fromSeq, toSeq, tier, fromAt, toAt, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...values);
      merged += group.length;
    }
    return { merged, written: groups.size };
  }

  // Maintenance: returns freed pages to the file system (the file is created with auto_vacuum = INCREMENTAL) and
  // truncates the WAL.
  incrementalVacuum(): void {
    this.writable();
    if (this.open) throw new Error('the vacuum runs outside the open batch (commit first)');
    this.db.exec('PRAGMA incremental_vacuum');
    this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  }

  close(): void {
    if (!this.db.isOpen) return;
    if (this.frame) this.abortFrame();
    if (this.open) this.commit();
    this.statements.clear();
    this.db.close();
  }
}
