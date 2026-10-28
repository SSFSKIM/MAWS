// P5 O3-A acceptance 1 and 2 (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §1 to §4): a profile last run by master
// with O2 (a unified settings.json at version 20, an index at version 13 holding the browser's tables) through the data
// half of main's start as src/main/index.ts runs it: spine.lock, the settings split, both halves, the index (migration 14,
// staged), the browser's database (promoted on the index's version) and the spine's snapshot of the sessions. Every value
// and every row is still there with its id and times, nothing re-indexed, and each file holds exactly its owner's data.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { Settings } from '@shared/ipc/schema/settings';
import { SETTINGS_DEFAULTS_V21, splitSettings } from '@shared/settings/defaults';
import { item } from '../../test/support/builders';
import { summary, tempDir } from '../../test/support/index-fixture';
import { BrowserData } from './browser/data';
import { composeSettings } from './client/settings-store';
import { Index } from '../services/index/index';
import { MIGRATIONS } from '../services/index/migrations';
import { startMachineSettings } from '../services/settings/machine';
import { takeSpineLock } from '../services/settings/spine-lock';
import { settingsPaths } from '@shared/settings/paths';
import { splitSettingsFiles } from '../services/settings/split';

const DS = '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71';
// The owner's settings with every section away from its defaults
const CHOSEN: Settings = {
  ...SETTINGS_DEFAULTS_V21,
  theme: 'dark',
  keymap: { 'attention.next': 'Cmd+Alt+J' },
  engine: { ...SETTINGS_DEFAULTS_V21.engine, subagentModel: 'haiku', mcpServers: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' }] },
  gateway: { defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: false },
  usage: { nearLimitPercent: 75 },
  permissions: { autoFallback: 'plan' },
  voice: { locale: 'en-GB' },
  supervisor: { idleExitMinutes: 30, keepRunningDefault: false, shape: 'embedded' },
  browser: { ...SETTINGS_DEFAULTS_V21.browser, linkTarget: 'external', bookmarksBar: 'hidden' },
  mods: { toHuman: { enabled: false } },
  artifacts: { defaultDesignSystem: DS, spaceDesignSystems: {}, commentsView: 'hide', exportAuthorName: 'Kim Min' },
  sessions: { archiveInactiveDays: 14 },
};
const PARTITION = 'persist:maws';

// Every table's rows (the browser's apart), read in rowid order: what "nothing re-indexed" compares.
function machineRows(path: string): Record<string, unknown[]> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'browser_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    return Object.fromEntries(tables.map((name) => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
  } finally {
    db.close();
  }
}

describe('a profile O2 left starts under O3-A’s build with no visible change', () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir('maws-profile-upgrade-');
  });
  afterEach(() => dir.dispose());

  it('keeps every setting, record, draft, attention item, library row, history entry, bookmark and activity row, each in its owner’s file', async () => {
    const profile = dir.path;
    const indexPath = join(profile, 'index.sqlite');

    // The O2-era profile: the index's machine rows written through its own stores ...
    const before = new Index(indexPath);
    mkdirSync(join(profile, 'work'));
    const project = before.projects.add(join(profile, 'work'));
    const one = before.sessions.upsertFromSummary(summary({ directory: join(profile, 'work'), customTitle: 'Pricing' })).record;
    const two = before.sessions.upsertFromSummary(summary({ directory: '/elsewhere' })).record;
    before.drafts.set(one.appId, { doc: { type: 'doc', content: [] }, attachments: [], updatedAt: '2026-10-27T09:00:00.000Z' });
    await before.attention.replaceForSession(one.appId, [item(one.appId, 'permission', '2026-10-27T09:01:00.000Z')]);
    before.library.reconcile({
      artifacts: [{ id: '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a', kind: 'document', title: 'Launch plan', createdBy: { kind: 'human' }, createdAt: 1_000, updatedAt: 2_000, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 2_000 }],
      links: [], spaces: [],
    });
    before.close();
    // ... then rewound to the version-13 file O2's build left: the browser's tables back in it, with their rows, and no
    // browser database beside it
    rmSync(join(profile, 'browser'), { recursive: true, force: true });
    const raw = new DatabaseSync(indexPath);
    for (const migration of MIGRATIONS.filter((m) => m.version >= 5 && m.version <= 7)) raw.exec(migration.sql);
    raw.exec('PRAGMA foreign_keys = ON');
    raw.prepare("INSERT INTO browser_history (partition, url, title, visit_count, typed_count, last_visit_ms, source) VALUES (?, 'https://pricing.example/', 'Pricing', 4, 2, 1760000000123, 'maws'), (?, 'https://imported.example/', NULL, 9, 0, 1750000000000, 'imported')").run(PARTITION, PARTITION);
    raw.prepare("INSERT INTO browser_bookmarks (id, partition, parent_id, root, position, kind, name, url, added_at_ms) VALUES (7, 'persist:profile-1', NULL, 'bar', 0, 'folder', 'Bookmarks bar', NULL, NULL), (8, 'persist:profile-1', 7, 'bar', 0, 'url', 'Docs', 'https://docs.example/', 1700000000000), (9, 'persist:profile-1', NULL, 'other', 1, 'folder', 'Other', NULL, NULL), (10, 'persist:profile-1', NULL, 'mobile', 2, 'folder', 'Mobile', NULL, NULL)").run();
    raw.prepare("INSERT INTO browser_activity (id, app_session_id, tab_id, at, activity) VALUES (41, ?, 'b_000000000001', '2026-10-27T09:02:00.000Z', ?), (42, ?, 'b_000000000002', '2026-10-27T09:03:00.000Z', ?)").run(one.appId, JSON.stringify({ kind: 'navigated', url: 'https://pricing.example/', title: 'Pricing' }), two.appId, JSON.stringify({ kind: 'screenshot' }));
    raw.exec('PRAGMA user_version = 13');
    const browserRows = Object.fromEntries(['browser_history', 'browser_bookmarks', 'browser_activity'].map((t) => [t, raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
    raw.close();
    const rows = machineRows(indexPath);
    writeFileSync(join(profile, 'settings.json'), JSON.stringify({ ...CHOSEN, version: 20 }));
    mkdirSync(join(profile, 'sessions', 'intents'), { recursive: true });

    // O3-A's start, in main's order
    const spine = await takeSpineLock(profile, { build: '0.0.0+o3a' });
    expect(spine.refused).toBeNull();
    const paths = settingsPaths(profile);
    const split = splitSettingsFiles(paths, undefined, () => {});
    expect(split.outcome).toBe('split');
    const settings = composeSettings({ clientFile: paths.client, machine: startMachineSettings(paths.machine, { refused: split.machineRefused, unsplit: split.unsplit }) });
    const index = new Index(indexPath);
    const browser = new BrowserData({ file: join(profile, 'browser', 'browser.sqlite'), index: indexPath });
    browser.reattach(index.sessions.appIds());
    try {
      // Settings shows every value as before
      expect(settings.settings).toEqual(CHOSEN);
      // the files: each exactly its owner's fields, the client file at 21, the machine file at 1
      expect(JSON.parse(readFileSync(paths.client, 'utf8'))).toEqual(splitSettings(CHOSEN).client);
      expect(JSON.parse(readFileSync(paths.machine, 'utf8'))).toEqual(splitSettings(CHOSEN).machine);
      // the index at 14 with no browser table, every other row as it was: nothing re-indexed
      expect(index.applied).toEqual([14]);
      index.close();
      const db = new DatabaseSync(indexPath, { readOnly: true });
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(14);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'browser_%'").all()).toEqual([]);
      db.close();
      expect(machineRows(indexPath)).toEqual(rows);
      const reopened = new Index(indexPath);
      expect(reopened.sessions.get(one.appId)).toMatchObject({ appId: one.appId, createdAt: one.createdAt, projectId: project.id });
      expect(reopened.sessions.get(two.appId)).toMatchObject({ appId: two.appId, createdAt: two.createdAt });
      expect(reopened.drafts.get(one.appId)).toMatchObject({ updatedAt: '2026-10-27T09:00:00.000Z' });
      expect((await reopened.attention.list()).map((a) => a.id)).toEqual([item(one.appId, 'permission', '2026-10-27T09:01:00.000Z').id]);
      expect(reopened.library.get('0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a')).toMatchObject({ title: 'Launch plan', createdAt: 1_000 });
      reopened.close();
      // the browser's database holds the three tables' rows, ids and times unchanged, and the browser reads them as before
      expect(browser.ready).toBe(true);
      const live = new DatabaseSync(join(profile, 'browser', 'browser.sqlite'), { readOnly: true });
      for (const [table, expected] of Object.entries(browserRows)) expect(live.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), table).toEqual(expected);
      expect(live.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'staging_%'").all()).toEqual([]);
      live.close();
      expect(browser.history.suggest(PARTITION, 'pric').map((s) => s.url)).toEqual(['https://pricing.example/']);
      expect(browser.bookmarks.tree('persist:profile-1').bar.children.map((n) => n.name)).toEqual(['Docs']);
      expect(browser.activity.list(one.appId as AppSessionId).map((a) => a.tabId)).toEqual(['b_000000000001']);
      expect(browser.activity.list(two.appId as AppSessionId).map((a) => a.tabId)).toEqual(['b_000000000002']);
      // and a second start changes nothing
      expect(splitSettingsFiles(paths, undefined, () => {}).outcome).toBe('none');
      const again = new Index(indexPath);
      expect(again.applied).toEqual([]);
      again.close();
      expect(machineRows(indexPath)).toEqual(rows);
    } finally {
      browser.close();
      spine.release();
    }
    expect(existsSync(join(profile, 'spine.lock'))).toBe(false);
  });
});
