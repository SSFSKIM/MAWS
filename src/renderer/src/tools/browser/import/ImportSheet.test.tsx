// E4b Task 3.1: the import sheet (Design §3, §10; Decision Log 21, 28; P-17, P-23): the picker's preselection and the
// chosen-folder route, the consent's rule (a category, the acknowledgement only with extensions; Saved passwords
// disabled with P-17's words; the agents line under Cookies), the Keychain line, the report for the fixture's runs, and
// the lifecycle per state (pick and consent discard on close, running ignores it and only Cancel ends the run, report
// just closes, a remounted sheet shows the run).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedExtension, ImportReport } from '@shared/browser/import';
import type { MawsBridge } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V14 } from '@shared/settings/defaults';
import { CANCELLED_REPORT, NO_SKIPS, WRONG_KEY_REPORT } from '../../../../../../test/support/import-reports';
import { useSettings } from '../../../stores/settings';
import { CHROME, DISABLED_ID, DONE, FAILS_ID, IMPORT_ID, importBridge, INSPECTION, INSPECTION_ID, PROFILES_ANSWER, RECORD, WALLET_ID, type ImportBridge } from '../../../test-support/browser-import';
import { IMPORT_COPY } from './copy';
import { ImportSheet } from './ImportSheet';
import { browserImport, connectBrowserImport, openImport, resetBrowserImport, showReport } from './store';
import { formatDate } from '../../../app/date-format';

let b: ImportBridge;
let disconnect = () => {};
const calls = (name: string) => b.calls.filter((c) => c.name === name).map((c) => c.input);
const sheet = () => screen.getByRole('dialog');
const button = (name: string | RegExp) => within(sheet()).getByRole('button', { name }) as HTMLButtonElement;
const box = (name: string | RegExp) => within(sheet()).getByRole('checkbox', { name }) as HTMLInputElement;

function renderSheet(answers: ImportBridge['answers'] = {}) {
  Object.assign(b.answers, answers);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect = connectBrowserImport(undefined, queries);
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={queries}>
      <ImportSheet onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, view, queries };
}

async function toConsent() {
  const rendered = renderSheet();
  await within(sheet()).findByRole('radio', { name: /Person 1/ }); // Local State answered
  fireEvent.click(button('Continue'));
  await within(sheet()).findByText(/6 pages/);
  return rendered;
}

beforeEach(() => {
  b = importBridge();
  window.maws = b.bridge;
});
afterEach(() => {
  cleanup();
  disconnect();
  resetBrowserImport();
  useSettings.setState({ state: null });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('pick', () => {
  it('lists Local State’s profiles with the muted names, preselects the last used one, and Continue inspects it', async () => {
    renderSheet();
    expect(sheet().dataset.browserImport).toBe('pick');
    expect(screen.getByText('Import a Chrome profile')).toBeTruthy();
    const person = (await within(sheet()).findByRole('radio', { name: /Person 1/ })) as HTMLInputElement;
    expect(person.checked).toBe(true);
    expect(within(sheet()).getByText('Probe Owner')).toBeTruthy();
    expect((within(sheet()).getByRole('radio', { name: /Work/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(button('Continue'));
    await vi.waitFor(() => expect(calls('browser.import.inspect')).toEqual([{ userDataDir: CHROME, profileDir: 'Default' }]));
    await vi.waitFor(() => expect(sheet().dataset.browserImport).toBe('consent'));
    expect(screen.getByText('What to import from Person 1')).toBeTruthy();
  });

  it('an imported profile is shown with its date and cannot be chosen; the next one is preselected', async () => {
    const profiles = PROFILES_ANSWER.profiles.map((p) => (p.profileDir === 'Default' ? { ...p, imported: true } : p));
    b.answers['browser.import.list'] = () => ({ profiles: [RECORD], fileBroken: false, running: null });
    renderSheet({ 'browser.import.profiles': () => ({ ...PROFILES_ANSWER, profiles }) });
    const person = (await within(sheet()).findByRole('radio', { name: /Person 1/ })) as HTMLInputElement;
    expect(person.disabled).toBe(true);
    await within(sheet()).findByText(`Imported ${formatDate(Date.parse(RECORD.importedAt))}`);
    expect((within(sheet()).getByRole('radio', { name: /Work/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('"Choose another Chrome folder…" re-lists from the chosen folder and inspects there; a folder without Local State says so', async () => {
    const other = '/Users/owner/Other Chrome';
    renderSheet({ 'browser.import.chooseUserData': () => ({ userDataDir: other }) });
    await within(sheet()).findByRole('radio', { name: /Person 1/ });
    fireEvent.click(button('Choose another Chrome folder…'));
    await within(sheet()).findByText(other);
    expect(calls('browser.import.profiles')).toContainEqual({ userDataDir: other });
    fireEvent.click(button('Continue'));
    await vi.waitFor(() => expect(calls('browser.import.inspect')).toEqual([{ userDataDir: other, profileDir: 'Default' }]));

    cleanup();
    disconnect();
    resetBrowserImport();
    renderSheet({ 'browser.import.profiles': () => ({ ...PROFILES_ANSWER, userDataDir: other, found: false, profiles: [] }) });
    await within(sheet()).findByText(`No Chrome folder at ${other}`);
    expect(button('Continue').disabled).toBe(true);
  });

  it('a failed Local State read and a refused folder are said in words, never an endless "Reading…"', async () => {
    renderSheet({
      'browser.import.profiles': () => {
        throw new Error('the Chrome folder must be an absolute, normal path');
      },
      'browser.import.chooseUserData': () => {
        throw new Error('the Chrome folder must be an absolute, normal path');
      },
    });
    await within(sheet()).findByText("Couldn't list Chrome's profiles: the Chrome folder must be an absolute, normal path");
    expect(within(sheet()).queryByText("Reading Chrome's profiles…")).toBeNull();
    fireEvent.click(button('Choose another Chrome folder…'));
    await within(sheet()).findByText("Couldn't use that folder: the Chrome folder must be an absolute, normal path");
  });

  it('shows the Chrome-running hint, never as a block', async () => {
    renderSheet({ 'browser.import.profiles': () => ({ ...PROFILES_ANSWER, chromeRunning: true }) });
    await within(sheet()).findByText('Quit Chrome for the most complete copy');
    expect(button('Continue').disabled).toBe(false);
  });
});

describe('consent', () => {
  it('shows the counts, Saved passwords disabled with P-17’s words, the agents line, and the extension facts', async () => {
    await toConsent();
    expect(box('History').checked).toBe(true);
    expect(within(sheet()).getByText(/^6 pages\. Read from a copy; needs no password\./)).toBeTruthy();
    expect(box('Cookies').checked).toBe(true);
    expect(within(sheet()).getByText(/^5 cookies \(1 partitioned\)\. macOS will ask once/)).toBeTruthy();
    expect(within(sheet()).getByText(/choose Allow\./)).toBeTruthy();
    expect(within(sheet()).getByText("New browser tabs, including the ones agents open through MAWS's browser tools, will be signed in as Person 1 wherever Chrome was.")).toBeTruthy();
    const passwords = box('Saved passwords — a credential store comes later');
    expect([passwords.disabled, passwords.checked]).toEqual([true, false]);
    expect(sheet().textContent).not.toMatch(/always/i);

    const row = (id: string) => sheet().querySelector(`[data-extension-id="${id}"]`) as HTMLElement;
    expect(within(row(WALLET_ID)).getByText('Wallet · off until you turn it on')).toBeTruthy();
    expect(box('Import Probe Wallet').checked).toBe(true); // imported, off
    expect(box('Import Disabled in Chrome').checked).toBe(false); // Decision Log 9
    expect(within(row(DISABLED_ID)).getByText('Disabled in Chrome', { selector: 'span span' })).toBeTruthy();
    expect(within(row(FAILS_ID)).getByText('1 permission MAWS doesn\'t support').closest('[title]')!.getAttribute('title')).toBe('contextMenus');
    expect(within(row(WALLET_ID)).getByText('No background')).toBeTruthy();
  });

  it('Import needs a category, and the acknowledgement only while an extension is chosen; it sends exactly what is checked', async () => {
    await toConsent();
    expect(button('Import').disabled).toBe(true); // extensions are checked: the acknowledgement is required
    fireEvent.click(box('Extensions'));
    expect(button('Import').disabled).toBe(false);
    fireEvent.click(box('History'));
    fireEvent.click(box('Cookies'));
    fireEvent.click(box('Bookmarks')); // cua #90
    expect(button('Import').disabled).toBe(true); // nothing chosen
    fireEvent.click(box('Extensions'));
    expect(button('Import').disabled).toBe(true);
    fireEvent.click(box(/MAWS can't verify these extensions/));
    expect(button('Import').disabled).toBe(false);
    fireEvent.click(box('Import Fails'));
    fireEvent.click(button('Import'));
    await vi.waitFor(() =>
      expect(calls('browser.import.start')).toEqual([
        {
          inspectionId: INSPECTION_ID,
          categories: { history: false, cookies: false, extensions: true, bookmarks: false },
          extensionIds: [INSPECTION.extensions[0]!.id, WALLET_ID],
          allowUnverifiedExtensions: true,
        },
      ]),
    );
  });

  it('without extensions chosen it never sends the acknowledgement', async () => {
    await toConsent();
    for (const name of ['Import Probe', 'Import Fails', 'Import Probe Wallet']) fireEvent.click(box(name));
    fireEvent.click(button('Import'));
    await vi.waitFor(() =>
      expect(calls('browser.import.start')).toEqual([{ inspectionId: INSPECTION_ID, categories: { history: true, cookies: true, extensions: false, bookmarks: true }, extensionIds: [], allowUnverifiedExtensions: false }]),
    );
  });

  it('a cookie store with no rows says so, without the Keychain sentence, and starts unchecked', async () => {
    renderSheet({ 'browser.import.inspect': () => ({ ...INSPECTION, cookies: { rows: 0, partitioned: 0, storeVersion: 24 } }) });
    await within(sheet()).findByRole('radio', { name: /Person 1/ });
    fireEvent.click(button('Continue'));
    await within(sheet()).findByText('No cookies in this profile.');
    expect(sheet().textContent).not.toContain('Keychain');
    expect(sheet().querySelector('[data-cookies-agents]')).toBeNull();
    expect([box('Cookies').checked, box('Cookies').disabled]).toEqual([false, false]);
  });

  it('a store the inspection could not read disables its row and says why in words', async () => {
    renderSheet({ 'browser.import.inspect': () => ({ ...INSPECTION, history: { error: 'SQLITE_NOTADB' }, cookies: { error: 'missing' } }) });
    await within(sheet()).findByRole('radio', { name: /Person 1/ });
    fireEvent.click(button('Continue'));
    await within(sheet()).findByText("History couldn't be read from the copy. Chrome may have been writing it; quit Chrome and try again.");
    expect(within(sheet()).getByText('This profile has no Cookies file.')).toBeTruthy();
    expect([box('History').disabled, box('History').checked, box('Cookies').disabled, box('Cookies').checked]).toEqual([true, false, true, false]);
  });

  // cua #90 start
  it('lists Bookmarks between Cookies and Extensions with the count found, checked, and Bookmarks alone is enough to import', async () => {
    await toConsent();
    const categories = [...sheet().querySelectorAll('[data-category]')].map((row) => row.getAttribute('data-category'));
    expect(categories).toEqual(['history', 'cookies', 'bookmarks', 'passwords', 'extensions']);
    expect([box('Bookmarks').checked, box('Bookmarks').disabled]).toEqual([true, false]);
    expect(within(sheet().querySelector('[data-category="bookmarks"]') as HTMLElement).getByText(/^46 bookmarks\./)).toBeTruthy();
    for (const name of ['History', 'Cookies', 'Extensions']) fireEvent.click(box(name));
    expect(button('Import').disabled).toBe(false);
    fireEvent.click(button('Import'));
    await vi.waitFor(() =>
      expect(calls('browser.import.start')).toEqual([
        { inspectionId: INSPECTION_ID, categories: { history: false, cookies: false, extensions: false, bookmarks: true }, extensionIds: [], allowUnverifiedExtensions: false },
      ]),
    );
  });

  it('a profile with no readable Bookmarks file disables the row and says so', async () => {
    renderSheet({ 'browser.import.inspect': () => ({ ...INSPECTION, bookmarks: null }) });
    await within(sheet()).findByRole('radio', { name: /Person 1/ });
    fireEvent.click(button('Continue'));
    await within(sheet()).findByText('No bookmarks file');
    expect([box('Bookmarks').disabled, box('Bookmarks').checked]).toEqual([true, false]);
  });
  // cua #90 end
});

describe('running', () => {
  it('shows the phase main reports, the Keychain line while it is asked, and Cancel sends cancel for this run', async () => {
    await toConsent();
    fireEvent.click(box('Extensions'));
    fireEvent.click(button('Import'));
    await vi.waitFor(() => expect(sheet().dataset.browserImport).toBe('running'));
    expect(screen.getByText('Importing from Person 1…')).toBeTruthy();
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'copying', done: 0, total: 1 });
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'keychain', done: 0, total: 1 });
    await within(sheet()).findByText('Waiting for the Keychain… choose Allow in the macOS dialog');
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'extensions', done: 1, total: 3 }); // no cookies phase: a wrong key has none
    await within(sheet()).findByText('Importing extensions…');
    expect(within(sheet()).getByText('1 of 3')).toBeTruthy();
    fireEvent.click(button('Cancel'));
    expect(calls('browser.import.cancel')).toEqual([{ importId: IMPORT_ID }]);
    expect(button('Cancelling…').disabled).toBe(true);
  });

  it('cannot be dismissed (Escape does nothing), and a remounted sheet shows the run', async () => {
    const { onClose } = await toConsent();
    fireEvent.click(box('Extensions'));
    fireEvent.click(button('Import'));
    await vi.waitFor(() => expect(sheet().dataset.browserImport).toBe('running'));
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(calls('browser.import.discard')).toEqual([]);
    cleanup(); // Settings closed mid-run
    disconnect();
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'history', done: 6, total: 6 }); // not heard: no store connection
    renderSheet();
    expect(sheet().dataset.browserImport).toBe('running');
    expect(screen.getByText('Importing from Person 1…')).toBeTruthy();
  });
});

describe('close', () => {
  it('in pick just closes; in consent it discards the inspection, then closes', async () => {
    const { onClose } = renderSheet();
    await within(sheet()).findByRole('radio', { name: /Person 1/ });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls('browser.import.discard')).toEqual([]);
    cleanup();
    disconnect();

    const again = await toConsent();
    fireEvent.click(button('Cancel'));
    expect(again.onClose).toHaveBeenCalledTimes(1);
    expect(calls('browser.import.discard')).toEqual([{ inspectionId: INSPECTION_ID }]);
    expect(browserImport.getState().stage).toEqual({ kind: 'pick' });
  });

  it('unmounting in consent (Settings closed) discards the inspection; unmounting in report discards nothing', async () => {
    await toConsent();
    cleanup();
    expect(calls('browser.import.discard')).toEqual([{ inspectionId: INSPECTION_ID }]);
    expect(browserImport.getState().stage).toEqual({ kind: 'pick' });
    disconnect();
    showReport(DONE);
    renderSheet();
    cleanup();
    expect(calls('browser.import.discard')).toHaveLength(1);
    expect(browserImport.getState().stage).toEqual({ kind: 'report', report: DONE });
  });

  it('in report Escape and Done just close', async () => {
    showReport(DONE);
    const { onClose } = renderSheet();
    await userEvent.keyboard('{Escape}');
    fireEvent.click(button('Done'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(calls('browser.import.discard')).toEqual([]);
  });
});

describe('report', () => {
  const extensionRow = (id: string) => sheet().querySelector(`[data-extension-id="${id}"]`) as HTMLElement;

  it('the full import: the summary, the partitioned line, each extension’s state, and the active line once the setting names it', async () => {
    renderSheet();
    b.emit('browser.import.finished', { importId: IMPORT_ID, report: DONE });
    await vi.waitFor(() => expect(sheet().dataset.browserImport).toBe('report'));
    expect(screen.getByText('Imported from Person 1')).toBeTruthy();
    expect(sheet().querySelector('[data-import-summary]')!.textContent).toBe(
      "4 cookies, 4 history entries, 3 extensions · 3 skipped: 1 rejected by Chromium (SameSite=None without Secure), 1 hidden page, 1 page MAWS's browser can't open",
    );
    expect(within(sheet()).getByText('1 partitioned cookie set, 1 confirmed in the partition')).toBeTruthy();
    expect(within(extensionRow(DONE.extensions[0]!.id)).getByText('Loaded · background running')).toBeTruthy();
    expect(within(extensionRow(FAILS_ID)).getByText('Loaded · background failed: chrome.contextMenus.onClicked is not available in MAWS')).toBeTruthy();
    expect(within(extensionRow(WALLET_ID)).getByText('Off (wallet)')).toBeTruthy();
    expect(within(sheet()).getByText('Cookies · Rejected by Chromium (SameSite=None without Secure) (1)')).toBeTruthy();
    await within(sheet()).findByText("New tabs browse as Person 1. Change in Settings › Browser.");
    expect(sheet().querySelector('[data-import-keychain]')).toBeNull();
  });

  it('the wrong key: the summary names it and the Keychain line says the password did not match', async () => {
    useSettings.setState({ state: { settings: SETTINGS_DEFAULTS_V14, resolvedTheme: 'light' } });
    showReport(WRONG_KEY_REPORT);
    renderSheet();
    expect(sheet().querySelector('[data-import-summary]')!.textContent).toMatch(/^0 cookies, 4 history entries, 3 extensions · 7 skipped: 5 could not be decrypted/);
    expect(sheet().querySelector('[data-import-keychain="wrongKey"]')!.textContent).toBe('The Safe Storage password did not match this profile; no cookie was imported');
    expect(within(sheet()).queryByText(/New tabs browse as/)).toBeNull(); // the setting names another profile
  });

  it('a cancelled run is framed as nothing kept, with the counts it reached, and no extension state or active line', () => {
    showReport({ ...CANCELLED_REPORT, extensions: DONE.extensions });
    renderSheet();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(within(sheet()).getByText('Nothing from Person 1 was kept: what the import reached was removed again.')).toBeTruthy();
    expect(sheet().querySelector('[data-import-summary]')!.textContent).toBe('Before it stopped: 1,200 cookies, 2 history entries, 3 extensions · 3,912 skipped: 3,912 not imported (cancelled)');
    expect(within(sheet()).queryByText(/Loaded ·/)).toBeNull();
    expect(button('Close')).toBeTruthy();
  });

  it('a history write that failed in MAWS’s index is said about the index, not Chrome', () => {
    showReport({ ...DONE, history: { ...DONE.history, imported: 2, error: 'ERR_SQLITE_ERROR' } });
    renderSheet();
    expect(within(sheet()).getByTitle('ERR_SQLITE_ERROR').textContent).toBe("MAWS couldn't write the history into its index; some history wasn't imported.");
    cleanup();
    disconnect();
    showReport({ ...DONE, history: { ...DONE.history, imported: 0, error: 'indexUnavailable' } });
    renderSheet();
    expect(within(sheet()).getByTitle('indexUnavailable').textContent).toBe("MAWS's index is read-only right now, so history couldn't be imported.");
  });

  // cua #90
  it('the bookmarks count joins the summary, and a bookmarks error is said in words with its code as the title', () => {
    showReport({ ...DONE, bookmarks: { imported: 46, skipped: 1, error: null } });
    renderSheet();
    expect(sheet().querySelector('[data-import-summary]')!.textContent).toContain('46 bookmarks');
    cleanup();
    disconnect();
    showReport({ ...DONE, bookmarks: { imported: 0, skipped: 0, error: 'missing' } });
    renderSheet();
    expect(within(sheet()).getByTitle('missing').textContent).toBe("Chrome's Bookmarks file was gone by the time of the import, so no bookmarks were imported. MAWS reads it again each time this profile opens.");
    cleanup();
    disconnect();
    showReport({ ...DONE, bookmarks: { imported: 0, skipped: 1, error: 'indexUnavailable' } });
    renderSheet();
    expect(within(sheet()).getByTitle('indexUnavailable').textContent).toBe("MAWS's index is read-only right now, so bookmarks couldn't be imported.");
  });

  it('a failed run says why and that nothing was kept', () => {
    showReport({ ...CANCELLED_REPORT, outcome: 'failed', failure: 'partitionUnavailable' });
    renderSheet();
    expect(screen.getByText('The import failed')).toBeTruthy();
    expect(within(sheet()).getByRole('alert').textContent).toBe("MAWS couldn't open browser storage for this profile.");
    expect(within(sheet()).getByText(/was kept/)).toBeTruthy();
  });
});

describe('IMPORT_COPY’s Keychain and extension words', () => {
  type Cookies = NonNullable<ImportReport['cookies']>;
  const cookies = (over: Partial<Cookies>): Cookies => ({ ...DONE.cookies, imported: 0, partitioned: { imported: 0, verified: 0 }, skipped: NO_SKIPS.cookies, hosts: {}, ...over });

  it('words each Keychain outcome, a store with no cookies, and an unreadable store; never Always Allow', () => {
    expect(IMPORT_COPY.keychainLine(cookies({ keychain: 'allowed' }), 'done')).toBeNull();
    expect(IMPORT_COPY.keychainLine(cookies({ keychain: 'denied', error: 'security: User interaction is not allowed.' }), 'done')).toBe('Keychain access was not allowed; cookies were not imported');
    expect(IMPORT_COPY.keychainLine(cookies({ keychain: 'missing' }), 'done')).toBe('No Chrome Safe Storage item in your login keychain; cookies were not imported');
    expect(IMPORT_COPY.keychainLine(cookies({ keychain: 'timeout' }), 'done')).toBe('The Keychain did not answer in time; cookies were not imported');
    expect(IMPORT_COPY.keychainLine(cookies({ keychain: 'skipped', error: null }), 'done')).toBe('This profile has no cookies to import');
    expect(IMPORT_COPY.keychainLine(cookies({ keychain: 'skipped', error: null }), 'cancelled')).toBeNull();
    expect(IMPORT_COPY.keychainLine(cookies({ keychain: 'skipped', error: 'SQLITE_NOTADB' }), 'done')).toBe(
      "Cookies couldn't be read from the copy. Chrome may have been writing it; quit Chrome and try again.",
    );
    expect(IMPORT_COPY.keychainLine(cookies({ keychain: 'skipped', error: 'symlink' }), 'done')).toBe("Cookies is a link in this profile, so MAWS didn't copy it.");
    const every = JSON.stringify(Object.values(IMPORT_COPY).map((value) => (typeof value === 'function' ? String(value) : value)));
    expect(every).not.toMatch(/always allow/i);
  });

  it('words each extension state, an extension turned on in a profile not opened yet included', () => {
    const probe: ImportedExtension = DONE.extensions[0]!;
    const words = (over: Partial<ImportedExtension>) => IMPORT_COPY.extensionStatus({ ...probe, ...over });
    expect(words({ background: 'none' })).toBe('Loaded · no background');
    expect(words({ background: 'stopped' })).toBe('Loaded · background stopped');
    expect(words({ background: 'failed', backgroundError: null })).toBe('Loaded · background failed');
    expect(words({ status: 'off', enabled: true, background: 'none' })).toBe('On · loads when a tab next opens in this profile');
    expect(words({ status: 'off', enabled: false })).toBe('Off');
    expect(words({ status: 'loadFailed', error: 'Manifest file is missing or unreadable' })).toBe("Couldn't load: Manifest file is missing or unreadable");
    expect(words({ status: 'copyFailed', error: 'EACCES' })).toBe("Couldn't copy");
  });
});

// The Settings block's opener: the Import button over a standing inspection discards it and starts over (store.test.ts
// covers the store's side); here the sheet follows the stage.
describe('opening', () => {
  it('opens on the picker after a report', async () => {
    showReport(DONE);
    renderSheet();
    expect(sheet().dataset.browserImport).toBe('report');
    openImport();
    await vi.waitFor(() => expect(sheet().dataset.browserImport).toBe('pick'));
  });
});
