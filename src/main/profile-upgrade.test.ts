// P5 O3-A acceptance 1 and 2 (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §1 to §4): a profile last run by master
// with O2 (a unified settings.json at version 20, an index at version 13 holding the browser's tables) through the data
// half of main's start as src/main/index.ts runs it: spine.lock, the settings split, both halves, the index (migration 14,
// staged), the browser's database (promoted on the index's version) and the spine's snapshot of the sessions. Every value
// and every row is still there with its id and times, nothing re-indexed, and each file holds exactly its owner's data.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { SETTINGS_DEFAULTS_V21, splitSettings } from '@shared/settings/defaults';
import { item } from '../../test/support/builders';
import { tempDir } from '../../test/support/index-fixture';
import { machineRows, O2_CHOSEN_SETTINGS as CHOSEN, O2_LIBRARY_ARTIFACT, O2_PARTITION as PARTITION, writeO2Profile } from '../../test/support/o2-profile';
import { BrowserData } from './browser/data';
import { composeSettings } from './client/settings-store';
import { createMachineSettingsMirror } from './client/machine-settings-mirror';
import { openSpineData } from '../services/spine-root';
import { Index } from '../services/index/index';
import { startMachineSettings } from '../services/settings/machine';
import { takeSpineLock } from '../services/settings/spine-lock';
import { settingsPaths } from '@shared/settings/paths';
import { splitSettingsFiles } from '../services/settings/split';

describe('a profile O2 left starts under O3-A’s build with no visible change', () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir('maws-profile-upgrade-');
  });
  afterEach(() => dir.dispose());

  it('keeps every setting, record, draft, attention item, library row, history entry, bookmark and activity row, each in its owner’s file', async () => {
    const profile = dir.path;
    const indexPath = join(profile, 'index.sqlite');

    // The O2-era profile (test/support/o2-profile.ts)
    const { project, one, two, machineRows: before, browserRows } = await writeO2Profile(profile);
    // every row as it was, with the columns added since, empty (P5 O7 M4: `launched_by`, ADDED_COLUMNS)
    const rows = { ...before, sessions: before.sessions!.map((row) => ({ ...(row as object), launched_by: null })) };

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
      expect(index.applied).toEqual([14, 15]);
      index.close();
      const db = new DatabaseSync(indexPath, { readOnly: true });
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(15);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'browser_%'").all()).toEqual([]);
      db.close();
      expect(machineRows(indexPath)).toEqual(rows);
      const reopened = new Index(indexPath);
      expect(reopened.sessions.get(one.appId)).toMatchObject({ appId: one.appId, createdAt: one.createdAt, projectId: project.id });
      expect(reopened.sessions.get(two.appId)).toMatchObject({ appId: two.appId, createdAt: two.createdAt });
      expect(reopened.drafts.get(one.appId)).toMatchObject({ updatedAt: '2026-10-27T09:00:00.000Z' });
      expect((await reopened.attention.list()).map((a) => a.id)).toEqual([item(one.appId, 'permission', '2026-10-27T09:01:00.000Z').id]);
      expect(reopened.library.get(O2_LIBRARY_ARTIFACT)).toMatchObject({ title: 'Launch plan', createdAt: 1_000 });
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

  // P5 O3-D M5b (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, acceptance 1): on the daemon shape `mawsd` migrates
  // the profile, at its spine's first load (its own lock, then the data start under it, D26), while main, started first,
  // reads both halves without migrating either: the client file as it finds it, the machine half from its file and then
  // from `mawsd`'s answer. A change made before the split waits for it and lands in the converted file.
  it('on the daemon shape mawsd splits the settings under its lock, main shows every value, and a change made before the split persists after it', async () => {
    const profile = dir.path;
    const paths = settingsPaths(profile);
    const unified = JSON.stringify({ ...CHOSEN, version: 20 });
    writeFileSync(paths.client, unified);

    // main starts first: the client file read as it is (unified: not written until mawsd has split it), the machine half
    // from its file (absent: the defaults) until mawsd answers
    let streaming = false;
    const onStreaming = new Set<() => void>();
    let answer: unknown = null;
    const hosts = {
      dispatch: async (_owner: string, name: string) => (name === 'machineSettings.get' ? { ok: true, value: answer } : { ok: false, error: { code: 'unknown_command', message: name } }),
      onEvent: () => () => {},
      onStreaming: (_owner: string, listener: () => void) => (onStreaming.add(listener), () => void onStreaming.delete(listener)),
      streaming: () => streaming,
    };
    const mirror = createMachineSettingsMirror({ file: paths.machine, hosts: hosts as never, log: () => {} });
    const settings = composeSettings({ clientFile: paths.client, machine: mirror, split: mirror.answered });
    expect(settings.settings).toMatchObject({ theme: 'dark', gateway: SETTINGS_DEFAULTS_V21.gateway }); // the client's value; the machine's defaults
    // the person changes the theme before mawsd has loaded: the change waits for the split, nothing written yet
    let changed = false;
    const changing = settings.update({ theme: 'light' }).finally(() => (changed = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(changed).toBe(false);
    expect(readFileSync(paths.client, 'utf8')).toBe(unified);

    // mawsd's spine loads: its lock, the split under it, the machine half
    const lock = await takeSpineLock(profile, { build: '0.0.0+mawsd' });
    try {
      const data = await openSpineData(profile, { build: '0.0.0+mawsd', lock });
      expect(data.refused).toBeNull();
      expect(JSON.parse(readFileSync(paths.client, 'utf8'))).toEqual(splitSettings(CHOSEN).client);
      expect(JSON.parse(readFileSync(paths.machine, 'utf8'))).toEqual(splitSettings(CHOSEN).machine);
      // mawsd answers main's read at the machine host's streaming: Settings shows every value as before
      answer = { settings: data.machineSettings.state(), version: 0 };
      streaming = true;
      for (const listener of onStreaming) listener();
      await vi.waitFor(() => expect(settings.settings).toEqual({ ...CHOSEN, theme: 'light' }));
      // the change made in the window is in the converted client file; main wrote nothing else
      expect(await changing).toEqual({ ...CHOSEN, theme: 'light' });
      expect(JSON.parse(readFileSync(paths.client, 'utf8'))).toEqual({ ...splitSettings(CHOSEN).client, theme: 'light' });
      expect(JSON.parse(readFileSync(paths.machine, 'utf8'))).toEqual(splitSettings(CHOSEN).machine);
    } finally {
      mirror.stop();
      lock.release();
    }
  });
});
