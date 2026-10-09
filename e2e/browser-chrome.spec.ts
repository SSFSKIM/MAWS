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
//
// M2 (the avatar and the popover) proves: (7) the pill shows Default's Google picture as the avatar main wrote at 64 px
// and Work's initial, and opens the profile popover with the name, the signed-in account (Work: not signed in), Switch
// profile, Sync bookmarks now with its line, Re-import this profile… and Browser settings, the main area keeping its
// Browser tab, a click on the chrome outside closing it; (5, the popover half) Sync bookmarks now shows an edited file at
// once, and a deleted one's "읽지 못함" line; (8) Switch profile → Work opens a new selected tab in Work's partition, the
// first tab staying in its own; Re-import from the popover runs the removal and the import sheet at app level and the
// active profile is active again after it; (10, the avatar) removal takes avatar.png with the partition folder. The
// Chrome account's names reach no log line, console message or the e2e seam.
//
// The cover's still (M2's fix): with the popover open in the 380 px session panel the pane shows the page's still, a
// decoded picture of the page, and at no frame is the page's view hidden with no still in the pane; a page that commits
// and paints only once the popover is open gets its still too.
//
// M3 (the extensions action bar) proves: (9) the probe extension's icon right of the address field in a main tab, the
// popup-less extension present but inert, its popup under the icon (its right edge on the icon's, sized by its page)
// whose page reaches the service worker and is not answered the page tab by `chrome.tabs.query`, a second click and the
// window's cover closing it, the browser preload doing nothing in extension pages, the action's native menu's Options
// opening `options.html` as an internal tab titled "MAWS probe extension · Options" with a read-only address field, and
// in the 380 px session panel the icons folded into the puzzle button whose menu lists the actions, Options and Manage
// extensions…; Settings' imported profile saying what popups cannot see; (12) the options tab not restored by a
// relaunch, the page's tab restored; (10, the actions) removing the profile closes an open options tab with a notice
// naming the extension, and lists no action.
// Runs under `pnpm e2e:browser-chrome` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app.
import { existsSync, readFileSync, rmSync } from 'node:fs';
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
import { address, addressOf, browserIn, chipOf, chipsIn, openBrowser, overflow, pageAt, paneIn, paneRect, preloadRunsAt, resizeWindow, tabAt, tabsOf, viewOf } from './support/browser-scene';
import { invoke, value } from './support/c7-replay';
import { clearToasts, closeScene, show, type Scratch } from './support/maws-tools';
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
      // and ⇧⌘B in its page is not the bar's: it passes on (Toggle right panel's) and the setting stays as it was
      await address(main, server.url('/b.html'));
      const defaultTab = await tabAt(s, id, server.url('/b.html'));
      expect((await tabsOf(s, id)).tabs.find((tab) => tab.tabId === defaultTab)?.partition).toBe(DEFAULT_PARTITION);
      expect(await sendInput(s, defaultTab, { type: 'keyDown', keyCode: 'B', modifiers: ['meta', 'shift'] })).toBe(true);
      expect(await sendInput(s, defaultTab, { type: 'keyUp', keyCode: 'B', modifiers: ['meta', 'shift'] })).toBe(true);
      await s.page.waitForTimeout(300);
      expect((settingsFile(s.maws.userData).browser as { bookmarksBar?: string }).bookmarksBar).toBe('shown');
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
      await expect(listbox.getByRole('option').filter({ hasText: new RegExp(`^${historyTitle}`) })).toHaveCount(1); // the history row (the typed search row quotes it too)
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


// ---- (5, 7, 8, 10) the avatar and the profile popover ----------------------------------------------------------------

const ACCOUNT = /Probe Owner|probe@example\.test/; // the fixture's Chrome account, which only the popover and the picker show
const avatarFile = (userData: string, profileDir: string) => join(userData, 'browser', `maws-chrome-${profileDir}`, 'avatar.png');
// A PNG's width and height, from its IHDR chunk.
const pngSize = (file: string) => {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};
const pillIn = (view: Locator) => view.locator('[data-browser-partition]');
const popoverOf = (s: ImportScene) => s.page.locator('[data-profile-popover]');
async function openPopover(s: ImportScene, view: Locator): Promise<Locator> {
  await pillIn(view).click();
  const popover = popoverOf(s);
  await expect(popover).toBeVisible();
  return popover;
}

test('5, 7, 8, 10: the pill\'s avatar and its popover: the account, Sync bookmarks now, Switch profile into a new tab, Re-import at app level, the avatar gone with the profile', async () => {
  const server = await startBrowserServer();
  const { scratch, chrome } = importScratch(['cua #90: the popover'], { bookmarksOrigin: server.origin });
  const bookmarks = chrome.profiles.Default.bookmarks!;
  try {
    const s = await launchBarScene(scratch, server, chrome, { keychain: `file:${chrome.passwordFile}` });
    const [id] = s.ids as [AppSessionId];
    const userData = s.maws.userData;
    try {
      // Default (Person 1, signed in, with a picture and bookmarks) and Work (Profile 1, neither)
      await importThrough(s, { history: false, cookies: false, extensions: false });
      await closeSheet(s);
      await importThrough(s, { profileDir: 'Profile 1', cookies: false, extensions: false });
      await closeSheet(s);
      // (10, the avatar) the import wrote Default's picture at 64 px beside its partition; Work has none
      expect(pngSize(avatarFile(userData, 'Default'))).toEqual([64, 64]);
      expect(existsSync(avatarFile(userData, 'Profile 1'))).toBe(false);
      expect((await recordOf(s, 'Default'))!.avatar).toEqual({ kind: 'picture' });
      expect((await recordOf(s, 'Profile 1'))!.avatar).toEqual({ kind: 'initials' });
      expect([(await recordOf(s, 'Default'))!.gaiaName, (await recordOf(s, 'Default'))!.userName]).toEqual([null, null]); // the seam keeps no names

      // (7) a Default tab in a main tab: the pill shows the picture
      value(await invoke(s.page, 'settings.set', { browser: { profile: 'Default' } }));
      const panel = await browserPanel(s, id);
      await address(panel, server.url('/a.html'));
      const first = await tabAt(s, id, server.url('/a.html'));
      await overflow(s, panel, 'Open in tab');
      const main = browserIn(s, 'main');
      await expect(pillIn(main)).toContainText('Person 1');
      await expect(pillIn(main).locator('img[data-profile-avatar="picture"]')).toHaveAttribute('src', /^data:image\/png;base64,/);

      // the popover: the name, the account, Switch profile, Sync with its line, Re-import, Browser settings
      let popover = await openPopover(s, main);
      await expect(popover).toHaveAttribute('data-profile-popover', 'profile');
      await expect(popover.locator('header')).toContainText('Person 1');
      await expect(popover.locator('[data-profile-account]')).toHaveText('로그인: Probe Owner · probe@example.test');
      await expect(popover.getByRole('region', { name: 'Switch profile' })).toContainText('새 탭에 적용');
      expect(await popover.locator('[data-profile-switch]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-profile-switch')))).toEqual(['Profile 1', 'default']);
      await expect(popover.locator('[data-profile-switch="Profile 1"] [data-profile-avatar="initials"]')).toHaveText('W');
      await expect(popover.locator('[data-profile-sync]')).toContainText('Sync bookmarks now');
      await expect(popover.locator('[data-profile-sync-line]')).toHaveText(/^마지막 동기화 (just now|\d+ minutes? ago)$/);
      await expect(popover.locator('[data-profile-reimport]')).toHaveText('Re-import this profile…');
      await expect(popover.locator('[data-profile-settings]')).toHaveText('Browser settings');
      // the main area keeps the Browser tab: no Settings tab opened
      await expect(main).toBeVisible();
      await expect(s.page.getByRole('navigation', { name: 'Settings sections' })).toHaveCount(0);
      // a click on the chrome outside closes it
      await addressOf(main).click();
      await expect(popover).toHaveCount(0);
      await addressOf(main).press('Escape');

      // (5, the popover half) Chrome renames A: Sync bookmarks now shows A2 at once, the popover open meanwhile
      writeChromeBookmarks(bookmarks.file, { ...bookmarks.roots, bar: [{ name: 'A2', url: server.url('/a2') }, ...bookmarks.roots.bar.slice(1)] });
      popover = await openPopover(s, main);
      await popover.locator('[data-profile-sync]').click();
      await expect(chipNamed(main, 'A2')).toBeVisible();
      await expect(popover.locator('[data-profile-sync]')).not.toHaveAttribute('aria-disabled', 'true');
      // the file deleted: the bar kept, the 읽지 못함 line with the last good sync, a toast
      rmSync(bookmarks.file);
      await popover.locator('[data-profile-sync]').click();
      await expect(popover.locator('[data-profile-sync-line]')).toHaveText(/^Chrome의 북마크 파일을 읽지 못함 · 마지막 동기화 (just now|\d+ minutes? ago)$/);
      await expect(s.page.getByText('Bookmarks could not be synced: Chrome의 북마크 파일을 읽지 못함', { exact: true })).toBeVisible();
      await expect(chipNamed(main, 'A2')).toBeVisible();
      await s.page.keyboard.press('Escape'); // the toast is the top layer: Esc dismisses it first, then the popover
      await s.page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await clearToasts(s.page);
      writeChromeBookmarks(bookmarks.file, bookmarks.roots); // back, for the re-import below

      // (8) Switch profile → Work: a new selected tab in Work's partition, its own main tab; the first stays as it was
      popover = await openPopover(s, main);
      await popover.locator('[data-profile-switch="Profile 1"]').click();
      await expect(popover).toHaveCount(0);
      await expect.poll(async () => (await tabsOf(s, id)).tabs.length).toBe(2);
      const { tabs, selected } = await tabsOf(s, id);
      const work = tabs.find((tab) => tab.tabId !== first)!;
      expect(work.partition).toBe(profilePartition('Profile 1'));
      expect(selected).toBe(work.tabId);
      expect(tabs.find((tab) => tab.tabId === first)).toMatchObject({ partition: DEFAULT, url: server.url('/a.html') });
      expect(settingsFile(userData).browser.profile).toBe('Profile 1');
      await expect(pillIn(main)).toContainText('Work');
      await expect(pillIn(main).locator('[data-profile-avatar="initials"]')).toHaveText('W');
      // Work's popover: not signed in, no Sync row (its bookmarks were not imported)
      popover = await openPopover(s, main);
      await expect(popover.locator('[data-profile-account]')).toHaveText('Chrome에 로그인되지 않은 프로필');
      await expect(popover.locator('[data-profile-sync]')).toHaveCount(0);
      await s.page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);

      // Re-import from the popover of the first tab, the active profile's: the removal closes the tab, the sheets carry on
      value(await invoke(s.page, 'settings.set', { browser: { profile: 'Default' } }));
      await chipOf(main, first).click();
      await expect(pillIn(main)).toContainText('Person 1');
      popover = await openPopover(s, main);
      await popover.locator('[data-profile-reimport]').click();
      await expect(popover).toHaveCount(0);
      const remove = s.page.locator('[data-browser-import-remove="Default"]');
      await expect(remove).toBeVisible();
      await remove.getByRole('checkbox', { name: 'Remove everything MAWS imported from Person 1' }).check();
      await remove.getByRole('button', { name: 'Remove', exact: true }).click();
      const sheet = s.page.locator('[data-browser-import]');
      await expect(sheet).toHaveAttribute('data-browser-import', 'pick', { timeout: 30_000 }); // once main has emptied the partition
      await expect(sheet.locator('[data-chrome-profile="Default"]').getByRole('radio')).toBeChecked();
      expect((await tabsOf(s, id)).tabs.map((tab) => tab.tabId)).toEqual([work.tabId]); // its tab closed with it
      expect(settingsFile(userData).browser.profile).toBeNull(); // meanwhile, new tabs browse as Default
      expect(existsSync(avatarFile(userData, 'Default'))).toBe(false); // (10, the avatar) gone with the partition folder
      await sheet.getByRole('button', { name: 'Continue' }).click();
      await expect(sheet).toHaveAttribute('data-browser-import', 'consent');
      for (const name of ['History', 'Cookies', 'Extensions']) await sheet.getByRole('checkbox', { name, exact: true }).setChecked(false);
      await sheet.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(sheet).toHaveAttribute('data-browser-import', 'report', { timeout: 30_000 });
      await expect.poll(() => settingsFile(userData).browser.profile).toBe('Default'); // the active profile again
      expect(pngSize(avatarFile(userData, 'Default'))).toEqual([64, 64]);
      await sheet.getByRole('button', { name: /^(Done|Close)$/ }).first().click();
      await expect(sheet).toHaveCount(0);

      // (10, the avatar) Remove imported profile: avatar.png goes with the partition folder
      value(await invoke(s.page, 'browser.import.remove', { profileDir: 'Default' }));
      expect(existsSync(avatarFile(userData, 'Default'))).toBe(false);

      // the account's names never reach a log line, the app's console or the import's log
      await expectNothingLogged(s);
      const importLog = existsSync(s.importLog) ? readFileSync(s.importLog, 'utf8') : '';
      for (const [where, text] of Object.entries({ main: s.mainOutput(), console: s.appConsole().join('\n'), importLog })) expect(text, where).not.toMatch(ACCOUNT);
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

// ---- the cover's still -------------------------------------------------------------------------------------------------

// The pane's still once it is there: decoded, the pane's size, and a picture of a page (many colours, dark text pixels),
// not a blank.
async function expectStill(pane: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        pane.evaluate((element) => {
          const img = element.querySelector('img');
          if (!img || !img.complete || img.naturalWidth === 0) return null;
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const context = canvas.getContext('2d')!;
          context.drawImage(img, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const colours = new Set<number>();
          let dark = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            colours.add(((pixels[i]! >> 4) << 8) | ((pixels[i + 1]! >> 4) << 4) | (pixels[i + 2]! >> 4));
            if (pixels[i]! < 96 && pixels[i + 1]! < 96 && pixels[i + 2]! < 96) dark++;
          }
          const box = element.getBoundingClientRect();
          return { size: img.naturalWidth === Math.round(box.width) || img.naturalWidth === Math.floor(box.width), many: colours.size > 8, text: dark > 100 };
        }),
      { message: 'the pane shows the page’s still', timeout: 5_000 },
    )
    .toEqual({ size: true, many: true, text: true });
}

// Watches, frame by frame in the window and every 2 ms in main, for a moment when the tab's view is hidden and its pane
// has no decoded still: answers those moments (ms since the watch began) when stopped.
async function watchHoles(s: ImportScene, tabId: string, pane: Locator): Promise<() => Promise<number[]>> {
  await s.maws.app.evaluate((_electron, id) => {
    const g = globalThis as unknown as { __holeMain: [number, boolean][]; __holeTimer: ReturnType<typeof setInterval>; __maws_browser: { tab(id: string): { visible: boolean } | null } };
    g.__holeMain = [];
    g.__holeTimer = setInterval(() => g.__holeMain.push([Date.now(), g.__maws_browser.tab(id)?.visible ?? false]), 2);
  }, tabId);
  await pane.evaluate((element) => {
    const w = window as unknown as { __holeFrames: [number, boolean][]; __holeOn: boolean };
    w.__holeFrames = [];
    w.__holeOn = true;
    const frame = () => {
      const img = element.querySelector('img');
      w.__holeFrames.push([Date.now(), img !== null && img.complete && img.naturalWidth > 0]); // decoded, not just mounted
      if (w.__holeOn) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const began = Date.now();
  return async () => {
    const frames = await s.page.evaluate(() => {
      const w = window as unknown as { __holeFrames: [number, boolean][]; __holeOn: boolean };
      w.__holeOn = false;
      return w.__holeFrames;
    });
    const shown = await s.maws.app.evaluate(() => {
      const g = globalThis as unknown as { __holeMain: [number, boolean][]; __holeTimer: ReturnType<typeof setInterval> };
      clearInterval(g.__holeTimer);
      return g.__holeMain;
    });
    // the view's state at a frame: main's last sample at or before it
    const visibleAt = (t: number) => shown.filter(([at]) => at <= t).at(-1)?.[1] ?? true;
    return frames.filter(([t, still]) => !still && !visibleAt(t)).map(([t]) => t - began);
  };
}

test('the cover\'s still: the profile popover over the 380 px panel shows the page\'s still and never a hole, a page painted under it included', async () => {
  const server = await startBrowserServer();
  const { scratch, chrome } = importScratch(['cua #90: the still']);
  try {
    const s = await launchImportScene(scratch, server, chrome, { keychain: `file:${chrome.passwordFile}` });
    const [id] = s.ids as [AppSessionId];
    try {
      const panel = await browserPanel(s, id);
      expect(Math.round((await paneRect(paneIn(panel))).width)).toBeLessThanOrEqual(380);
      await address(panel, server.url('/a.html'));
      const tabId = await tabAt(s, id, server.url('/a.html'));
      await expect.poll(async () => (await viewOf(s, tabId))?.visible).toBe(true);
      await s.page.waitForTimeout(300); // the page has painted

      // a page on screen: kept up until its still is in the pane, then hidden; no frame with neither
      const holes = await watchHoles(s, tabId, paneIn(panel));
      const popover = await openPopover(s, panel);
      await expectStill(paneIn(panel));
      await expect.poll(async () => (await viewOf(s, tabId))?.visible).toBe(false);
      await s.page.waitForTimeout(200);
      expect(await holes(), 'moments with the view hidden and no still in the pane').toEqual([]);
      await s.page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect.poll(async () => (await viewOf(s, tabId))?.visible).toBe(true);

      // a new tab whose page answers after LATER_MS, the popover opened before it commits: it paints under the cover
      // (never on screen) and still gets its still
      await panel.getByRole('button', { name: 'New tab', exact: true }).click();
      await address(panel, server.url('/later.html'));
      await openPopover(s, panel);
      const later = await tabAt(s, id, server.url('/later.html'));
      await expectStill(paneIn(panel));
      expect((await viewOf(s, later))?.visible).toBe(false);
      await s.page.keyboard.press('Escape');
      await expect(popoverOf(s)).toHaveCount(0);
      await expect.poll(async () => (await viewOf(s, later))?.visible).toBe(true);
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

// ---- (9, 10, 12) the extensions action bar -----------------------------------------------------------------------------

interface PopupSeam {
  __maws_browser: { extensions: { popup(): { windowId: number; tabId: string; extensionId: string; url: string; bounds: { x: number; y: number; width: number; height: number }; visible: boolean } | null } };
}
const popupOf = (s: ImportScene) => s.maws.app.evaluate(() => (globalThis as unknown as PopupSeam).__maws_browser.extensions.popup());
const actionIn = (view: Locator, extensionId: string) => view.locator(`[data-extension-action="${extensionId}"]`);
const puzzleIn = (view: Locator) => view.locator('[data-extensions-puzzle]');
type PopupResult = { ping: { value?: { echo?: unknown; swSawMessage?: boolean } }; tabsActive: { value?: { url: string }[] }; tabsAll: { value?: { url: string }[] } };

test('9, 10, 12: the extensions action bar: the probe\'s icon right of the address field, its popup under it reaching its background, Options as a transient tab, the puzzle fold in the panel, all gone with the profile', async () => {
  const server = await startBrowserServer();
  const { scratch, chrome } = importScratch(['cua #90: the action bar'], { bookmarksOrigin: server.origin });
  const keychain = `file:${chrome.passwordFile}`;
  const probeId = chrome.extensions.probe.id;
  const popupUrl = `chrome-extension://${probeId}/popup.html`;
  const optionsUrl = `chrome-extension://${probeId}/options.html`;
  const OPTIONS_TITLE = 'MAWS probe extension · Options';
  try {
    const s = await launchBarScene(scratch, server, chrome, { keychain });
    const [id] = s.ids as [AppSessionId];
    let optionsTab: string;
    let pageTab: string;
    try {
      await importThrough(s, { history: false, cookies: false, bookmarks: false });
      await closeSheet(s);
      await expect.poll(() => settingsFile(s.maws.userData).browser.profile).toBe('Default');
      // Settings says what a popup cannot see here
      const region = await openSettingsBrowser(s);
      await expect(region.locator('[data-imported-profile="Default"] [data-extension-popup-limit]')).toHaveText(
        'Extension popups can’t see the current tab here, so ad blockers and per-site toggles may not work.',
      );

      // (9) the session panel at 380 px: the icons fold into the puzzle button, whose menu lists the extension
      const panel = await browserPanel(s, id);
      await address(panel, server.url('/a.html'));
      pageTab = await tabAt(s, id, server.url('/a.html'));
      await expect(puzzleIn(panel)).toBeVisible();
      await expect(panel.locator('[data-extension-actions]')).toHaveCount(0);
      const folded = await menuAfter(s.maws.app, () => puzzleIn(panel).click());
      expect(menuIds(folded)).toEqual(expect.arrayContaining([`action:${probeId}`, `action:${chrome.extensions.fails.id}`, 'options', 'manage']));
      expect(menuIds(folded).at(-1)).toBe('manage');
      expect(menuShape(folded)).toContainEqual(['Options', ['MAWS probe extension']]);
      expect(folded.find((node) => 'id' in node && node.id === `action:${chrome.extensions.fails.id}`)).toMatchObject({ enabled: false }); // no popup: inert

      // a main tab: the icons inline, right of the address field and before the pill
      await overflow(s, panel, 'Open in tab');
      const main = browserIn(s, 'main');
      const probe = actionIn(main, probeId);
      await expect(probe).toBeVisible();
      await expect(puzzleIn(main)).toHaveCount(0);
      const [field, icon, pill] = await Promise.all([main.locator('[data-address-box]').boundingBox(), probe.boundingBox(), main.locator('[data-browser-partition]').boundingBox()]);
      expect(icon!.x).toBeGreaterThanOrEqual(field!.x + field!.width);
      expect(icon!.x + icon!.width).toBeLessThanOrEqual(pill!.x);
      expect([icon!.width, icon!.height]).toEqual([24, 24]);
      await expect(probe).toHaveAttribute('title', 'MAWS probe');
      const fails = actionIn(main, chrome.extensions.fails.id);
      await expect(fails).toHaveAttribute('aria-disabled', 'true');
      await expect(fails).toHaveAttribute('title', /This extension has no popup here$/);
      await fails.click({ force: true }); // aria-disabled: Playwright would wait for it to be enabled
      expect(await popupOf(s)).toBeNull();

      // the popup, the button pressed meanwhile: under the icon, its right edge on the icon's. Its size is not observed here: Playwright's attachment to every
      // page keeps Chromium from reporting a preferred size (measured on a bare Electron app under `_electron.launch`:
      // no `preferred-size-changed`; the same app without Playwright reports it), so the popup stays at Chrome's 25 px
      // minimum in this run; the resize on every report is the unit tests' and S1's (spikes/extension-popup)
      await probe.click();
      await expect.poll(async () => (await popupOf(s))?.extensionId).toBe(probeId);
      const popup = (await popupOf(s))!;
      expect(popup).toMatchObject({ tabId: pageTab, extensionId: probeId, url: popupUrl });
      expect(popup.bounds.y).toBe(Math.round(icon!.y + icon!.height));
      expect(popup.bounds.x + popup.bounds.width).toBe(Math.round(icon!.x + icon!.width));
      expect(popup.visible).toBe(true);
      await expect(probe).toHaveAttribute('aria-pressed', 'true');
      // its page reached the service worker, and the page tab is not what tabs.query answers it (S1)
      const popupPage = await pageAt(s, popupUrl);
      await expect.poll(() => popupPage.evaluate(() => (window as unknown as { __popupResult?: unknown }).__popupResult !== undefined)).toBe(true);
      const result = (await popupPage.evaluate(() => (window as unknown as { __popupResult: unknown }).__popupResult)) as PopupResult;
      expect(result.ping.value).toMatchObject({ echo: { ping: 1 }, swSawMessage: true });
      expect((result.tabsActive.value ?? []).map((tab) => tab.url)).not.toContain(server.url('/a.html'));
      // the browser preload does nothing in an extension's page
      expect((await preloadRunsAt(s, popupUrl)).map((runs) => runs.main)).toEqual([0]);
      // a second click on the action closes it
      await probe.click();
      await expect.poll(() => popupOf(s)).toBeNull();
      await expect(probe).toHaveAttribute('aria-pressed', 'false');
      // the window's cover closes it: a layer freezes the page, and no live popup floats over the layer
      await probe.click();
      await expect.poll(async () => (await popupOf(s))?.extensionId).toBe(probeId);
      value(await invoke(s.page, 'browser.view.cover', { covered: true }));
      await expect.poll(() => popupOf(s)).toBeNull();
      value(await invoke(s.page, 'browser.view.cover', { covered: false }));

      // the action's context menu: Options opens the options page as a tab, the main tab moving to it
      const context = await menuAfter(s.maws.app, () => probe.click({ button: 'right' }));
      expect(menuIds(context)).toEqual(['name', '—', `options:${probeId}`, 'manage']);
      await pickMenu(s.maws.app, [`options:${probeId}`]);
      await expect.poll(async () => (await tabsOf(s, id)).tabs.length).toBe(2);
      const opened = (await tabsOf(s, id)).tabs.find((tab) => tab.tabId !== pageTab)!;
      optionsTab = opened.tabId;
      expect(opened).toMatchObject({ partition: DEFAULT, url: optionsUrl, title: OPTIONS_TITLE, internal: { kind: 'extension', extensionId: probeId, title: OPTIONS_TITLE } });
      expect((await tabsOf(s, id)).selected).toBe(optionsTab);
      await expect(chipOf(main, optionsTab).locator('[aria-selected]')).toHaveAttribute('aria-selected', 'true');
      const optionsField = main.locator('[data-address-internal] input');
      await expect(optionsField).toHaveValue(OPTIONS_TITLE);
      await expect(optionsField).toHaveJSProperty('readOnly', true);
      const optionsPage = await pageAt(s, optionsUrl);
      await expect.poll(() => optionsPage.evaluate(() => document.title)).toBe('MAWS probe options');
      expect(await optionsPage.evaluate(() => (window as unknown as { __optionsResult: unknown }).__optionsResult)).toEqual({ name: 'MAWS probe extension', href: optionsUrl });
      expect((await preloadRunsAt(s, optionsUrl)).map((runs) => runs.main)).toEqual([0]);

      // leaving the options tab (the person's navigation, as a bookmark chip's): it closes, and the page opens as a new
      // ordinary tab that the options tab's main tab shows in place (one main tab where there was one), with no Back
      // into the options page
      const mainTabs = () => s.page.locator('[data-region="main"] [role="tab"][data-tab-id^="browser:"]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id')));
      expect(await mainTabs()).toEqual([`browser:${id}:${pageTab}`, `browser:${id}:${optionsTab}`]);
      value(await invoke(s.page, 'browser.tabs.navigate', { tabId: optionsTab, to: { url: server.url('/b.html'), typed: false } }));
      await expect.poll(async () => (await tabsOf(s, id)).tabs.some((tab) => tab.tabId === optionsTab)).toBe(false);
      const left = (await tabsOf(s, id)).tabs.find((tab) => tab.tabId !== pageTab)!;
      expect(left).toMatchObject({ url: server.url('/b.html'), internal: null, partition: DEFAULT });
      await expect.poll(mainTabs).toEqual([`browser:${id}:${pageTab}`, `browser:${id}:${left.tabId}`]);
      await expect(s.page.locator(`[data-region="main"] [role="tab"][data-tab-id="browser:${id}:${left.tabId}"]`)).toHaveAttribute('aria-selected', 'true');
      expect((await tabsOf(s, id)).selected).toBe(left.tabId);
      await expect(chipOf(main, left.tabId).locator('[aria-selected]')).toHaveAttribute('aria-selected', 'true');
      await expect.poll(async () => (await viewOf(s, left.tabId))?.visible).toBe(true);
      expect(value(await invoke(s.page, 'browser.tabs.navigate', { tabId: left.tabId, to: 'back' })).accepted).toBe(false);
      value(await invoke(s.page, 'browser.tabs.close', { tabId: left.tabId }));
      // the options tab again, open at the quit below
      value(await invoke(s.page, 'browser.extensions.action.options', { tabId: pageTab, extensionId: probeId }));
      await expect.poll(async () => (await tabsOf(s, id)).tabs.find((tab) => tab.url === optionsUrl)?.tabId).toBeDefined();
      optionsTab = (await tabsOf(s, id)).tabs.find((tab) => tab.url === optionsUrl)!.tabId;
      await expectNothingLogged(s);
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);

    // (12) the options tab is transient: a relaunch restores the page's tab and not it
    const again = await launchBarScene(scratch, server, chrome, { keychain }, s.ids);
    try {
      const { tabs } = await tabsOf(again, id);
      expect(tabs.map((tab) => tab.tabId)).toEqual([pageTab]);
      expect((await tabsOf(again, id)).selected).toBe(pageTab); // the tab the options tab's closing would have selected

      // (10, the actions) Remove imported profile: its open options tab closes with a notice naming the extension, and
      // the actions list is empty
      const panel = await browserPanel(again, id);
      await expect(puzzleIn(panel)).toBeVisible();
      value(await invoke(again.page, 'browser.extensions.action.options', { tabId: pageTab, extensionId: probeId }));
      await expect.poll(async () => (await tabsOf(again, id)).tabs.some((tab) => tab.url === optionsUrl)).toBe(true);
      expect(value(await invoke(again.page, 'browser.extensions.actions', { partition: DEFAULT })).actions.map((action) => action.extensionId)).toContain(probeId);
      // the notice is heard as main sends it: its line lasts 4 s, and a removal can take longer than that under load
      await again.page.evaluate(() => {
        const heard: unknown[] = [];
        (window as unknown as { __cua90Notices: unknown[] }).__cua90Notices = heard;
        window.maws.on('browser.notice', (notice) => void heard.push(notice));
      });
      value(await invoke(again.page, 'browser.import.remove', { profileDir: 'Default' }));
      expect((await tabsOf(again, id)).tabs).toEqual([]);
      expect(await again.page.evaluate(() => (window as unknown as { __cua90Notices: unknown[] }).__cua90Notices)).toContainEqual({ appSessionId: id, tabId: null, kind: 'extensionPageClosed', name: 'MAWS probe extension' });
      expect(value(await invoke(again.page, 'browser.extensions.actions', { partition: DEFAULT })).actions).toEqual([]);
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
