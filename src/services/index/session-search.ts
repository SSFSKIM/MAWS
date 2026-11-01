import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SearchCheckpoint } from '@shared/ipc/schema/fs';
import { SESSION_SEARCH_LIMIT } from '@shared/ipc/schema/session';
import type { Db } from './db';

export interface SessionSearchHit { appSessionId: AppSessionId; snippet: string | null }
interface TextStamp { appId: AppSessionId; sessionId: SessionId; size: number; mtimeMs: number }
const TITLE = "coalesce(json_extract(s.title_override, '$.text'), s.custom_title, s.ai_title, s.first_prompt, '')";
const SAME_STAMP = 'st.session_id = s.engine_session_id AND st.size = s.transcript_size AND st.mtime_ms = s.transcript_mtime_ms';
// session.search accepts at most 1000 UTF-16 code units. Retaining that much of
// the preceding text makes every accepted literal searchable across page edges.
const OVERLAP = 1000;

export class SessionSearchStore {
  // Even a disk-full/read-only failure must stop polling. Only stamps that could
  // not be persisted live here; ordinary failures and successes remain in SQLite.
  private readonly unpersisted = new Map<AppSessionId, TextStamp>();
  constructor(private readonly db: Db) {}
  current(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number): boolean {
    return !this.failedWrite(appId, sessionId, size, mtimeMs) && this.stamped(appId, sessionId, size, mtimeMs, 'ready');
  }
  failed(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number): boolean {
    return this.failedWrite(appId, sessionId, size, mtimeMs) || this.stamped(appId, sessionId, size, mtimeMs, 'error');
  }
  private failedWrite(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number): boolean {
    const stamp = this.unpersisted.get(appId);
    return stamp?.sessionId === sessionId && stamp.size === size && stamp.mtimeMs === mtimeMs;
  }
  private stamped(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number, status: string): boolean {
    return this.db.get('SELECT 1 FROM session_text_state WHERE app_id = ? AND session_id = ? AND size = ? AND mtime_ms = ? AND status = ?', appId, sessionId, size, mtimeMs, status) !== null;
  }
  // Where a ready text ended, for the next pass to resume at; null when the text is not ready, or was written without one.
  resume(appId: AppSessionId, sessionId: SessionId): SearchCheckpoint | null {
    const row = this.db.get<{ resume: string | null }>("SELECT st.resume FROM session_text_state st JOIN sessions s ON s.app_id = st.app_id AND s.engine_session_id = st.session_id WHERE st.app_id = ? AND st.session_id = ? AND st.status = 'ready'", appId, sessionId);
    return row?.resume ? JSON.parse(row.resume) as SearchCheckpoint : null;
  }
  replace(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number, body: string, complete = true, checkpoint: SearchCheckpoint | null = null): void {
    this.db.transaction(() => {
      // A deleted/rebound session must never get an old in-flight read attached to it.
      if (!this.db.get('SELECT 1 FROM sessions WHERE app_id = ? AND engine_session_id = ?', appId, sessionId)) return;
      this.db.run("INSERT INTO session_text_state(app_id, session_id, size, mtime_ms, status) VALUES (?, ?, ?, ?, 'indexing') ON CONFLICT(app_id) DO UPDATE SET session_id=excluded.session_id, size=excluded.size, mtime_ms=excluded.mtime_ms, status='indexing', tail='', resume=NULL", appId, sessionId, size, mtimeMs);
      this.db.run('DELETE FROM session_text_chunks WHERE app_id = ?', appId);
      this.append(appId, sessionId, body, complete, checkpoint);
    });
  }
  // The first page of a pass that carries on from `from` (a stored checkpoint's offset): the text after it joins what is
  // stored, whose tail keeps the overlap. Until the pass completes the checkpoint is gone, so a pass cut short (the
  // text is then only part-appended) is never resumed, and the next one reads the whole file. False when the stored
  // text is no longer ready at `from`.
  extend(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number, from: number, body: string, complete = true, checkpoint: SearchCheckpoint | null = null): boolean {
    return this.db.transaction(() => {
      if (this.resume(appId, sessionId)?.offset !== from) return false;
      this.db.run("UPDATE session_text_state SET size = ?, mtime_ms = ?, status = 'indexing', resume = NULL WHERE app_id = ?", size, mtimeMs, appId);
      this.append(appId, sessionId, body, complete, checkpoint);
      return true;
    });
  }
  append(appId: AppSessionId, sessionId: SessionId, body: string, complete: boolean, checkpoint: SearchCheckpoint | null = null): void {
    this.db.transaction(() => {
      const state = this.db.get<{ tail: string }>("SELECT st.tail FROM session_text_state st JOIN sessions s ON s.app_id = st.app_id AND s.engine_session_id = st.session_id WHERE st.app_id = ? AND st.session_id = ? AND st.status = 'indexing'", appId, sessionId);
      if (!state) return;
      const text = state.tail + body;
      if (body) {
        const chunk = this.db.prepare('INSERT INTO session_text_chunks(app_id) VALUES (?)').run(appId).lastInsertRowid;
        this.db.run('INSERT INTO session_text(rowid, body) VALUES (?, ?)', chunk, text);
      }
      this.db.run('UPDATE session_text_state SET tail = ?, status = ?, resume = ? WHERE app_id = ?', text.slice(-OVERLAP), complete ? 'ready' : 'indexing', complete && checkpoint ? JSON.stringify(checkpoint) : null, appId);
      if (complete) this.db.defer(`session-search:${appId}`, () => this.unpersisted.delete(appId));
    });
  }
  fail(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number): void {
    if (!this.db.get('SELECT 1 FROM sessions WHERE app_id = ? AND engine_session_id = ?', appId, sessionId)) return;
    try {
      this.db.run("INSERT INTO session_text_state(app_id, session_id, size, mtime_ms, status) VALUES (?, ?, ?, ?, 'error') ON CONFLICT(app_id) DO UPDATE SET session_id=excluded.session_id, size=excluded.size, mtime_ms=excluded.mtime_ms, status='error'", appId, sessionId, size, mtimeMs);
    } catch (error) { this.unpersisted.set(appId, { appId, sessionId, size, mtimeMs }); throw error; }
  }
  retryFailures(): void {
    this.db.run("UPDATE session_text_state SET status = 'indexing' WHERE status = 'error'");
    this.unpersisted.clear();
  }
  indexing(): boolean {
    const pending = `FROM sessions s LEFT JOIN session_text_state st ON st.app_id = s.app_id
      WHERE s.archived = 0 AND s.transcript_path IS NOT NULL AND (st.app_id IS NULL OR NOT (${SAME_STAMP}) OR st.status = 'indexing')`;
    if (this.unpersisted.size === 0) return this.db.get(`SELECT 1 ${pending} LIMIT 1`) !== null;
    return this.db.all<TextStamp>(`SELECT s.app_id AS appId, s.engine_session_id AS sessionId, s.transcript_size AS size, s.transcript_mtime_ms AS mtimeMs ${pending}`)
      .some((stamp) => !this.failedWrite(stamp.appId, stamp.sessionId, stamp.size, stamp.mtimeMs));
  }
  incomplete(): boolean {
    if (this.db.get(`SELECT 1 FROM sessions s JOIN session_text_state st ON st.app_id = s.app_id
      WHERE s.archived = 0 AND s.transcript_path IS NOT NULL AND ${SAME_STAMP} AND st.status = 'error' LIMIT 1`) !== null) return true;
    for (const stamp of this.unpersisted.values()) if (this.db.get('SELECT 1 FROM sessions WHERE app_id = ? AND engine_session_id = ? AND transcript_size = ? AND transcript_mtime_ms = ? AND archived = 0 AND transcript_path IS NOT NULL', stamp.appId, stamp.sessionId, stamp.size, stamp.mtimeMs)) return true;
    return false;
  }
  // `sessions` (P5 O7 M6): only these sessions are searched, applied before the limit in both queries, so the limit is
  // spent on them (a remote member's viewable set; the endpoint still cuts the answer itself).
  search(raw: string, limit = SESSION_SEARCH_LIMIT, sessions?: readonly AppSessionId[]): SessionSearchHit[] {
    const query = raw.trim();
    const only = sessions === undefined ? '' : 'AND s.app_id IN (SELECT value FROM json_each(?))';
    const named = sessions === undefined ? [] : [JSON.stringify(sessions)];
    const titles = this.db.all<SessionSearchHit>(`SELECT s.app_id AS appSessionId, NULL AS snippet FROM sessions s WHERE s.archived = 0 AND instr(lower(${TITLE}), lower(?)) > 0 ${only} ORDER BY s.updated_at DESC, s.app_id LIMIT ?`, query, ...named, limit);
    if (!query || titles.length === limit) return titles;
    const long = [...query].length >= 3;
    const where = long ? 'session_text MATCH ?' : 'instr(lower(session_text.body), lower(?)) > 0';
    const snippet = long ? "snippet(session_text, 0, '', '', '…', 48)" : 'substr(session_text.body, max(1, instr(lower(session_text.body), lower(?)) - 60), 180)';
    // The first matching chunk per session supplies its snippet; dedup before LIMIT.
    const rows = this.db.all<SessionSearchHit>(`WITH matches AS MATERIALIZED (
      SELECT s.app_id AS appSessionId, s.updated_at, c.id, ${snippet} AS snippet
      FROM session_text JOIN session_text_chunks c ON c.id = session_text.rowid
      JOIN session_text_state st ON st.app_id = c.app_id
      JOIN sessions s ON s.app_id = st.app_id AND s.engine_session_id = st.session_id
      WHERE s.archived = 0 AND ${where} AND instr(lower(${TITLE}), lower(?)) = 0 ${only}
    ) SELECT appSessionId, snippet FROM (
      SELECT *, row_number() OVER (PARTITION BY appSessionId ORDER BY id) AS ordinal FROM matches
    ) WHERE ordinal = 1 ORDER BY updated_at DESC, appSessionId LIMIT ?`, ...(long ? [] : [query]), long ? `"${query.replaceAll('"', '""')}"` : query, query, ...named, limit - titles.length);
    return [...titles, ...rows];
  }
}
