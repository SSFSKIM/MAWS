// The agent's browser activity (cua board #93; index migration 6's `browser_activity`): what main told the windows an
// agent did in the in-app browser through cua (src/shared/browser/activity.ts), so the rows a transcript shows under the
// agent's cua_repl `js` call survive an app restart as they survive a window reload. One row per activity, in the order
// it was told; each session keeps its last BROWSER_ACTIVITIES_KEPT, and a row goes with its session's record (ON DELETE
// CASCADE). Main's activity feed (src/main/browser/cua/activity.ts) loads a session's rows on first use and writes what
// it told each tick through. The rows are a convenience, so an unavailable index (a newer app's file) keeps and answers
// nothing, and a write never waits: it goes over a connection of its own with no busy timeout, so a write lock another
// connection holds fails it at once (SQLITE_BUSY) instead of stalling main's event loop for the index's 2 s timeout.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { BROWSER_ACTIVITIES_KEPT, BrowserAgentActivitySchema, type BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import type { Db } from './db';

interface Row {
  app_session_id: string;
  tab_id: string;
  at: string;
  activity: string;
}

interface Writer {
  db: DatabaseSync;
  insert: StatementSync;
  prune: StatementSync;
}

export class BrowserActivityStore {
  private writer: Writer | null = null; // opened on the first write
  private closed = false;
  private readonly flushers = new Set<() => void>();

  constructor(
    private readonly db: Db,
    private readonly path: string,
  ) {}

  // The session's last `keep` activities, oldest first. A row this app cannot read (a later app's kind) is skipped, so
  // one never costs a window the rest of the list.
  list(appSessionId: AppSessionId, keep = BROWSER_ACTIVITIES_KEPT): BrowserAgentActivity[] {
    if (this.db.readOnly) return [];
    const rows = this.db.all<Row>(
      'SELECT app_session_id, tab_id, at, activity FROM (SELECT id, app_session_id, tab_id, at, activity FROM browser_activity WHERE app_session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id',
      appSessionId, keep,
    );
    return rows.flatMap((row) => {
      const parsed = BrowserAgentActivitySchema.safeParse({ appSessionId: row.app_session_id, tabId: row.tab_id, at: row.at, activity: parseJson(row.activity) });
      return parsed.success ? [parsed.data] : [];
    });
  }

  // Activities after their sessions' others, in one transaction, each session's oldest beyond `keep` dropped. A
  // session with no record keeps nothing (there is no transcript to show it in). Throws when the transaction cannot
  // start or commit (SQLITE_BUSY at once while another connection writes); nothing is written then. After `close`,
  // nothing is written.
  append(told: readonly BrowserAgentActivity[], keep = BROWSER_ACTIVITIES_KEPT): void {
    if (this.db.readOnly || this.closed || told.length === 0) return;
    const writer = (this.writer ??= openWriter(this.path));
    writer.db.exec('BEGIN IMMEDIATE');
    try {
      for (const { appSessionId, tabId, at, activity } of told) writer.insert.run(appSessionId, tabId, at, JSON.stringify(activity));
      for (const appSessionId of new Set(told.map((row) => row.appSessionId))) writer.prune.run(appSessionId, keep);
      writer.db.exec('COMMIT');
    } catch (error) {
      if (writer.db.isTransaction) writer.db.exec('ROLLBACK');
      throw error;
    }
  }

  // `flush` writes what its writer still holds; it runs when the index closes, before the write connection does. At a
  // quit the index closes before the browser stops, so this is how a row told in the last tick is still written.
  beforeClose(flush: () => void): () => void {
    this.flushers.add(flush);
    return () => this.flushers.delete(flush);
  }

  // The index is closing: what the writers still hold is written, then the write connection closes.
  close(): void {
    if (this.closed) return;
    for (const flush of this.flushers) {
      try {
        flush();
      } catch (error) {
        console.warn(`[index] the browser activity's last write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.flushers.clear();
    this.closed = true;
    this.writer?.db.close();
    this.writer = null;
  }
}

function openWriter(path: string): Writer {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 0; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON');
    return {
      db,
      insert: db.prepare('INSERT INTO browser_activity (app_session_id, tab_id, at, activity) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM sessions WHERE app_id = ?1)'),
      prune: db.prepare('DELETE FROM browser_activity WHERE app_session_id = ?1 AND id <= (SELECT id FROM browser_activity WHERE app_session_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?2)'),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
