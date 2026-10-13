// cua #90: the profile popover's Re-import this profile… at app level: the removal's confirm sheet, then the import
// sheet at the picker on the removed profile's Chrome folder with it chosen; a Cancel at the removal ends the flow.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V14 } from '@shared/settings/defaults';
import { useSettings } from '../../../stores/settings';
import { importBridge, RECORD, type ImportBridge } from '../../../test-support/browser-import';
import { ProfileSheets } from './ProfileSheets';
import { browserImport, connectBrowserImport, resetBrowserImport, startReimport } from './store';

const OTHER_FOLDER = '/Users/owner/Library/Application Support/Google/Chrome Beta'; // the record's, not the picker's default
let b: ImportBridge;
let disconnect = () => {};
const calls = (name: string) => b.calls.filter((c) => c.name === name).map((c) => c.input);
const dialog = () => screen.getByRole('dialog');

async function renderHost() {
  b = importBridge({ ...SETTINGS_DEFAULTS_V14, browser: { ...SETTINGS_DEFAULTS_V14.browser, profile: 'Default' } });
  Object.assign(b.answers, {
    'browser.import.list': () => ({ profiles: [{ ...RECORD, userDataDir: OTHER_FOLDER }], fileBroken: false, running: null }),
    'browser.import.remove': () => ({ removed: { tabs: 1, historyRows: 4, extensions: 3 } }),
  });
  window.maws = b.bridge;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect = connectBrowserImport(undefined, queries);
  render(
    <QueryClientProvider client={queries}>
      <ProfileSheets />
    </QueryClientProvider>,
  );
  await vi.waitFor(() => expect(browserImport.getState().records).toHaveLength(1));
}

beforeEach(() => resetBrowserImport());
afterEach(() => {
  cleanup();
  disconnect();
  resetBrowserImport();
  useSettings.setState({ state: null });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('ProfileSheets', () => {
  it('shows nothing until a re-import starts; then the removal, then the picker on the profile’s folder with it chosen', async () => {
    await renderHost();
    expect(screen.queryByRole('dialog')).toBeNull();
    startReimport('Default');
    expect((await screen.findByRole('dialog')).dataset.browserImportRemove).toBe('Default');
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Remove everything MAWS imported from Person 1' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => expect(dialog().dataset.browserImport).toBe('pick'));
    expect(calls('browser.import.remove')).toEqual([{ profileDir: 'Default' }]);
    await vi.waitFor(() => expect(calls('browser.import.profiles')).toEqual([{ userDataDir: OTHER_FOLDER }]));
    expect((await within(dialog()).findByRole('radio', { name: /Person 1/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await vi.waitFor(() => expect(browserImport.getState().reimport).toBeNull());
  });

  it('a Cancel at the removal ends the flow and removes nothing', async () => {
    await renderHost();
    startReimport('Default');
    await screen.findByRole('dialog');
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(browserImport.getState().reimport).toBeNull();
    expect(calls('browser.import.remove')).toEqual([]);
  });
});
