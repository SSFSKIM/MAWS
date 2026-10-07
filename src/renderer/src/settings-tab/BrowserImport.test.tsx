// E4b Task 3.2: Settings › Browser's imported-profiles block (E4b Design §11, §12; P-21): the Import button with no
// record, each record with its date, summary and Show report, the extension toggles through `setExtension`, a run in
// progress shown with Show, and Remove behind its acknowledgement, writing `browser.profile: null` when the setting named
// the removed profile.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V11 } from '@shared/settings/defaults';
import { useSettings } from '../stores/settings';
import { browserTab, T1, T2 } from '../test-support/browser';
import { FAILS_ID, IMPORT_ID, importBridge, RECORD, WALLET_ID, type ImportBridge } from '../test-support/browser-import';
import { connectBrowserImport, resetBrowserImport } from '../tools/browser/import/store';
import { browser } from '../tools/browser/store';
import { BrowserImport } from './BrowserImport';

const A = 'app-a' as AppSessionId;
let b: ImportBridge;
let disconnect = () => {};
const calls = (name: string) => b.calls.filter((c) => c.name === name).map((c) => c.input);
const profile = () => screen.getByRole('region', { name: 'Person 1' });
const row = (name: string) => within(profile()).getByRole('group', { name });
const dialog = () => screen.getByRole('dialog');

function renderBlock(answers: ImportBridge['answers'] = {}, profileSetting: string | null = null) {
  b = importBridge({ ...SETTINGS_DEFAULTS_V11, browser: { ...SETTINGS_DEFAULTS_V11.browser, profile: profileSetting } });
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
const withRecord = { 'browser.import.list': () => ({ profiles: [RECORD], fileBroken: false }) };

beforeEach(() => resetBrowserImport());
afterEach(() => {
  cleanup();
  disconnect();
  resetBrowserImport();
  browser.setState({ sessions: new Map() });
  useSettings.setState({ state: null });
  delete (window as { maws?: MawsBridge }).maws;
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

  it('while a run goes on, says so with its step and Show reopens the running sheet', async () => {
    renderBlock();
    b.emit('browser.import.progress', { importId: IMPORT_ID, phase: 'history', done: 2, total: 6 });
    const importRow = screen.getByRole('group', { name: 'Chrome profile' });
    await within(importRow).findByText('Import running · Importing browsing history…');
    expect(within(importRow).queryByRole('button', { name: 'Import a Chrome profile…' })).toBeNull();
    fireEvent.click(within(importRow).getByRole('button', { name: 'Show' }));
    expect(dialog().dataset.browserImport).toBe('running');
  });
});

describe('an imported profile', () => {
  it('shows its date and summary, each extension with its state and toggle, and the wallet note', async () => {
    renderBlock(withRecord);
    await screen.findByRole('region', { name: 'Person 1' });
    expect(profile().textContent).toContain('Imported Oct 6, 2026');
    expect(profile().textContent).toContain('4 cookies, 4 history entries, 3 extensions · 3 skipped');
    expect(row('Probe').textContent).toContain('Loaded · background running');
    expect(row('Fails').textContent).toContain('Loaded · background failed: chrome.contextMenus.onClicked is not available in MAWS');
    expect(row('Probe Wallet').textContent).toContain('Off (wallet)');
    expect(row('Probe Wallet').textContent).toContain('Wallet extensions start off');
    expect(row('Probe').textContent).not.toContain('Wallet extensions start off');
    expect((within(row('Probe')).getByRole('radio', { name: 'On' }) as HTMLInputElement).checked).toBe(true);
    expect((within(row('Probe Wallet')).getByRole('radio', { name: 'Off' }) as HTMLInputElement).checked).toBe(true);
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
    fireEvent.click(within(row('Probe Wallet')).getByRole('radio', { name: 'On' }));
    await within(row('Probe Wallet')).findByText('Loaded · no background');
    fireEvent.click(within(row('Fails')).getByRole('radio', { name: 'Off' }));
    await within(row('Fails')).findByText('Off');
    expect(calls('browser.import.setExtension')).toEqual([
      { profileDir: 'Default', extensionId: WALLET_ID, enabled: true },
      { profileDir: 'Default', extensionId: FAILS_ID, enabled: false },
    ]);
    expect(b.sets).toEqual([]); // the toggles live in profiles.json, never in settings (Decision Log 1)
  });

  it('Show report reopens the sheet on the record’s report', async () => {
    renderBlock(withRecord);
    fireEvent.click(await within(await screen.findByRole('region', { name: 'Person 1' })).findByRole('button', { name: 'Show report' }));
    expect(dialog().dataset.browserImport).toBe('report');
    expect(within(dialog()).getByText('Imported from Person 1')).toBeTruthy();
  });
});

describe('Remove imported profile', () => {
  const remove = { ...withRecord, 'browser.import.remove': () => ({ removed: { tabs: 1, historyRows: 4, extensions: 3 } }) };

  it('names what goes, the open tabs counted; Remove waits for the acknowledgement, then clears the active setting', async () => {
    browser.setState({
      sessions: new Map([[A, { tabs: [browserTab(T1, A, { partition: 'persist:maws-chrome-Default' }), browserTab(T2, A)], selected: T1 }]]),
    });
    renderBlock(remove, 'Default');
    fireEvent.click(await within(await screen.findByRole('region', { name: 'Person 1' })).findByRole('button', { name: 'Remove imported profile' }));
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
    fireEvent.click(await within(await screen.findByRole('region', { name: 'Person 1' })).findByRole('button', { name: 'Remove imported profile' }));
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
    fireEvent.click(await within(await screen.findByRole('region', { name: 'Person 1' })).findByRole('button', { name: 'Remove imported profile' }));
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Remove everything MAWS imported from Person 1' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove' }));
    await within(dialog()).findByText("Couldn't remove the profile: an import is running");
    expect(screen.getByRole('region', { name: 'Person 1', hidden: true })).toBeTruthy(); // under the open sheet
  });
});
