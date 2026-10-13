// Versions (parent §4.2 and §4.7; the P3-A document's Decision Log 8, 22b and 22c; P3-0's S7a policy,
// `spikes/p3-store/s7/soak/store.mjs`). A Y kind's version row holds zstd V2 bytes, `enc` either `full` (a keyframe) or
// `delta` from the previous retained version of the artifact (by id): a keyframe whenever the deltas since the last one
// would outweigh it. A byte kind's version names its write's file (`content`). Reading a version reconstructs it from its
// keyframe forward. Thinning (nightly) keeps every version but unnamed `auto` ones, and of those all within 24 hours,
// the newest per hour to 7 days, per day to 30 days, per ISO week after, the newest version and every pinned one (a
// design-system pin's target); an `auto` version the owner named keeps its kind and is never thinned (Decision Log 37d).
// Dropping a delta's base folds the dropped bytes into the next retained row in the same transaction.
//
// Every write here runs inside a savepoint of the document service's open batch (the caller's `inBatch` or a write's
// `inFrame`), so a version commits with the change it records.
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { canonicalV2, mergeV2, versionDelta } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { ContentRef } from './bytes';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONDAY0 = Date.UTC(2026, 0, 5); // a Monday: ISO-week buckets start here
const floor = (t: number, step: number) => t - (((t % step) + step) % step);

export type VersionKind = ArtifactVersion['kind'];
export interface DesignSystemRef {
  id: string;
  versionSeq: number;
}

interface Row {
  id: number;
  artifactId: string;
  seq: number;
  at: number;
  actor: string;
  kind: VersionKind;
  label: string | null;
  note: string | null;
  summary: string | null;
  enc: 'full' | 'delta' | null;
  bytes: Uint8Array | null;
  content: string | null;
  designSystemRef: string | null;
  assetRefs: string;
}

export interface VersionMeta {
  kind: VersionKind;
  actor: string; // actorKey
  at: number;
  label?: string | null;
  note?: string | null;
  summary?: string | null;
  designSystemRef?: DesignSystemRef | null;
  assetRefs?: string[];
}

const toBytes = (buffer: Buffer): Uint8Array => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
const zip = (bytes: Uint8Array) => zstdCompressSync(bytes);
const unzip = (bytes: Uint8Array) => toBytes(zstdDecompressSync(bytes));

export function actorFromKey(key: string): Actor {
  return key === 'human' ? { kind: 'human' } : ({ kind: 'session', appSessionId: key.slice('session:'.length) } as Actor);
}

export class VersionStore {
  // The last written version's state per artifact, so the next delta needs no reconstruction.
  private readonly last = new Map<string, { id: number; seq: number; state: Uint8Array }>();

  constructor(private readonly db: DatabaseSync) {}

  private row(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  latest(artifactId: string): Row | undefined {
    return this.row('SELECT * FROM artifact_versions WHERE artifactId = ? ORDER BY id DESC LIMIT 1', artifactId);
  }

  get(artifactId: string, version: number | { seq: number }): Row | undefined {
    return typeof version === 'number'
      ? this.row('SELECT * FROM artifact_versions WHERE artifactId = ? AND id = ?', artifactId, version)
      : this.row('SELECT * FROM artifact_versions WHERE artifactId = ? AND seq = ? ORDER BY id DESC LIMIT 1', artifactId, version.seq);
  }

  list(artifactId: string): ArtifactVersion[] {
    const rows = this.db.prepare('SELECT * FROM artifact_versions WHERE artifactId = ? ORDER BY id').all(artifactId) as unknown as Row[];
    return rows.map(toVersion);
  }

  // One version as history lists it.
  version(artifactId: string, versionId: number): ArtifactVersion | undefined {
    const row = this.get(artifactId, versionId);
    return row && toVersion(row);
  }

  // A Y kind's version of `state` (the doc's V2 state at `seq`). Answers the row's id. When the latest version already
  // captured `seq`, an `auto` is not written again, and another kind upgrades an `auto` there in place. A doc never
  // written gets no `auto`, unless the version is a design-system pin's target (`pinTarget`): a pin needs a row.
  writeState(artifactId: string, seq: number, state: Uint8Array, meta: VersionMeta, options: { pinTarget?: boolean } = {}): number | null {
    const latest = this.latest(artifactId);
    if (meta.kind === 'auto' && !latest && seq === 0 && !options.pinTarget) return null; // nothing moved
    if (latest && latest.seq === seq) {
      if (meta.kind === 'auto') return null;
      if (latest.kind === 'auto') return this.upgrade(latest.id, meta);
    }
    let enc: 'full' | 'delta' = 'full';
    let bytes = zip(state);
    if (latest?.enc) {
      const delta = zip(versionDelta(this.state(artifactId, latest.id), state));
      const keyframe = this.row("SELECT id, length(bytes) AS size FROM artifact_versions WHERE artifactId = ? AND enc = 'full' ORDER BY id DESC LIMIT 1", artifactId) as unknown as { id: number; size: number } | undefined;
      const chain = keyframe
        ? (this.db.prepare("SELECT COALESCE(SUM(length(bytes)), 0) AS n FROM artifact_versions WHERE artifactId = ? AND id > ? AND enc = 'delta'").get(artifactId, keyframe.id) as { n: number }).n
        : Infinity;
      if (keyframe && chain + delta.length <= keyframe.size) {
        enc = 'delta';
        bytes = delta;
      }
    }
    const id = this.insert(artifactId, seq, meta, { enc, bytes, content: null });
    this.last.set(artifactId, { id, seq, state });
    return id;
  }

  // A byte kind's version of one write.
  writeContent(artifactId: string, seq: number, content: ContentRef, meta: VersionMeta): number {
    return this.insert(artifactId, seq, meta, { enc: null, bytes: null, content: JSON.stringify(content) });
  }

  private insert(artifactId: string, seq: number, meta: VersionMeta, body: { enc: 'full' | 'delta' | null; bytes: Uint8Array | null; content: string | null }): number {
    const result = this.db
      .prepare(
        'INSERT INTO artifact_versions (artifactId, seq, at, actor, kind, label, note, summary, enc, bytes, content, designSystemRef, assetRefs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        artifactId,
        seq,
        meta.at,
        meta.actor,
        meta.kind,
        meta.label ?? null,
        meta.note ?? null,
        meta.summary ?? null,
        body.enc,
        body.bytes,
        body.content,
        meta.designSystemRef ? JSON.stringify(meta.designSystemRef) : null,
        JSON.stringify(meta.assetRefs ?? []),
      );
    return Number(result.lastInsertRowid);
  }

  // An `auto` row taking the metadata of the version written at its seq, the pin and the asset refs as they are now (a
  // null pin clears it; omitted ones are kept). A name the owner gave the auto row stays unless the version brings one.
  private upgrade(id: number, meta: VersionMeta): number {
    const named = meta.label !== undefined && meta.label !== null;
    const set: [string, SQLInputValue][] = [
      ['kind', meta.kind],
      ['actor', meta.actor],
      ['at', meta.at],
      ['summary', meta.summary ?? null],
    ];
    if (named) set.push(['label', meta.label!], ['note', meta.note ?? null]);
    if (meta.designSystemRef !== undefined) set.push(['designSystemRef', meta.designSystemRef ? JSON.stringify(meta.designSystemRef) : null]);
    if (meta.assetRefs !== undefined) set.push(['assetRefs', JSON.stringify(meta.assetRefs)]);
    this.db.prepare(`UPDATE artifact_versions SET ${set.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`).run(...set.map(([, value]) => value), id);
    return id;
  }

  // Names a version (Decision Log 37d): its label and note become these, its kind and everything else stay.
  name(id: number, label: string, note: string | null): void {
    this.db.prepare('UPDATE artifact_versions SET label = ?, note = ? WHERE id = ?').run(label, note, id);
  }

  // A Y kind's version state (V2): its keyframe merged with the deltas after it (Decision Log 22c).
  state(artifactId: string, versionId: number): Uint8Array {
    const target = this.get(artifactId, versionId);
    if (!target?.enc) throw new Error(`no state for version ${versionId} of ${artifactId}`);
    // A doc's state at a revision is fixed by its log, so a cached state stands for any row of that id and seq (an id a
    // taken-back write used may be reused).
    const cached = this.last.get(artifactId);
    if (cached?.id === versionId && cached.seq === target.seq) return cached.state;
    const keyframe = this.row("SELECT * FROM artifact_versions WHERE artifactId = ? AND enc = 'full' AND id <= ? ORDER BY id DESC LIMIT 1", artifactId, versionId);
    if (!keyframe?.bytes) throw new Error(`version ${versionId} of ${artifactId} has no keyframe`);
    const deltas = (this.db.prepare('SELECT bytes FROM artifact_versions WHERE artifactId = ? AND id > ? AND id <= ? ORDER BY id').all(artifactId, keyframe.id, versionId) as { bytes: Uint8Array }[]).map((row) => unzip(row.bytes));
    const base = unzip(keyframe.bytes);
    return deltas.length === 0 ? base : mergeV2([base, ...deltas]);
  }

  // Every (artifact, seq) a design-system pin names: those versions never thin (Decision Log 8, 22b).
  pinned(): Set<string> {
    const refs = this.db.prepare('SELECT DISTINCT designSystemRef FROM artifact_versions WHERE designSystemRef IS NOT NULL').all() as { designSystemRef: string }[];
    return new Set(refs.map(({ designSystemRef }) => {
      const ref = JSON.parse(designSystemRef) as DesignSystemRef;
      return `${ref.id}\u0000${ref.versionSeq}`;
    }));
  }

  // The rows thinning drops for one artifact at `now` (unnamed autos only; never the newest or a pinned one).
  thinnable(artifactId: string, now: number, pinned: Set<string>): number[] {
    const rows = this.db.prepare('SELECT id, seq, at, kind, label FROM artifact_versions WHERE artifactId = ? ORDER BY id').all(artifactId) as { id: number; seq: number; at: number; kind: VersionKind; label: string | null }[];
    if (rows.length === 0) return [];
    const newest = rows[rows.length - 1].id;
    const winners = new Map<string, number>();
    const candidates: number[] = [];
    for (const row of rows) {
      if (row.kind !== 'auto' || row.label !== null || row.id === newest || pinned.has(`${artifactId}\u0000${row.seq}`)) continue;
      const age = now - row.at;
      if (age < DAY) continue;
      candidates.push(row.id);
      const bucket = age < WEEK ? `h${floor(row.at, HOUR)}` : age < 30 * DAY ? `d${floor(row.at, DAY)}` : `w${MONDAY0 + floor(row.at - MONDAY0, WEEK)}`;
      winners.set(bucket, row.id); // rows ascend, so the bucket keeps its newest
    }
    const keep = new Set(winners.values());
    return candidates.filter((id) => !keep.has(id));
  }

  // Deletes versions of one artifact, folding each dropped Y-kind row into the next retained one (a dropped keyframe
  // makes that row a keyframe); answers the content refs of dropped byte-kind rows, whose files the caller deletes
  // once this commits.
  drop(artifactId: string, ids: number[]): ContentRef[] {
    if (ids.length === 0) return [];
    const dropped = new Set(ids);
    const rows = this.db.prepare('SELECT id, enc, bytes, content FROM artifact_versions WHERE artifactId = ? ORDER BY id').all(artifactId) as unknown as Pick<Row, 'id' | 'enc' | 'bytes' | 'content'>[];
    let carry: Uint8Array[] = [];
    let carryFull = false;
    const files: ContentRef[] = [];
    for (const row of rows) {
      if (dropped.has(row.id)) {
        if (row.content) files.push(JSON.parse(row.content) as ContentRef);
        if (!row.bytes) continue;
        if (row.enc === 'full') {
          carry = [unzip(row.bytes)];
          carryFull = true;
        } else carry.push(unzip(row.bytes));
        continue;
      }
      if (carry.length === 0 || !row.bytes) continue;
      if (row.enc === 'full') {
        carry = [];
        carryFull = false;
        continue;
      }
      const merged = mergeV2([...carry, unzip(row.bytes)]);
      this.db.prepare('UPDATE artifact_versions SET bytes = ?, enc = ? WHERE id = ?').run(zip(carryFull ? canonicalV2(merged) : merged), carryFull ? 'full' : 'delta', row.id);
      carry = [];
      carryFull = false;
    }
    const remove = this.db.prepare('DELETE FROM artifact_versions WHERE id = ?');
    for (const id of ids) remove.run(id);
    this.last.delete(artifactId);
    return files;
  }

  // The owner's "Delete versions older than…" (Decision Log 8): every kind but pinned states; a byte kind keeps its
  // newest version (it names the live content).
  prunable(artifactId: string, olderThan: number, pinned: Set<string>, byteKind: boolean): number[] {
    const rows = this.db.prepare('SELECT id, seq FROM artifact_versions WHERE artifactId = ? AND at < ? ORDER BY id').all(artifactId, olderThan) as { id: number; seq: number }[];
    const newest = this.latest(artifactId)?.id;
    return rows.filter((row) => !pinned.has(`${artifactId}\u0000${row.seq}`) && !(byteKind && row.id === newest)).map((row) => row.id);
  }

  // Forgets cached states (a transaction that wrote versions was taken back).
  forget(artifactId?: string): void {
    if (artifactId === undefined) this.last.clear();
    else this.last.delete(artifactId);
  }
}

function toVersion(row: Row): ArtifactVersion {
  return {
    id: row.id,
    seq: row.seq,
    at: row.at,
    actor: actorFromKey(row.actor),
    kind: row.kind,
    ...(row.label === null ? {} : { label: row.label }),
    ...(row.note === null ? {} : { note: row.note }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    ...(row.designSystemRef === null ? {} : { designSystemRef: JSON.parse(row.designSystemRef) as DesignSystemRef }),
    assetRefs: JSON.parse(row.assetRefs) as string[],
  };
}
