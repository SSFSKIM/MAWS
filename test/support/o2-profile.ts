// A profile as master with O2 last left it (P5 O3-A acceptance 1; P5 O3-D acceptance 11): a unified settings.json at
// version 20, an index at version 13 holding the machine's rows (two sessions, a project, a draft, an attention item, a
// library row) and the browser's three tables with their rows, and no browser database beside it. The index's rows are
// written through its own stores at today's version, then the file is rewound to 13 with the browser's tables put back,
// as O2's build left it. src/main/profile-upgrade.test.ts starts it through main's data start in one process, and
// src/main/profile-upgrade-mawsd.test.ts through the built `mawsd` beside the browser in the test's process.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SessionRecord } from '@shared/graph/session';
import type { Settings } from '@shared/ipc/schema/settings';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { Index } from '../../src/services/index/index';
import { MIGRATIONS } from '../../src/services/index/migrations';
import { item } from './builders';
import { summary } from './index-fixture';

const DS = '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71';
// The owner's settings with every section away from its defaults
export const O2_CHOSEN_SETTINGS: Settings = {
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
export const O2_PARTITION = 'persist:maws';
export const O2_LIBRARY_ARTIFACT = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
export const O2_BROWSER_TABLES = ['browser_history', 'browser_bookmarks', 'browser_activity'] as const;

export interface O2Profile {
  indexPath: string;
  project: { id: string };
  one: SessionRecord; // in the project's directory, with a draft and an attention item; two browser activity rows name it
  two: SessionRecord;
  machineRows: Record<string, unknown[]>; // every table's rows but the browser's, as the version-13 file holds them
  browserRows: Record<(typeof O2_BROWSER_TABLES)[number], unknown[]>; // the browser's tables' rows, in rowid order
}

// Every table's rows (the browser's apart), read in rowid order: what "nothing re-indexed" compares.
export function machineRows(path: string): Record<string, unknown[]> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'browser_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    return Object.fromEntries(tables.map((name) => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
  } finally {
    db.close();
  }
}

export async function writeO2Profile(profile: string): Promise<O2Profile> {
  const indexPath = join(profile, 'index.sqlite');
  // the index's machine rows written through its own stores ...
  const before = new Index(indexPath);
  mkdirSync(join(profile, 'work'));
  const project = before.projects.add(join(profile, 'work'));
  const one = before.sessions.upsertFromSummary(summary({ directory: join(profile, 'work'), customTitle: 'Pricing' })).record;
  const two = before.sessions.upsertFromSummary(summary({ directory: '/elsewhere' })).record;
  before.drafts.set(one.appId, { doc: { type: 'doc', content: [] }, attachments: [], updatedAt: '2026-10-27T09:00:00.000Z' });
  await before.attention.replaceForSession(one.appId, [item(one.appId, 'permission', '2026-10-27T09:01:00.000Z')]);
  before.library.reconcile({
    artifacts: [{ id: O2_LIBRARY_ARTIFACT, kind: 'document', title: 'Launch plan', createdBy: { kind: 'human' }, createdAt: 1_000, updatedAt: 2_000, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 2_000 }],
    links: [], spaces: [],
  });
  before.close();
  // ... then rewound to the version-13 file O2's build left: the browser's tables back in it, with their rows, and no
  // browser database beside it
  rmSync(join(profile, 'browser'), { recursive: true, force: true });
  const raw = new DatabaseSync(indexPath);
  for (const migration of MIGRATIONS.filter((m) => m.version >= 5 && m.version <= 7)) raw.exec(migration.sql);
  raw.exec('PRAGMA foreign_keys = ON');
  raw.prepare("INSERT INTO browser_history (partition, url, title, visit_count, typed_count, last_visit_ms, source) VALUES (?, 'https://pricing.example/', 'Pricing', 4, 2, 1760000000123, 'maws'), (?, 'https://imported.example/', NULL, 9, 0, 1750000000000, 'imported')").run(O2_PARTITION, O2_PARTITION);
  raw.prepare("INSERT INTO browser_bookmarks (id, partition, parent_id, root, position, kind, name, url, added_at_ms) VALUES (7, 'persist:profile-1', NULL, 'bar', 0, 'folder', 'Bookmarks bar', NULL, NULL), (8, 'persist:profile-1', 7, 'bar', 0, 'url', 'Docs', 'https://docs.example/', 1700000000000), (9, 'persist:profile-1', NULL, 'other', 1, 'folder', 'Other', NULL, NULL), (10, 'persist:profile-1', NULL, 'mobile', 2, 'folder', 'Mobile', NULL, NULL)").run();
  raw.prepare("INSERT INTO browser_activity (id, app_session_id, tab_id, at, activity) VALUES (41, ?, 'b_000000000001', '2026-10-27T09:02:00.000Z', ?), (42, ?, 'b_000000000002', '2026-10-27T09:03:00.000Z', ?)").run(one.appId, JSON.stringify({ kind: 'navigated', url: 'https://pricing.example/', title: 'Pricing' }), two.appId, JSON.stringify({ kind: 'screenshot' }));
  raw.exec('ALTER TABLE session_text_state DROP COLUMN resume'); // version 15's column, which a version-13 file lacks
  raw.exec('ALTER TABLE sessions DROP COLUMN launched_by'); // version 16's (P5 O7 M4), which it lacks too
  raw.exec('PRAGMA user_version = 13');
  const browserRows = Object.fromEntries(O2_BROWSER_TABLES.map((t) => [t, raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])) as O2Profile['browserRows'];
  raw.close();
  const rows = machineRows(indexPath);
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ ...O2_CHOSEN_SETTINGS, version: 20 }));
  mkdirSync(join(profile, 'sessions', 'intents'), { recursive: true });
  return { indexPath, project, one, two, machineRows: rows, browserRows };
}
