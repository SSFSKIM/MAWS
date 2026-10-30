// Index migration 14 and its staging step (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §2 and §4): the
// browser's tables leave the index, copied first into the browser database's staging tables beside it. The transfer's
// crash cases and the promotion are the browser's suites (src/main/browser/data/index.test.ts); these are the index's
// own: what an index too old to have the tables stages, a broken target, and a build that stops at 13 (acceptance 7).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_TABLES, stagingTable } from '@shared/browser/data-schema';
import { preAmendmentIndex, tempDir } from '../../../test/support/index-fixture';
import { browserDataBeside } from './browser-staging';
import { openDb } from './db';
import { Index } from './index';
import { MIGRATIONS, REPAIRS } from './migrations';

const STAGING = BROWSER_TABLES.map(stagingTable).sort();

function tableRows(path: string): Record<string, number> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    return Object.fromEntries(names.map((name) => [name, (db.prepare(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n]));
  } finally {
    db.close();
  }
}

describe('index migration 14 (P5 O3-A)', () => {
  let dir: ReturnType<typeof tempDir>;
  let path: string;
  beforeEach(() => {
    dir = tempDir();
    path = join(dir.path, 'index.sqlite');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    dir.dispose();
  });

  it('stages its tables next to the index, in <dir>/browser/browser.sqlite', () => {
    expect(browserDataBeside(path)).toBe(join(dir.path, 'browser', 'browser.sqlite'));
  });

  // §4: an index below version 5 has no browser table yet; the step runs after the earlier pending entries, which make
  // them empty, so the copy is of empty tables, and the browser promotes nothing
  it.each([
    ['a fresh index', () => {}],
    ['an index at version 3 (the owner\'s pre-amendment one)', () => preAmendmentIndex(path, [{ appId: 'kept', sessionId: '00000000-0000-4000-8000-000000000001', archived: 0 }])],
  ])('%s stages the three tables empty', (_name, make) => {
    make();
    new Index(path).close();
    expect(tableRows(browserDataBeside(path))).toEqual(Object.fromEntries(STAGING.map((name) => [name, 0])));
  });

  it('a browser database SQLite reports as not a database is moved aside, never deleted, and staged afresh', () => {
    const target = browserDataBeside(path);
    new Index(join(dir.path, 'first.sqlite')).close(); // makes <dir>/browser/
    const garbage = 'this is not a database, but it is sixteen bytes and more of text';
    writeFileSync(target, garbage);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const index = new Index(path);
    try {
      expect(index.applied).toContain(14);
    } finally {
      index.close();
    }
    const aside = readdirSync(join(dir.path, 'browser')).filter((name) => /^browser\.sqlite\.broken-\d+$/.test(name));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir.path, 'browser', aside[0]!), 'utf8')).toBe(garbage);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(aside[0]!));
    expect(Object.keys(tableRows(target))).toEqual(STAGING);
  });

  // acceptance 7's index half: a build from before O3-A meets an index O3-A migrated
  it('an opener knowing migrations 1 to 13 only opens a version-14 index read-only and unavailable, and the file does not change', () => {
    openDb(path, MIGRATIONS.slice(0, 14), REPAIRS).close();
    const before = readFileSync(path);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const older = openDb(path, MIGRATIONS.slice(0, 13), REPAIRS);
    try {
      expect(older.unavailable).toBe('user_version 14 is newer than this app knows (13)');
      expect(older.readOnly).toBe(true);
      expect(() => older.all('SELECT * FROM sessions')).toThrow('index unavailable: user_version 14 is newer than this app knows (13)');
    } finally {
      older.close();
    }
    expect(error).toHaveBeenCalledTimes(1);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(existsSync(`${path}-wal`) ? readFileSync(`${path}-wal`).length : 0).toBe(0);
  });
});
