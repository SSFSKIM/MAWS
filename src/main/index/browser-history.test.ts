// The browser's history (E4a execution document, Design §6; index migration 5): one row per (partition, url), fed by
// the tabs' committed navigations and read by the address field's suggestions.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';

const P = 'persist:maws-browser';
const OTHER = 'persist:maws-chrome-Default';

describe('BrowserHistoryStore', () => {
  let dir: ReturnType<typeof tempDir>;
  let path: string;
  let index: Index;
  const raw = <T,>(sql: string, ...params: (string | number)[]): T[] => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db.prepare(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  };
  const row = (url: string, partition = P) =>
    raw<{ visit_count: number; typed_count: number; last_visit_ms: number; title: string | null; source: string }>(
      'SELECT visit_count, typed_count, last_visit_ms, title, source FROM browser_history WHERE partition = ? AND url = ?', partition, url,
    )[0];

  beforeEach(() => {
    dir = tempDir();
    path = join(dir.path, 'index.sqlite');
    index = new Index(path);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    index.close();
    dir.dispose();
  });

  it('migration 5 creates the table keyed by (partition, url), its source checked, with the recency index', () => {
    expect(index.applied.at(-1)).toBe(5);
    const columns = raw<{ name: string; type: string; notnull: number; pk: number }>('PRAGMA table_info(browser_history)').map((c) => [c.name, c.type, c.notnull, c.pk]);
    expect(columns).toEqual([
      ['partition', 'TEXT', 1, 1], ['url', 'TEXT', 1, 2], ['title', 'TEXT', 0, 0], ['visit_count', 'INTEGER', 1, 0],
      ['typed_count', 'INTEGER', 1, 0], ['last_visit_ms', 'INTEGER', 1, 0], ['source', 'TEXT', 1, 0],
    ]);
    expect(raw<{ name: string }>('PRAGMA index_list(browser_history)').map((i) => i.name)).toContain('browser_history_recent');
    index.close();
    const db = new DatabaseSync(path);
    expect(() => db.prepare("INSERT INTO browser_history (partition, url, last_visit_ms, source) VALUES ('p', 'u', 1, 'agent')").run()).toThrow(/CHECK/);
    db.close();
    index = new Index(path);
  });

  it('counts each visit, and a typed one apart, keeping the latest time', () => {
    index.browserHistory.visit(P, 'https://a.example/', { typed: false, at: 1000 });
    expect(row('https://a.example/')).toEqual({ visit_count: 1, typed_count: 0, last_visit_ms: 1000, title: null, source: 'maws' });
    index.browserHistory.visit(P, 'https://a.example/', { typed: true, at: 2000 });
    expect(row('https://a.example/')).toEqual({ visit_count: 2, typed_count: 1, last_visit_ms: 2000, title: null, source: 'maws' });
  });

  it('sets the title of a visited URL, and of nothing else', () => {
    index.browserHistory.visit(P, 'https://a.example/', { typed: false, at: 1000 });
    index.browserHistory.setTitle(P, 'https://a.example/', 'Page A');
    index.browserHistory.setTitle(P, 'https://never.example/', 'Never');
    expect(row('https://a.example/').title).toBe('Page A');
    expect(raw('SELECT * FROM browser_history')).toHaveLength(1);
  });

  it('keeps an imported row imported when it is visited again', () => {
    index.close();
    const db = new DatabaseSync(path);
    db.prepare("INSERT INTO browser_history (partition, url, title, visit_count, typed_count, last_visit_ms, source) VALUES (?, ?, 'Imported', 5, 2, 10, 'imported')").run(OTHER, 'https://i.example/');
    db.close();
    index = new Index(path);
    index.browserHistory.visit(OTHER, 'https://i.example/', { typed: false, at: 20 });
    expect(row('https://i.example/', OTHER)).toEqual({ visit_count: 6, typed_count: 2, last_visit_ms: 20, title: 'Imported', source: 'imported' });
  });

  it('suggests rows whose URL or title holds the query, any case, typed first, then most visited, then most recent', () => {
    const visit = (url: string, at: number, typed = false) => index.browserHistory.visit(P, url, { typed, at });
    visit('https://docs.example/electron', 1);
    visit('https://docs.example/electron', 2);
    visit('https://wiki.example/Electron_(software)', 3, true);
    visit('https://news.example/', 4);
    index.browserHistory.setTitle(P, 'https://news.example/', 'ELECTRON weekly');
    visit('https://recent.example/electron', 5);
    visit('https://unrelated.example/', 6);
    index.browserHistory.visit(OTHER, 'https://docs.example/electron-other', { typed: true, at: 7 });

    expect(index.browserHistory.suggest(P, 'Electron')).toEqual([
      { url: 'https://wiki.example/Electron_(software)', title: null }, // typed once
      { url: 'https://docs.example/electron', title: null }, // visited twice
      { url: 'https://recent.example/electron', title: null }, // once, the latest
      { url: 'https://news.example/', title: 'ELECTRON weekly' }, // by its title
    ]);
    expect(index.browserHistory.suggest(P, 'electron', 2)).toHaveLength(2);
    expect(index.browserHistory.suggest(OTHER, 'electron')).toEqual([{ url: 'https://docs.example/electron-other', title: null }]);
  });

  it('answers the eight most recent for an empty query, and treats LIKE’s wildcards as text', () => {
    for (let n = 1; n <= 10; n += 1) index.browserHistory.visit(P, `https://s${n}.example/`, { typed: n === 1, at: n });
    expect(index.browserHistory.suggest(P, '').map((s) => s.url)).toEqual([10, 9, 8, 7, 6, 5, 4, 3].map((n) => `https://s${n}.example/`));
    index.browserHistory.visit(P, 'https://q.example/?p=50%25_off', { typed: false, at: 11 });
    expect(index.browserHistory.suggest(P, '%').map((s) => s.url)).toEqual(['https://q.example/?p=50%25_off']);
    expect(index.browserHistory.suggest(P, '_off').map((s) => s.url)).toEqual(['https://q.example/?p=50%25_off']);
    expect(index.browserHistory.suggest(P, 's_.')).toEqual([]);
  });

  it('removes one partition’s rows', () => {
    index.browserHistory.visit(P, 'https://a.example/', { typed: false, at: 1 });
    index.browserHistory.visit(OTHER, 'https://a.example/', { typed: false, at: 1 });
    index.browserHistory.removePartition(OTHER);
    expect(index.browserHistory.suggest(OTHER, '')).toEqual([]);
    expect(index.browserHistory.suggest(P, '')).toEqual([{ url: 'https://a.example/', title: null }]);
  });

  it('drops visits and suggests nothing when the index is unavailable (a newer app’s file)', () => {
    index.close();
    const newer = join(dir.path, 'newer.sqlite');
    const db = new DatabaseSync(newer);
    db.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY); PRAGMA user_version = 99');
    db.close();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    index = new Index(newer);
    expect(index.readOnly).toBe(true);
    expect(() => index.browserHistory.visit(P, 'https://a.example/', { typed: true, at: 1 })).not.toThrow();
    expect(() => index.browserHistory.setTitle(P, 'https://a.example/', 'A')).not.toThrow();
    expect(() => index.browserHistory.removePartition(P)).not.toThrow();
    expect(index.browserHistory.suggest(P, 'a')).toEqual([]);
  });
});

// E4b start
describe('BrowserHistoryStore.removeImportedExcept (E4b Design §14: the boot sweep’s history pattern)', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    index.close();
    dir.dispose();
  });

  it('removes every row of a prefixed partition no record lists, whatever its source, and nothing else', () => {
    const history = index.browserHistory;
    const LISTED = 'persist:maws-chrome-Profile 1';
    const ORPHAN = 'persist:maws-chrome-Default';
    for (const partition of [P, LISTED, ORPHAN]) history.visit(partition, 'https://a.example/', { typed: false, at: 1 });
    history.visit(ORPHAN, 'https://b.example/', { typed: false, at: 2 });
    expect(history.removeImportedExcept('persist:maws-chrome-', [LISTED])).toBe(2);
    expect(history.suggest(ORPHAN, '')).toEqual([]);
    expect(history.suggest(LISTED, '')).toHaveLength(1);
    expect(history.suggest(P, '')).toHaveLength(1);
    expect(history.removeImportedExcept('persist:maws-chrome-', [])).toBe(1);
  });

  it('removes nothing from an unavailable index', () => {
    index.close();
    const newer = join(dir.path, 'newer.sqlite');
    const db = new DatabaseSync(newer);
    db.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY); PRAGMA user_version = 99');
    db.close();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    index = new Index(newer);
    expect(index.browserHistory.removeImportedExcept('persist:maws-chrome-', [])).toBe(0);
    expect(index.browserHistory.countPartition('persist:maws-chrome-Default')).toBe(0);
  });

  it('counts one partition\'s rows, for the removal\'s answer (E4a\'s removePartition answers nothing)', () => {
    const history = index.browserHistory;
    const IMPORTED = 'persist:maws-chrome-Default';
    history.visit(IMPORTED, 'https://a.example/', { typed: false, at: 1 });
    history.visit(IMPORTED, 'https://b.example/', { typed: false, at: 2 });
    history.visit(P, 'https://a.example/', { typed: false, at: 1 });
    expect(history.countPartition(IMPORTED)).toBe(2);
    history.removePartition(IMPORTED);
    expect(history.countPartition(IMPORTED)).toBe(0);
    expect(history.countPartition(P)).toBe(1);
  });
});

describe('BrowserHistoryStore.importRows (E4b Design §6; Decision Log 16: Chrome’s counts carried, a conflict replaces)', () => {
  let dir: ReturnType<typeof tempDir>;
  let path: string;
  let index: Index;
  const IMPORTED = 'persist:maws-chrome-Default';
  const rowOf = (url: string) => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db.prepare('SELECT title, visit_count, typed_count, last_visit_ms, source FROM browser_history WHERE partition = ? AND url = ?').get(IMPORTED, url);
    } finally {
      db.close();
    }
  };
  const rows = [
    { url: 'https://a.example/', title: 'A', visitCount: 40, typedCount: 7, lastVisitMs: 5000 },
    { url: 'https://b.example/', title: null, visitCount: 3, typedCount: 0, lastVisitMs: 4000 },
  ];
  beforeEach(() => {
    dir = tempDir();
    path = join(dir.path, 'index.sqlite');
    index = new Index(path);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    index.close();
    dir.dispose();
  });

  it('inserts the rows as imported with Chrome’s counts, so suggest ranks them as Chrome would', () => {
    expect(index.browserHistory.importRows(IMPORTED, rows)).toBe(2);
    expect(rowOf('https://a.example/')).toEqual({ title: 'A', visit_count: 40, typed_count: 7, last_visit_ms: 5000, source: 'imported' });
    expect(rowOf('https://b.example/')).toEqual({ title: null, visit_count: 3, typed_count: 0, last_visit_ms: 4000, source: 'imported' });
    expect(index.browserHistory.suggest(IMPORTED, 'example').map((s) => s.url)).toEqual(['https://a.example/', 'https://b.example/']);
    expect(index.browserHistory.suggest('persist:maws-browser', '')).toEqual([]);
  });

  it('is idempotent: importing the same rows twice leaves the counts unchanged', () => {
    index.browserHistory.importRows(IMPORTED, rows);
    expect(index.browserHistory.importRows(IMPORTED, rows)).toBe(2);
    expect(rowOf('https://a.example/')).toEqual({ title: 'A', visit_count: 40, typed_count: 7, last_visit_ms: 5000, source: 'imported' });
  });

  it('over a row visited in MAWS: replaces the counts, keeps the later visit and a title the import lacks, marks it imported', () => {
    index.browserHistory.visit(IMPORTED, 'https://b.example/', { typed: true, at: 9000 });
    index.browserHistory.setTitle(IMPORTED, 'https://b.example/', 'Seen in MAWS');
    index.browserHistory.importRows(IMPORTED, rows);
    expect(rowOf('https://b.example/')).toEqual({ title: 'Seen in MAWS', visit_count: 3, typed_count: 0, last_visit_ms: 9000, source: 'imported' });
  });

  it('fails as indexUnavailable on a read-only index rather than dropping the rows silently', () => {
    index.close();
    const newer = join(dir.path, 'newer.sqlite');
    const db = new DatabaseSync(newer);
    db.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY); PRAGMA user_version = 99');
    db.close();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    index = new Index(newer);
    expect(() => index.browserHistory.importRows(IMPORTED, rows)).toThrow(expect.objectContaining({ code: 'indexUnavailable' }));
  });
});
// E4b end
