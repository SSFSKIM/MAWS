// The agent's browser activity (cua board #93; index migration 6): what main told the windows an agent did through cua,
// kept per session across app restarts, the last BROWSER_ACTIVITIES_KEPT, gone with the session's record.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';

const T = 'b_000000000001';
const told = (appSessionId: AppSessionId, n: number, activity: BrowserAgentActivity['activity'] = { kind: 'key', key: `F${n}` }): BrowserAgentActivity => ({
  appSessionId, tabId: T, at: new Date(1_000_000 + n).toISOString(), activity,
});

describe('BrowserActivityStore', () => {
  let dir: ReturnType<typeof tempDir>;
  let path: string;
  let index: Index;
  let a: AppSessionId;
  let b: AppSessionId;
  beforeEach(() => {
    dir = tempDir();
    path = join(dir.path, 'index.sqlite');
    index = new Index(path);
    a = index.sessions.upsertFromSummary(summary()).record.appId;
    b = index.sessions.upsertFromSummary(summary()).record.appId;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    index.close();
    dir.dispose();
  });

  it('answers a session\'s activities as written, oldest first, across a reopen', () => {
    const navigated = told(a, 1, { kind: 'navigated', url: 'https://a.example/', title: 'A' });
    const clicked = told(a, 2, { kind: 'clicked', x: 1, y: 2, label: null });
    index.browserActivity.append([navigated]);
    index.browserActivity.append([told(b, 3)]);
    index.browserActivity.append([clicked]);
    index.close();
    index = new Index(path);
    expect(index.browserActivity.list(a)).toEqual([navigated, clicked]);
    expect(index.browserActivity.list(b)).toEqual([told(b, 3)]);
    expect(index.browserActivity.list('unknown' as AppSessionId)).toEqual([]);
  });

  it('keeps each session\'s last `keep`, dropping its oldest and never another session\'s', () => {
    for (let n = 0; n < 4; n++) index.browserActivity.append([told(a, n)], 5);
    index.browserActivity.append([4, 5, 6].map((n) => told(a, n)), 5); // a tick's batch, pruned once
    index.browserActivity.append([told(b, 100)], 5);
    expect(index.browserActivity.list(a).map((x) => x.activity)).toEqual([2, 3, 4, 5, 6].map((n) => ({ kind: 'key', key: `F${n}` })));
    expect(index.browserActivity.list(a, 2).map((x) => x.at)).toEqual([told(a, 5).at, told(a, 6).at]); // the latest two, still oldest first
    expect(index.browserActivity.list(b)).toHaveLength(1);
  });

  it('goes with the session\'s record', () => {
    index.browserActivity.append([told(a, 1)]);
    index.browserActivity.append([told(b, 2)]);
    index.sessions.remove(a);
    expect(index.browserActivity.list(a)).toEqual([]);
    expect(index.browserActivity.list(b)).toHaveLength(1);
  });

  it('keeps nothing of a session with no record, and the rest of its batch', () => {
    index.browserActivity.append([told('unknown' as AppSessionId, 1), told(a, 2)]);
    expect(index.browserActivity.list('unknown' as AppSessionId)).toEqual([]);
    expect(index.browserActivity.list(a)).toEqual([told(a, 2)]);
  });

  it('fails at once, writing nothing, while another connection holds the write lock', () => {
    const other = new DatabaseSync(path);
    other.exec('BEGIN IMMEDIATE');
    try {
      const started = performance.now();
      expect(() => index.browserActivity.append([told(a, 1)])).toThrow(/locked|busy/i);
      expect(performance.now() - started).toBeLessThan(100); // never the index's 2 s busy timeout
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    index.browserActivity.append([told(a, 2)]);
    expect(index.browserActivity.list(a)).toEqual([told(a, 2)]);
  });

  it('writes nothing once closed', () => {
    index.browserActivity.close();
    expect(() => index.browserActivity.append([told(a, 1)])).not.toThrow();
    expect(index.browserActivity.list(a)).toEqual([]);
  });

  it('skips a row it cannot read (a later app\'s kind) and answers the rest', () => {
    index.browserActivity.append([told(a, 1)]);
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO browser_activity (app_session_id, tab_id, at, activity) VALUES (?, ?, ?, ?)').run(a, T, told(a, 2).at, JSON.stringify({ kind: 'scrolled', dy: 3 }));
    db.prepare('INSERT INTO browser_activity (app_session_id, tab_id, at, activity) VALUES (?, ?, ?, ?)').run(a, T, told(a, 3).at, 'not json');
    db.close();
    index.browserActivity.append([told(a, 4)]);
    expect(index.browserActivity.list(a)).toEqual([told(a, 1), told(a, 4)]);
  });

  it('keeps and answers nothing when the index is unavailable (a newer app\'s file)', () => {
    index.close();
    const newer = join(dir.path, 'newer.sqlite');
    const db = new DatabaseSync(newer);
    db.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY); PRAGMA user_version = 99');
    db.close();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    index = new Index(newer);
    expect(() => index.browserActivity.append([told(a, 1)])).not.toThrow();
    expect(index.browserActivity.list(a)).toEqual([]);
  });
});
