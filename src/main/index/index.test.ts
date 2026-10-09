import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { preAmendmentIndex, summary, tempDir } from '../../../test/support/index-fixture';
import { openDb } from './db';
import { Index } from './index';
import { MIGRATIONS, REPAIRS } from './migrations';

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

  it('a fresh index has user_version 7 and the ten tables, in WAL mode', () => {
    const path = join(dir.path, 'index.sqlite');
    const index = open(path);
    expect(index.readOnly).toBe(false);
    expect(index.applied).toEqual([1, 2, 3, 4, 5, 6, 7]); // P2-C: 7
    expect(MIGRATIONS).toHaveLength(7);
    expect(inspect(path)).toEqual({ version: 7, tables: ['attention_items', 'browser_activity', 'browser_history', 'drafts', 'owner_channel_marks', 'owner_channel_sessions', 'projects', 'replay_fixtures', 'sessions', 'side_threads'], mode: 'wal' });
    // The removal mark was amended into v1 (see the repair cases below for databases created before that).
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
    expect(index.applied).toEqual([2, 3, 4, 5, 6, 7]); // P2-C: 7
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
      expect(columnsOf(db)).toEqual([...v1Columns, 'lineage', 'lineage_source', 'root_uuid', 'transcript_birthtime_ms'].sort()); // v4 adds four
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
    expect(index.applied).toEqual([3, 4, 5, 6, 7]); // P2-C: 7
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

  // E3 (X11, A-16): lineage and the disk signal's columns, the side-thread rows, and one forced re-summarise of every
  // engine transcript so the root uuid and the birth time fill for transcripts already indexed
  it('v4 adds lineage, the root uuid, the birth time and the side-thread table, and forces one re-summarise of engine transcripts', () => {
    const path = join(dir.path, 'index.sqlite');
    const raw = new DatabaseSync(path);
    for (const migration of MIGRATIONS.slice(0, 3)) raw.exec(migration.sql);
    raw.exec('PRAGMA user_version = 3');
    const insert = raw.prepare("INSERT INTO sessions (app_id, engine_session_id, directory, transcript_path, transcript_size, transcript_mtime_ms, kind, created_at, updated_at) VALUES (?, ?, '/w', ?, ?, ?, ?, 't', 't')");
    insert.run('on-disk', 'e-1', '/cfg/projects/-w/e-1.jsonl', 4096, 1_000, 'engine');
    insert.run('no-transcript', 'e-2', null, null, null, 'engine');
    insert.run('replay', 'e-3', '/fixtures/r.jsonl', 10, 2_000, 'replay');
    raw.close();

    const index = open(path);
    expect(index.applied).toEqual([4, 5, 6, 7]); // P2-C: 7
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string; type: string }[]).map((c) => [c.name, c.type]);
      expect(columns).toEqual(expect.arrayContaining([['lineage', 'TEXT'], ['lineage_source', 'TEXT'], ['root_uuid', 'TEXT'], ['transcript_birthtime_ms', 'REAL']]));
      const sideColumns = (db.prepare('PRAGMA table_info(side_threads)').all() as { name: string }[]).map((c) => c.name);
      expect(sideColumns).toEqual(['child_app_id', 'parent_app_id', 'opened_at', 'summarised_at', 'text', 'is_error', 'turns', 'last_turn_event_id']);
      const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((i) => i.name);
      expect(indexes).toEqual(['browser_activity_session', 'browser_history_recent', 'owner_channel_marks_session', 'sessions_project', 'sessions_root', 'side_threads_parent']); // E4a: v5 applies after v4; cua board #93: v6 after it; P2-C: v7
      const sizes = db.prepare('SELECT app_id, transcript_size, transcript_mtime_ms, lineage, lineage_source FROM sessions ORDER BY app_id').all();
      expect(sizes).toEqual([
        { app_id: 'no-transcript', transcript_size: null, transcript_mtime_ms: null, lineage: null, lineage_source: null },
        { app_id: 'on-disk', transcript_size: 4096, transcript_mtime_ms: -1, lineage: null, lineage_source: null }, // the next sync re-summarises it
        { app_id: 'replay', transcript_size: 10, transcript_mtime_ms: 2_000, lineage: null, lineage_source: null },
      ]);
    } finally {
      db.close();
    }
    // the host is told the on-disk transcript as known with an mtime no file has, so its next scan re-reads it and, the
    // row staying in `known`, still marks it removed when the file went while MAWS was closed (the whole-branch review)
    expect(index.sessions.bindings().find((b) => b.appSessionId === 'on-disk')).toMatchObject({ size: 4096, mtimeMs: -1 });
    expect(index.sessions.get('on-disk' as AppSessionId)!.lineage).toBeNull();
  });

  // P2-C start (2026-10-09): the owner channel's two tables (the P2-C document, §10), added to a version-6 database
  it('v7 adds the owner channel’s session and mark tables beside a v6 database’s rows, each going with its record', () => {
    const path = join(dir.path, 'index.sqlite');
    const raw = new DatabaseSync(path);
    for (const migration of MIGRATIONS.slice(0, 6)) raw.exec(migration.sql);
    raw.exec('PRAGMA user_version = 6');
    raw.prepare("INSERT INTO sessions (app_id, engine_session_id, directory, kind, created_at, updated_at) VALUES ('kept', 'e-1', '/w', 'engine', 't', 't')").run();
    raw.close();

    const index = open(path);
    expect(index.applied).toEqual([7]);
    expect(index.sessions.get('kept' as AppSessionId)).not.toBeNull();
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      expect(columns('owner_channel_sessions')).toEqual(['app_session_id', 'override', 'enabled_at', 'launch_id', 'launched_at', 'desired', 'recorded', 'appended', 'snapshot_off', 'off_unavailable', 'applied', 'style', 'observed_style', 'style_mismatch']);
      expect(columns('owner_channel_marks')).toEqual(['id', 'app_session_id', 'kind', 'message_uuid', 'block_index', 'span', 'grammar', 'head', 'at', 'item', 'live', 'state', 'answer_text', 'answer_origin', 'answer_members', 'answered_at', 'read_at', 'state_changed_at']);
    } finally {
      db.close();
    }
    index.ownerChannel.setOverride('kept' as AppSessionId, 'off');
    expect(index.ownerChannel.override('kept' as AppSessionId)).toBe('off');
    expect(() => index.ownerChannel.setOverride('kept' as AppSessionId, 'sometimes' as 'off')).toThrow(/CHECK/);
  });
  // P2-C end

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

  // `sessions.removed_at` was amended into the released v1 entry; a database created before that is at version 3 without
  // it, and every discovery update of an existing record failed with `no such column: removed_at`.
  describe('the schema repair (a released entry amended after some database applied it)', () => {
    afterEach(() => vi.restoreAllMocks());
    const sessionColumns = (path: string) => {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        return (db.prepare('PRAGMA table_info(sessions)').all() as { name: string; type: string; notnull: number }[]).map((c) => [c.name, c.type, c.notnull]);
      } finally {
        db.close();
      }
    };
    it('a pre-amendment database at user_version 3 gains sessions.removed_at on open, and discovery updates its existing records', () => {
      const path = join(dir.path, 'index.sqlite');
      const live = summary();
      const ownerArchived = summary();
      preAmendmentIndex(path, [
        { appId: 'live', sessionId: live.sessionId, archived: 0 },
        { appId: 'owner-archived', sessionId: ownerArchived.sessionId, archived: 1 },
      ]);
      expect(sessionColumns(path).map(([name]) => name)).not.toContain('removed_at');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const index = open(path);
      // E3's migration 4 (and any later entry) is pending on a version-3 database and applies after the repair
      const pending = MIGRATIONS.filter((m) => m.version > 3).map((m) => m.version);
      expect(index.applied).toEqual(pending);
      expect(inspect(path).version).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
      expect(sessionColumns(path)).toContainEqual(['removed_at', 'TEXT', 0]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('sessions.removed_at'));

      const updated = index.sessions.upsertFromSummary({ ...live, lastRecordAt: '2026-09-28T11:00:00.000Z' });
      expect(updated).toMatchObject({ created: false, record: { appId: 'live', archived: false } });
      // a repaired row's mark is null, so the owner's own archive is not taken for the removal's and stays
      expect(index.sessions.upsertFromSummary(ownerArchived).record).toMatchObject({ appId: 'owner-archived', archived: true });
      // and the column carries the removal mark from now on: removed, then back, lifts the removal's archive
      index.sessions.markTranscriptRemoved(live.sessionId);
      expect(index.sessions.upsertFromSummary(live).record).toMatchObject({ appId: 'live', archived: false });
    });

    // The owner's archive sheet failed with `no such column: removed_at` (E11's sitting; owner-notes report A): the
    // archive writes the removal mark, so every history that applied v1 before the amendment must be repaired before it
    // runs, whether migrations are pending (3, 4) or not (5, the current version).
    describe.each([3, 4, 5])('an archive on a pre-amendment database carried to user_version %i', (version) => {
      const removedAt = (path: string, appId: string) => {
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          return db.prepare('SELECT archived, removed_at FROM sessions WHERE app_id = ?').get(appId);
        } finally {
          db.close();
        }
      };

      it('archives, clears the removal mark, survives a reopen and the next discovery', () => {
        const path = join(dir.path, 'index.sqlite');
        const live = summary();
        preAmendmentIndex(path, [{ appId: 'live', sessionId: live.sessionId, archived: 0 }], version);
        expect(sessionColumns(path).map(([name]) => name)).not.toContain('removed_at');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const index = open(path);
        expect(index.applied).toEqual(MIGRATIONS.filter((m) => m.version > version).map((m) => m.version));
        expect(warn).toHaveBeenCalledTimes(1); // the repair ran, with or without a pending migration
        const appId = 'live' as AppSessionId;
        expect(index.sessions.update(appId, { archived: true })).toMatchObject({ appId, archived: true });
        expect(removedAt(path, appId)).toEqual({ archived: 1, removed_at: null });
        index.close();
        opened.pop();

        const again = open(path);
        expect(again.applied).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1); // nothing left to repair
        expect(again.sessions.get(appId)).toMatchObject({ archived: true });
        // the owner's archive is not the removal's: discovery seeing the transcript again leaves it archived
        expect(again.sessions.upsertFromSummary({ ...live, lastRecordAt: '2026-10-08T09:00:00.000Z' }).record).toMatchObject({ appId, archived: true });
        expect(again.sessions.update(appId, { archived: false })).toMatchObject({ archived: false });
      });
    });

    it('a fresh database, created with the column, is unchanged by the repair on this open or the next', () => {
      const path = join(dir.path, 'index.sqlite');
      const reference = join(dir.path, 'reference.sqlite');
      const raw = new DatabaseSync(reference);
      for (const migration of MIGRATIONS) raw.exec(migration.sql);
      raw.close();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      open(path).close();
      opened.pop();
      expect(sessionColumns(path)).toEqual(sessionColumns(reference));
      expect(open(path).applied).toEqual([]);
      expect(sessionColumns(path)).toEqual(sessionColumns(reference));
      expect(warn).not.toHaveBeenCalled();
    });

    it('the repair is idempotent: a second open of the repaired database adds nothing and logs nothing', () => {
      const path = join(dir.path, 'index.sqlite');
      preAmendmentIndex(path);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      open(path).close();
      opened.pop();
      const repaired = sessionColumns(path);
      expect(warn).toHaveBeenCalledTimes(1);

      open(path);
      expect(sessionColumns(path)).toEqual(repaired);
      expect(repaired.filter(([name]) => name === 'removed_at')).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    // A later entry is written against the amended history, so the repair comes first; and it shares the opening
    // transaction, so a pending entry that fails leaves the database as found.
    it('runs before the pending migrations, inside their transaction', () => {
      const path = join(dir.path, 'index.sqlite');
      preAmendmentIndex(path);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const next = MIGRATIONS[MIGRATIONS.length - 1].version + 1; // past every released entry (E4a took 5)
      const pending = MIGRATIONS.filter((m) => m.version > 3).map((m) => m.version);
      const failing = [...MIGRATIONS, { version: next, sql: 'CREATE TABLE later (x); SELECT * FROM no_such_table;' }];
      expect(() => openDb(path, failing, REPAIRS)).toThrow(/no_such_table/);
      expect(sessionColumns(path).map(([name]) => name)).not.toContain('removed_at');
      expect(inspect(path)).toMatchObject({ version: 3, tables: ['attention_items', 'drafts', 'projects', 'replay_fixtures', 'sessions'] });

      const later = [...MIGRATIONS, { version: next, sql: 'CREATE INDEX sessions_removed ON sessions(removed_at);' }];
      const db = openDb(path, later, REPAIRS);
      try {
        expect(db.applied).toEqual([...pending, next]);
        expect(db.get<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE name = 'sessions_removed'")).toEqual({ n: 1 });
      } finally {
        db.close();
      }
    });
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
    expect(index.unavailable).toBe('user_version 99 is newer than this app knows (7)');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('user_version 99'));
    const message = 'index unavailable: user_version 99 is newer than this app knows (7)';
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
    expect(index.applied).toEqual([1, 2, 3, 4, 5, 6, 7]); // P2-C: 7
    const aside = readdirSync(dir.path).filter((name) => /^index\.sqlite\.broken-\d+$/.test(name));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir.path, aside[0]), 'utf8')).toBe(garbage);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(aside[0]));
    expect(existsSync(path)).toBe(true);
    expect(inspect(path).version).toBe(7);
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
