// The project channel's journal (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b, Interfaces
// §O; the index's ADDED_TABLES): the to-human entries this machine's sessions wrote, per org project, as `channel.history`
// pages them. An entry is recorded once by its `src` (a resend, a replayed batch or a state stated again adds nothing),
// and the journal keeps the newest CHANNEL_BOUNDS.perProject of each project and nothing older than
// CHANNEL_BOUNDS.maxAgeMs: pruned at each record and at start, and never read past the age bound in between. An entry's
// words are kept to a size the desk hub carries as one event, cut with a visible marker past it (`boundedEntry`).
import type { HostEntry, NewHostEntry } from '@shared/ipc/schema/channel';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { Db } from '../index/db';

export const CHANNEL_BOUNDS = {
  perProject: 2_000,
  maxAgeMs: 30 * 24 * 60 * 60_000,
  // What one entry's words may take, in UTF-8 bytes, and a question's options. The desk hub refuses an event over 1 MiB of
  // canonical JSON (apps/desk-hub/src/objects/log-store.ts:79, FRAME_LIMIT at apps/desk-hub/src/protocol/parts.ts:5);
  // the entry rides in one with its envelope, possibly sealed (base64, 4/3) after JSON's escaping (up to 6 bytes for a
  // control character's one), so its words are held to an eighth of that and less: 64 KiB of text and 32 options of 512
  // bytes, 80 KiB, at most 640 KiB on the wire.
  textBytes: 64 * 1024,
  choiceBytes: 512,
  choices: 32,
  // What lane B holds while a session's project waits for its org id at start (./lane-b.ts), the oldest let go past it.
  held: 1_000,
} as const;

// What ends a text cut at its bound.
export const CUT_MARKER = '\n… [cut]';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The text whole when it fits `bytes`, else cut at a character and ended with CUT_MARKER, `bytes` in all.
function cut(text: string, bytes: number): string {
  const encoded = encoder.encode(text);
  if (encoded.length <= bytes) return text;
  let end = bytes - encoder.encode(CUT_MARKER).length;
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end -= 1; // a continuation byte: back to its character's start
  return decoder.decode(encoded.subarray(0, end)) + CUT_MARKER;
}

// The entry with its words within CHANNEL_BOUNDS: its text and each option cut at their bound, and no option past the
// count.
export function boundedEntry(entry: NewHostEntry): NewHostEntry {
  const text = cut(entry.text, CHANNEL_BOUNDS.textBytes);
  if (entry.choices === undefined) return text === entry.text ? entry : { ...entry, text };
  return { ...entry, text, choices: entry.choices.slice(0, CHANNEL_BOUNDS.choices).map((choice) => cut(choice, CHANNEL_BOUNDS.choiceBytes)) };
}

interface EntryRow {
  id: number;
  project: string;
  app_session_id: string | null;
  engine_session_id: string | null;
  lane: HostEntry['lane'];
  kind: HostEntry['kind'];
  text: string;
  choices: string | null; // JSON, a question's options
  at: number; // epoch ms
  src: string;
}

const entryOf = (row: EntryRow): HostEntry => ({
  id: String(row.id), project: row.project, appSessionId: row.app_session_id as AppSessionId | null, engineSessionId: row.engine_session_id as SessionId | null,
  lane: row.lane, kind: row.kind, text: row.text, ...(row.choices === null ? {} : { choices: JSON.parse(row.choices) as string[] }), at: new Date(row.at).toISOString(), src: row.src,
});

const NEWEST_FIRST = 'ORDER BY at DESC, id DESC';

export class ChannelJournal {
  constructor(private readonly db: Db) {}

  /**
   * The entry as the journal now holds it; null when its `src` is already recorded, or when the bounds would not keep it
   * (older than the age bound, or than every entry its project keeps). `entry.at` is a valid ISO-8601 time (the schema's).
   * Its words are kept within CHANNEL_BOUNDS (`boundedEntry`).
   */
  record(said: NewHostEntry, now: number): HostEntry | null {
    const entry = boundedEntry(said);
    const at = Date.parse(entry.at);
    return this.db.transaction(() => {
      const added = this.db.run(
        'INSERT INTO channel_entries (project, app_session_id, engine_session_id, lane, kind, text, choices, at, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(src) DO NOTHING',
        entry.project, entry.appSessionId, entry.engineSessionId, entry.lane, entry.kind, entry.text, entry.choices === undefined ? null : JSON.stringify(entry.choices), at, entry.src,
      );
      if (added === 0) return null;
      this.prune(now, entry.project);
      const row = this.db.get<EntryRow>('SELECT * FROM channel_entries WHERE src = ?', entry.src);
      return row === null ? null : entryOf(row);
    });
  }

  // Whether an entry of this `src` is held (lane B answers only a question it recorded).
  has(src: string): boolean {
    return this.db.get('SELECT 1 AS held FROM channel_entries WHERE src = ?', src) !== null;
  }

  /** A project's entries, newest first (one time ordered by arrival), `limit` of them from before the entry `before` names. */
  history({ project, before, limit }: { project: string; before?: string; limit: number }, now: number): { entries: HostEntry[]; more: boolean } {
    const cutoff = now - CHANNEL_BOUNDS.maxAgeMs;
    let rows: EntryRow[];
    if (before === undefined) {
      rows = this.db.all<EntryRow>(`SELECT * FROM channel_entries WHERE project = ? AND at >= ? ${NEWEST_FIRST} LIMIT ?`, project, cutoff, limit + 1);
    } else {
      const cursor = /^[1-9][0-9]{0,15}$/.test(before) ? this.db.get<Pick<EntryRow, 'id' | 'at'>>('SELECT id, at FROM channel_entries WHERE id = ? AND project = ?', Number(before), project) : null;
      if (cursor === null || cursor.at < cutoff) return { entries: [], more: false }; // pruned past the bounds, with all before it
      rows = this.db.all<EntryRow>(
        `SELECT * FROM channel_entries WHERE project = ? AND at >= ? AND (at < ? OR (at = ? AND id < ?)) ${NEWEST_FIRST} LIMIT ?`,
        project, cutoff, cursor.at, cursor.at, cursor.id, limit + 1,
      );
    }
    return { entries: rows.slice(0, limit).map(entryOf), more: rows.length > limit };
  }

  // Every entry past the age bound; and, given a project, its entries past the newest CHANNEL_BOUNDS.perProject.
  prune(now: number, project?: string): void {
    this.db.run('DELETE FROM channel_entries WHERE at < ?', now - CHANNEL_BOUNDS.maxAgeMs);
    if (project === undefined) return;
    this.db.run(
      `DELETE FROM channel_entries WHERE id IN (SELECT id FROM channel_entries WHERE project = ? ${NEWEST_FIRST} LIMIT -1 OFFSET ?)`,
      project, CHANNEL_BOUNDS.perProject,
    );
  }
}
