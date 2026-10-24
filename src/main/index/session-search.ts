import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { Db } from './db';

export interface SessionSearchHit { appSessionId: AppSessionId; snippet: string | null }
const TITLE = "coalesce(s.title_override, s.custom_title, s.ai_title, s.first_prompt, '')";
export class SessionSearchStore {
  constructor(private readonly db: Db) {}
  current(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number): boolean {
    return this.db.get('SELECT 1 FROM session_text_state WHERE app_id = ? AND session_id = ? AND size = ? AND mtime_ms = ?', appId, sessionId, size, mtimeMs) !== null;
  }
  replace(appId: AppSessionId, sessionId: SessionId, size: number, mtimeMs: number, body: string): void {
    this.db.transaction(() => {
      // A deleted/rebound session must never get an old in-flight read attached to it.
      if (!this.db.get('SELECT 1 FROM sessions WHERE app_id = ? AND engine_session_id = ?', appId, sessionId)) return;
      this.db.run('INSERT INTO session_text_state(app_id, session_id, size, mtime_ms) VALUES (?, ?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET session_id=excluded.session_id, size=excluded.size, mtime_ms=excluded.mtime_ms', appId, sessionId, size, mtimeMs);
      const { rowid } = this.db.get<{ rowid: number }>('SELECT rowid FROM session_text_state WHERE app_id = ?', appId)!;
      this.db.run('DELETE FROM session_text WHERE rowid = ?', rowid);
      this.db.run('INSERT INTO session_text(rowid, body) VALUES (?, ?)', rowid, body);
    });
  }
  indexing(): boolean {
    return this.db.get(`SELECT 1 FROM sessions s LEFT JOIN session_text_state st ON st.app_id = s.app_id
      WHERE s.archived = 0 AND s.transcript_path IS NOT NULL AND (st.app_id IS NULL OR st.session_id != s.engine_session_id OR st.size != s.transcript_size OR st.mtime_ms != s.transcript_mtime_ms) LIMIT 1`) !== null;
  }
  search(raw: string, limit = 50): SessionSearchHit[] {
    const query = raw.trim();
    const titles = this.db.all<SessionSearchHit>(`SELECT s.app_id AS appSessionId, NULL AS snippet FROM sessions s WHERE s.archived = 0 AND instr(lower(${TITLE}), lower(?)) > 0 ORDER BY s.updated_at DESC, s.app_id LIMIT ?`, query, limit);
    if (!query || titles.length === limit) return titles;
    const long = [...query].length >= 3;
    const where = long ? 'session_text MATCH ?' : 'instr(lower(session_text.body), lower(?)) > 0';
    const snippet = long ? "snippet(session_text, 0, '', '', '…', 48)" : 'substr(session_text.body, max(1, instr(lower(session_text.body), lower(?)) - 60), 180)';
    const rows = this.db.all<SessionSearchHit>(`SELECT s.app_id AS appSessionId, ${snippet} AS snippet FROM session_text JOIN session_text_state st ON st.rowid = session_text.rowid JOIN sessions s ON s.app_id = st.app_id AND s.engine_session_id = st.session_id WHERE s.archived = 0 AND ${where} AND instr(lower(${TITLE}), lower(?)) = 0 ORDER BY s.updated_at DESC, s.app_id LIMIT ?`, ...(long ? [] : [query]), long ? `"${query.replaceAll('"', '""')}"` : query, query, limit - titles.length);
    return [...titles, ...rows];
  }
}
