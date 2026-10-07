// E4b's `browser-import` group (docs/doperpowers/plans/2026-10-06-e4b-profile-import.md, Acceptance G1): the Chrome
// profile import on the real Electron against the synthetic Chrome user data directory (test/support/chrome-profile.ts),
// never the owner's Chrome or Keychain (the Keychain is the MAWS_E2E_KEYCHAIN seam), in the product app over the replay
// (no engine), with a loopback server that echoes the cookies a page sends (support/browser-server.ts `/echo-cookies`).
//
// (1) the full import: the picker, the consent, the run's phases, the report, the profile made active, the cookies sent
// by a Browser tab of the partition, the extension's content script in its pages and not in MAWS's, the history in the
// suggestions; a relaunch keeps all of it, and a profile that is not the active one holds its first page until its
// extensions are loaded; nothing logs a value; (2) a wrong Safe Storage password; (3) the Keychain denied, then a second
// profile cancelled during its extensions; (4) extension toggles and removal with a tab open, the storage directory
// swept at the next boot; (5) the Chrome-running hint and a chosen folder; (6) the consent with many extensions stays
// usable, and the evidence shots (MAWS_E4B_SHOTS=1).
// Runs under `pnpm e2e:browser-import` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app.
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { profilePartition } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { buildChromeUserData } from '../test/support/chrome-profile';
import { address, browserIn, chipsIn, openBrowser, pageAt } from './support/browser-scene';
import { startBrowserServer } from './support/browser-server';
import {
  addExtensions, closeSheet, echoedCookies, expectContentScript, expectNothingLogged, importScratch, importThrough, launchImportScene, openImportSheet, openSettingsBrowser, phasesHeard,
  profilesFile, recordIn, recordOf, recordPhases, report, settingsFile, sheetOf, shootImport, stagingLeft, suggest, type ImportScene,
} from './support/browser-import-scene';
import { invoke, value } from './support/c7-replay';
import { closeScene, show } from './support/deliverables-scene';

test.describe.configure({ timeout: 240_000 });

const DEFAULT = profilePartition('Default');
const WORK = profilePartition('Profile 1');
const REPORT_DONE =
  "4 cookies, 4 history entries, 3 extensions · 3 skipped: 1 rejected by Chromium (SameSite=None without Secure), 1 hidden page, 1 page MAWS's browser can't open";
const FAILS_STATUS = 'Loaded · background failed: chrome.contextMenus.onClicked is not available in MAWS';

const pill = (view: Locator) => view.locator('[data-browser-partition]');

// The session shown and its Browser tool in the panel (the tool comes back after a relaunch, or is added afresh).
async function browserPanel(s: ImportScene, id: AppSessionId): Promise<Locator> {
  await show(s, id);
  const panel = browserIn(s, 'panel');
  await expect(panel.or(s.panel.getByRole('button', { name: 'Add a tool' })).first()).toBeVisible();
  return (await panel.isVisible()) ? panel : openBrowser(s);
}

// A new tab in the panel (in the active profile's partition) loading `url`; its page.
async function newTabAt(s: ImportScene, panel: Locator, url: string) {
  if ((await chipsIn(panel).count()) > 0) await panel.getByRole('button', { name: 'New tab', exact: true }).click();
  await address(panel, url);
  return pageAt(s, url);
}

const titlesOf = (s: ImportScene, profileDir: 'Default' | 'Profile 1') =>
  s.chrome.profiles[profileDir].history.entries.filter((entry) => entry.expected === 'imported').map((entry) => entry.title).sort();
const cookieValue = (s: ImportScene, name: string) => s.chrome.profiles.Default.cookies.entries.find((cookie) => cookie.name === name)!.value;

// ---- (1) the full import --------------------------------------------------------------------------------------------

test('the full import: picker, consent, phases, report, active profile, cookies, content script, history; a relaunch keeps it and holds a non-active profile’s first page for its extensions; nothing logs a value', async () => {
  const { scratch, chrome } = importScratch(['E4b: import']);
  const server = await startBrowserServer();
  const keychain = `file:${chrome.passwordFile}`;
  const { probe, fails, wallet, disabled, workProbe } = chrome.extensions;
  try {
    const s = await launchImportScene(scratch, server, chrome, { keychain });
    const [id] = s.ids as [AppSessionId];
    try {
      await recordPhases(s);
      const sheet = await openImportSheet(s);
      // the picker: both profiles by Chrome's names, the owner's account muted, the last used preselected
      const person = sheet.locator('[data-chrome-profile="Default"]');
      await expect(person).toContainText('Person 1');
      await expect(person).toContainText('Probe Owner');
      await expect(person.getByRole('radio')).toBeChecked();
      await expect(sheet.locator('[data-chrome-profile="Profile 1"]')).toContainText('Work');
      await expect(sheet.locator('[data-chrome-profile]')).toHaveCount(2);
      await sheet.getByRole('button', { name: 'Continue' }).click();

      // the consent: counts from the staged copies, Saved passwords disabled (P-17), the agents line, four extensions
      await expect(sheet).toHaveAttribute('data-browser-import', 'consent');
      await expect(s.page.getByRole('dialog', { name: 'What to import from Person 1' })).toBeVisible();
      await expect(sheet.locator('[data-category="history"]')).toContainText('6 pages');
      await expect(sheet.locator('[data-category="cookies"]')).toContainText('5 cookies (1 partitioned)');
      await expect(sheet.locator('[data-cookies-agents]')).toContainText('signed in as Person 1');
      const passwords = sheet.getByRole('checkbox', { name: 'Saved passwords — a credential store comes later' });
      await expect(passwords).toBeDisabled();
      await expect(passwords).not.toBeChecked();
      await expect(sheet.locator('[data-extension-id]')).toHaveCount(4);
      await expect(sheet.locator(`[data-extension-id="${wallet.id}"]`)).toContainText('Wallet · off until you turn it on');
      await expect(sheet.getByRole('checkbox', { name: 'Import Disabled in Chrome' })).not.toBeChecked();
      await expect(sheet.locator(`[data-extension-id="${disabled.id}"]`)).toContainText('Disabled in Chrome');
      for (const extension of [probe, fails, wallet]) await expect(sheet.getByRole('checkbox', { name: `Import ${extension.name}` })).toBeChecked();
      const importButton = sheet.getByRole('button', { name: 'Import', exact: true });
      await expect(importButton).toBeDisabled(); // the unverified-files acknowledgement first
      await sheet.getByRole('checkbox', { name: /^MAWS can't verify these extensions/ }).check();
      await expect(importButton).toBeEnabled();
      await importButton.click();

      // the run: the sheet shows it, and main reports its phases in order
      await expect(sheet).toHaveAttribute('data-browser-import', 'running');
      const done = await report(s);
      expect(await phasesHeard(s)).toEqual(['copying', 'history', 'keychain', 'cookies', 'verifying', 'extensions', 'cleaning']);

      // the report
      await expect(s.page.getByRole('dialog', { name: 'Imported from Person 1' })).toBeVisible();
      await expect(done.locator('[data-import-summary]')).toHaveText(REPORT_DONE);
      await expect(done).toContainText('1 partitioned cookie set, 1 confirmed in the partition');
      await expect(done.locator(`[data-extension-id="${probe.id}"] [data-extension-status]`)).toHaveText('Loaded · background running');
      await expect(done.locator(`[data-extension-id="${fails.id}"] [data-extension-status]`)).toHaveText(FAILS_STATUS);
      await expect(done.locator(`[data-extension-id="${wallet.id}"] [data-extension-status]`)).toHaveText('Off (wallet)');
      await expect(done).toContainText('New tabs browse as Person 1');
      await expect.poll(() => settingsFile(s.maws.userData).browser.profile).toBe('Default');
      const file = profilesFile(s.maws.userData)!;
      expect(file.profiles.map((record) => record.profileDir)).toEqual(['Default']);
      expect(file.profiles[0]!.report).toMatchObject({ outcome: 'done', cookies: { imported: 3, partitioned: { imported: 1, verified: 1 }, keychain: 'allowed' }, history: { imported: 4 } });
      expect(stagingLeft(s.maws.userData)).toEqual([]);
      const record = await recordOf(s, 'Default');
      expect(Object.fromEntries(record!.extensions.map((e) => [e.id, [e.status, e.background, e.backgroundError]]))).toEqual({
        [probe.id]: ['loaded', 'running', null],
        [fails.id]: ['loaded', 'failed', 'chrome.contextMenus.onClicked is not available in MAWS'],
        [wallet.id]: ['off', 'none', null],
      });
      await closeSheet(s);

      // a Browser tab: the pill names the profile, the partition sends the imported cookies, the content script runs
      const panel = await browserPanel(s, id);
      const echo = await newTabAt(s, panel, s.server.url('/echo-cookies?first'));
      await expect(pill(panel)).toHaveText('Person 1');
      expect(await echoedCookies(echo)).toEqual({ probe_session: cookieValue(s, 'probe_session'), probe_pref: cookieValue(s, 'probe_pref') });
      expect(await echo.evaluate(() => document.cookie)).toBe(`probe_pref=${cookieValue(s, 'probe_pref')}`);
      await expectContentScript(echo);
      expect(await s.page.evaluate(() => document.documentElement.dataset.probeContentScript ?? null)).toBeNull();
      expect((await suggest(s, DEFAULT, 'e4b-sentinel-title')).map((row) => row.title).sort()).toEqual(titlesOf(s, 'Default'));

      // the second profile imported too (it becomes the active one), then Default made active again, so the relaunch
      // boots Default's partition and leaves Work's to its first tab
      await importThrough(s, { profileDir: 'Profile 1' });
      await expect(sheetOf(s).locator('[data-import-summary]')).toHaveText('1 cookie, 2 history entries, 1 extension');
      await closeSheet(s);
      await expect.poll(() => settingsFile(s.maws.userData).browser.profile).toBe('Profile 1');
      value(await invoke(s.page, 'settings.set', { browser: { profile: 'Default' } }));
      expect(profilesFile(s.maws.userData)!.profiles.map((r) => r.profileDir)).toEqual(['Default', 'Profile 1']);
      await expectNothingLogged(s);
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);

    // the relaunch: the records, the live storage directories (Chromium's lower-cased, escaped names), the cookies, the
    // history and the extensions loaded again
    const again = await launchImportScene(scratch, server, chrome, { keychain }, s.ids);
    try {
      const listed = value(await invoke(again.page, 'browser.import.list', undefined));
      expect(listed.profiles.map((r) => r.profileDir)).toEqual(['Default', 'Profile 1']);
      expect(listed.fileBroken).toBe(false);
      for (const name of ['maws-chrome-default', 'maws-chrome-profile%201']) expect(existsSync(join(again.maws.userData, 'Partitions', name)), name).toBe(true);
      const panel = await browserPanel(again, id);
      const echo = await newTabAt(again, panel, again.server.url('/echo-cookies?relaunched'));
      await expect(pill(panel)).toHaveText('Person 1');
      // probe_pref was a Chrome session cookie, so it ended with the app (Decision Log 10); probe_session persists
      expect(await echoedCookies(echo)).toEqual({ probe_session: cookieValue(again, 'probe_session') });
      await expectContentScript(echo);
      expect((await suggest(again, DEFAULT, 'e4b-sentinel-title')).map((row) => row.title).sort()).toEqual(titlesOf(again, 'Default'));

      // Work is not the active profile, so its partition opens with this tab: the first page waits for its extensions
      value(await invoke(again.page, 'settings.set', { browser: { profile: 'Profile 1' } }));
      const work = await newTabAt(again, panel, again.server.url('/echo-cookies?work'));
      await expect(pill(panel)).toHaveText('Work');
      expect(Object.keys(await echoedCookies(work))).toEqual(['work_session']);
      await expectContentScript(work);
      await expect.poll(async () => (await recordOf(again, 'Profile 1'))?.extensions.map((e) => [e.id, e.status, e.background])).toEqual([[workProbe.id, 'loaded', 'running']]);
      expect((await suggest(again, WORK, 'e4b-sentinel-title')).map((row) => row.title).sort()).toEqual(titlesOf(again, 'Profile 1'));
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

// ---- (2) the wrong key ----------------------------------------------------------------------------------------------

test('a wrong Safe Storage password fails every cookie and says so; history and extensions import; nothing logs a value', async () => {
  const { scratch, chrome } = importScratch(['E4b: wrong key']);
  const server = await startBrowserServer();
  try {
    const s = await launchImportScene(scratch, server, chrome, { keychain: `file:${chrome.wrongPasswordFile}` });
    const [id] = s.ids as [AppSessionId];
    try {
      const done = await importThrough(s);
      await expect(done.locator('[data-import-summary]')).toHaveText(
        "0 cookies, 4 history entries, 3 extensions · 7 skipped: 5 could not be decrypted: the Safe Storage password did not match this profile, 1 hidden page, 1 page MAWS's browser can't open",
      );
      await expect(done.locator('[data-import-keychain="wrongKey"]')).toHaveText('The Safe Storage password did not match this profile; no cookie was imported');
      expect(profilesFile(s.maws.userData)!.profiles[0]!.report.cookies).toMatchObject({ imported: 0, keychain: 'wrongKey', skipped: { wrongKey: 5 } });
      await closeSheet(s);
      const panel = await browserPanel(s, id);
      const echo = await newTabAt(s, panel, s.server.url('/echo-cookies'));
      await expect(pill(panel)).toHaveText('Person 1');
      expect(await echoedCookies(echo)).toEqual({});
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

// ---- (3) denied, then cancelled ---------------------------------------------------------------------------------------

test('the Keychain denied skips cookies only; a second profile cancelled during its extensions keeps nothing', async () => {
  // slowCopy pads the Work extension's copy; the phase also waits out the loader's settle for its worker, the window
  // Cancel lands in
  const { scratch, chrome } = importScratch(['E4b: denied and cancelled'], { slowCopy: true });
  const server = await startBrowserServer();
  try {
    const s = await launchImportScene(scratch, server, chrome, { keychain: 'deny' });
    try {
      const denied = await importThrough(s);
      await expect(denied.locator('[data-import-keychain="denied"]')).toHaveText('Keychain access was not allowed; cookies were not imported');
      await expect(denied.locator('[data-import-summary]')).toContainText('0 cookies, 4 history entries, 3 extensions');
      await closeSheet(s);

      const cancelled = await importThrough(s, { profileDir: 'Profile 1', cancelDuring: 'extensions' });
      await expect(s.page.getByRole('dialog', { name: 'Cancelled' })).toBeVisible();
      await expect(cancelled).toContainText('Nothing from Work was kept');
      await closeSheet(s);
      expect(profilesFile(s.maws.userData)!.profiles.map((record) => record.profileDir)).toEqual(['Default']);
      expect(await recordOf(s, 'Profile 1')).toBeNull();
      expect(await suggest(s, WORK, '')).toEqual([]);
      expect(existsSync(join(s.maws.userData, 'browser', 'maws-chrome-Profile 1'))).toBe(false);
      expect(stagingLeft(s.maws.userData)).toEqual([]);
      expect(settingsFile(s.maws.userData).browser.profile).toBe('Default');
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

// ---- (4) toggles and removal ----------------------------------------------------------------------------------------

test('extension toggles load and unload at once; Remove closes the profile’s tab and drops its storage, history, extensions and record; the next boot sweeps the storage directory', async () => {
  const { scratch, chrome } = importScratch(['E4b: toggles and removal']);
  const server = await startBrowserServer();
  const keychain = `file:${chrome.passwordFile}`;
  const { fails, wallet } = chrome.extensions;
  try {
    const s = await launchImportScene(scratch, server, chrome, { keychain });
    const [id] = s.ids as [AppSessionId];
    try {
      await importThrough(s);
      await closeSheet(s);
      let panel = await browserPanel(s, id);
      await newTabAt(s, panel, s.server.url('/echo-cookies'));
      await expect(pill(panel)).toHaveText('Person 1');

      const region = await openSettingsBrowser(s);
      const record = recordIn(region, 'Default');
      const row = (name: string) => record.getByRole('group', { name, exact: true });
      const status = (name: string) => row(name).locator('[data-extension-status]');
      await expect(status(fails.name)).toHaveText(FAILS_STATUS);
      await row(fails.name).getByRole('radio', { name: 'Off' }).check();
      await expect(status(fails.name)).toHaveText('Off');
      await row(fails.name).getByRole('radio', { name: 'On' }).check();
      await expect(status(fails.name)).toHaveText(FAILS_STATUS);
      await expect(status(wallet.name)).toHaveText('Off (wallet)');
      await row(wallet.name).getByRole('radio', { name: 'On' }).check();
      await expect(status(wallet.name)).toHaveText('Loaded · no background');
      expect((await recordOf(s, 'Default'))!.extensions.find((e) => e.id === wallet.id)).toMatchObject({ enabled: true, status: 'loaded' });

      await record.getByRole('button', { name: 'Remove imported profile' }).click();
      const confirm = s.page.locator('[data-browser-import-remove="Default"]');
      await expect(confirm).toContainText('1 open tab');
      const remove = confirm.getByRole('button', { name: 'Remove', exact: true });
      await expect(remove).toBeDisabled();
      await confirm.getByRole('checkbox', { name: 'Remove everything MAWS imported from Person 1' }).check();
      await remove.click();
      await expect(confirm).toHaveCount(0);
      await expect(record).toHaveCount(0);
      expect(profilesFile(s.maws.userData)).toEqual({ version: 1, profiles: [] });
      await expect.poll(() => settingsFile(s.maws.userData).browser.profile).toBeNull();
      expect(await suggest(s, DEFAULT, '')).toEqual([]);
      expect(existsSync(join(s.maws.userData, 'browser', 'maws-chrome-Default'))).toBe(false);
      expect(existsSync(join(s.maws.userData, 'Partitions', 'maws-chrome-default')), 'the emptied shell stays until the next boot').toBe(true);
      expect(value(await invoke(s.page, 'browser.tabs.list', {})).tabs.filter((tab) => tab.partition === DEFAULT)).toEqual([]);

      panel = await browserPanel(s, id);
      await expect(chipsIn(panel)).toHaveCount(0);
      await newTabAt(s, panel, s.server.url('/echo-cookies?after-removal'));
      await expect(pill(panel)).toHaveText('Default');
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);

    const again = await launchImportScene(scratch, server, chrome, { keychain }, s.ids);
    try {
      expect(existsSync(join(again.maws.userData, 'Partitions', 'maws-chrome-default')), 'swept at boot').toBe(false);
      expect(value(await invoke(again.page, 'browser.import.list', undefined)).profiles).toEqual([]);
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

// ---- (5) the Chrome-running hint and a chosen folder ------------------------------------------------------------------

test('the picker hints that Chrome is running, lists a chosen folder’s profiles, and says when a folder has no Local State', async () => {
  const { scratch, chrome } = importScratch(['E4b: picker']);
  symlinkSync('e4b-host-4242', join(chrome.dir, 'SingletonLock')); // Chrome's lock is a symlink to <host>-<pid>
  const other = buildChromeUserData(join(scratch.root, 'other-chrome'));
  const empty = join(scratch.root, 'not-chrome');
  mkdirSync(empty);
  const server = await startBrowserServer();
  const pickNext = (s: ImportScene, path: string) => s.maws.app.evaluate((_electron, p) => void (process.env.MAWS_E2E_PICK_PATHS = p), path);
  try {
    const s = await launchImportScene(scratch, server, chrome, { keychain: 'deny' });
    try {
      const sheet = await openImportSheet(s);
      await expect(sheet.locator('legend')).toHaveText(chrome.dir);
      await expect(sheet).toContainText('Quit Chrome for the most complete copy');

      await pickNext(s, other.dir);
      await sheet.getByRole('button', { name: 'Choose another Chrome folder…' }).click();
      await expect(sheet.locator('legend')).toHaveText(other.dir);
      await expect(sheet.locator('[data-chrome-profile]')).toHaveCount(2);
      await expect(sheet.locator('[data-chrome-profile="Default"]').getByRole('radio')).toBeChecked();
      await expect(sheet).not.toContainText('Quit Chrome for the most complete copy');

      await pickNext(s, empty);
      await sheet.getByRole('button', { name: 'Choose another Chrome folder…' }).click();
      await expect(sheet).toContainText(`No Chrome folder at ${empty}`);
      await expect(sheet.getByRole('button', { name: 'Continue' })).toBeDisabled();
      await closeSheet(s);
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

// ---- (6) many extensions, and the shots ---------------------------------------------------------------------------------

test('the consent with twenty extensions keeps Import on screen and scrolls its list; the four states in both themes', async () => {
  const { scratch, chrome } = importScratch(['E4b: shots']);
  const extras = addExtensions(chrome, 'Default', 16);
  const server = await startBrowserServer();
  try {
    const s = await launchImportScene(scratch, server, chrome, { keychain: `file:${chrome.passwordFile}` });
    try {
      const sheet = await openImportSheet(s);
      await expect(sheet.locator('[data-chrome-profile]')).toHaveCount(2);
      await shootImport(s, 'pick');
      await sheet.getByRole('button', { name: 'Continue' }).click();
      await expect(sheet).toHaveAttribute('data-browser-import', 'consent');
      await expect(sheet.locator('[data-extension-id]')).toHaveCount(4 + extras.length);
      await sheet.getByRole('checkbox', { name: /^MAWS can't verify these extensions/ }).check();
      const importButton = sheet.getByRole('button', { name: 'Import', exact: true });
      await expect(importButton).toBeInViewport({ ratio: 1 });
      const box = (await sheet.boundingBox())!;
      const viewport = await s.page.evaluate(() => window.innerHeight);
      expect(box.y + box.height, 'the sheet ends inside the window').toBeLessThanOrEqual(viewport);
      const scroller = sheet.locator('form > div').first();
      expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight), 'the consent scrolls its own list').toBe(true);
      await scroller.evaluate((el) => (el.scrollTop = 0)); // the shot shows the categories; the list scrolls under them
      await shootImport(s, 'consent');
      await importButton.click();
      const done = await report(s);
      await expect(done.locator('[data-import-summary]')).toContainText(`4 cookies, 4 history entries, ${3 + extras.length} extensions`);
      await expect(done.getByRole('button', { name: 'Done' })).toBeInViewport({ ratio: 1 });
      await shootImport(s, 'report');
      await closeSheet(s);
      const region = await openSettingsBrowser(s);
      await recordIn(region, 'Default').scrollIntoViewIfNeeded();
      await shootImport(s, 'settings');
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
