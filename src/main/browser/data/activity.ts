// The agent's browser activity (cua board #93; index migration 6's `browser_activity`, in the browser's own database
// since P5 O3-A): what main told the windows an agent did in the in-app browser through cua
// (src/shared/browser/activity.ts), so the rows a transcript shows under the agent's cua_repl `js` call survive an app
// restart as they survive a window reload. One row per activity, in the order it was told; each session keeps its last
// BROWSER_ACTIVITIES_KEPT. Main's activity feed (src/main/browser/cua/activity.ts) loads a session's rows on first use and
// writes what it told each tick through. A row goes with its session's record: the index's FK cascade became the
// browser's own rules (index.ts): an append keeps only rows of sessions the spine knows, read from memory
// (`known`), and a removed or unknown session's rows are deleted (`removeSession`, `keepSessions`). The rows are a
// convenience, so an inert store (the index not yet at 14, or a newer app's file) keeps and answers nothing, and a write
// never waits: the connection has no busy timeout (db.ts).
import { BROWSER_ACTIVITIES_KEPT, BrowserAgentActivitySchema, type BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserDb } from './db';

interface Row {
  app_session_id: string;
  tab_id: string;
  at: string;
  activity: string;
}

export class BrowserActivityStore {
  private closed = false;
  private readonly flushers = new Set<() => void>();

  constructor(
    private readonly db: BrowserDb,
    // The sessions the spine has a record of, or null when there is no snapshot of them (the spine unavailable).
    private readonly known: () => ReadonlySet<string> | null,
  ) {}

  // The session's last `keep` activities, oldest first. A row this app cannot read (a later app's kind) is skipped, so
  // one never costs a window the rest of the list.
  list(appSessionId: AppSessionId, keep = BROWSER_ACTIVITIES_KEPT): BrowserAgentActivity[] {
    if (this.db.inert) return [];
    const rows = this.db.all<Row>(
      'SELECT app_session_id, tab_id, at, activity FROM (SELECT id, app_session_id, tab_id, at, activity FROM browser_activity WHERE app_session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id',
      appSessionId, keep,
    );
    return rows.flatMap((row) => {
      const parsed = BrowserAgentActivitySchema.safeParse({ appSessionId: row.app_session_id, tabId: row.tab_id, at: row.at, activity: parseJson(row.activity) });
      return parsed.success ? [parsed.data] : [];
    });
  }

  // Activities after their sessions' others, in one transaction, each session's oldest beyond `keep` dropped. A session
  // the spine has no record of keeps nothing (there is no transcript to show it in), and with no snapshot of the spine's
  // sessions nothing is kept. Throws when the transaction cannot start or commit (SQLITE_BUSY at once while another
  // connection writes); nothing is written then. After `close`, nothing is written.
  append(told: readonly BrowserAgentActivity[], keep = BROWSER_ACTIVITIES_KEPT): void {
    const known = this.known();
    if (this.db.inert || this.closed || known === null) return;
    const kept = told.filter((row) => known.has(row.appSessionId));
    if (kept.length === 0) return;
    this.db.transaction(() => {
      for (const { appSessionId, tabId, at, activity } of kept) {
        this.db.run('INSERT INTO browser_activity (app_session_id, tab_id, at, activity) VALUES (?, ?, ?, ?)', appSessionId, tabId, at, JSON.stringify(activity));
      }
      for (const appSessionId of new Set(kept.map((row) => row.appSessionId))) {
        this.db.run(
          'DELETE FROM browser_activity WHERE app_session_id = ?1 AND id <= (SELECT id FROM browser_activity WHERE app_session_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?2)',
          appSessionId, keep,
        );
      }
    });
  }

  // P5 O3-A: a removed session's rows (the cascade the index's foreign key made).
  removeSession(appSessionId: string): number {
    if (this.db.inert) return 0;
    return this.db.run('DELETE FROM browser_activity WHERE app_session_id = ?', appSessionId);
  }

  // P5 O3-A: the reconciliation at a snapshot of the spine's sessions: the rows of every session it does not list (one
  // removed while no browser listened, or in a crash before it heard) are deleted. Answers the rows removed.
  keepSessions(sessions: ReadonlySet<string>): number {
    if (this.db.inert) return 0;
    return this.db.run('DELETE FROM browser_activity WHERE app_session_id NOT IN (SELECT value FROM json_each(?))', JSON.stringify([...sessions]));
  }

  // `flush` writes what its writer still holds; it runs when the browser's data closes, before its connection does.
  beforeClose(flush: () => void): () => void {
    this.flushers.add(flush);
    return () => this.flushers.delete(flush);
  }

  // The browser's data is closing: what the writers still hold is written, then nothing more.
  close(): void {
    if (this.closed) return;
    for (const flush of this.flushers) {
      try {
        flush();
      } catch (error) {
        console.warn(`[browser] the browser activity's last write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.flushers.clear();
    this.closed = true;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
