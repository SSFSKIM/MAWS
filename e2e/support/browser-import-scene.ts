// E4b's scene for `e2e/browser-import.spec.ts` (E4b execution document, Task 4.1; Acceptance G1): E4a's browser scene
// (support/browser-scene.ts, imported, not copied: the product app over the replay, a loopback server, the Browser
// tool's locators) launched with the import's seams pointed at the synthetic Chrome user data directory
// (test/support/chrome-profile.ts), never at the owner's Chrome or Keychain:
//
// - `MAWS_E2E_CHROME_USER_DATA` names the fixture as the picker's default folder; `MAWS_E2E_KEYCHAIN` answers the
//   Keychain step (`file:<the fixture's password file>`, a wrong one, or `deny`); `MAWS_E2E_IMPORT_LOG` mirrors the
//   import's log lines into the scratch;
// - `collectMainOutput` reads main's own stdout and stderr (Playwright launches Electron with piped stdio) from the moment
//   the launch resolves (launch.ts's `onLaunched`), so the boot's sweep and eager extension load are read too, and the
//   scene keeps every console message of the app window, so `expectNothingLogged` can assert that none of the fixture's
//   sentinels (cookie values, history paths and titles, the passwords) reached any of them (Design §16);
// - `openSettingsBrowser`, `importThrough` and `report` drive Settings › Browser and the import sheet as the owner does;
// - `shootImport` writes `e4b-<state>-<theme>.png` under docs/doperpowers/evidence/p1-e4b/ when MAWS_E4B_SHOTS=1.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { ImportedProfile } from '@shared/browser/profiles';
import type { AppSessionId } from '@shared/graph/ids';
import { buildChromeUserData, chromeExtensionId, SENTINEL_PREFIX, type ChromeUserData, type ChromeUserDataOptions } from '../../test/support/chrome-profile';
import { launchBrowserScene, type BrowserScene } from './browser-scene';
import type { BrowserServer } from './browser-server';
import { invoke, value } from './c7-replay';
import { clearToasts, scratchProject, type Scratch } from './deliverables-scene';
import { onLaunched, REPO_ROOT } from './launch';
import { menu } from './menu';

export interface ImportScene extends BrowserScene {
  chrome: ChromeUserData;
  mainOutput(): string; // main's stdout and stderr since the process started
  appConsole(): string[]; // every console message and uncaught error of the app window since its first load
  importLog: string; // the MAWS_E2E_IMPORT_LOG mirror (one file across a scratch's launches)
  importLogFrom: number; // its length when this launch started
}

export interface ImportSeams {
  keychain: string; // MAWS_E2E_KEYCHAIN: `file:<path>`, `deny`, `missing` or `timeout`
}

// A scratch project with the Chrome fixture built beside it, under the scratch root (removed with it).
export function importScratch(titles: string[], options: ChromeUserDataOptions = {}): { scratch: Scratch; chrome: ChromeUserData } {
  const scratch = scratchProject({ titles });
  return { scratch, chrome: buildChromeUserData(join(scratch.root, 'chrome'), options) };
}

// The product app over the scratch with the import's seams set (main reads them from its environment; launchMaws passes
// the runner's environment on, so they are set around the launch as E4a's scene sets its own).
export async function launchImportScene(scratch: Scratch, server: BrowserServer, chrome: ChromeUserData, seams: ImportSeams, known?: AppSessionId[]): Promise<ImportScene> {
  const importLog = join(scratch.root, 'import-log.txt');
  const vars = { MAWS_E2E_CHROME_USER_DATA: chrome.dir, MAWS_E2E_KEYCHAIN: seams.keychain, MAWS_E2E_IMPORT_LOG: importLog };
  const before = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const importLogFrom = existsSync(importLog) ? readFileSync(importLog, 'utf8').length : 0;
  let mainOutput = (): string => '';
  let s: BrowserScene;
  try {
    s = await onLaunched((app) => (mainOutput = collectMainOutput(app)), () => launchBrowserScene(scratch, server, known));
  } finally {
    for (const [key, was] of Object.entries(before)) {
      if (was === undefined) delete process.env[key];
      else process.env[key] = was;
    }
  }
  const appConsole = await collectAppConsole(s.page);
  return Object.assign(s, { chrome, mainOutput, appConsole, importLog, importLogFrom });
}

// Main's stdout and stderr from now on: Playwright's Electron child has both piped, and a listener added to a stream
// already flowing receives every later chunk.
export function collectMainOutput(app: ElectronApplication): () => string {
  const chunks: string[] = [];
  const child = app.process();
  child.stdout?.on('data', (data: Buffer) => chunks.push(data.toString('utf8')));
  child.stderr?.on('data', (data: Buffer) => chunks.push(data.toString('utf8')));
  return () => chunks.join('');
}

// Every console message (any level) and uncaught error of the app window, seeded from what Playwright kept since launch.
async function collectAppConsole(page: Page): Promise<() => string[]> {
  const live: string[] = [];
  page.on('console', (message) => live.push(message.text()));
  page.on('pageerror', (error) => live.push(`uncaught: ${error.message}\n${error.stack ?? ''}`));
  const seeded = (await page.consoleMessages({ filter: 'all' })).map((message) => message.text());
  const seededErrors = (await page.pageErrors({ filter: 'all' })).map((error) => `uncaught: ${error.message}\n${error.stack ?? ''}`);
  live.splice(0);
  return () => [...seeded, ...seededErrors, ...live];
}

// Nothing logs a value (Design §16): none of the fixture's sentinels in main's streams, the app window's console or the
// import's log mirror. A leak is reported by the sentinel's kind and position, never by the value itself. Every line
// the import logged in this launch is also in main's stdout, so the check is known to have read the stream it checks.
// The mirror file is appended synchronously by main while its stdout reaches this process through the pipe, so a line
// logged just before the check can be in the file and not yet received: the containment check waits (bounded) for the
// stream to catch up, and the sentinel checks then read the caught-up stream.
export async function expectNothingLogged(s: ImportScene): Promise<void> {
  const readImportLog = () => (existsSync(s.importLog) ? readFileSync(s.importLog, 'utf8') : '');
  await expect
    .poll(
      () => {
        const output = s.mainOutput();
        return readImportLog().slice(s.importLogFrom).split('\n').filter(Boolean).filter((line) => !output.includes(line));
      },
      { timeout: 5_000, message: "the import's lines of this launch, missing from main's stdout" },
    )
    .toEqual([]);
  const importLog = readImportLog();
  const sources = { 'main stdout and stderr': s.mainOutput(), 'the app console': s.appConsole().join('\n'), 'the import log': importLog };
  for (const [where, text] of Object.entries(sources)) {
    const leaked = s.chrome.sentinels.flatMap((sentinel, k) => (text.includes(sentinel) ? [`#${k} ${sentinel.startsWith(SENTINEL_PREFIX) ? sentinel.split('-')[2] : 'password'}`] : []));
    expect(leaked, `sentinels in ${where}`).toEqual([]);
  }
}

// ---- Settings › Browser and the sheet -------------------------------------------------------------------------------

const settingsPanel = (s: ImportScene) => s.page.locator('[data-region="main"]').getByRole('tabpanel');

// Settings (⌘,) at its Browser section: the section's region.
// The application menu can still be building just after launch, so its item is awaited before it is clicked.
export async function openSettingsBrowser(s: ImportScene): Promise<Locator> {
  await expect
    .poll(() => s.maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('settings.open')?.enabled ?? false), { message: 'the Settings menu item is ready' })
    .toBe(true);
  await menu(s.maws.app, 'settings.open');
  const panel = settingsPanel(s);
  await panel.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Browser', exact: true }).click();
  const region = panel.getByRole('region', { name: 'Browser', exact: true });
  await expect(region).toBeVisible();
  return region;
}

export const sheetOf = (s: ImportScene): Locator => s.page.locator('[data-browser-import]');
export const recordIn = (region: Locator, profileDir: string): Locator => region.locator(`[data-imported-profile="${profileDir}"]`);

// Import a Chrome profile… opened from Settings › Browser: the sheet in its pick state.
export async function openImportSheet(s: ImportScene): Promise<Locator> {
  const region = await openSettingsBrowser(s);
  await region.getByRole('button', { name: 'Import a Chrome profile…' }).click();
  const sheet = sheetOf(s);
  await expect(sheet).toHaveAttribute('data-browser-import', 'pick');
  return sheet;
}

export interface ImportChoices {
  profileDir?: string; // the picker's preselection when absent
  history?: boolean; // each category as the consent offers it when absent
  cookies?: boolean;
  extensions?: boolean;
  cancelDuring?: 'extensions'; // press Cancel once main reports this phase
  atConsent?: (sheet: Locator) => Promise<void>; // runs in the consent state before Import
}

// The picker → consent → Import, with the unverified-files acknowledgement checked whenever it is offered; then the
// report. The sheet is left open on its report.
export async function importThrough(s: ImportScene, choices: ImportChoices = {}): Promise<Locator> {
  const sheet = await openImportSheet(s);
  if (choices.profileDir !== undefined) await sheet.locator(`[data-chrome-profile="${choices.profileDir}"]`).getByRole('radio').check();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet).toHaveAttribute('data-browser-import', 'consent');
  for (const category of ['history', 'cookies', 'extensions'] as const) {
    const wanted = choices[category];
    if (wanted !== undefined) await sheet.getByRole('checkbox', { name: { history: 'History', cookies: 'Cookies', extensions: 'Extensions' }[category], exact: true }).setChecked(wanted);
  }
  const acknowledgement = sheet.getByRole('checkbox', { name: /^MAWS can't verify these extensions/ });
  if (await acknowledgement.count()) await acknowledgement.check();
  await choices.atConsent?.(sheet);
  await sheet.getByRole('button', { name: 'Import', exact: true }).click();
  if (choices.cancelDuring) {
    await expect(sheet.locator(`[data-import-phase="${choices.cancelDuring}"]`)).toBeVisible();
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  return report(s);
}

// The sheet in its report state (a run's end, or Show report).
export async function report(s: ImportScene): Promise<Locator> {
  const sheet = sheetOf(s);
  await expect(sheet).toHaveAttribute('data-browser-import', 'report', { timeout: 30_000 });
  return sheet;
}

export async function closeSheet(s: ImportScene): Promise<void> {
  const sheet = sheetOf(s);
  await sheet.getByRole('button', { name: /^(Done|Close|Cancel)$/ }).first().click();
  await expect(sheet).toHaveCount(0);
}

// Every `browser.import.progress` phase the window hears, in order (installed once per launch).
export async function recordPhases(s: ImportScene): Promise<void> {
  await s.page.evaluate(() => {
    const w = window as unknown as { __e4bPhases?: string[] };
    if (w.__e4bPhases) return;
    const phases: string[] = [];
    w.__e4bPhases = phases;
    window.maws.on('browser.import.progress', ({ phase }) => {
      if (phases[phases.length - 1] !== phase) phases.push(phase);
    });
  });
}
export const phasesHeard = (s: ImportScene): Promise<string[]> => s.page.evaluate(() => (window as unknown as { __e4bPhases?: string[] }).__e4bPhases ?? []);

// ---- main's records -------------------------------------------------------------------------------------------------

export function profilesFile(userData: string): { version: number; profiles: ImportedProfile[] } | null {
  const file = join(userData, 'browser', 'profiles.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { version: number; profiles: ImportedProfile[] }) : null;
}

export const settingsFile = (userData: string) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as { browser: { profile: string | null } };

export const stagingLeft = (userData: string): string[] => {
  const dir = join(userData, 'browser', 'import');
  return existsSync(dir) ? readdirSync(dir) : [];
};

// The record as main holds it (the e2e seam `__maws_browser_import`).
export async function recordOf(s: ImportScene, profileDir: string): Promise<ImportedProfile | null> {
  return s.maws.app.evaluate(
    (_electron, dir) => (globalThis as unknown as { __maws_browser_import: { record(profileDir: string): unknown } }).__maws_browser_import.record(dir) as ImportedProfile | null,
    profileDir,
  );
}

export async function suggest(s: ImportScene, partition: string, query: string): Promise<{ url: string; title: string | null }[]> {
  return value(await invoke(s.page, 'browser.history.suggest', { partition, query })).suggestions;
}

// What `/echo-cookies` answered a page: the Cookie header the partition sent, by name.
export async function echoedCookies(page: Page): Promise<Record<string, string>> {
  const text = await page.locator('#echo').textContent();
  return (JSON.parse(text ?? 'null') as { cookies: Record<string, string> }).cookies;
}

// The probe extension's content-script marker on a page's document, polled (it runs at document_idle).
export async function expectContentScript(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.probeContentScript ?? null), { message: "the probe's content script marked the page" }).toBe('1');
}

// ---- the fixture, extended for the consent's height ------------------------------------------------------------------

const EXTRA_NAMES = ['Tab Organizer', 'Reading Mode', 'Grammar Helper', 'Page Ruler', 'Color Picker', 'JSON Formatter', 'Session Buddy', 'Screenshot Tool', 'Dark Theme', 'Link Checker', 'Cookie Banner Hider', 'Translate Selection', 'Font Finder', 'Quick Notes', 'Tab Suspender', 'Video Speed'];

// `n` more installed extensions in a fixture profile, each keyed so its directory is its id, with no background (a
// copied and loaded row each, quick to settle): the owner's profile has twenty, and the consent must stay usable.
export function addExtensions(chrome: ChromeUserData, profileDir: 'Default' | 'Profile 1', n: number): string[] {
  const ids: string[] = [];
  for (let k = 0; k < n; k++) {
    const der = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' });
    const id = chromeExtensionId(der);
    const dir = join(chrome.dir, profileDir, 'Extensions', id, '1.0.0_0');
    mkdirSync(dir, { recursive: true });
    const manifest = { manifest_version: 3, name: EXTRA_NAMES[k % EXTRA_NAMES.length], version: '1.0.0', description: 'A fixture extension with no background', key: der.toString('base64') };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    ids.push(id);
  }
  return ids;
}

// ---- evidence -------------------------------------------------------------------------------------------------------

export const SHOTS = process.env.MAWS_E4B_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e4b') : null;
const THEMES = ['light', 'dark'] as const;

// `e4b-<state>-<theme>.png`, the window as it stands in each theme, then back to light.
export async function shootImport(s: ImportScene, state: string): Promise<void> {
  if (SHOTS === null) return;
  mkdirSync(SHOTS, { recursive: true });
  await clearToasts(s.page);
  for (const theme of THEMES) {
    value(await invoke(s.page, 'settings.set', { theme }));
    await expect(s.page.locator('html')).toHaveAttribute('data-theme', theme);
    await s.page.waitForTimeout(250);
    await s.page.screenshot({ path: join(SHOTS, `e4b-${state}-${theme}.png`) });
  }
  value(await invoke(s.page, 'settings.set', { theme: 'light' }));
  await expect(s.page.locator('html')).toHaveAttribute('data-theme', 'light');
}
