// The index's schema history (C4 execution document, Interfaces "Index"; residue *Index schema and location*). An
// ordered list: version N is the N-th entry, applied once, inside the one transaction that opens a database behind the
// app, with `PRAGMA user_version` recording the last applied. Never edit a released entry; append.
export interface Migration {
  version: number;
  sql: string;
}

// A column a released entry was amended to add after some database had already applied it, so that database lacks it.
// The opener adds each one missing from a database at or past `version`, before the pending entries (which are written
// against the amended history) and in their transaction. `definition` is what follows the column name in
// `ALTER TABLE … ADD COLUMN`, so SQLite's limits on an added column apply to it. A repair holds at every later version
// (a branch without it may have carried a database past the amended entry), so a later entry that drops or renames the
// column, or its table, must bound the repair to the versions before it, or the opener would add the column back.
export interface Repair {
  version: number; // the amended entry
  table: string;
  column: string;
  definition: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    // The five tables of §4.4 as amended: what the engine does not hold. `sessions.summary` (beyond the document's
    // column list, advisory) keeps the last TranscriptSummary whole, so `SessionStore.summaries()` answers what discovery
    // said without a column per fact; the named columns stay for queries and the Title rule. `sessions.removed_at` marks
    // an archive made by `fs.sessionRemoved` (not the owner's), which a returning transcript lifts (whole-branch review).
    // It was amended into this entry in the belief that v1 was unshipped; it had shipped, and the owner's database,
    // created before the amendment, reached version 3 without the column (REPAIRS below adds it). The lesson: a released
    // entry is never amended, even one believed unshipped; a repair entry carries the fix.
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
  {
    version: 3,
    // W9 (H2; waves plan §2 H): `HEAD` and the empty string are not branch names (the engine writes `HEAD` for a folder
    // that is no repository and for a detached checkout alike). Discovery stores null for them from now on; the rows an
    // earlier summary filled are cleared once here, the kept summary's `gitBranch` with them.
    sql: `
UPDATE sessions SET branch = NULL WHERE branch IN ('HEAD', '');
UPDATE sessions SET worktree_branch = NULL WHERE worktree_branch IN ('HEAD', '');
UPDATE sessions SET summary = json_set(summary, '$.gitBranch', json('null')) WHERE summary IS NOT NULL AND json_extract(summary, '$.gitBranch') IN ('HEAD', '');
`,
  },
  {
    version: 4,
    // E3 (P1 X11, A-16; E3 execution document, Interfaces "Index migration 4"): a session's lineage (X11 as JSON, null for a
    // root) with where it came from (`intent`: MAWS launched it so, never recomputed; `disk`: the disk rule's reading,
    // recomputed per family), the transcript's root uuid and birth time the disk rule groups and orders a fork family
    // by, and one row per side thread mirroring its two app-synthesised events. Every indexed engine transcript is
    // re-summarised once so the new columns fill: an mtime of -1, which no file has, fails the next scan's `known` match
    // while the row stays in `known` (its size kept), so a transcript deleted while MAWS was closed is still marked
    // removed; a null size would make the row bare, bound rather than known, and never checked for removal.
    sql: `
ALTER TABLE sessions ADD COLUMN lineage TEXT;
ALTER TABLE sessions ADD COLUMN lineage_source TEXT CHECK (lineage_source IN ('intent','disk'));
ALTER TABLE sessions ADD COLUMN root_uuid TEXT;
ALTER TABLE sessions ADD COLUMN transcript_birthtime_ms REAL;
CREATE INDEX sessions_root ON sessions(project_id, root_uuid);
CREATE TABLE side_threads (child_app_id TEXT PRIMARY KEY REFERENCES sessions(app_id) ON DELETE CASCADE, parent_app_id TEXT NOT NULL,
  opened_at TEXT NOT NULL, summarised_at TEXT, text TEXT, is_error INTEGER NOT NULL DEFAULT 0, turns INTEGER NOT NULL DEFAULT 0,
  last_turn_event_id TEXT);
CREATE INDEX side_threads_parent ON side_threads(parent_app_id);
UPDATE sessions SET transcript_mtime_ms = -1 WHERE kind = 'engine' AND transcript_path IS NOT NULL;
`,
  },
  // E4a start
  {
    version: 5,
    // E4a (P1 ledger §4; E4a execution document, Design §6): MAWS's own browser history, one row per (partition, url),
    // fed by the tabs' committed navigations and read by the address field's suggestions. `source` is 'imported' for a
    // row E4b brought in from a Chrome profile (kept so when MAWS visits it again); the index serves the most recent
    // rows of one partition.
    sql: `
CREATE TABLE browser_history (partition TEXT NOT NULL, url TEXT NOT NULL, title TEXT, visit_count INTEGER NOT NULL DEFAULT 0,
  typed_count INTEGER NOT NULL DEFAULT 0, last_visit_ms INTEGER NOT NULL, source TEXT NOT NULL CHECK (source IN ('maws','imported')),
  PRIMARY KEY (partition, url));
CREATE INDEX browser_history_recent ON browser_history(partition, last_visit_ms DESC);
`,
  },
  // E4a end
  {
    version: 6,
    // cua board #93: the agent's browser activity (src/shared/browser/activity.ts), so the rows a transcript shows under
    // an agent's cua_repl `js` call survive an app restart. One row per activity main told the windows, in the order it
    // told them (`id`), the session's last BROWSER_ACTIVITIES_KEPT kept; a row goes with its session's record.
    sql: `
CREATE TABLE browser_activity (id INTEGER PRIMARY KEY, app_session_id TEXT NOT NULL REFERENCES sessions(app_id) ON DELETE CASCADE,
  tab_id TEXT NOT NULL, at TEXT NOT NULL, activity TEXT NOT NULL);
CREATE INDEX browser_activity_session ON browser_activity(app_session_id, id);
`,
  },
  {
    version: 7,
    // cua board #90 (P1 ledger §4, taken 2026-10-08): an imported Chrome profile's bookmarks, a read-only mirror of its
    // `Bookmarks` file, one row per node keyed per partition and replaced whole at every sync. The three roots have no
    // parent; `(partition, parent_id, position)` serves the tree, `(partition, url)` the address field's suggestions.
    sql: `
CREATE TABLE browser_bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partition TEXT NOT NULL,
  parent_id INTEGER,            -- NULL for the three roots
  root TEXT NOT NULL CHECK (root IN ('bar','other','mobile')),
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('url','folder')),
  name TEXT NOT NULL,
  url TEXT,                     -- NULL for folders
  added_at_ms INTEGER
);
CREATE INDEX browser_bookmarks_tree ON browser_bookmarks (partition, parent_id, position);
CREATE INDEX browser_bookmarks_url ON browser_bookmarks (partition, url);
`,
  },
  // P2-C start (2026-10-09)
  {
    version: 8,
    // P2-C (the P2-C document, §10; X15's slot): the owner channel. `owner_channel_sessions` holds per session the
    // to-human lane's override, the watermark from which marks may raise attention items, the last decided launch (its
    // desired, recorded and applied states, the flags passed, whether a wanted `--system-prompt-snapshot off` was
    // unavailable so the change waits for a compaction, the resolved style) and the style the engine reported;
    // `owner_channel_marks` holds per question and essential its state, its delivered answer (text, origin, members, time),
    // the answers still on their way (`answer_attempts`, JSON) and its times. `attention_items`
    // stays a projection of the marks: it cannot keep a delivered answer, a read time or an override once its item
    // retires. Both go with the session's record.
    sql: `
CREATE TABLE owner_channel_sessions (app_session_id TEXT PRIMARY KEY REFERENCES sessions(app_id) ON DELETE CASCADE,
  override TEXT NOT NULL DEFAULT 'inherit' CHECK (override IN ('inherit','on','off')),
  enabled_at TEXT,
  launch_id TEXT, launched_at TEXT,
  desired TEXT CHECK (desired IN ('maws-contract','external-compatible-style','off')),
  recorded TEXT,
  appended INTEGER NOT NULL DEFAULT 0, snapshot_off INTEGER NOT NULL DEFAULT 0, off_unavailable INTEGER NOT NULL DEFAULT 0,
  applied TEXT CHECK (applied IN ('maws-contract','external-compatible-style','off')),
  style TEXT, observed_style TEXT, style_mismatch INTEGER NOT NULL DEFAULT 0);
CREATE TABLE owner_channel_marks (id TEXT PRIMARY KEY,
  app_session_id TEXT NOT NULL REFERENCES sessions(app_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('need-input','essential')),
  message_uuid TEXT NOT NULL, block_index INTEGER NOT NULL, span INTEGER NOT NULL, grammar INTEGER NOT NULL,
  head TEXT NOT NULL, at TEXT NOT NULL, item INTEGER NOT NULL, live INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unanswered','queued','unconfirmed','delivered','unread','read','retired')),
  answer_text TEXT, answer_origin TEXT CHECK (answer_origin IN ('answer','reply','legacy')),
  answer_members TEXT NOT NULL DEFAULT '[]',
  answered_at TEXT, answer_attempts TEXT NOT NULL DEFAULT '[]', read_at TEXT, state_changed_at TEXT NOT NULL);
CREATE INDEX owner_channel_marks_session ON owner_channel_marks(app_session_id, state);
`,
  },
  // P2-C end
  // P3-L start (2026-10-13)
  {
    version: 9,
    // P3-L (the P3-L document, Decision Log 6; X15's slot 9): the library, a view derived from the engine host's artifact
    // store (main never opens it), rebuilt from the host's change events and replaced whole by a reconciliation at every
    // host connection. `library_artifacts` holds each live artifact as the host's `library.entry` answers it (actors as
    // `actorKey`, times in epoch ms) with the revision its indexed text was extracted at (`text_revision`, null until
    // fetched) and its row in `library_text` (`text_rowid`, so the text is reached by rowid, never by scanning the
    // unindexed id); `library_links` its session links; `library_spaces` the Spaces. `library_text` is the search index
    // over titles and extracted text: FTS5 with the trigram tokenizer (substring matching that works for Korean and for
    // identifiers). Deleted artifacts are not kept.
    sql: `
CREATE TABLE library_artifacts (id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('document','presentation','design','design_system','dashboard','html','file')),
  title TEXT NOT NULL, handle TEXT, space_id TEXT, project_id TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_viewed_at INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0, design_system_id TEXT, linked_path TEXT, agent_edits_as_suggestions INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL, last_editor TEXT NOT NULL, last_edited_at INTEGER NOT NULL,
  text_revision INTEGER, text_rowid INTEGER NOT NULL);
CREATE INDEX library_artifacts_updated ON library_artifacts(updated_at DESC);
CREATE TABLE library_links (artifact_id TEXT NOT NULL REFERENCES library_artifacts(id) ON DELETE CASCADE, app_session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('created','edited','viewed','commented')), last_at INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, app_session_id, role));
CREATE INDEX library_links_session ON library_links(app_session_id);
CREATE TABLE library_spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, linked_dir TEXT, created_at INTEGER NOT NULL);
CREATE VIRTUAL TABLE library_text USING fts5(artifact_id UNINDEXED, title, body, tokenize = 'trigram');
`,
  },
  // P3-L end
];

export const REPAIRS: readonly Repair[] = [{ version: 1, table: 'sessions', column: 'removed_at', definition: 'TEXT' }];
