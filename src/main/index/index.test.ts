import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';
import { MIGRATIONS } from './migrations';

describe('the index opens, migrates and refuses what it cannot own', () => {
  let dir: ReturnType<typeof tempDir>;
  let opened: Index[];
  beforeEach(() => {
    dir = tempDir();
    opened = [];
  });
  afterEach(() => {
    for (const index of opened) index.close();
    dir.dispose();
  });
  const open = (path = join(dir.path, 'index.sqlite')) => {
    const index = new Index(path);
    opened.push(index);
    return index;
  };
  const inspect = (path: string) => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
      const mode = (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
      return { version, tables, mode };
    } finally {
      db.close();
    }
  };

  it('a fresh index has user_version 3 and the five tables, in WAL mode', () => {
    const path = join(dir.path, 'index.sqlite');
    const index = open(path);
    expect(index.readOnly).toBe(false);
    expect(index.applied).toEqual([1, 2, 3]);
    expect(MIGRATIONS).toHaveLength(3);
    expect(inspect(path)).toEqual({ version: 3, tables: ['attention_items', 'drafts', 'projects', 'replay_fixtures', 'sessions'], mode: 'wal' });
    // v1 is unshipped, so the removal mark (whole-branch review) is part of it rather than a v2.
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string; type: string; notnull: number }[]).map((c) => [c.name, c.type, c.notnull]);
      expect(columns).toContainEqual(['removed_at', 'TEXT', 0]);
      expect(columns).toContainEqual(['gateway_routed', 'INTEGER', 0]); // v2: null is unknown
    } finally {
      db.close();
    }
  });

  it('v2 makes a v1 default routed flag unknown and keeps the ones a verification wrote', () => {
    const path = join(dir.path, 'index.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec(MIGRATIONS[0].sql);
    raw.exec('PRAGMA user_version = 1');
    const columnsOf = (db: DatabaseSync) => (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name).sort();
    const v1Columns = columnsOf(raw);
    const insert = raw.prepare(
      "INSERT INTO sessions (app_id, directory, gateway_routed, gateway_base_url, created_at, updated_at) VALUES (?, '/w', ?, ?, 't', 't')",
    );
    insert.run('discovered', 1, null); // v1's default for a session found on disk
    insert.run('routed', 1, 'http://127.0.0.1:8641');
    insert.run('direct', 0, null);
    insert.run('mismatch', 0, 'http://127.0.0.1:9999'); // verified, but not through the relay
    raw.exec("UPDATE sessions SET custom_title = 'Kept', pinned = 1, gateway_auto_mode_server = 'enabled', engine_session_id = 'e-routed' WHERE app_id = 'routed'");
    raw.close();

    const index = open(path);
    expect(index.applied).toEqual([2, 3]);
    const routed = (appId: string) => index.sessions.get(appId as AppSessionId)?.gateway.routed;
    expect([routed('discovered'), routed('routed'), routed('direct'), routed('mismatch')]).toEqual([null, true, false, false]);
    // The rebuild touches only the flag: every other column, its values and the project index survive.
    expect(index.sessions.get('routed' as AppSessionId)).toMatchObject({
      engineSessionId: 'e-routed',
      title: { text: 'Kept', source: 'user' },
      pinned: true,
      gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' },
    });
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      expect(columnsOf(db)).toEqual(v1Columns);
      const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions'").all() as { name: string }[]).map((i) => i.name);
      expect(indexes).toContain('sessions_project');
    } finally {
      db.close();
    }
  });

  // W9 (H2): `HEAD` and empty are no branch names; rows an earlier summary filled with them are cleared once, and a later
  // summary naming `HEAD` brings back neither them nor a branch the row held before.
  it('v3 clears the HEAD and empty branches earlier summaries stored, and a later HEAD summary stores none', () => {
    const path = join(dir.path, 'index.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec(MIGRATIONS[0].sql);
    raw.exec(MIGRATIONS[1].sql);
    raw.exec('PRAGMA user_version = 2');
    const insert = raw.prepare('INSERT INTO sessions (app_id, engine_session_id, directory, worktree_path, worktree_branch, branch, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, \'t\', \'t\')');
    const nonRepo = summary({ gitBranch: 'HEAD', directory: '/tmp/not-a-repo' });
    const onMain = summary({ gitBranch: 'main' });
    insert.run('non-repo', nonRepo.sessionId, '/tmp/not-a-repo', null, null, 'HEAD', JSON.stringify(nonRepo));
    insert.run('empty', summary().sessionId, '/w', '/w/.claude/worktrees/x', '', '', null);
    insert.run('on-main', onMain.sessionId, '/w', '/w/.claude/worktrees/y', 'HEAD', 'main', JSON.stringify(onMain));
    raw.close();

    const index = open(path);
    expect(index.applied).toEqual([3]);
    const of = (appId: string) => index.sessions.get(appId as AppSessionId)!;
    expect([of('non-repo').branch, of('empty').branch, of('empty').worktree, of('on-main').branch, of('on-main').worktree]).toEqual([
      null,
      null,
      { path: '/w/.claude/worktrees/x', branch: null },
      'main',
      { path: '/w/.claude/worktrees/y', branch: null },
    ]);
    expect(index.sessions.summaryOf('non-repo' as AppSessionId)?.gitBranch).toBeNull();
    expect(index.sessions.summaryOf('on-main' as AppSessionId)?.gitBranch).toBe('main');

    // the index boundary: a summary still naming HEAD (an older host's, a kept one) stores none, and a row that named a
    // branch does not keep it once the transcript's latest record names HEAD
    expect(index.sessions.upsertFromSummary(nonRepo).record.branch).toBeNull();
    expect(index.sessions.upsertFromSummary({ ...onMain, gitBranch: 'HEAD', lastRecordAt: '2026-09-28T11:00:00.000Z' }).record.branch).toBeNull();
    expect(index.sessions.upsertFromSummary({ ...onMain, gitBranch: 'topic', lastRecordAt: '2026-09-28T12:00:00.000Z' }).record.branch).toBe('topic');
  });

  it('opening it again runs no migration and keeps its rows', () => {
    const path = join(dir.path, 'index.sqlite');
    const first = open(path);
    const { record } = first.sessions.upsertFromSummary(summary());
    first.sessions.setPinned(record.appId, true);
    first.close();
    opened.pop();

    const second = open(path);
    expect(second.applied).toEqual([]);
    expect(second.sessions.get(record.appId)).toMatchObject({ appId: record.appId, pinned: true });
  });

  it('a database at a user_version newer than the app knows opens read-only and is unavailable: nothing reads or writes a schema it does not know', () => {
    const path = join(dir.path, 'index.sqlite');
    const raw = new DatabaseSync(path);
    // A future version whose sessions table has another shape entirely.
    raw.exec("CREATE TABLE sessions (id INTEGER PRIMARY KEY, blob BLOB); INSERT INTO sessions (blob) VALUES (x'00'); PRAGMA user_version = 99");
    raw.close();

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const index = open(path);
    expect(index.readOnly).toBe(true);
    expect(index.unavailable).toBe('user_version 99 is newer than this app knows (3)');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('user_version 99'));
    const message = 'index unavailable: user_version 99 is newer than this app knows (3)';
    expect(() => index.sessions.list()).toThrow(message);
    expect(() => index.sessions.get('x' as AppSessionId)).toThrow(message);
    expect(() => index.sessions.setPinned('x' as AppSessionId, true)).toThrow(message);
    expect(() => index.projects.list()).toThrow(message);
    expect(() => index.drafts.get('x' as AppSessionId)).toThrow(message);
    expect(inspect(path).version).toBe(99);
  });

  it('a newer-version database is left exactly as found: its DELETE journal mode kept, no -wal or -shm, the bytes identical', () => {
    const path = join(dir.path, 'index.sqlite');
    const raw = new DatabaseSync(path);
    raw.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY); PRAGMA user_version = 99');
    raw.close();
    const before = readFileSync(path);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const index = open(path);
    expect(index.unavailable).not.toBeNull();
    index.close();
    opened.pop();
    expect(readdirSync(dir.path)).toEqual(['index.sqlite']);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(inspect(path)).toMatchObject({ version: 99, mode: 'delete' });
  });

  it('a file SQLite reports as not a database is moved aside as index.sqlite.broken-<epoch>, never deleted, and a fresh index is created', () => {
    const path = join(dir.path, 'index.sqlite');
    const garbage = 'this is not a database, but it is sixteen bytes and more of text';
    writeFileSync(path, garbage);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const index = open(path);
    expect(index.readOnly).toBe(false);
    expect(index.applied).toEqual([1, 2, 3]);
    const aside = readdirSync(dir.path).filter((name) => /^index\.sqlite\.broken-\d+$/.test(name));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir.path, aside[0]), 'utf8')).toBe(garbage);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(aside[0]));
    expect(existsSync(path)).toBe(true);
    expect(inspect(path).version).toBe(3);
  });

  it('a transient failure at open (another connection holds the lock) throws and leaves the file untouched', () => {
    const path = join(dir.path, 'index.sqlite');
    const other = new DatabaseSync(path);
    other.exec('CREATE TABLE held (x); PRAGMA user_version = 1');
    other.exec('BEGIN EXCLUSIVE');
    const before = readFileSync(path);
    try {
      expect(() => open(path)).toThrow(/locked|busy/i);
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    expect(readdirSync(dir.path).filter((name) => name.includes('broken'))).toEqual([]);
    expect(readFileSync(path).equals(before)).toBe(true);
  }, 10_000);

  it('stamps one revision per committed change, in commit order; a rolled-back transaction consumes none', () => {
    const index = open();
    const stamped: number[] = [];
    index.sessions.onChange((_record, _cause, revision) => stamped.push(revision));
    const before = index.revision;
    const { record } = index.sessions.upsertFromSummary(summary());
    index.sessions.setPinned(record.appId as AppSessionId, true);
    expect(stamped).toEqual([before + 1, before + 2]);
    expect(index.revision).toBe(before + 2);

    expect(() =>
      index.transaction(() => {
        index.sessions.setPinned(record.appId, false);
        index.sessions.upsertFromSummary(summary());
        throw new Error('abandoned');
      }),
    ).toThrow('abandoned');
    expect(index.revision).toBe(before + 2);
    expect(stamped).toHaveLength(2);
  });
});
