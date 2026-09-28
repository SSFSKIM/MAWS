import { existsSync, readdirSync, writeFileSync } from 'node:fs';
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

  it('a fresh index has user_version 1 and the five tables, in WAL mode', () => {
    const path = join(dir.path, 'index.sqlite');
    const index = open(path);
    expect(index.readOnly).toBe(false);
    expect(index.applied).toEqual([1]);
    expect(MIGRATIONS).toHaveLength(1);
    expect(inspect(path)).toEqual({ version: 1, tables: ['attention_items', 'drafts', 'projects', 'replay_fixtures', 'sessions'], mode: 'wal' });
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

  it('a database at a user_version newer than the app knows opens read-only: reads answer, writes refuse', () => {
    const path = join(dir.path, 'index.sqlite');
    const seeded = open(path);
    const { record } = seeded.sessions.upsertFromSummary(summary());
    seeded.close();
    opened.pop();
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const index = open(path);
    expect(index.readOnly).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('user_version 99'));
    expect(index.sessions.get(record.appId)).toMatchObject({ appId: record.appId });
    expect(() => index.sessions.setPinned(record.appId, true)).toThrow('the index is read-only');
    expect(inspect(path).version).toBe(99);
  });

  it('an unopenable file is moved aside as index.sqlite.broken-<epoch>, never deleted, and a fresh index is created', () => {
    const path = join(dir.path, 'index.sqlite');
    writeFileSync(path, 'this is not a database, but it is sixteen bytes and more of text');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const index = open(path);
    expect(index.readOnly).toBe(false);
    expect(index.applied).toEqual([1]);
    const aside = readdirSync(dir.path).filter((name) => /^index\.sqlite\.broken-\d+$/.test(name));
    expect(aside).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(aside[0]));
    expect(existsSync(path)).toBe(true);
    expect(inspect(path).version).toBe(1);
  });

  it('bumps one index-wide revision on every session or project change', () => {
    const index = open();
    const before = index.revision;
    const { record } = index.sessions.upsertFromSummary(summary());
    const afterCreate = index.revision;
    expect(afterCreate).toBeGreaterThan(before);
    index.sessions.setPinned(record.appId as AppSessionId, true);
    expect(index.revision).toBeGreaterThan(afterCreate);
  });
});
