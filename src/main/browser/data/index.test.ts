// P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §4; O3-A acceptance 1, 3 and 6): the browser's tables leave
// the index for `<profile>/browser/browser.sqlite`. Index migration 14 stages a full copy there before it drops them;
// the browser promotes staging once it reads the index at 14, and keeps the activity's cascade to `sessions` itself. A
// crash at any step repeats an idempotent one: each case below interrupts a step and opens again, and the live rows
// converge, nothing lost or doubled, ids and times as the index held them.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyBookmarkTree } from '@shared/browser/bookmarks';
import { BROWSER_COLUMNS, BROWSER_TABLES, stagingTable, type BrowserTable } from '@shared/browser/data-schema';
import type { AppSessionId } from '@shared/graph/ids';
import { browserDataFile } from '../../../../test/support/browser-data';
import { tempDir } from '../../../../test/support/index-fixture';
import { openDb } from '../../../services/index/db';
import { Index } from '../../../services/index/index';
import { MIGRATIONS, REPAIRS, type Migration } from '../../../services/index/migrations';
import { BrowserData } from './index';

const S1 = 'a1a1a1a1-0000-4000-8000-000000000001' as AppSessionId;
const S2 = 'a2a2a2a2-0000-4000-8000-000000000002' as AppSessionId;
const S3 = 'a3a3a3a3-0000-4000-8000-000000000003' as AppSessionId; // archived: still a record the spine knows
const TAB = 'b_000000000001';
const MAWS = 'persist:maws-browser';
const CHROME = 'persist:maws-chrome-Default';
const ORDER: Record<BrowserTable, string> = { browser_history: 'partition, url', browser_bookmarks: 'id', browser_activity: 'id' };

// An index as a build before O3-A left it: migrations 1 to 13, then the owner's sessions, history (MAWS's and an
// imported profile's), an imported profile's bookmarks and the agent's activity of three sessions, ids with gaps.
function v13Index(path: string): void {
  openDb(path, MIGRATIONS.slice(0, 13), REPAIRS).close();
  const db = new DatabaseSync(path);
  try {
    const session = db.prepare("INSERT INTO sessions (app_id, directory, archived, created_at, updated_at) VALUES (?, '/w', ?, '2026-10-01T00:00:00.000Z', 't')");
    session.run(S1, 0);
    session.run(S2, 0);
    session.run(S3, 1);
    const history = db.prepare('INSERT INTO browser_history (partition, url, title, visit_count, typed_count, last_visit_ms, source) VALUES (?, ?, ?, ?, ?, ?, ?)');
    history.run(MAWS, 'https://alpha.example/', 'Alpha', 3, 1, 1_760_000_000_001, 'maws');
    history.run(MAWS, 'https://beta.example/', null, 1, 0, 1_760_000_000_002, 'maws');
    history.run(CHROME, 'https://alpha.example/', 'Alpha in Chrome', 40, 7, 1_750_000_000_000, 'imported');
    history.run(CHROME, 'https://gamma.example/', 'Gamma', 2, 0, 1_750_000_000_005, 'imported');
    const bookmark = db.prepare('INSERT INTO browser_bookmarks (id, partition, parent_id, root, position, kind, name, url, added_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    bookmark.run(21, CHROME, null, 'bar', 0, 'folder', 'Bookmarks bar', null, null);
    bookmark.run(22, CHROME, null, 'other', 1, 'folder', 'Other bookmarks', null, null);
    bookmark.run(23, CHROME, null, 'mobile', 2, 'folder', 'Mobile bookmarks', null, null);
    bookmark.run(27, CHROME, 21, 'bar', 0, 'url', 'Alpha docs', 'https://alpha.example/docs', 1_700_000_000_000);
    bookmark.run(28, CHROME, 21, 'bar', 1, 'folder', 'Work', null, null);
    bookmark.run(30, CHROME, 28, 'bar', 0, 'url', 'Gamma', 'https://gamma.example/', null);
    const activity = db.prepare('INSERT INTO browser_activity (id, app_session_id, tab_id, at, activity) VALUES (?, ?, ?, ?, ?)');
    activity.run(5, S1, TAB, '2026-10-20T10:00:00.000Z', JSON.stringify({ kind: 'navigated', url: 'https://alpha.example/', title: 'Alpha' }));
    activity.run(6, S1, TAB, '2026-10-20T10:00:01.000Z', JSON.stringify({ kind: 'key', key: 'Enter' }));
    activity.run(9, S2, TAB, '2026-10-21T09:00:00.000Z', JSON.stringify({ kind: 'screenshot' }));
    activity.run(12, S3, TAB, '2026-10-22T08:00:00.000Z', JSON.stringify({ kind: 'typed', chars: 4 }));
  } finally {
    db.close();
  }
}

// Writes as a build from before O3-A would to a version-13 index.
function write(path: string, sql: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

// One table's rows in key order, under `name` (the live table, or its staging copy).
function rows(path: string, table: BrowserTable, name: string = table): unknown[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(`SELECT ${BROWSER_COLUMNS[table].join(', ')} FROM ${name} ORDER BY ${ORDER[table]}`).all();
  } finally {
    db.close();
  }
}

const allRows = (path: string, name: (table: BrowserTable) => string = (table) => table) =>
  Object.fromEntries(BROWSER_TABLES.map((table) => [table, rows(path, table, name(table))]));

function tables(path: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
  } finally {
    db.close();
  }
}

function userVersion(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
}

// Migration 14 with its staging step followed by a crash: the copy committed in the browser's database, the index's
// migration rolled back with it never applied.
const crashAfterStaging: readonly Migration[] = MIGRATIONS.map((migration) =>
  migration.version !== 14
    ? migration
    : {
        ...migration,
        before: (db, path) => {
          migration.before!(db, path);
          throw new Error('crashed after the staging copy');
        },
      },
);

describe('the browser\'s tables leave the index (P5 O3-A, the O3 document §4)', () => {
  let dir: ReturnType<typeof tempDir>;
  let indexPath: string;
  let file: string;
  let opened: { close(): void }[];
  const index = () => {
    const opening = new Index(indexPath);
    opened.push(opening);
    return opening;
  };
  const browserData = (sessions: Iterable<string> | null = [S1, S2, S3]) => {
    const data = new BrowserData({ file, index: indexPath });
    opened.push(data);
    data.reattach(sessions);
    return data;
  };
  beforeEach(() => {
    dir = tempDir();
    indexPath = join(dir.path, 'index.sqlite');
    file = browserDataFile(dir.path);
    opened = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const db of opened) db.close();
    dir.dispose();
  });

  it('a populated version-13 index migrates whole: the index at 14 with no browser table, the live tables holding exactly its rows, and the stores answering as before', () => {
    v13Index(indexPath);
    const before = allRows(indexPath);
    expect(before.browser_history).toHaveLength(4);

    const migrated = index();
    expect(migrated.applied).toEqual([14]);
    expect(userVersion(indexPath)).toBe(14);
    expect(tables(indexPath).filter((name) => name.startsWith('browser_'))).toEqual([]);
    expect(migrated.sessions.get(S3)).toMatchObject({ archived: true }); // the index's own rows stay

    const data = browserData(migrated.sessions.appIds());
    expect(data.ready).toBe(true);
    expect(allRows(file)).toEqual(before); // every row, its id and times as the index held them
    expect(tables(file)).toEqual(['browser_activity', 'browser_bookmarks', 'browser_history']); // staging dropped

    expect(data.history.suggest(MAWS, 'alpha')).toEqual([{ url: 'https://alpha.example/', title: 'Alpha' }]);
    expect(data.history.suggest(CHROME, '')).toEqual([{ url: 'https://gamma.example/', title: 'Gamma' }, { url: 'https://alpha.example/', title: 'Alpha in Chrome' }]);
    const tree = data.bookmarks.tree(CHROME);
    expect(tree.bar).toEqual({
      kind: 'folder', id: 21, name: 'Bookmarks bar', children: [
        { kind: 'url', id: 27, name: 'Alpha docs', url: 'https://alpha.example/docs', addedAt: 1_700_000_000_000 },
        { kind: 'folder', id: 28, name: 'Work', children: [{ kind: 'url', id: 30, name: 'Gamma', url: 'https://gamma.example/', addedAt: null }] },
      ],
    });
    expect(data.bookmarks.suggest(CHROME, 'gam', 8)).toEqual([{ url: 'https://gamma.example/', title: 'Gamma' }]);
    expect(data.activity.list(S1)).toEqual([
      { appSessionId: S1, tabId: TAB, at: '2026-10-20T10:00:00.000Z', activity: { kind: 'navigated', url: 'https://alpha.example/', title: 'Alpha' } },
      { appSessionId: S1, tabId: TAB, at: '2026-10-20T10:00:01.000Z', activity: { kind: 'key', key: 'Enter' } },
    ]);
    expect(data.activity.list(S3)).toHaveLength(1); // an archived session's rows are its record's

    // a new bookmark sync's ids follow the copied ones (AUTOINCREMENT), and a new activity row follows the last id
    data.bookmarks.replace(MAWS, emptyBookmarkTree());
    expect(Math.min(...(rows(file, 'browser_bookmarks') as { id: number; partition: string }[]).filter((row) => row.partition === MAWS).map((row) => row.id))).toBeGreaterThan(30);
    data.activity.append([{ appSessionId: S2, tabId: TAB, at: '2026-10-28T00:00:00.000Z', activity: { kind: 'screenshot' } }]);
    expect((rows(file, 'browser_activity') as { id: number }[]).map((row) => row.id)).toEqual([5, 6, 9, 12, 13]);
  });

  it('the live tables are the index\'s version-13 tables, but for the activity\'s foreign key to sessions', () => {
    v13Index(indexPath);
    const reference = join(dir.path, 'reference.sqlite');
    v13Index(reference);
    index();
    browserData();
    const shape = (path: string, table: string) => {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        const indexes = (db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]).map((row) => row.name).sort();
        return { columns: db.prepare(`PRAGMA table_info(${table})`).all(), indexes, keys: db.prepare(`PRAGMA foreign_key_list(${table})`).all() };
      } finally {
        db.close();
      }
    };
    for (const table of BROWSER_TABLES) {
      const { columns, indexes, keys } = shape(file, table);
      const expected = shape(reference, table);
      expect({ table, columns, indexes }).toEqual({ table, columns: expected.columns, indexes: expected.indexes });
      expect(keys).toEqual([]);
    }
    expect(shape(reference, 'browser_activity').keys).toEqual([expect.objectContaining({ table: 'sessions', from: 'app_session_id', to: 'app_id', on_delete: 'CASCADE' })]);
  });

  // acceptance 3: a crash after the staging copy, before migration 14 commits, repeated; between the two, the version-13
  // index loses a row (a pre-O3-A build's removal), which staging must not keep
  it('a crash after the staging copy leaves the index at 13 as it was; the next open copies again, replacing staging, and the rows arrive once', () => {
    v13Index(indexPath);
    const before = allRows(indexPath);
    expect(() => openDb(indexPath, crashAfterStaging, REPAIRS)).toThrow('crashed after the staging copy');
    expect(userVersion(indexPath)).toBe(13);
    expect(allRows(indexPath)).toEqual(before);
    expect(allRows(file, stagingTable)).toEqual(before);
    const waiting = browserData();
    expect(waiting.ready).toBe(false); // the index is not at 14: nothing promoted
    expect(tables(file)).toEqual(BROWSER_TABLES.map(stagingTable).sort());

    expect(() => openDb(indexPath, crashAfterStaging, REPAIRS)).toThrow('crashed after the staging copy');
    write(indexPath, "DELETE FROM browser_history WHERE url = 'https://beta.example/'");
    const after = allRows(indexPath);
    index();
    expect(allRows(file, stagingTable)).toEqual(after);

    const data = browserData();
    expect(data.ready).toBe(true);
    expect(allRows(file)).toEqual(after);
    expect(rows(file, 'browser_history')).toHaveLength(3);
  });

  it('a crash in the staging copy itself leaves the browser\'s database without staging and the index at 13; the next open converges', () => {
    v13Index(indexPath);
    const before = allRows(indexPath);
    const exec = DatabaseSync.prototype.exec;
    let commits = 0;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
      if (sql === 'COMMIT' && commits++ === 0) throw new Error('crashed committing the staging copy'); // staging's commit comes first
      return exec.call(this, sql);
    });
    expect(() => index()).toThrow('crashed committing the staging copy');
    vi.restoreAllMocks();
    expect(userVersion(indexPath)).toBe(13);
    expect(tables(file)).toEqual([]);

    index();
    browserData();
    expect(allRows(file)).toEqual(before);
  });

  it('a crash during promotion leaves staging whole and no live table; the next start promotes the same rows once', () => {
    v13Index(indexPath);
    const before = allRows(indexPath);
    index();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exec = DatabaseSync.prototype.exec;
    const crash = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
      if (sql.startsWith('INSERT OR IGNORE INTO browser_activity')) throw new Error('crashed promoting'); // after history and bookmarks
      return exec.call(this, sql);
    });
    const crashed = browserData();
    expect(crashed.ready).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('crashed promoting'));
    crash.mockRestore();
    expect(tables(file)).toEqual(BROWSER_TABLES.map(stagingTable).sort());
    expect(userVersion(file)).toBe(0);
    expect(allRows(file, stagingTable)).toEqual(before);

    crashed.reattach([S1, S2, S3]); // the same process asks again at its next snapshot
    expect(crashed.ready).toBe(true);
    expect(allRows(file)).toEqual(before);
    crashed.close();
    expect(browserData().ready).toBe(true); // and a later start finds nothing more to do
    expect(allRows(file)).toEqual(before);
  });

  // acceptance 6: a crash after the staging copy, then rows written to the version-13 index (as a pre-O3-A build would),
  // then O3-A's build again
  it('rows a pre-O3-A build writes to the version-13 index after a staging copy all reach the live tables', () => {
    v13Index(indexPath);
    expect(() => openDb(indexPath, crashAfterStaging, REPAIRS)).toThrow('crashed after the staging copy');
    write(indexPath, `
      INSERT INTO browser_history (partition, url, title, visit_count, typed_count, last_visit_ms, source) VALUES ('${MAWS}', 'https://delta.example/', 'Delta', 1, 1, 1760000000009, 'maws');
      UPDATE browser_history SET visit_count = visit_count + 1, last_visit_ms = 1760000000010 WHERE partition = '${MAWS}' AND url = 'https://alpha.example/';
      INSERT INTO browser_bookmarks (partition, parent_id, root, position, kind, name, url, added_at_ms) VALUES ('${CHROME}', 22, 'other', 0, 'url', 'Other one', 'https://other.example/', 1700000000001);
      INSERT INTO browser_activity (app_session_id, tab_id, at, activity) VALUES ('${S2}', '${TAB}', '2026-10-23T00:00:00.000Z', '{"kind":"screenshot"}');
    `);
    const written = allRows(indexPath);
    expect(written.browser_activity).toHaveLength(5);

    index();
    const data = browserData();
    expect(allRows(file)).toEqual(written);
    expect(data.history.suggest(MAWS, 'delta')).toEqual([{ url: 'https://delta.example/', title: 'Delta' }]);
    expect(data.bookmarks.tree(CHROME).other.children.map((node) => node.name)).toEqual(['Other one']);
    expect(data.activity.list(S2).map((row) => row.at)).toEqual(['2026-10-21T09:00:00.000Z', '2026-10-23T00:00:00.000Z']);
  });

  // §4: live tables hold rows at a promotion only when an index restored from a backup is migrated again
  // The spine's process (mawsd from O3-D) migrates the restored index while the app's browser runs, which promotes the
  // new staging at its next reattach; a browser that starts afterwards promotes it at its start (the crash cases above).
  it('a promotion never loses a live row: a restored index\'s rows are staged again while the browser runs, and the live ones win at its next reattach', () => {
    v13Index(indexPath);
    const backup = readFileSync(indexPath);
    index().close();
    opened.pop();
    const live = browserData();
    live.history.visit(MAWS, 'https://alpha.example/', { typed: false, at: 1_770_000_000_000 }); // since the backup
    live.activity.append([{ appSessionId: S1, tabId: TAB, at: '2026-10-27T00:00:00.000Z', activity: { kind: 'screenshot' } }]);
    const kept = allRows(file);

    for (const suffix of ['-wal', '-shm']) rmSync(indexPath + suffix, { force: true });
    writeFileSync(indexPath, backup); // the owner restores index.sqlite from a backup at 13
    write(indexPath, `INSERT INTO browser_activity (id, app_session_id, tab_id, at, activity) VALUES (40, '${S2}', '${TAB}', '2026-10-24T00:00:00.000Z', '{"kind":"screenshot"}')`);
    index();
    expect(tables(file)).toEqual([...BROWSER_TABLES, ...BROWSER_TABLES.map(stagingTable)].sort());
    live.reattach([S1, S2, S3]);
    expect(tables(file)).toEqual([...BROWSER_TABLES].sort());
    expect(rows(file, 'browser_history')).toEqual(kept.browser_history); // the live counts, not the backup's
    expect(rows(file, 'browser_bookmarks')).toEqual(kept.browser_bookmarks);
    expect((rows(file, 'browser_activity') as { id: number }[]).map((row) => row.id)).toEqual([5, 6, 9, 12, 13, 40]); // 13 is the live row
  });

  // §2 with §4: a run refused the spine creates no file of the spine's, and SQLite's read-only open of a WAL database no
  // connection holds creates its -wal and -shm (hosted e2e:settings, e2e/spine-lock.spec.ts)
  it('reads the version of an index no connection holds from its header, creating no -wal or -shm beside it; one held open is read through SQLite', () => {
    const indexPath = join(dir.path, 'index.sqlite');
    new Index(indexPath).close();
    expect(readdirSync(dir.path).filter((name) => name.startsWith('index.sqlite')).sort()).toEqual(['index.sqlite']);
    const data = new BrowserData({ file: browserDataFile(dir.path), index: indexPath });
    expect(data.ready).toBe(true);
    data.close();
    expect(readdirSync(dir.path).filter((name) => name.startsWith('index.sqlite')).sort()).toEqual(['index.sqlite']);
    // a holder with the index open: its -wal holds the committed version the header may not have yet
    rmSync(join(dir.path, 'browser'), { recursive: true, force: true });
    const raw = new DatabaseSync(indexPath);
    raw.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; PRAGMA user_version = 13');
    const held = new BrowserData({ file: browserDataFile(dir.path), index: indexPath });
    expect(held.ready).toBe(false);
    raw.exec('PRAGMA user_version = 14'); // committed to the -wal, not yet checkpointed into the header
    held.reattach([]);
    expect(held.ready).toBe(true);
    held.close();
    raw.close();
  });

  // §4: in O3-D the browser may start while `mawsd` migrates; it waits on the index's version and records nothing meanwhile
  it('waits on the index: absent or below 14 it is inert and writes nothing, and a later reattach that reads 14 promotes', () => {
    const absent = browserData();
    expect(absent.ready).toBe(false);
    expect(existsSync(join(dir.path, 'browser'))).toBe(false);
    absent.close();

    v13Index(indexPath);
    const before = allRows(indexPath);
    expect(() => openDb(indexPath, crashAfterStaging, REPAIRS)).toThrow('crashed after the staging copy');
    const staged = readFileSync(file);
    const data = browserData();
    data.history.visit(MAWS, 'https://zeta.example/', { typed: true, at: 1 });
    data.activity.append([{ appSessionId: S1, tabId: TAB, at: '2026-10-28T00:00:00.000Z', activity: { kind: 'screenshot' } }]);
    expect(data.history.suggest(MAWS, '')).toEqual([]);
    expect(data.bookmarks.tree(CHROME)).toEqual(emptyBookmarkTree());
    expect(data.bookmarks.readOnly).toBe(true);
    expect(() => data.history.importRows(CHROME, [])).toThrow(expect.objectContaining({ code: 'indexUnavailable' }));
    expect(() => data.bookmarks.replace(CHROME, emptyBookmarkTree())).toThrow(expect.objectContaining({ code: 'indexUnavailable' }));
    expect(readFileSync(file).equals(staged)).toBe(true);

    index(); // the spine's process migrates
    expect(data.ready).toBe(false); // read again only at a snapshot
    data.reattach([S1, S2, S3]);
    expect(data.ready).toBe(true);
    expect(allRows(file)).toEqual(before);
  });

  it('a browser database of a version newer than this build knows is left as found: inert, its bytes unchanged', () => {
    index();
    browserData().close();
    write(file, 'PRAGMA user_version = 2');
    const bytes = readFileSync(file);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = browserData();
    expect(data.ready).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('user_version 2 is newer than this app knows (1)'));
    data.history.visit(MAWS, 'https://a.example/', { typed: false, at: 1 });
    data.reattach([S1]);
    expect(error).toHaveBeenCalledTimes(1); // decided once for the run
    data.close();
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  it('a browser database SQLite cannot read is moved aside, never deleted, and a fresh one made', () => {
    index();
    browserData().close();
    for (const suffix of ['-wal', '-shm']) expect(existsSync(file + suffix)).toBe(false);
    writeFileSync(file, 'not a database, sixteen bytes and more of it');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = browserData();
    expect(data.ready).toBe(true);
    const aside = readdirSync(join(dir.path, 'browser')).filter((name) => /^browser\.sqlite\.broken-\d+$/.test(name));
    expect(aside).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(aside[0]!));
  });
});

// The FK cascade from `browser_activity` to `sessions`, replaced (§4): a removal the browser hears (activity.test.ts),
// a reconciliation at every complete snapshot, and appends for known sessions only.
describe('the agent activity follows the spine\'s sessions', () => {
  let dir: ReturnType<typeof tempDir>;
  let indexPath: string;
  let opened: { close(): void }[];
  const open = <T extends { close(): void }>(made: T): T => {
    opened.push(made);
    return made;
  };
  beforeEach(() => {
    dir = tempDir();
    indexPath = join(dir.path, 'index.sqlite');
    opened = [];
    v13Index(indexPath);
  });
  afterEach(() => {
    for (const db of opened) db.close();
    dir.dispose();
  });

  it('a session removed while no browser listened (or in a crash before it heard) loses its rows at the next start\'s reconciliation; an archived one keeps them', () => {
    const spine = open(new Index(indexPath));
    open(new BrowserData({ file: browserDataFile(dir.path), index: indexPath })).reattach(spine.sessions.appIds());
    opened.pop()!.close();
    spine.sessions.remove(S2); // the index commits; the browser never hears it

    const data = open(new BrowserData({ file: browserDataFile(dir.path), index: indexPath }));
    expect(data.activity.list(S2)).toHaveLength(1); // read before any snapshot: the rows are still there
    data.reattach(spine.sessions.appIds());
    expect(data.activity.list(S2)).toEqual([]);
    expect(data.activity.list(S1)).toHaveLength(2);
    expect(data.activity.list(S3)).toHaveLength(1);
  });

  it('an unavailable spine (no snapshot) reconciles nothing and keeps no new activity', () => {
    open(new Index(indexPath));
    const data = open(new BrowserData({ file: browserDataFile(dir.path), index: indexPath }));
    data.reattach(null);
    expect([S1, S2, S3].map((id) => data.activity.list(id).length)).toEqual([2, 1, 1]);
    data.activity.append([{ appSessionId: S1, tabId: TAB, at: '2026-10-28T00:00:00.000Z', activity: { kind: 'screenshot' } }]);
    expect(data.activity.list(S1)).toHaveLength(2);
  });
});
