// cua board #90's `browser-chrome` group (the in-app browser's Chrome-like top chrome; its spec's Acceptance), against the
// synthetic Chrome user data directory (test/support/chrome-profile.ts; Default has a `Bookmarks` file: A, B, a
// bookmarklet, folder F with F1, F2 and folder G with G1, N01 to N40, and O1 under Other bookmarks), never the owner's
// Chrome or Keychain, in the product app over the replay (no engine).
//
// M1a (bookmarks behind the chrome) proves: (1) the import sheet asks about Bookmarks with the count found and the report
// counts them, the rows reach the index per partition; (5, IPC half) an edited `Bookmarks` is read again at the next
// launch, and `browser.bookmarks.sync` reads it again now, a deleted file keeping the rows and recording the error;
// (6, the answer's shape) the address field's suggestions carry the partition's bookmarks above its history; (10, the
// rows) removing the profile leaves no `browser_bookmarks` row of its partition. Nothing logs a value.
// Runs under `pnpm e2e:browser-chrome` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import type { BookmarkNode, BookmarkTree } from '@shared/browser/bookmarks';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import { writeChromeBookmarks, type FixtureBookmarks } from '../test/support/chrome-profile';
import { startBrowserServer } from './support/browser-server';
import {
  closeSheet, expectNothingLogged, importScratch, importThrough, launchImportScene, openImportSheet, phasesHeard, recordOf, recordPhases, suggest,
} from './support/browser-import-scene';
import { invoke, value } from './support/c7-replay';
import { closeScene } from './support/maws-tools';

test.describe.configure({ timeout: 240_000 });

const DEFAULT = profilePartition('Default');
const N = Array.from({ length: 40 }, (_, k) => `N${String(k + 1).padStart(2, '0')}`);

// A tree as names: a URL bookmark is its name, a folder `[name, children]`.
type Shape = string | [string, Shape[]];
const shape = (node: BookmarkNode): Shape => (node.kind === 'url' ? node.name : [node.name, node.children.map(shape)]);
const treeOf = async (page: Page, partition = DEFAULT): Promise<BookmarkTree> => value(await invoke(page, 'browser.bookmarks.tree', { partition })).tree;
const barOf = async (page: Page, partition = DEFAULT) => (await treeOf(page, partition)).bar.children.map(shape);

// The index's rows of a partition, read beside the running app (WAL: a reader sees what main committed).
function bookmarkRows(userData: string, partition: string): number {
  const db = new DatabaseSync(join(userData, 'index.sqlite'), { readOnly: true });
  try {
    return (db.prepare('SELECT count(*) AS n FROM browser_bookmarks WHERE partition = ?').get(partition) as { n: number }).n;
  } finally {
    db.close();
  }
}

// Every `browser.bookmarks.changed` partition the window hears, in order (installed once per launch).
async function recordChanges(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __cua90Changed?: string[] };
    if (w.__cua90Changed) return;
    const heard: string[] = [];
    w.__cua90Changed = heard;
    window.maws.on('browser.bookmarks.changed', ({ partition }) => void heard.push(partition));
  });
}
const changesHeard = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __cua90Changed?: string[] }).__cua90Changed ?? []);

// ---- (1, 6, 10) the import, the suggestions, the removal ---------------------------------------------------------------

test('1, 6, 10: the import asks about Bookmarks and counts them, the rows reach the index, the address field suggests them above history, and removal leaves no row', async () => {
  const { scratch, chrome } = importScratch(['cua #90: bookmarks']);
  const server = await startBrowserServer();
  try {
    const s = await launchImportScene(scratch, server, chrome, { keychain: `file:${chrome.passwordFile}` });
    try {
      await recordPhases(s);
      await recordChanges(s.page);

      // (1) the consent: Bookmarks between Cookies and Extensions, the count found, checked
      const sheet = await openImportSheet(s);
      await sheet.getByRole('button', { name: 'Continue' }).click();
      await expect(sheet).toHaveAttribute('data-browser-import', 'consent');
      expect(await sheet.locator('[data-category]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-category')))).toEqual([
        'history', 'cookies', 'bookmarks', 'passwords', 'extensions',
      ]);
      await expect(sheet.locator('[data-category="bookmarks"]')).toContainText('46 bookmarks');
      await expect(sheet.getByRole('checkbox', { name: 'Bookmarks', exact: true })).toBeChecked();
      await closeSheet(s);

      // (1) the report: 46 imported, 1 skipped; the phase between verifying and extensions; the rows in the index
      const done = await importThrough(s);
      await expect(done.locator('[data-import-summary]')).toContainText('46 bookmarks');
      await expect(done.locator('[data-import-summary]')).toContainText('1 bookmark not imported');
      expect(await phasesHeard(s)).toEqual(['copying', 'history', 'keychain', 'cookies', 'verifying', 'bookmarks', 'extensions', 'cleaning']);
      await closeSheet(s);
      const record = (await recordOf(s, 'Default'))!;
      expect(record.report.bookmarks).toEqual({ imported: 46, skipped: 1, error: null });
      expect(record.bookmarks).toMatchObject({ consentedAt: record.report.startedAt, count: 46, error: null, errorAt: null });
      expect(record.bookmarks!.syncedAt).not.toBeNull();
      expect(await barOf(s.page)).toEqual(['A', 'B', ['F', ['F1', 'F2', ['G', ['G1']]]], ...N]);
      expect((await treeOf(s.page)).other.children.map(shape)).toEqual(['O1']);
      expect((await treeOf(s.page)).mobile.children).toEqual([]);
      expect((await treeOf(s.page)).bar.children[0]).toMatchObject({ kind: 'url', url: chrome.profiles.Default.bookmarks!.urls.A });
      expect(await barOf(s.page, DEFAULT_PARTITION)).toEqual([]); // the Default partition has no bookmarks
      expect(await changesHeard(s.page)).toEqual([DEFAULT]);

      // (6) the answer's shape: a bookmark above the history rows, with its kind; a history-only title as before
      const f1 = await suggest(s, DEFAULT, 'f1');
      expect(f1[0]).toEqual({ url: chrome.profiles.Default.bookmarks!.urls.F1, title: 'F1', kind: 'bookmark' });
      const imported = chrome.profiles.Default.history.entries.filter((entry) => entry.expected === 'imported');
      const historyOnly = await suggest(s, DEFAULT, imported[0]!.title);
      expect(historyOnly).toEqual([{ url: imported[0]!.url, title: imported[0]!.title, kind: 'history' }]);
      expect((await suggest(s, DEFAULT, 'bookmark/N')).filter((row) => row.kind === 'bookmark')).toHaveLength(3); // at most 3 of 8

      // (10, the rows) Remove imported profile: no row of the partition left, the tree empty
      expect(bookmarkRows(s.maws.userData, DEFAULT)).toBe(3 + 2 + 46); // the roots, F and G, and the URLs
      value(await invoke(s.page, 'browser.import.remove', { profileDir: 'Default' }));
      expect(bookmarkRows(s.maws.userData, DEFAULT)).toBe(0);
      expect(await barOf(s.page)).toEqual([]);
      expect((await suggest(s, DEFAULT, 'f1')).filter((row) => row.kind === 'bookmark')).toEqual([]);
      await expectNothingLogged(s);
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);
  } finally {
    await server.close();
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

// ---- (5, the IPC half) the mirror ----------------------------------------------------------------------------------------

test('5: an edited Bookmarks is read again at the next launch and on browser.bookmarks.sync; a deleted file keeps the rows and records the error', async () => {
  const { scratch, chrome } = importScratch(['cua #90: mirror']);
  const server = await startBrowserServer();
  const keychain = `file:${chrome.passwordFile}`;
  const file = chrome.profiles.Default.bookmarks!.file;
  const roots = chrome.profiles.Default.bookmarks!.roots;
  const url = (name: string) => `https://bookmarks.example.test/${name}`;
  const edit = (change: (roots: FixtureBookmarks) => FixtureBookmarks) => writeChromeBookmarks(file, change(roots));
  try {
    const s = await launchImportScene(scratch, server, chrome, { keychain });
    try {
      await importThrough(s, { history: false, cookies: false, extensions: false });
      await closeSheet(s);
      expect((await barOf(s.page)).slice(0, 2)).toEqual(['A', 'B']);
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);

    // Chrome renames A to A2 and adds Z while MAWS is closed: the boot prepares Default's partition, which syncs
    edit((r) => ({ ...r, bar: [{ name: 'A2', url: url('A2') }, ...r.bar.slice(1), { name: 'Z', url: url('Z') }] }));
    const again = await launchImportScene(scratch, server, chrome, { keychain }, s.ids);
    try {
      await expect.poll(async () => (await barOf(again.page)).slice(0, 2)).toEqual(['A2', 'B']);
      await recordChanges(again.page); // after the boot's sync, whose event no window heard
      expect((await barOf(again.page)).at(-1)).toBe('Z');
      const synced = (await recordOf(again, 'Default'))!.bookmarks!;
      expect(synced).toMatchObject({ count: 47, error: null });

      // edited again while MAWS runs: a sync reads it now, and the bar's event is heard
      edit((r) => ({ ...r, bar: [{ name: 'Y', url: url('Y') }, ...r.bar.slice(1)] }));
      const answer = value(await invoke(again.page, 'browser.bookmarks.sync', { profileDir: 'Default' }));
      expect(answer).toEqual({ syncedAt: expect.any(String), count: 46 });
      expect((await barOf(again.page)).slice(0, 2)).toEqual(['Y', 'B']);
      expect(await changesHeard(again.page)).toEqual([DEFAULT]);
      expect((await recordOf(again, 'Default'))!.bookmarks).toMatchObject({ syncedAt: (answer as { syncedAt: string }).syncedAt, count: 46, error: null });

      // the file deleted: the rows stay, the record says why and when
      rmSync(file);
      expect(value(await invoke(again.page, 'browser.bookmarks.sync', { profileDir: 'Default' }))).toEqual({ error: 'missing' });
      expect((await barOf(again.page)).slice(0, 2)).toEqual(['Y', 'B']);
      expect((await recordOf(again, 'Default'))!.bookmarks).toMatchObject({ syncedAt: (answer as { syncedAt: string }).syncedAt, error: 'missing', errorAt: expect.any(String) });
      expect(await changesHeard(again.page)).toEqual([DEFAULT]);

      // a profile whose bookmarks were not imported is refused, with the reason
      expect(value(await invoke(again.page, 'browser.bookmarks.sync', { profileDir: 'Profile 1' }))).toEqual({ error: 'refused', reason: 'not an imported profile' });
      await expectNothingLogged(again);
    } catch (error) {
      await again.maws.cleanup();
      throw error;
    }
    await closeScene(again);
  } finally {
    await server.close();
    rmSync(scratch.root, { recursive: true, force: true });
  }
});
