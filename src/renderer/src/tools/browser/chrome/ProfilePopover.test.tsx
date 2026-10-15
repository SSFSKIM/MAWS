// cua #90: the partition pill's avatar and its profile popover (cua board #90's spec, "The avatar and the profile
// popover"): the picture, the initial or Default's person on the pill; the popover's heading, account line, Switch
// profile (the setting written, then a new tab of this session in the chosen partition, this tab untouched), Sync
// bookmarks now with its line, Re-import this profile… handed to the app-level flow, and Browser settings; Default's
// reduced popover; the page frozen to its still while it is open.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserProfileListItem, ImportedProfile } from '@shared/browser/profiles';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { SETTINGS_DEFAULTS_V14 } from '@shared/settings/defaults';
import { useLayout } from '../../../stores/layout';
import { browserTab, T2 } from '../../../test-support/browser';
import { RECORD } from '../../../test-support/browser-import';
import { installFakeMain, ok } from '../../../test-support/code';
import { BROWSER_COPY } from '../copy';
import { coverPane, resetCovering } from '../covering';
import { browserImport, resetBrowserImport } from '../import/store';
import { PartitionPill } from './PartitionPill';

const A = 'app-a' as AppSessionId;
const PERSON = profilePartition('Default');
const PICTURE = 'data:image/png;base64,iVBORw0KGgo=';
const LIST: BrowserProfileListItem[] = [
  { profileDir: 'Default', name: 'Person 1', gaiaName: 'Probe Owner', userName: 'probe@example.test', avatar: { kind: 'picture', dataUrl: PICTURE } },
  { profileDir: 'Profile 1', name: 'Work', gaiaName: null, userName: null, avatar: { kind: 'initials', letter: 'W' } },
];
const SYNCED = new Date(Date.now() - 5 * 60_000).toISOString();
const PERSON_RECORD: ImportedProfile = { ...RECORD, bookmarks: { consentedAt: RECORD.importedAt, syncedAt: SYNCED, count: 46, error: null, errorAt: null } };

let main: ReturnType<typeof installFakeMain>;
beforeEach(() => {
  resetCovering();
  resetBrowserImport();
  useLayout.setState({ regions: LAYOUT_DEFAULTS.regions, main: LAYOUT_DEFAULTS.main, overviewOpen: false });
  main = installFakeMain((name) => {
    switch (name) {
      case 'browser.profiles.list':
        return ok({ profiles: LIST });
      case 'browser.tabs.open':
        return ok({ tab: browserTab(T2, A, { url: '', partition: profilePartition('Profile 1') }), reused: false });
      case 'browser.bookmarks.sync':
        return ok({ syncedAt: new Date().toISOString(), count: 46 });
      case 'settings.set':
        return ok({ settings: SETTINGS_DEFAULTS_V14, resolvedTheme: 'light' });
      default:
        return ok();
    }
  });
  browserImport.setState({ records: [PERSON_RECORD] });
});
afterEach(() => {
  cleanup();
  resetCovering();
  resetBrowserImport();
  vi.restoreAllMocks();
});

const pill = () => document.querySelector<HTMLButtonElement>('[data-browser-partition]')!;
function showPill(partition: string, surface: 'panel' | 'main' = 'panel') {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queries}>
      <PartitionPill appSessionId={A} surface={surface} partition={partition} />
    </QueryClientProvider>,
  );
}
async function openPopover(name: string) {
  fireEvent.click(pill());
  return screen.findByRole('dialog', { name: `Profile: ${name}` });
}

describe('the pill’s avatar', () => {
  it('is the picture, the initial on its disc, or Default’s person', async () => {
    showPill(PERSON);
    await vi.waitFor(() => expect(pill().querySelector('img[data-profile-avatar="picture"]')?.getAttribute('src')).toBe(PICTURE));
    cleanup();
    showPill(profilePartition('Profile 1'));
    await vi.waitFor(() => expect(pill().querySelector('[data-profile-avatar="initials"]')?.textContent).toBe('W'));
    expect(pill().querySelector('[data-profile-avatar="initials"]')!.className).toMatch(/\bbg-(accent|info|success|warning)\b/);
    cleanup();
    showPill(DEFAULT_PARTITION);
    expect(pill().querySelector('[data-profile-avatar="default"]')).not.toBeNull();
    expect(main.callsOf('browser.profiles.list')).toHaveLength(2); // Default's pill asks nothing until its popover opens
  });
});

describe('an imported profile’s popover', () => {
  it('shows the avatar, the name and the account; Switch profile lists the others then Default; Sync with its line; Re-import; Browser settings', async () => {
    showPill(PERSON);
    await vi.waitFor(() => expect(pill().textContent).toContain('Person 1'));
    const popover = await openPopover('Person 1');
    expect(popover.querySelector('header img')?.getAttribute('src')).toBe(PICTURE);
    expect(within(popover).getByText('Person 1')).toBeTruthy();
    expect(popover.querySelector('[data-profile-account]')!.textContent).toBe('로그인: Probe Owner · probe@example.test');
    const switchList = within(popover).getByRole('region', { name: BROWSER_COPY.profile.switchProfile });
    expect(within(switchList).getByText(BROWSER_COPY.profile.appliesToNewTabs)).toBeTruthy();
    expect([...popover.querySelectorAll<HTMLElement>('[data-profile-switch]')].map((row) => [row.dataset.profileSwitch, row.textContent])).toEqual([
      ['Profile 1', 'WWork'],
      ['default', 'Default'],
    ]);
    expect(popover.querySelector('[data-profile-sync]')!.textContent).toContain(BROWSER_COPY.profile.syncNow);
    expect(popover.querySelector('[data-profile-sync-line]')!.textContent).toBe('마지막 동기화 5 minutes ago');
    expect(popover.querySelector('[data-profile-reimport]')!.textContent).toBe(BROWSER_COPY.profile.reimport);
    expect(popover.querySelector('[data-profile-settings]')!.textContent).toBe(BROWSER_COPY.profile.settings);
  });

  it('a profile not signed in says so, and one imported without bookmarks has no Sync row', async () => {
    browserImport.setState({ records: [PERSON_RECORD, { ...RECORD, profileDir: 'Profile 1', name: 'Work', partition: profilePartition('Profile 1') }] });
    showPill(profilePartition('Profile 1'));
    await vi.waitFor(() => expect(pill().textContent).toContain('Work'));
    const popover = await openPopover('Work');
    expect(popover.querySelector('[data-profile-account]')!.textContent).toBe('Chrome에 로그인되지 않은 프로필');
    expect(popover.querySelector('[data-profile-sync]')).toBeNull();
    expect(popover.querySelector('[data-profile-reimport]')).not.toBeNull();
  });

  it('a failed read shows the 읽지 못함 line with the last good sync', async () => {
    browserImport.setState({ records: [{ ...PERSON_RECORD, bookmarks: { ...PERSON_RECORD.bookmarks!, error: 'missing', errorAt: new Date().toISOString() } }] });
    showPill(PERSON);
    await vi.waitFor(() => expect(pill().textContent).toContain('Person 1'));
    const popover = await openPopover('Person 1');
    expect(popover.querySelector('[data-profile-sync-line]')!.textContent).toBe('Chrome의 북마크 파일을 읽지 못함 · 마지막 동기화 5 minutes ago');
  });

  it('Switch profile writes browser.profile, then opens a new selected tab of this session; this tab is left as it is', async () => {
    showPill(PERSON);
    await vi.waitFor(() => expect(pill().textContent).toContain('Person 1'));
    const popover = await openPopover('Person 1');
    fireEvent.click(popover.querySelector('[data-profile-switch="Profile 1"]')!);
    await vi.waitFor(() => expect(main.callsOf('browser.tabs.open')).toHaveLength(1));
    const order = main.calls.map((call) => call.name).filter((name) => name === 'settings.set' || name === 'browser.tabs.open');
    expect(order).toEqual(['settings.set', 'browser.tabs.open']);
    expect(main.callsOf('settings.set')).toEqual([{ browser: { profile: 'Profile 1' } }]);
    expect(main.callsOf('browser.tabs.open')).toEqual([{ appSessionId: A, url: null, select: true }]);
    expect(main.calls.filter((call) => ['browser.tabs.navigate', 'browser.tabs.close', 'browser.tabs.select'].includes(call.name))).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Switch profile to Default writes null; from a main tab the new tab gets its own main tab', async () => {
    const openTab = vi.spyOn(useLayout.getState(), 'openTab');
    showPill(PERSON, 'main');
    await vi.waitFor(() => expect(pill().textContent).toContain('Person 1'));
    fireEvent.click((await openPopover('Person 1')).querySelector('[data-profile-switch="default"]')!);
    await vi.waitFor(() => expect(openTab).toHaveBeenCalledWith({ kind: 'browser', appSessionId: A, browserTabId: T2 }));
    expect(main.callsOf('settings.set')).toEqual([{ browser: { profile: null } }]);
  });

  it('Sync bookmarks now asks main for the profile; Re-import hands the profile to the app-level flow and closes', async () => {
    showPill(PERSON);
    await vi.waitFor(() => expect(pill().textContent).toContain('Person 1'));
    let popover = await openPopover('Person 1');
    await act(async () => void fireEvent.click(popover.querySelector('[data-profile-sync]')!));
    expect(main.callsOf('browser.bookmarks.sync')).toEqual([{ profileDir: 'Default' }]);
    expect(screen.getByRole('dialog')).toBe(popover); // it stays open while main reads
    fireEvent.click(popover.querySelector('[data-profile-reimport]')!);
    expect(browserImport.getState().reimport).toEqual({ record: PERSON_RECORD, step: 'remove' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    popover = await openPopover('Person 1');
    const openTab = vi.spyOn(useLayout.getState(), 'openTab');
    fireEvent.click(popover.querySelector('[data-profile-settings]')!);
    expect(openTab).toHaveBeenCalledWith({ kind: 'settings', section: 'browser' });
  });

  it('holds the cover while open, so the page freezes to its still under it', async () => {
    const pane = coverPane(() => ({ x: 0, y: 40, width: 380, height: 600 }));
    showPill(PERSON);
    await vi.waitFor(() => expect(pill().textContent).toContain('Person 1'));
    const popover = await openPopover('Person 1');
    await vi.waitFor(() => expect(main.callsOf('browser.view.cover').at(-1)).toEqual({ covered: true }));
    fireEvent.keyDown(popover, { key: 'Escape' });
    await vi.waitFor(() => expect(main.callsOf('browser.view.cover').at(-1)).toEqual({ covered: false }));
    pane.release();
  });
});

describe('the Default partition’s popover', () => {
  it('has the person, Default profile, Switch profile over every imported profile, and the settings link only', async () => {
    showPill(DEFAULT_PARTITION);
    const popover = await openPopover(BROWSER_COPY.profile.defaultName);
    expect(popover.dataset.profilePopover).toBe('default');
    expect(popover.querySelector('header [data-profile-avatar="default"]')).not.toBeNull();
    expect(within(popover).getByText('Default profile')).toBeTruthy();
    expect(popover.querySelector('[data-profile-account]')).toBeNull();
    await vi.waitFor(() => expect([...popover.querySelectorAll<HTMLElement>('[data-profile-switch]')].map((row) => row.dataset.profileSwitch)).toEqual(['Default', 'Profile 1']));
    expect(popover.querySelector('[data-profile-sync]')).toBeNull();
    expect(popover.querySelector('[data-profile-reimport]')).toBeNull();
    expect(popover.querySelector('[data-profile-settings]')).not.toBeNull();
  });
});
