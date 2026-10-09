// The agent's browser activity (cua board #93; index migration 6's `browser_activity`): what main told the windows an
// agent did in the in-app browser through cua (src/shared/browser/activity.ts), so the rows a transcript shows under the
// agent's cua_repl `js` call survive an app restart as they survive a window reload. One row per activity, in the order
// it was told; each session keeps its last BROWSER_ACTIVITIES_KEPT, and a row goes with its session's record (ON DELETE
// CASCADE). Main's activity feed (src/main/browser/cua/activity.ts) loads a session's rows on first use and writes each
// new one through. The rows are a convenience, so an unavailable index (a newer app's file) keeps and answers nothing.
import { BROWSER_ACTIVITIES_KEPT, BrowserAgentActivitySchema, type BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import type { Db } from './db';

interface Row {
  app_session_id: string;
  tab_id: string;
  at: string;
  activity: string;
}

export class BrowserActivityStore {
  constructor(private readonly db: Db) {}

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

  // One activity after the session's others, the oldest beyond `keep` dropped. Throws when the session has no record
  // (the caller keeps the live row and logs).
  append(told: BrowserAgentActivity, keep = BROWSER_ACTIVITIES_KEPT): void {
    if (this.db.readOnly) return;
    this.db.transaction(() => {
      this.db.insert('browser_activity', { app_session_id: told.appSessionId, tab_id: told.tabId, at: told.at, activity: JSON.stringify(told.activity) });
      this.db.run(
        'DELETE FROM browser_activity WHERE app_session_id = ?1 AND id <= (SELECT id FROM browser_activity WHERE app_session_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?2)',
        told.appSessionId, keep,
      );
    });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
