// The browser's three tables as they leave the index (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §1 and
// §4, binding), defined once for both sides of the transfer. The index's migration 14 copies its `browser_history`,
// `browser_bookmarks` and `browser_activity` into `<table>_staging` tables of the browser's own database
// (`<profile>/browser/browser.sqlite`, the client's file, which main's browser writes) before it drops them, and the
// browser promotes staging into its live tables once it reads the index at BROWSER_HANDOFF_INDEX_VERSION or above. Both
// have this shape: the index's tables as migrations 5 to 7 made them (unchanged through 13), less `browser_activity`'s
// foreign key to `sessions`, which another database cannot hold (the browser keeps that coupling itself). Frozen: staging
// is the index's version-13 shape for good, so a later change to a live table is a migration of the browser's database,
// never an edit here. Pure (no Node), so either process may import it.

export const BROWSER_DATA_PATH = ['browser', 'browser.sqlite'] as const; // under the profile directory
export const BROWSER_HANDOFF_INDEX_VERSION = 14; // the index migration that drops the tables

export const BROWSER_TABLES = ['browser_history', 'browser_bookmarks', 'browser_activity'] as const;
export type BrowserTable = (typeof BROWSER_TABLES)[number];

export const stagingTable = (table: BrowserTable): string => `${table}_staging`;

// Each table's columns as the index's migrations declared them, so a copy that names them puts every value in its own
// column, the id included.
const DEFINITIONS: Readonly<Record<BrowserTable, readonly (readonly [column: string, definition: string])[]>> = {
  browser_history: [
    ['partition', 'TEXT NOT NULL'],
    ['url', 'TEXT NOT NULL'],
    ['title', 'TEXT'],
    ['visit_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['typed_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_visit_ms', 'INTEGER NOT NULL'],
    ['source', "TEXT NOT NULL CHECK (source IN ('maws','imported'))"],
  ],
  browser_bookmarks: [
    ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
    ['partition', 'TEXT NOT NULL'],
    ['parent_id', 'INTEGER'], // NULL for the three roots
    ['root', "TEXT NOT NULL CHECK (root IN ('bar','other','mobile'))"],
    ['position', 'INTEGER NOT NULL'],
    ['kind', "TEXT NOT NULL CHECK (kind IN ('url','folder'))"],
    ['name', 'TEXT NOT NULL'],
    ['url', 'TEXT'], // NULL for folders
    ['added_at_ms', 'INTEGER'],
  ],
  browser_activity: [
    ['id', 'INTEGER PRIMARY KEY'],
    ['app_session_id', 'TEXT NOT NULL'],
    ['tab_id', 'TEXT NOT NULL'],
    ['at', 'TEXT NOT NULL'],
    ['activity', 'TEXT NOT NULL'],
  ],
};
const PRIMARY_KEYS: Partial<Record<BrowserTable, string>> = { browser_history: 'PRIMARY KEY (partition, url)' };

export const BROWSER_COLUMNS: Readonly<Record<BrowserTable, readonly string[]>> = {
  browser_history: DEFINITIONS.browser_history.map(([column]) => column),
  browser_bookmarks: DEFINITIONS.browser_bookmarks.map(([column]) => column),
  browser_activity: DEFINITIONS.browser_activity.map(([column]) => column),
};

// `CREATE TABLE <name> (…)` in the table's shape: the live table under its own name, staging under `stagingTable`.
export function browserTableSql(table: BrowserTable, name: string = table): string {
  const parts = DEFINITIONS[table].map(([column, definition]) => `${column} ${definition}`);
  const key = PRIMARY_KEYS[table];
  return `CREATE TABLE ${name} (${[...parts, ...(key ? [key] : [])].join(', ')})`;
}

// The live tables' indexes, as the index had them: the recent history of a partition, a session's activity in order,
// the bookmark tree and the address field's bookmark matches.
export const BROWSER_INDEXES_SQL = `
CREATE INDEX browser_history_recent ON browser_history(partition, last_visit_ms DESC);
CREATE INDEX browser_activity_session ON browser_activity(app_session_id, id);
CREATE INDEX browser_bookmarks_tree ON browser_bookmarks (partition, parent_id, position);
CREATE INDEX browser_bookmarks_url ON browser_bookmarks (partition, url);
`;
