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
//
// M1b (the bar) proves: (2) the bar under the address row in an imported profile's tab, the chips that fit then », the
// » menu the hidden chips then Other bookmarks, no bar for the Default partition; (3) a chip's click in the tab and the
// address field showing it, ⌘-click in a new unselected tab, folder F's native menu (F1, F2, G › G1, Open all (2)),
// choosing F1, Open all, a narrower window's » listing exactly the hidden chips; "Open all" above 20 asking first;
// (4) ⌘⇧B in the page hides the bar and the page grows by 28 px, a relaunch keeps it hidden, ⌘⇧B with the chrome
// focused shows it again, Settings › Browser's switch mirrors it; (5, the visible half) an edited file synced shows at
// once, a deleted one keeps the bar; (6) `f1` suggests F1 with the bookmark star above history, a history-only title as
// before. Native menus go through main's seam (support/native-menu.ts).
// Runs under `pnpm e2e:browser-chrome` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { BookmarkNode, BookmarkTree } from '@shared/browser/bookmarks';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import { writeChromeBookmarks, type ChromeUserData, type FixtureBookmarks } from '../test/support/chrome-profile';
import type { AppSessionId } from '@shared/graph/ids';
import { startBrowserServer, type BrowserServer } from './support/browser-server';
import {
  closeSheet, expectNothingLogged, importScratch, importThrough, launchImportScene, openImportSheet, openSettingsBrowser, phasesHeard, recordOf, recordPhases,
  settingsFile, suggest, type ImportScene, type ImportSeams,
} from './support/browser-import-scene';
import { address, addressOf, browserIn, chipsIn, openBrowser, overflow, paneIn, paneRect, resizeWindow, tabAt, tabsOf } from './support/browser-scene';
import { invoke, value } from './support/c7-replay';
import { closeScene, show, type Scratch } from './support/maws-tools';
import { menuAfter, menuIds, menuShape, openAllAsked, pickMenu } from './support/native-menu';

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

// ---- (2–6) the bar ---------------------------------------------------------------------------------------------------

// The import scene launched with "Open all"'s answer set (main reads it at start).
async function launchBarScene(scratch: Scratch, server: BrowserServer, chrome: ChromeUserData, seams: ImportSeams, known?: AppSessionId[]): Promise<ImportScene> {
  const before = process.env.MAWS_E2E_OPEN_ALL_ANSWER;
  process.env.MAWS_E2E_OPEN_ALL_ANSWER = 'cancel';
  try {
    return await launchImportScene(scratch, server, chrome, seams, known);
  } finally {
    if (before === undefined) delete process.env.MAWS_E2E_OPEN_ALL_ANSWER;
    else process.env.MAWS_E2E_OPEN_ALL_ANSWER = before;
  }
}

// The session shown and its Browser tool in the panel (the tool comes back after a relaunch, or is added afresh).
async function browserPanel(s: ImportScene, id: AppSessionId): Promise<Locator> {
  await show(s, id);
  const panel = browserIn(s, 'panel');
  await expect(panel.or(s.panel.getByRole('button', { name: 'Add a tool' })).first()).toBeVisible();
  return (await panel.isVisible()) ? panel : openBrowser(s);
}

const barIn = (view: Locator) => view.locator('[data-bookmarks-bar]');
const chipNamed = (view: Locator, name: string) => barIn(view).locator('[data-bookmark], [data-bookmark-folder]').filter({ hasText: new RegExp(`^${name}$`) });
const moreIn = (view: Locator) => barIn(view).locator('[data-bookmarks-more]');
// The bar's chips as the person sees them (the ones that fit) and the ones handed to the », by name and by menu id.
async function chipsOf(view: Locator): Promise<{ shown: string[]; hidden: string[]; hiddenIds: string[] }> {
  return barIn(view).evaluate((bar) => {
    const chips = Array.from(bar.querySelectorAll<HTMLButtonElement>('[data-bookmark], [data-bookmark-folder]'));
    const id = (chip: HTMLElement) => (chip.dataset.bookmark !== undefined ? `bookmark:${chip.dataset.bookmark}` : `folder:${chip.dataset.bookmarkFolder}`);
    return {
      shown: chips.filter((chip) => !chip.inert).map((chip) => chip.textContent ?? ''),
      hidden: chips.filter((chip) => chip.inert).map((chip) => chip.textContent ?? ''),
      hiddenIds: chips.filter((chip) => chip.inert).map(id),
    };
  });
}
const nodeIdOf = async (chip: Locator) => Number((await chip.getAttribute('data-bookmark')) ?? (await chip.getAttribute('data-bookmark-folder')));

test('2, 3, 5: the bar in an imported profile\'s tab: chips and », a chip in the tab or a new one, native folder and » menus, Open all and its question, a narrower window, an edited file synced at once; none for Default', async () => {
  const server = await startBrowserServer();
  const { scratch, chrome } = importScratch(['cua #90: the bar'], { bookmarksOrigin: server.origin });
  const bookmarks = chrome.profiles.Default.bookmarks!;
  const urls = bookmarks.urls;
  try {
    const s = await launchBarScene(scratch, server, chrome, { keychain: `file:${chrome.passwordFile}` });
    const [id] = s.ids as [AppSessionId];
    const app = s.maws.app;
    try {
      await importThrough(s, { history: false, cookies: false, extensions: false });
      await closeSheet(s);
      await expect.poll(() => settingsFile(s.maws.userData).browser.profile).toBe('Default');

      // (2) a tab of the imported profile, in the panel, then in a main tab: the bar under the address row
      const panel = await browserPanel(s, id);
      await address(panel, server.url('/a.html'));
      const tabId = await tabAt(s, id, server.url('/a.html'));
      await expect(barIn(panel)).toBeVisible();
      await overflow(s, panel, 'Open in tab');
      const main = browserIn(s, 'main');
      await expect(barIn(main)).toBeVisible();
      const bar = await barIn(main).boundingBox();
      const nav = await addressOf(main).boundingBox();
      expect(bar!.y).toBeGreaterThan(nav!.y);
      expect(bar!.height).toBe(28);
      let chips = await chipsOf(main);
      expect(chips.shown.slice(0, 4)).toEqual(['A', 'B', 'F', 'N01']);
      expect(chips.hidden.length).toBeGreaterThan(0); // forty N chips never fit
      expect([...chips.shown, ...chips.hidden]).toEqual(['A', 'B', 'F', ...N]);
      await expect(moreIn(main)).toBeVisible();
      const overflowMenu = await menuAfter(app, () => moreIn(main).click());
      expect(menuIds(overflowMenu)).toEqual([...chips.hiddenIds, '—', 'root:other']);
      expect(menuShape(overflowMenu).at(-1)).toEqual(['Other bookmarks', ['O1', '—', 'Open all (1)']]);

      // (3) A in the tab, the address field showing it; ⌘-click B: a new tab, not selected
      await chipNamed(main, 'A').click();
      await expect.poll(async () => (await tabsOf(s, id)).tabs.find((tab) => tab.tabId === tabId)?.url).toBe(urls.A);
      await expect(main.locator('[data-address-display]')).toContainText('/bookmark/A/');
      const count = (await tabsOf(s, id)).tabs.length;
      await chipNamed(main, 'B').click({ modifiers: ['Meta'] });
      await expect.poll(async () => (await tabsOf(s, id)).tabs.map((tab) => tab.url)).toContain(urls.B);
      expect((await tabsOf(s, id)).tabs).toHaveLength(count + 1);
      expect((await tabsOf(s, id)).selected).toBe(tabId);

      // folder F: F1, F2, G › G1, a separator, Open all (2); F1 loads in the tab
      const folder = await menuAfter(app, () => chipNamed(main, 'F').click());
      expect(menuShape(folder)).toEqual(['F1', 'F2', ['G', ['G1', '—', 'Open all (1)']], '—', 'Open all (2)']);
      const f1 = folder.find((node) => 'label' in node && node.label === 'F1') as { id: string };
      await pickMenu(app, [f1.id]);
      await expect.poll(async () => (await tabsOf(s, id)).tabs.find((tab) => tab.tabId === tabId)?.url).toBe(urls.F1);
      // Open all: two new unselected tabs, F1 and F2, in order
      await menuAfter(app, () => chipNamed(main, 'F').click());
      await pickMenu(app, ['open-all']);
      await expect.poll(async () => (await tabsOf(s, id)).tabs.length).toBe(count + 3);
      expect((await tabsOf(s, id)).tabs.slice(-2).map((tab) => tab.url)).toEqual([urls.F1, urls.F2]);
      expect((await tabsOf(s, id)).selected).toBe(tabId);

      // a narrower window hides more chips; » lists exactly the hidden ones, then Other bookmarks
      const before = chips.hidden.length;
      await resizeWindow(s, paneIn(main), -300, 0);
      await expect.poll(async () => (await chipsOf(main)).hidden.length).toBeGreaterThan(before);
      chips = await chipsOf(main);
      expect(menuIds(await menuAfter(app, () => moreIn(main).click()))).toEqual([...chips.hiddenIds, '—', 'root:other']);
      await resizeWindow(s, paneIn(main), 300, 0);

      // (5, the visible half) Chrome renames A and adds a large folder: a sync shows it now, without a relaunch
      const many = Array.from({ length: 21 }, (_, k) => ({ name: `M${k + 1}`, url: server.url(`/many/${k + 1}`) }));
      writeChromeBookmarks(bookmarks.file, { ...bookmarks.roots, bar: [{ name: 'A2', url: server.url('/a2') }, bookmarks.roots.bar[1]!, { name: 'Many', children: many }, ...bookmarks.roots.bar.slice(2)] });
      expect(value(await invoke(s.page, 'browser.bookmarks.sync', { profileDir: 'Default' }))).toMatchObject({ count: 46 + 21 });
      await expect(chipNamed(main, 'A2')).toBeVisible();
      await expect(chipNamed(main, 'A')).toHaveCount(0);
      // Open all (21) asks first; the e2e's answer is Cancel: no tab opens
      const manyMenu = await menuAfter(app, () => chipNamed(main, 'Many').click());
      expect(menuShape(manyMenu).at(-1)).toBe('Open all (21)');
      await pickMenu(app, ['open-all']);
      await expect.poll(() => openAllAsked(app)).toEqual([21]);
      expect((await tabsOf(s, id)).tabs).toHaveLength(count + 3);
      // the file deleted: the sync fails and the bar keeps what it had
      rmSync(bookmarks.file);
      expect(value(await invoke(s.page, 'browser.bookmarks.sync', { profileDir: 'Default' }))).toEqual({ error: 'missing' });
      await expect(chipNamed(main, 'A2')).toBeVisible();
      expect(await nodeIdOf(chipNamed(main, 'A2'))).toBeGreaterThan(0);

      // (2) the Default partition's tab shows no bar
      value(await invoke(s.page, 'settings.set', { browser: { profile: null } }));
      await main.getByRole('button', { name: 'New tab', exact: true }).click();
      await expect(main.locator('[data-browser-partition]')).toHaveText('Default');
      await expect(barIn(main)).toHaveCount(0);
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

// What the e2e's agent seam sends a tab's page as the OS would (`webContents.sendInputEvent`, which keys.ts hears).
const sendInput = (s: ImportScene, tabId: string, event: Record<string, unknown>) =>
  s.maws.app.evaluate(
    (_electron, [tab, input]) => (globalThis as unknown as { __maws_browser: { agent: { sendInput(tabId: string, event: unknown): boolean } } }).__maws_browser.agent.sendInput(tab as string, input),
    [tabId, event] as const,
  );

test('4, 6: ⌘⇧B in the page hides the bar and the page grows by 28 px; a relaunch keeps it hidden; ⌘⇧B in the chrome shows it; the Settings switch mirrors it; f1 suggests the bookmark above history', async () => {
  const server = await startBrowserServer();
  const { scratch, chrome } = importScratch(['cua #90: the toggle'], { bookmarksOrigin: server.origin });
  const keychain = `file:${chrome.passwordFile}`;
  try {
    const s = await launchBarScene(scratch, server, chrome, { keychain });
    const [id] = s.ids as [AppSessionId];
    try {
      await importThrough(s, { cookies: false, extensions: false });
      await closeSheet(s);
      await expect.poll(() => settingsFile(s.maws.userData).browser.profile).toBe('Default');
      const panel = await browserPanel(s, id);
      await address(panel, server.url('/a.html'));
      const tabId = await tabAt(s, id, server.url('/a.html'));
      await expect(barIn(panel)).toBeVisible();

      // (4) ⌘⇧B pressed in the page: the bar goes, the page takes its 28 px, the setting is written
      const withBar = await paneRect(paneIn(panel));
      expect(await sendInput(s, tabId, { type: 'keyDown', keyCode: 'B', modifiers: ['meta', 'shift'] })).toBe(true);
      expect(await sendInput(s, tabId, { type: 'keyUp', keyCode: 'B', modifiers: ['meta', 'shift'] })).toBe(true);
      await expect(barIn(panel)).toHaveCount(0);
      await expect.poll(() => paneRect(paneIn(panel))).toEqual({ ...withBar, y: withBar.y - 28, height: withBar.height + 28 });
      await expect.poll(() => (settingsFile(s.maws.userData).browser as { bookmarksBar?: string }).bookmarksBar).toBe('hidden');
      await expect(s.panel).toBeVisible(); // the chord was the bar's, not Toggle right panel's

      // (6) f1: the bookmark F1 with its star above any history row; a history-only title as before
      const field = addressOf(panel);
      await field.click();
      await field.fill('f1');
      const listbox = panel.getByRole('listbox', { name: 'Address suggestions' });
      // F1 first among the bookmark rows (a fixture URL's random sentinel may also hold "f1"), every one of them after the
      // typed search and before any history row
      const bookmarkRows = listbox.getByRole('option').filter({ has: s.page.locator('[data-suggestion-bookmark]') });
      await expect(bookmarkRows.first()).toContainText('F1');
      const marks = await listbox.getByRole('option').evaluateAll((rows) => rows.map((row) => row.querySelector('[data-suggestion-bookmark]') !== null));
      expect(marks[0]).toBe(false);
      expect(marks.slice(1, 1 + marks.filter(Boolean).length).every(Boolean)).toBe(true);
      const historyTitle = chrome.profiles.Default.history.entries.find((entry) => entry.expected === 'imported')!.title;
      await field.fill(historyTitle);
      await expect(listbox.getByRole('option').filter({ hasText: historyTitle })).toHaveCount(1);
      await expect(listbox.locator('[data-suggestion-bookmark]')).toHaveCount(0);
      await field.press('Escape');
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);

    // (4) the relaunch keeps the bar hidden; ⌘⇧B with the chrome focused shows it; Settings › Browser mirrors it
    const again = await launchBarScene(scratch, server, chrome, { keychain }, s.ids);
    try {
      const panel = await browserPanel(again, id);
      await expect(chipsIn(panel).first()).toBeVisible();
      await expect(barIn(panel)).toHaveCount(0);
      const field = addressOf(panel);
      await field.click();
      await field.press('Meta+Shift+B');
      await expect(barIn(panel)).toBeVisible();
      await field.press('Escape');
      const region = await openSettingsBrowser(again);
      const toggle = region.getByRole('switch', { name: 'Show the bookmarks bar' });
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect.poll(() => (settingsFile(again.maws.userData).browser as { bookmarksBar?: string }).bookmarksBar).toBe('hidden');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect.poll(() => (settingsFile(again.maws.userData).browser as { bookmarksBar?: string }).bookmarksBar).toBe('shown');
      await expect(barIn(await browserPanel(again, id))).toBeVisible(); // the Settings tab hid the session's panel
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

