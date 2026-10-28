// A project's log as its `Project` object stores it (SQLite): each event once, keyed by `(writer, seq)`, with a project
// offset in arrival order beside it, never inside it; each writer's last seq; the async questions the log holds open;
// and the project's audit record. Events are kept as received (a `hub/` event with the `writer`, `seq`, and `ts` the hub
// assigned) and compared by their canonical form, so a second copy of an event differs from the first only if its
// canonical form does.
import { isSig, machineNameKey, type HistoryLogPage, type StoredEvent } from 'org-protocol';
import { isBase64urlOf } from '../protocol/base64url';
import { canonicalize } from '../protocol/canonical';
import { isHubWriter, isLogSeq, LEGACY_WRITER_PREFIX, questionEffect, writerMachine, type LogEvent, type Vector } from '../protocol/log';
import { FRAME_LIMIT } from '../protocol/parts';

// `open_questions`: one row per async question the log holds open (`questionEffect`), kept as each event is stored.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  offset INTEGER PRIMARY KEY AUTOINCREMENT, writer TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, nonce TEXT,
  UNIQUE (writer, seq));
CREATE INDEX IF NOT EXISTS events_by_nonce ON events (nonce) WHERE nonce IS NOT NULL;
CREATE TABLE IF NOT EXISTS writers (writer TEXT PRIMARY KEY, last INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS open_questions (session TEXT NOT NULL, ask TEXT NOT NULL, machine TEXT NOT NULL, PRIMARY KEY (session, ask));
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, entry TEXT NOT NULL);
`;

/** Bytes of event JSON per frame the hub sends; a larger batch is split across frames, a larger frame into parts. */
export const BATCH_BYTES = 256 * 1024;
/** Rows one query of a backlog's page reads at most (a page ends at BATCH_BYTES first, unless events are tiny). */
const PAGE_ROWS = 1000;

const encoder = new TextEncoder();
const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

export type Stored = { offset: number; event: LogEvent };
/** An async question the log holds open: the session that asked it, the machine whose feed holds it, and its id. */
export type OpenQuestion = { machine: string; session: string; ask: string };
/** The hub's own refusals, daemons' rejections, and decisions on pending requests (from `settled`). */
export type AuditKind = 'refused' | 'rejected' | 'decided';
export type AuditRow = { id: number; at: string; kind: AuditKind; entry: Record<string, unknown> };

/**
 * Why an event is not one the hub can store, or null when it can: a writer of the form `<prefix>/<rest>` without
 * control characters, a positive integer seq, string `ts` and `kind`, DX1's `mac` or RL8's `sig` or both (O11 M5), each
 * in its canonical spelling, a form RFC 8785 admits, and at most 1 MiB. A `hub/` event's `nonce`, which a v2-only one
 * needs for its resends to be known, is 16 bytes; a `legacy/` writer is v1-only and carries a `mac`. The hub holds no
 * org key and checks no code; a `sig` is checked by the Project (signed-events.ts).
 */
export function eventShapeError(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return 'an event is a JSON object';
  const e = event as Record<string, unknown>;
  if (typeof e.writer !== 'string' || !/^[^/]+\/.+$/.test(e.writer) || e.writer.length > 256 || hasControl(e.writer)) {
    return 'writer is <machine>/<feed>, without control characters';
  }
  if (!isLogSeq(e.seq)) return 'seq is a positive integer';
  if (typeof e.ts !== 'string' || typeof e.kind !== 'string') return 'ts and kind are strings';
  if (e.mac === undefined && e.sig === undefined) return 'an event carries a mac, a sig, or both';
  const mac = e.mac as { nonce?: unknown; value?: unknown } | undefined;
  // DX1: one spelling per value. A variant the hub stored would reach every daemon as an event it refuses.
  if (mac !== undefined && (typeof mac !== 'object' || mac === null || !isBase64urlOf(mac.nonce, 16) || !isBase64urlOf(mac.value, 32))) {
    return 'mac is {nonce, value}: 16 and 32 bytes, each in canonical base64url';
  }
  if (e.sig !== undefined && !isSig(e.sig)) return 'sig is {kid, value}: 16 and 64 bytes, each in canonical base64url';
  if (isHubWriter(e.writer) && (e.nonce !== undefined || mac === undefined) && !isBase64urlOf(e.nonce, 16)) {
    return 'a hub/ event without a mac carries nonce, and a nonce is 16 bytes in canonical base64url';
  }
  if (e.writer.startsWith(LEGACY_WRITER_PREFIX) && mac === undefined) return 'a legacy/ event is v1-only: it carries a mac';
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

  /** A writer's latest event (a session's feed names the session's alias in `from`). */
  latestOf(writer: string): LogEvent | undefined {
    const row = this.sql.exec<{ body: string }>('SELECT body FROM events WHERE writer = ? ORDER BY seq DESC LIMIT 1', writer).toArray()[0];
    return row && (JSON.parse(row.body) as LogEvent);
  }

  /** A `hub/` event by its writer and its resend nonce (`resendNonce`: a web or device `human` sent again). */
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
          isHubWriter(event.writer) ? resendNonce(event) : null,
        )
        .one().offset;
      this.sql.exec('INSERT INTO writers (writer, last) VALUES (?, ?) ON CONFLICT (writer) DO UPDATE SET last = excluded.last', event.writer, event.seq);
      this.keepQuestions(event);
    });
    return { offset, event };
  }

  /**
   * The open questions as this event leaves them, applied in the transaction that stores it, so they follow the log's
   * order: each feed's in its seq order, a machine's backlog included, which is the order a session wrote its ask, its
   * answer, and its retirement. A question is keyed by its session and id, so its answer closes it under whichever name
   * its machine went by.
   *
   * Events stored before this table existed are not read into it. Of the asks open then, a bridge's is counted from the
   * pending set anyway; a log-only one (MAWS's ask, whose export landed in doperpowers 7.182.0 the same day) goes
   * uncounted until it is answered. Reading every stored body at each project's first wake after the deploy would count
   * it, and also every older ask whose end the log does not hold, for as long as its session is not retired.
   */
  private keepQuestions(event: LogEvent): void {
    const effect = questionEffect(event);
    if (effect?.kind === 'question') this.sql.exec('INSERT OR IGNORE INTO open_questions (session, ask, machine) VALUES (?, ?, ?)', effect.session, effect.ask, effect.machine);
    else if (effect?.kind === 'answered') this.sql.exec('DELETE FROM open_questions WHERE session = ? AND ask = ?', effect.session, effect.ask);
    else if (effect?.kind === 'retired') this.sql.exec('DELETE FROM open_questions WHERE session = ?', effect.session);
  }

  /** The async questions the log holds open (`keepQuestions`). */
  openQuestions(): OpenQuestion[] {
    return this.sql.exec<OpenQuestion>('SELECT machine, session, ask FROM open_questions ORDER BY rowid').toArray();
  }

  /** Every event after `offset`, in offset order, in batches of about BATCH_BYTES. */
  *after(offset: number): Generator<Stored[]> {
    yield* batches(
      this.sql.exec<{ offset: number; body: string }>('SELECT offset, body FROM events WHERE offset > ? ORDER BY offset', offset),
      (row) => row.body,
      (row) => ({ offset: row.offset, event: JSON.parse(row.body) as LogEvent }),
    );
  }

  /**
   * Every writer's events past `have` (the suffix a machine lacks) and at or before offset `head`, each writer's in seq
   * order, in batches. Each batch is read when it is asked for, by its own query, so a caller that takes one at a time
   * across awaits holds one at a time, and events stored meanwhile (past `head`) are not among them.
   */
  *beyond(have: Vector, head: number = this.head()): Generator<LogEvent[]> {
    for (const writer of Object.keys(this.vector())) {
      let after = have[writer] ?? 0;
      for (;;) {
        const [batch] = batches(
          this.sql.exec<{ body: string }>('SELECT body FROM events WHERE writer = ? AND seq > ? AND offset <= ? ORDER BY seq LIMIT ?', writer, after, head, PAGE_ROWS),
          (row) => row.body,
          (row) => JSON.parse(row.body) as LogEvent,
        );
        if (!batch) break;
        yield batch;
        after = batch[batch.length - 1].seq;
      }
    }
  }

  /**
   * Each writer `<name>/…` whose name is one of `names` (lower-cased keys), with its highest seq whose event carries no
   * `sig`: a DX1 event, which history re-attestation covers (O14 M4). A writer of v2 events alone is not among them.
   */
  dx1Writers(names: ReadonlySet<string>): Array<{ writer: string; upTo: number }> {
    const out: Array<{ writer: string; upTo: number }> = [];
    for (const writer of Object.keys(this.vector())) {
      const name = writerMachine(writer);
      if (name === null || !names.has(machineNameKey(name))) continue;
      const upTo = this.sql.exec<{ up_to: number | null }>("SELECT MAX(seq) AS up_to FROM events WHERE writer = ? AND json_extract(body, '$.sig') IS NULL", writer).one().up_to;
      if (upTo !== null) out.push({ writer, upTo });
    }
    return out;
  }

  /** A writer's events after `after`, in seq order, about `bytes` of them (one at least), and whether more follow. */
  writerPage(writer: string, after: number, bytes: number): HistoryLogPage {
    const events: StoredEvent[] = [];
    let size = 0;
    for (const row of this.sql.exec<{ body: string }>('SELECT body FROM events WHERE writer = ? AND seq > ? ORDER BY seq', writer, after)) {
      if (events.length > 0 && size + row.body.length > bytes) return { events, more: true };
      events.push(JSON.parse(row.body) as StoredEvent);
      size += row.body.length;
    }
    return { events, more: false };
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

/**
 * The nonce a `hub/` event's resend is known by: its own `nonce` (RL8's, inside its signature), or DX1's `mac.nonce`
 * for an event without one. Undefined for neither.
 */
export function resendNonce(event: { nonce?: unknown; mac?: { nonce?: unknown } }): string | undefined {
  if (typeof event.nonce === 'string') return event.nonce;
  return typeof event.mac?.nonce === 'string' ? event.mac.nonce : undefined;
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
