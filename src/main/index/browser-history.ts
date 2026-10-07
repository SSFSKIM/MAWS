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

  // E4b start
  // An import's rows (E4b Design §6), in one transaction per call: Chrome's counts carried, so `suggest` ranks them as
  // Chrome's omnibox would. A conflict replaces the counts rather than adding (Decision Log 16), so importing the same
  // rows twice never doubles them; the later visit and a title the import lacks are kept. Answers the rows written. An
  // unavailable index fails the history category (Design §13) rather than dropping the rows silently.
  importRows(partition: string, rows: readonly BrowserHistoryImportRow[]): number {
    if (this.db.readOnly) throw Object.assign(new Error('the index is unavailable'), { code: 'indexUnavailable' });
    return this.db.transaction(() => {
      let written = 0;
      for (const row of rows) {
        written += this.db.run(
          `INSERT INTO browser_history (partition, url, title, visit_count, typed_count, last_visit_ms, source) VALUES (?, ?, ?, ?, ?, ?, 'imported')
           ON CONFLICT (partition, url) DO UPDATE SET visit_count = excluded.visit_count, typed_count = excluded.typed_count,
             last_visit_ms = max(last_visit_ms, excluded.last_visit_ms), title = coalesce(excluded.title, title), source = 'imported'`,
          partition, row.url, row.title, row.visitCount, row.typedCount, row.lastVisitMs,
        );
      }
      return written;
    });
  }

  // The boot sweep (E4b Design §14; Decision Log 26): every row of a partition named with `prefix` that `keep` does not
  // list, whatever its source (an import's rows, or visits a restored tab made in it); answers the rows removed.
  removeImportedExcept(prefix: string, keep: readonly string[]): number {
    if (this.db.readOnly) return 0;
    return this.db.run(
      'DELETE FROM browser_history WHERE substr(partition, 1, length(?1)) = ?1 AND partition NOT IN (SELECT value FROM json_each(?2))',
      prefix, JSON.stringify(keep),
    );
  }
  // E4b end
}

// E4b start
// One row of a Chrome import (E4b's history decoder yields this shape): the URL as the browser serialises it.
export interface BrowserHistoryImportRow {
  url: string;
  title: string | null;
  visitCount: number;
  typedCount: number;
  lastVisitMs: number;
}
// E4b end
