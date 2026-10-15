// A project's log as its `Project` object stores it (SQLite): each event once, keyed by `(writer, seq)`, with a project
// offset in arrival order beside it, never inside it; each writer's last seq; and the project's audit record. Events
// are kept as received (a `hub/` event with the `writer`, `seq`, and `ts` the hub assigned) and compared by their
// canonical form, so a second copy of an event differs from the first only if its canonical form does.
import { isBase64urlOf } from '../protocol/base64url';
import { canonicalize } from '../protocol/canonical';
import { isHubWriter, isLogSeq, type LogEvent, type Vector } from '../protocol/log';
import { FRAME_LIMIT } from '../protocol/parts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  offset INTEGER PRIMARY KEY AUTOINCREMENT, writer TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, nonce TEXT,
  UNIQUE (writer, seq));
CREATE INDEX IF NOT EXISTS events_by_nonce ON events (nonce) WHERE nonce IS NOT NULL;
CREATE TABLE IF NOT EXISTS writers (writer TEXT PRIMARY KEY, last INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, entry TEXT NOT NULL);
`;

/** Bytes of event JSON per frame the hub sends; a larger batch is split across frames, a larger frame into parts. */
export const BATCH_BYTES = 256 * 1024;

const encoder = new TextEncoder();
const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

export type Stored = { offset: number; event: LogEvent };
export type AuditKind = 'refused' | 'rejected';
export type AuditRow = { id: number; at: string; kind: AuditKind; entry: Record<string, unknown> };

/**
 * Why an event is not one the hub can store, or null when it can: a writer of the form `<prefix>/<rest>` without
 * control characters, a positive integer seq, string `ts` and `kind`, a `mac` whose nonce and value are canonical
 * base64url, a form RFC 8785 admits, and at most 1 MiB. The hub holds no key and checks no code.
 */
export function eventShapeError(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return 'an event is a JSON object';
  const e = event as Record<string, unknown>;
  if (typeof e.writer !== 'string' || !/^[^/]+\/.+$/.test(e.writer) || e.writer.length > 256 || hasControl(e.writer)) {
    return 'writer is <machine>/<feed>, without control characters';
  }
  if (!isLogSeq(e.seq)) return 'seq is a positive integer';
  if (typeof e.ts !== 'string' || typeof e.kind !== 'string') return 'ts and kind are strings';
  const mac = e.mac as { nonce?: unknown; value?: unknown } | undefined;
  // DX1: one spelling per value. A variant the hub stored would reach every daemon as an event it refuses.
  if (typeof mac !== 'object' || mac === null || !isBase64urlOf(mac.nonce, 16) || !isBase64urlOf(mac.value, 32)) {
    return 'mac is {nonce, value}: 16 and 32 bytes, each in canonical base64url';
  }
  try {
    if (encoder.encode(canonicalize(event)).length > FRAME_LIMIT) return 'an event is at most 1 MiB';
  } catch (error) {
    return `not canonical JSON: ${(error as Error).message}`;
  }
  return null;
}

export class LogStore {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(SCHEMA);
  }

  private get sql() {
    return this.storage.sql;
  }

  /** The latest offset; 0 for an empty log. */
  head(): number {
    return this.sql.exec<{ head: number | null }>('SELECT MAX(offset) AS head FROM events').one().head ?? 0;
  }

  vector(): Vector {
    const out: Vector = {};
    for (const { writer, last } of this.sql.exec<{ writer: string; last: number }>('SELECT writer, last FROM writers ORDER BY writer')) out[writer] = last;
    return out;
  }

  last(writer: string): number {
    return this.sql.exec<{ last: number }>('SELECT last FROM writers WHERE writer = ?', writer).toArray()[0]?.last ?? 0;
  }

  at(writer: string, seq: number): Stored | undefined {
    const row = this.sql.exec<{ offset: number; body: string }>('SELECT offset, body FROM events WHERE writer = ? AND seq = ?', writer, seq).toArray()[0];
    return row && { offset: row.offset, event: JSON.parse(row.body) as LogEvent };
  }

  /** A `hub/` event by its writer and `mac.nonce` (a web `human` sent again). */
  byNonce(writer: string, nonce: string): Stored | undefined {
    const row = this.sql.exec<{ offset: number; body: string }>('SELECT offset, body FROM events WHERE nonce = ? AND writer = ?', nonce, writer).toArray()[0];
    return row && { offset: row.offset, event: JSON.parse(row.body) as LogEvent };
  }

  /** Appends the event at `last(writer) + 1`, which the caller has checked; returns its offset. */
  append(event: LogEvent): Stored {
    let offset = 0;
    this.storage.transactionSync(() => {
      offset = this.sql
        .exec<{ offset: number }>(
          'INSERT INTO events (writer, seq, body, nonce) VALUES (?, ?, ?, ?) RETURNING offset',
          event.writer,
          event.seq,
          JSON.stringify(event),
          isHubWriter(event.writer) ? event.mac.nonce : null,
        )
        .one().offset;
      this.sql.exec('INSERT INTO writers (writer, last) VALUES (?, ?) ON CONFLICT (writer) DO UPDATE SET last = excluded.last', event.writer, event.seq);
    });
    return { offset, event };
  }

  /** Every event after `offset`, in offset order, in batches of about BATCH_BYTES. */
  *after(offset: number): Generator<Stored[]> {
    yield* batches(
      this.sql.exec<{ offset: number; body: string }>('SELECT offset, body FROM events WHERE offset > ? ORDER BY offset', offset),
      (row) => row.body,
      (row) => ({ offset: row.offset, event: JSON.parse(row.body) as LogEvent }),
    );
  }

  /** Every writer's events past `have` (the suffix a machine lacks), each writer's in seq order, in batches. */
  *beyond(have: Vector): Generator<LogEvent[]> {
    for (const writer of Object.keys(this.vector())) {
      const from = have[writer] ?? 0;
      yield* batches(
        this.sql.exec<{ body: string }>('SELECT body FROM events WHERE writer = ? AND seq > ? ORDER BY seq', writer, from),
        (row) => row.body,
        (row) => JSON.parse(row.body) as LogEvent,
      );
    }
  }

  record(kind: AuditKind, entry: Record<string, unknown>): AuditRow {
    const at = new Date().toISOString();
    const id = this.sql.exec<{ id: number }>('INSERT INTO audit (at, kind, entry) VALUES (?, ?, ?) RETURNING id', at, kind, JSON.stringify(entry)).one().id;
    return { id, at, kind, entry };
  }

  /** The audit record's latest `limit` entries, oldest first. */
  audit(limit: number): AuditRow[] {
    return this.sql
      .exec<{ id: number; at: string; kind: AuditKind; entry: string }>('SELECT id, at, kind, entry FROM audit ORDER BY id DESC LIMIT ?', limit)
      .toArray()
      .reverse()
      .map((row) => ({ ...row, entry: JSON.parse(row.entry) as Record<string, unknown> }));
  }
}

/** Two events are one when their canonical forms are equal (the order of keys, say, is not a difference). */
export function sameEvent(a: object, b: object): boolean {
  return canonicalize(a) === canonicalize(b);
}

function* batches<R, T>(rows: Iterable<R>, text: (row: R) => string, value: (row: R) => T): Generator<T[]> {
  let batch: T[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = text(row).length;
    if (batch.length > 0 && bytes + size > BATCH_BYTES) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(value(row));
    bytes += size;
  }
  if (batch.length > 0) yield batch;
}
