import type { AppSessionId, SessionId } from '@shared/graph/ids';
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
  replace(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number, body: string, complete = true): void {
    this.db.transaction(() => {
      // A deleted/rebound session must never get an old in-flight read attached to it.
      if (!this.db.get('SELECT 1 FROM sessions WHERE app_id = ? AND engine_session_id = ?', appId, sessionId)) return;
      this.db.run("INSERT INTO session_text_state(app_id, session_id, size, mtime_ms, status) VALUES (?, ?, ?, ?, 'indexing') ON CONFLICT(app_id) DO UPDATE SET session_id=excluded.session_id, size=excluded.size, mtime_ms=excluded.mtime_ms, status='indexing', tail=''", appId, sessionId, size, mtimeMs);
      this.db.run('DELETE FROM session_text_chunks WHERE app_id = ?', appId);
      this.append(appId, sessionId, body, complete);
    });
  }
  append(appId: AppSessionId, sessionId: SessionId, body: string, complete: boolean): void {
    this.db.transaction(() => {
      const state = this.db.get<{ tail: string }>("SELECT st.tail FROM session_text_state st JOIN sessions s ON s.app_id = st.app_id AND s.engine_session_id = st.session_id WHERE st.app_id = ? AND st.session_id = ? AND st.status = 'indexing'", appId, sessionId);
      if (!state) return;
      const text = state.tail + body;
      if (body) {
        const chunk = this.db.prepare('INSERT INTO session_text_chunks(app_id) VALUES (?)').run(appId).lastInsertRowid;
        this.db.run('INSERT INTO session_text(rowid, body) VALUES (?, ?)', chunk, text);
      }
      this.db.run('UPDATE session_text_state SET tail = ?, status = ? WHERE app_id = ?', text.slice(-OVERLAP), complete ? 'ready' : 'indexing', appId);
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
  search(raw: string, limit = 50): SessionSearchHit[] {
    const query = raw.trim();
    const titles = this.db.all<SessionSearchHit>(`SELECT s.app_id AS appSessionId, NULL AS snippet FROM sessions s WHERE s.archived = 0 AND instr(lower(${TITLE}), lower(?)) > 0 ORDER BY s.updated_at DESC, s.app_id LIMIT ?`, query, limit);
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
      WHERE s.archived = 0 AND ${where} AND instr(lower(${TITLE}), lower(?)) = 0
    ) SELECT appSessionId, snippet FROM (
      SELECT *, row_number() OVER (PARTITION BY appSessionId ORDER BY id) AS ordinal FROM matches
    ) WHERE ordinal = 1 ORDER BY updated_at DESC, appSessionId LIMIT ?`, ...(long ? [] : [query]), long ? `"${query.replaceAll('"', '""')}"` : query, query, limit - titles.length);
    return [...titles, ...rows];
  }
}
