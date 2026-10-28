// The agent's browser activity (cua board #93; index migration 6, the browser's own database since P5 O3-A): what main
// told the windows an agent did through cua, kept per session across app restarts, the last BROWSER_ACTIVITIES_KEPT,
// only for sessions the spine has a record of, and gone with the session's record.
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import { browserDataFile, browserDataIn, waitingBrowserDataIn } from '../../../../test/support/browser-data';
import { tempDir } from '../../../../test/support/index-fixture';
import type { BrowserData } from './index';

const T = 'b_000000000001';
const told = (appSessionId: AppSessionId, n: number, activity: BrowserAgentActivity['activity'] = { kind: 'key', key: `F${n}` }): BrowserAgentActivity => ({
  appSessionId, tabId: T, at: new Date(1_000_000 + n).toISOString(), activity,
});
const a = 'aaaaaaaa-0000-4000-8000-000000000001' as AppSessionId;
const b = 'bbbbbbbb-0000-4000-8000-000000000002' as AppSessionId;

describe('BrowserActivityStore', () => {
  let dir: ReturnType<typeof tempDir>;
  let path: string;
  let data: BrowserData;
  beforeEach(() => {
    dir = tempDir();
    path = browserDataFile(dir.path);
    data = browserDataIn(dir.path, [a, b]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    data.close();
    dir.dispose();
  });

  it('answers a session\'s activities as written, oldest first, across a reopen', () => {
    const navigated = told(a, 1, { kind: 'navigated', url: 'https://a.example/', title: 'A' });
    const clicked = told(a, 2, { kind: 'clicked', x: 1, y: 2, label: null });
    data.activity.append([navigated]);
    data.activity.append([told(b, 3)]);
    data.activity.append([clicked]);
    data.close();
    data = browserDataIn(dir.path, [a, b]);
    expect(data.activity.list(a)).toEqual([navigated, clicked]);
    expect(data.activity.list(b)).toEqual([told(b, 3)]);
    expect(data.activity.list('unknown' as AppSessionId)).toEqual([]);
  });

  it('keeps each session\'s last `keep`, dropping its oldest and never another session\'s', () => {
    for (let n = 0; n < 4; n++) data.activity.append([told(a, n)], 5);
    data.activity.append([4, 5, 6].map((n) => told(a, n)), 5); // a tick's batch, pruned once
    data.activity.append([told(b, 100)], 5);
    expect(data.activity.list(a).map((x) => x.activity)).toEqual([2, 3, 4, 5, 6].map((n) => ({ kind: 'key', key: `F${n}` })));
    expect(data.activity.list(a, 2).map((x) => x.at)).toEqual([told(a, 5).at, told(a, 6).at]); // the latest two, still oldest first
    expect(data.activity.list(b)).toHaveLength(1);
  });

  // P5 O3-A: the index's ON DELETE CASCADE, kept by the browser (the O3 document §4)
  it('goes with the session\'s record: a removal the browser hears deletes the rows, and its later appends are refused', () => {
    data.activity.append([told(a, 1)]);
    data.activity.append([told(b, 2)]);
    data.sessionChanged(a, true);
    expect(data.activity.list(a)).toEqual([]);
    expect(data.activity.list(b)).toHaveLength(1);
    data.activity.append([told(a, 3)]); // a row the feed still held for it
    expect(data.activity.list(a)).toEqual([]);
  });

  it('keeps nothing of a session the spine has no record of, and the rest of its batch; a session it hears of is kept from then on', () => {
    const c = 'cccccccc-0000-4000-8000-000000000003' as AppSessionId;
    data.activity.append([told(c, 1), told(a, 2)]);
    expect(data.activity.list(c)).toEqual([]);
    expect(data.activity.list(a)).toEqual([told(a, 2)]);
    data.sessionChanged(c, false); // its record was made
    data.activity.append([told(c, 3)]);
    expect(data.activity.list(c)).toEqual([told(c, 3)]);
  });

  it('keeps nothing with no snapshot of the spine\'s sessions (the spine unavailable)', () => {
    data.reattach(null);
    data.activity.append([told(a, 1)]);
    data.sessionChanged(a, false); // a change is no snapshot
    data.activity.append([told(a, 2)]);
    expect(data.activity.list(a)).toEqual([]);
  });

  it('fails at once, writing nothing, while another connection holds the write lock', () => {
    const other = new DatabaseSync(path);
    other.exec('BEGIN IMMEDIATE');
    try {
      const started = performance.now();
      expect(() => data.activity.append([told(a, 1)])).toThrow(/locked|busy/i);
      expect(performance.now() - started).toBeLessThan(500);
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    data.activity.append([told(a, 2)]);
    expect(data.activity.list(a)).toEqual([told(a, 2)]);
  });

  it('runs its flushers as the browser\'s data closes, before the connection goes, and not after one is removed', () => {
    data.activity.beforeClose(() => data.activity.append([told(a, 1)]));
    const removed = data.activity.beforeClose(() => data.activity.append([told(a, 2)]));
    removed();
    data.close();
    data = browserDataIn(dir.path, [a, b]);
    expect(data.activity.list(a)).toEqual([told(a, 1)]);
  });

  it('writes nothing once closed', () => {
    data.activity.close();
    expect(() => data.activity.append([told(a, 1)])).not.toThrow();
    expect(data.activity.list(a)).toEqual([]);
  });

  it('skips a row it cannot read (a later app\'s kind) and answers the rest', () => {
    data.activity.append([told(a, 1)]);
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO browser_activity (app_session_id, tab_id, at, activity) VALUES (?, ?, ?, ?)').run(a, T, told(a, 2).at, JSON.stringify({ kind: 'scrolled', dy: 3 }));
    db.prepare('INSERT INTO browser_activity (app_session_id, tab_id, at, activity) VALUES (?, ?, ?, ?)').run(a, T, told(a, 3).at, 'not json');
    db.close();
    data.activity.append([told(a, 4)]);
    expect(data.activity.list(a)).toEqual([told(a, 1), told(a, 4)]);
  });

  it('keeps and answers nothing while the browser\'s data waits on the index', () => {
    data.activity.append([told(a, 1)]);
    data.close();
    data = waitingBrowserDataIn(dir.path);
    data.reattach([a, b]);
    expect(() => data.activity.append([told(a, 2)])).not.toThrow();
    expect(data.activity.list(a)).toEqual([]);
    expect(() => data.sessionChanged(a, true)).not.toThrow();
  });
});
