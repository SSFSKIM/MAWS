// The browser's history (E4a execution document, Design §6; index migration 5's `browser_history`): one row per
// (partition, url), written on a tab's committed http(s) navigation and read by the address field as it is typed.
// History is a convenience, so an unavailable index (a newer app's file, opened read-only) drops visits and suggests
// nothing rather than failing the navigation that fed it. The agent never reads this table in P1.
import { BROWSER_SUGGESTIONS_MAX } from '@shared/browser/tab';
import type { Db } from './db';

export interface BrowserSuggestion {
  url: string;
  title: string | null;
}

// LIKE's wildcards in typed text are text.
const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

export class BrowserHistoryStore {
  constructor(private readonly db: Db) {}

  // One visit at `at` (epoch ms); `typed` when the address field navigated. A row E4b imported stays 'imported'.
  visit(partition: string, url: string, { typed, at }: { typed: boolean; at: number }): void {
    if (this.db.readOnly) return;
    this.db.run(
      `INSERT INTO browser_history (partition, url, visit_count, typed_count, last_visit_ms, source) VALUES (?, ?, 1, ?, ?, 'maws')
       ON CONFLICT (partition, url) DO UPDATE SET visit_count = visit_count + 1, typed_count = typed_count + excluded.typed_count,
         last_visit_ms = excluded.last_visit_ms`,
      partition, url, typed ? 1 : 0, at,
    );
  }

  // The page's title for a URL already visited; a URL with no row gains none.
  setTitle(partition: string, url: string, title: string): void {
    if (this.db.readOnly) return;
    this.db.run('UPDATE browser_history SET title = ? WHERE partition = ? AND url = ?', title, partition, url);
  }

  // Rows whose URL or title holds `query` (ASCII case-insensitively, SQLite's LIKE), typed most first, then visited
  // most, then the latest; an empty query answers the most recent.
  suggest(partition: string, query: string, limit = BROWSER_SUGGESTIONS_MAX): BrowserSuggestion[] {
    if (this.db.readOnly) return [];
    const rows =
      query === ''
        ? this.db.all<BrowserSuggestion>('SELECT url, title FROM browser_history WHERE partition = ? ORDER BY last_visit_ms DESC LIMIT ?', partition, limit)
        : this.db.all<BrowserSuggestion>(
            `SELECT url, title FROM browser_history WHERE partition = ?1 AND (url LIKE ?2 ESCAPE '\\' OR title LIKE ?2 ESCAPE '\\')
             ORDER BY typed_count DESC, visit_count DESC, last_visit_ms DESC LIMIT ?3`,
            partition, likePattern(query), limit,
          );
    return rows.map(({ url, title }) => ({ url, title }));
  }

  // E4b's "Remove imported profile".
  removePartition(partition: string): void {
    if (this.db.readOnly) return;
    this.db.run('DELETE FROM browser_history WHERE partition = ?', partition);
  }
}
