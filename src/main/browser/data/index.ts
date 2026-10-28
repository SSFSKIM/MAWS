// The browser's own data (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §1 and §4, binding): its history,
// an imported profile's bookmarks and the agent's browser activity, in `<profile>/browser/browser.sqlite`, the client's
// file, which main's browser alone writes. They left the index at its migration 14, so the index holds only the
// machine's data before it moves to `mawsd`.
//
// The transfer is staged, and the index's `user_version` is the handoff. Whichever process migrates the index to 14 first
// copies its three tables into this file's staging tables (src/main/index/browser-staging.ts). This side reads the
// index's version on a read-only connection (a reader beside the spine's writer, never a second writer) at its start and
// at each `reattach`, and touches its tables only once it reads 14 or above: then it brings its own schema current and
// promotes staging into its live tables (live rows win, ids and values kept), dropping staging, in one transaction.
// Until then it is inert: visits are dropped, suggestions and the bookmark tree are empty, an import or a bookmark sync is
// refused as `indexUnavailable`. In O3-A main migrates the index before the browser starts, so that window is empty.
//
// `browser_activity`'s FK cascade to `sessions` is kept here, in three parts: a session removed while the browser listens
// loses its rows (`sessionChanged`); at every complete, available snapshot of the spine's sessions (`reattach`: at the
// start, and at each reattach once the spine lives in `mawsd`) the rows of sessions it does not list are deleted before
// any activity is written, so a removal the browser never heard leaves nothing; and an append is written only for a
// session the browser knows, from memory (the snapshot, then the changes it hears), never from the index, which closes
// before the browser's last flush at a quit. With no snapshot (the spine unavailable) nothing is reconciled and no
// activity is written, as an unavailable index wrote none.
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BROWSER_COLUMNS, BROWSER_HANDOFF_INDEX_VERSION, BROWSER_TABLES, stagingTable } from '@shared/browser/data-schema';
import { BrowserActivityStore } from './activity';
import { BrowserBookmarksStore } from './bookmarks';
import { BrowserDb } from './db';
import { BrowserHistoryStore } from './history';
import { BROWSER_MIGRATIONS } from './migrations';

export interface BrowserDataPaths {
  file: string; // <profile>/browser/browser.sqlite
  index: string; // <profile>/index.sqlite, whose user_version is read, never written
}

export class BrowserData {
  readonly history: BrowserHistoryStore;
  readonly bookmarks: BrowserBookmarksStore;
  readonly activity: BrowserActivityStore;
  private readonly db = new BrowserDb();
  private known: Set<string> | null = null; // the sessions the spine has a record of (archived included); null: no snapshot
  private unavailable: string | null = null; // a newer build's file: left as it is for the run
  private closed = false;

  constructor(private readonly paths: BrowserDataPaths) {
    this.history = new BrowserHistoryStore(this.db);
    this.bookmarks = new BrowserBookmarksStore(this.db);
    this.activity = new BrowserActivityStore(this.db, () => this.known);
    this.open();
  }

  // Whether the tables are in use: the index read at 14 or above and the file opened and promoted.
  get ready(): boolean {
    return !this.db.inert;
  }

  // A fresh, complete snapshot of the spine's sessions (every record's app id), or null while the spine is unavailable:
  // the index's version is read again (and staging promoted), and the activity of every session the snapshot lacks is
  // deleted before any is written.
  reattach(sessions: Iterable<string> | null): void {
    if (this.closed) return;
    this.known = sessions === null ? null : new Set(sessions);
    this.open();
    if (this.known === null || this.db.inert) return;
    try {
      this.activity.keepSessions(this.known);
    } catch (error) {
      console.warn(`[browser] the activity of sessions the spine no longer knows could not be removed: ${message(error)}`);
    }
  }

  // A change to one session's record the browser heard: any but its removal means the spine has the record; a removal
  // takes the session's activity with it (or, while inert, leaves that to the next reattach's reconciliation).
  sessionChanged(appSessionId: string, removed: boolean): void {
    if (!removed) {
      this.known?.add(appSessionId);
      return;
    }
    this.known?.delete(appSessionId);
    if (this.db.inert) return;
    try {
      this.activity.removeSession(appSessionId);
    } catch (error) {
      console.warn(`[browser] the activity of removed session ${appSessionId} could not be deleted: ${message(error)}`);
    }
  }

  // At a quit, once the browser and its import have stopped: the activity's last flush, then the connection.
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.activity.close();
    this.db.close();
  }

  private open(): void {
    if (!this.db.inert || this.unavailable !== null || this.closed) return;
    const version = indexVersion(this.paths.index);
    if (version === null || version < BROWSER_HANDOFF_INDEX_VERSION) return;
    try {
      const opened = openPromoted(this.paths.file);
      if (typeof opened !== 'string') return this.db.use(opened);
      this.unavailable = opened;
      console.error(`[browser] ${this.paths.file}: ${opened}; the browser's history, bookmarks and activity are unavailable this run and the file is left as it is`);
    } catch (error) {
      console.error(`[browser] ${this.paths.file} could not be opened (${message(error)}); asked again at the next reattach`);
    }
  }
}

// The index's `user_version` as committed, on a read-only connection; null when there is no index file yet or it cannot
// be read, which reads as not ready.
function indexVersion(path: string): number | null {
  if (!existsSync(path)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } catch (error) {
    console.warn(`[browser] the index's version could not be read (${message(error)}); the browser's data waits`);
    return null;
  } finally {
    db?.close();
  }
}

// The file opened, its schema made current and staging promoted, in one transaction; or, for a file whose user_version
// is newer than this build knows, the reason it is left alone (nothing written to it, its journal mode included).
function openPromoted(path: string): DatabaseSync | string {
  mkdirSync(dirname(path), { recursive: true });
  const db = openFile(path);
  try {
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    const known = BROWSER_MIGRATIONS.length;
    if (version > known) {
      db.close();
      return `user_version ${version} is newer than this app knows (${known})`;
    }
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL');
    const pending = BROWSER_MIGRATIONS.slice(version);
    if (pending.length > 0 || staged(db).length > 0) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const migration of pending) db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${known}`);
        // Live rows win: live tables hold rows at a promotion only when an index restored from a backup was migrated
        // again, and then the rows the browser wrote since are the later ones.
        for (const table of staged(db)) {
          const columns = BROWSER_COLUMNS[table].join(', ');
          db.exec(`INSERT OR IGNORE INTO ${table} (${columns}) SELECT ${columns} FROM ${stagingTable(table)}; DROP TABLE ${stagingTable(table)};`);
        }
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    }
    return db;
  } catch (error) {
    if (db.isOpen) db.close();
    throw error;
  }
}

const staged = (db: DatabaseSync) =>
  BROWSER_TABLES.filter((table) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(stagingTable(table)) !== undefined);

// SQLite result codes that mean the file is no usable database (primary codes, carried in an extended code's low byte).
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

// The file opened, its version readable. One SQLite reports as corrupt or not a database is moved aside as
// `<path>.broken-<epoch>` (with its -wal and -shm), never deleted, and a fresh one made, as the index does with its own:
// the browser's data is a convenience, which must not stop the browser.
function openFile(path: string): DatabaseSync {
  try {
    return probe(path);
  } catch (error) {
    const code = (error as { errcode?: unknown }).errcode;
    if (typeof code !== 'number' || ![SQLITE_CORRUPT, SQLITE_NOTADB].includes(code & 0xff)) throw error;
    const aside = `${path}.broken-${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) renameSync(path + suffix, aside + suffix);
    console.error(`[browser] ${path} is not a usable database (${message(error)}); moved aside as ${aside}`);
    return probe(path);
  }
}

function probe(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 0');
    db.prepare('PRAGMA user_version').get();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
