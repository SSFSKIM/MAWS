// The index's schema history (C4 execution document, Interfaces "Index"; residue *Index schema and location*). An
// ordered list: version N is the N-th entry, applied once, inside the one transaction that opens a database behind the
// app, with `PRAGMA user_version` recording the last applied. Never edit a released entry; append.
export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    // The five tables of §4.4 as amended: what the engine does not hold. `sessions.summary` (beyond the document's
    // column list, advisory) keeps the last TranscriptSummary whole, so `SessionStore.summaries()` answers what discovery
    // said without a column per fact; the named columns stay for queries and the Title rule. `sessions.removed_at` marks
    // an archive made by `fs.sessionRemoved` (not the owner's), which a returning transcript lifts (whole-branch review;
    // v1 is unshipped, so it is part of v1).
    sql: `
CREATE TABLE projects (id TEXT PRIMARY KEY, directory TEXT NOT NULL UNIQUE, name TEXT NOT NULL, slug TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('user','discovered')), hidden INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_activity_at TEXT);
CREATE TABLE sessions (app_id TEXT PRIMARY KEY, engine_session_id TEXT UNIQUE, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  directory TEXT NOT NULL, additional_directories TEXT NOT NULL DEFAULT '[]', worktree_path TEXT, worktree_branch TEXT, branch TEXT,
  custom_title TEXT, ai_title TEXT, title_override TEXT, title_override_engine_title TEXT, pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  holder TEXT NOT NULL DEFAULT '{"kind":"none"}', last_seen_uuid TEXT, last_seen_at TEXT, unread INTEGER NOT NULL DEFAULT 0,
  engine_version TEXT, gateway_routed INTEGER NOT NULL DEFAULT 1, gateway_base_url TEXT, gateway_auto_mode_server TEXT NOT NULL DEFAULT 'unknown',
  model_requested TEXT, model_resolved TEXT, effort TEXT, pm_requested TEXT NOT NULL DEFAULT 'auto', pm_effective TEXT NOT NULL DEFAULT 'auto', pm_refusal TEXT,
  transcript_path TEXT, transcript_size INTEGER, transcript_mtime_ms REAL, first_record_at TEXT, last_record_at TEXT, last_assistant_text TEXT, first_prompt TEXT,
  summary TEXT, removed_at TEXT,
  kind TEXT NOT NULL DEFAULT 'engine' CHECK (kind IN ('engine','replay')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX sessions_project ON sessions(project_id, archived, last_record_at DESC);
CREATE TABLE attention_items (id TEXT PRIMARY KEY, app_session_id TEXT NOT NULL REFERENCES sessions(app_id) ON DELETE CASCADE, session_id TEXT,
  kind TEXT NOT NULL, request_id TEXT, tool_use_id TEXT, task_id TEXT, agent_id TEXT, summary TEXT NOT NULL, created_at TEXT NOT NULL,
  state TEXT NOT NULL, state_changed_at TEXT NOT NULL, expires_at TEXT);
CREATE TABLE drafts (app_session_id TEXT PRIMARY KEY REFERENCES sessions(app_id) ON DELETE CASCADE, doc TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE replay_fixtures (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL UNIQUE, session_id TEXT,
  added_at TEXT NOT NULL, last_played_at TEXT);
`,
  },
  {
    version: 2,
    // X1's `gateway.routed` becomes `boolean | null`, null meaning no verification ran (a session discovered on disk, not
    // launched by MAWS). SQLite cannot drop a NOT NULL in place, so the column is rebuilt. A v1 row keeps its value only
    // where a verification wrote it: false (direct or mismatch; v1's default was 1), or true beside the verified base URL.
    // A true with no base URL is v1's default, now unknown.
    sql: `
ALTER TABLE sessions ADD COLUMN gateway_routed_v2 INTEGER;
UPDATE sessions SET gateway_routed_v2 = CASE WHEN gateway_routed = 0 OR gateway_base_url IS NOT NULL THEN gateway_routed END;
ALTER TABLE sessions DROP COLUMN gateway_routed;
ALTER TABLE sessions RENAME COLUMN gateway_routed_v2 TO gateway_routed;
`,
  },
];
