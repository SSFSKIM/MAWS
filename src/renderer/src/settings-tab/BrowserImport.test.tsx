// E4b Task 3.2: Settings › Browser's imported-profiles block (E4b Design §11, §12; P-21): the Import button with no
// record, each record with its date, summary and Show report, the extension toggles through `setExtension`, a run in
// progress shown with Show, and Remove behind its acknowledgement, writing `browser.profile: null` when the setting named
// the removed profile. The word cut (G70, G73, G74, G76, G77): Import… named in full; a record's row is its date and a
// "…" menu holding Show report, Sync bookmarks now and Remove, its summary in the report; each extension a switch.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { browserTab, T1, T2 } from '../test-support/browser';
import { CANCELLED_REPORT } from '../../../../test/support/import-reports';
import { FAILS_ID, IMPORT_ID, importBridge, RECORD, WALLET_ID, type ImportBridge } from '../test-support/browser-import';
import { connectBrowserImport, resetBrowserImport } from '../tools/browser/import/store';
import { browser } from '../tools/browser/store';
import { BrowserImport } from './BrowserImport';
import { formatDate } from '@shared/app/date-format';

const A = 'app-a' as AppSessionId;
let b: ImportBridge;
let disconnect = () => {};
const calls = (name: string) => b.calls.filter((c) => c.name === name).map((c) => c.input);
const profile = () => screen.getByRole('region', { name: 'Person 1' });
const row = (name: string) => within(profile()).getByRole('group', { name });
const dialog = () => screen.getByRole('dialog');
// the record's "…" menu, opened, and one of its items chosen
async function choose(item: string) {
  const region = await screen.findByRole('region', { name: 'Person 1' });
  await userEvent.setup().click(within(region).getByRole('button', { name: 'Actions for Person 1' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}
const switchOf = (name: string) => within(row(name)).getByRole('switch', { name });

function renderBlock(answers: ImportBridge['answers'] = {}, profileSetting: string | null = null) {
  b = importBridge({ ...SETTINGS_DEFAULTS_V21, browser: { ...SETTINGS_DEFAULTS_V21.browser, profile: profileSetting } });
  Object.assign(b.answers, answers);
  window.maws = b.bridge;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect = connectBrowserImport(undefined, queries);
  render(
    <QueryClientProvider client={queries}>
      <BrowserImport />
    </QueryClientProvider>,
  );
}
const withRecord = { 'browser.import.list': () => ({ profiles: [RECORD], fileBroken: false, running: null }) };

beforeEach(() => resetBrowserImport());
afterEach(() => {
  cleanup();
  disconnect();
  resetBrowserImport();
  browser.setState({ sessions: new Map() });
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('with no imported profile', () => {
  it('offers the import and lists nothing; the button opens the sheet on the picker', async () => {
    renderBlock();
    const importRow = screen.getByRole('group', { name: 'Chrome profile' });
    expect(screen.queryByRole('region')).toBeNull();
    fireEvent.click(within(importRow).getByRole('button', { name: 'Import a Chrome profile…' }));
    expect(dialog().dataset.browserImport).toBe('pick');
    await within(dialog()).findByRole('radio', { name: /Person 1/ });
  });

  it('a window opened mid-run shows the run’s step from the list (Decision Log 41)', async () => {
    renderBlock({ 'browser.import.list': () => ({ profiles: [], fileBroken: false, running: { importId: IMPORT_ID, profileDir: 'Default', phase: 'keychain' } }) });
    await within(screen.getByRole('group', { name: 'Chrome profile' })).findByText('Import running · Waiting for the Keychain… choose Allow in the macOS dialog');
  });

  it('while a run goes on, says so with its step and Show reopens the running sheet', async () => {
    renderBlock();
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'history', done: 2, total: 6 });
    const importRow = screen.getByRole('group', { name: 'Chrome profile' });
    await within(importRow).findByText('Import running · Importing browsing history…');
    expect(within(importRow).queryByRole('button', { name: 'Import a Chrome profile…' })).toBeNull();
    fireEvent.click(within(importRow).getByRole('button', { name: 'Show' }));
    expect(dialog().dataset.browserImport).toBe('running');
  });

  it('a run that ended cancelled or failed while no sheet showed it is offered with Show until shown', async () => {
    renderBlock();
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'extensions', done: 1, total: 3 });
    b.emit('browser.import.finished', { importId: IMPORT_ID, report: CANCELLED_REPORT });
    const importRow = screen.getByRole('group', { name: 'Chrome profile' });
    await within(importRow).findByText('The last import was cancelled');
    expect(within(importRow).getByRole('button', { name: 'Import a Chrome profile…' })).toBeTruthy();
    fireEvent.click(within(importRow).getByRole('button', { name: 'Show' }));
    expect(dialog().dataset.browserImport).toBe('report');
    expect(within(dialog()).getByText('Cancelled')).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(importRow).queryByText('The last import was cancelled')).toBeNull();
    expect(within(importRow).queryByRole('button', { name: 'Show' })).toBeNull();
  });
});

describe('an imported profile', () => {
  it('shows its date and its menu, each extension with its state and switch, and the wallet note; the summary is the report’s', async () => {
    renderBlock(withRecord);
    await screen.findByRole('region', { name: 'Person 1' });
    expect(profile().textContent).toContain(`Imported ${formatDate(Date.parse(RECORD.importedAt))}`);
    expect(profile().textContent).not.toContain('4 cookies, 4 history entries, 3 extensions · 3 skipped');
    expect(within(row('Person 1')).getAllByRole('button').map((x) => x.getAttribute('aria-label'))).toEqual(['Actions for Person 1']);
    expect(row('Probe').textContent).toContain('Loaded · background running');
    expect(row('Fails').textContent).toContain('Loaded · background failed: chrome.contextMenus.onClicked is not available in MAWS');
    expect(row('Probe Wallet').textContent).toContain('Off (wallet)');
    expect(within(profile()).getByRole('group', { name: 'Probe Wallet', description: 'Wallet extensions start off' })).toBe(row('Probe Wallet')); // its note
    expect(row('Probe').textContent).not.toContain('Wallet extensions start off');
    expect(switchOf('Probe').getAttribute('aria-checked')).toBe('true');
    expect(switchOf('Probe Wallet').getAttribute('aria-checked')).toBe('false');
    expect(within(profile()).queryByRole('radio')).toBeNull();
    // the popup limit: an ⓘ beside the Extensions heading, named by the sentence
    expect(within(profile()).getByRole('img', { name: 'Extension popups can’t see the current tab here, so ad blockers and per-site toggles may not work.' }).closest('p')!.textContent).toBe('Extensionsⓘ');
  });

  it('a toggle writes through setExtension and the row shows main’s answer', async () => {
    renderBlock({
      ...withRecord,
      'browser.import.setExtension': (input) => {
        const { extensionId, enabled } = input as { extensionId: string; enabled: boolean };
        const extension = RECORD.extensions.find((e) => e.id === extensionId)!;
        return { extension: enabled ? { ...extension, enabled, status: 'loaded', background: 'none' } : { ...extension, enabled, status: 'off', background: 'none', backgroundError: null } };
      },
    });
    await screen.findByRole('region', { name: 'Person 1' });
    fireEvent.click(switchOf('Probe Wallet'));
    await within(row('Probe Wallet')).findByText('Loaded · no background');
    fireEvent.click(switchOf('Fails'));
    await within(row('Fails')).findByText('Off');
    expect(calls('browser.import.setExtension')).toEqual([
      { profileDir: 'Default', extensionId: WALLET_ID, enabled: true },
      { profileDir: 'Default', extensionId: FAILS_ID, enabled: false },
    ]);
    expect(b.sets).toEqual([]); // the toggles live in profiles.json, never in settings (Decision Log 1)
  });

  it('a toggle shows its pending state until main answers, and a refusal names the extension', async () => {
    let answer!: () => void;
    renderBlock(withRecord);
    const invoke = b.bridge.invoke;
    b.bridge.invoke = (async (name: string, input: unknown) => {
      if (name === 'browser.import.setExtension') await new Promise<void>((resolve) => (answer = resolve));
      return invoke(name as never, input as never);
    }) as PreloadBridge['invoke'];
    b.answers['browser.import.setExtension'] = () => {
      throw new Error('not an imported profile');
    };
    await screen.findByRole('region', { name: 'Person 1' });
    fireEvent.click(switchOf('Probe Wallet'));
    await within(row('Probe Wallet')).findByText('Turning on…');
    expect(switchOf('Probe Wallet').closest('[aria-busy]')!.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(switchOf('Probe Wallet')); // ignored while pending
    answer();
    await within(row('Probe Wallet')).findByText('Off (wallet)');
    expect(calls('browser.import.setExtension')).toHaveLength(1);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(["Couldn't turn Probe Wallet on: not an imported profile"]);
  });

  it('Show report, in the record’s menu, reopens the sheet on the record’s report, which holds its summary', async () => {
    renderBlock(withRecord);
    await choose('Show report');
    expect(dialog().dataset.browserImport).toBe('report');
    expect(within(dialog()).getByText('Imported from Person 1')).toBeTruthy();
    expect(dialog().textContent).toContain('4 cookies, 4 history entries, 3 extensions · 3 skipped');
  });

  it('a sheet opened from the menu by the keyboard gives the keyboard back to the record’s “…” on Escape (the word cut)', async () => {
    renderBlock(withRecord);
    const user = userEvent.setup();
    const trigger = within(await screen.findByRole('region', { name: 'Person 1' })).getByRole('button', { name: 'Actions for Person 1' });
    act(() => trigger.focus());
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: 'Show report' });
    await user.keyboard('{Enter}');
    expect(dialog().dataset.browserImport).toBe('report');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  // cua #90: beside Show report, for a profile whose bookmarks were imported
  it('Sync bookmarks now, in the menu, asks main for the profile, the last sync’s time in the row’s note; none without bookmarks', async () => {
    const syncedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const consented = { ...RECORD, bookmarks: { consentedAt: RECORD.importedAt, syncedAt, count: 46, error: null, errorAt: null } };
    renderBlock({ 'browser.import.list': () => ({ profiles: [consented], fileBroken: false, running: null }), 'browser.bookmarks.sync': () => ({ syncedAt, count: 46 }) });
    await screen.findByRole('region', { name: 'Person 1' });
    expect(within(profile()).getByRole('group', { name: 'Person 1', description: 'Last synced 2 hours ago' })).toBe(row('Person 1'));
    await choose('Sync bookmarks now');
    await vi.waitFor(() => expect(calls('browser.bookmarks.sync')).toEqual([{ profileDir: 'Default' }]));
    cleanup();
    disconnect();
    resetBrowserImport();
    renderBlock(withRecord);
    await userEvent.setup().click(within(await screen.findByRole('region', { name: 'Person 1' })).getByRole('button', { name: 'Actions for Person 1' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Show report', 'Remove imported profile']);
  });

  it('a failed sync keeps its warning on the row at rest', async () => {
    const failed = { ...RECORD, bookmarks: { consentedAt: RECORD.importedAt, syncedAt: null, count: 0, error: 'indexUnavailable' as const, errorAt: RECORD.importedAt } };
    renderBlock({ 'browser.import.list': () => ({ profiles: [failed], fileBroken: false, running: null }) });
    await screen.findByRole('region', { name: 'Person 1' });
    expect(row('Person 1').querySelector('.text-warning')).not.toBeNull();
    expect(row('Person 1').querySelector('[data-row-note]')).toBeNull();
  });
});

describe('Remove imported profile', () => {
  const remove = { ...withRecord, 'browser.import.remove': () => ({ removed: { tabs: 1, historyRows: 4, extensions: 3 } }) };

  it('names what goes, the open tabs counted; Remove waits for the acknowledgement, then clears the active setting', async () => {
    browser.setState({
      sessions: new Map([[A, { tabs: [browserTab(T1, A, { partition: 'persist:maws-chrome-Default' }), browserTab(T2, A)], selected: T1 }]]),
    });
    renderBlock(remove, 'Default');
    await choose('Remove imported profile');
    expect(within(dialog()).getByText('Remove Person 1?')).toBeTruthy();
    expect(dialog().textContent).toContain(
      "Removes Person 1's cookies and site data, its browsing history (4 entries imported), 3 extensions and its 1 open tab from MAWS. Chrome is untouched.",
    );
    const confirm = within(dialog()).getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Remove everything MAWS imported from Person 1' }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('browser.import.remove')).toEqual([{ profileDir: 'Default' }]);
    expect(b.sets).toEqual([{ browser: { profile: null } }]);
    expect(screen.queryByRole('region', { name: 'Person 1' })).toBeNull();
  });

  it('leaves the setting alone when it named another profile', async () => {
    renderBlock(remove, 'Profile 1');
    await choose('Remove imported profile');
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Remove everything MAWS imported from Person 1' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(b.sets).toEqual([]);
  });

  it('a refusal stays in the sheet, in words', async () => {
    renderBlock({
      ...withRecord,
      'browser.import.remove': () => {
        throw new Error('an import is running');
      },
    });
    await choose('Remove imported profile');
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Remove everything MAWS imported from Person 1' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove' }));
    await within(dialog()).findByText("Couldn't remove the profile: an import is running");
    expect(screen.getByRole('region', { name: 'Person 1', hidden: true })).toBeTruthy(); // under the open sheet
  });
});
