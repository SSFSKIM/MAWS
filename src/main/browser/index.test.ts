import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_SETTINGS_DEFAULTS, DEFAULT_PARTITION } from '@shared/browser/tab';

vi.mock('electron', () => ({
  ipcMain: { handle: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  session: { fromPartition: () => ({ getUserAgent: () => 'UA Electron/1', setUserAgent: () => {}, webRequest: { onBeforeRequest: () => {} } }) },
  WebContentsView: class {},
}));

const { startBrowser } = await import('./index');

const A = 'App-A' as AppSessionId;
const GONE = 'App-Gone' as AppSessionId;
const tab = (tabId: string, appSessionId: string) => ({ tabId, appSessionId, partition: DEFAULT_PARTITION, url: 'https://a.test/', title: 'A', favicon: null, zoom: 1, createdAt: 'c', lastShownAt: 'l' });

let userData: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-browser-start-'));
});
afterEach(() => rmSync(userData, { recursive: true, force: true }));

function fakeIndex(known: string[], unavailable: string | null = null) {
  const listeners = new Set<(record: { appId: AppSessionId }, cause: string) => void>();
  const index = {
    unavailable,
    browserHistory: { visit: () => {}, setTitle: () => {}, suggest: () => [] },
    sessions: {
      get: (id: AppSessionId) => (known.includes(id) ? { appId: id } : null),
      onChange: (listener: (record: { appId: AppSessionId }, cause: string) => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
  };
  const change = (appId: AppSessionId, cause: string) => listeners.forEach((l) => l({ appId }, cause));
  return { index: index as never, change, listeners };
}

function start(index: never, more: Partial<Parameters<typeof startBrowser>[0]> = {}) {
  return startBrowser({ userData, settings: () => BROWSER_SETTINGS_DEFAULTS, index, register: () => {}, emit: () => {}, env: {}, ...more });
}

describe('startBrowser (E4a Design §2, G4)', () => {
  it('drops at boot the tabs of a session the index does not know, and rewrites the file at stop', () => {
    mkdirSync(join(userData, 'browser'));
    const file = join(userData, 'browser', 'tabs.json');
    writeFileSync(file, JSON.stringify({ version: 1, tabs: [tab('b_aaaaaaaaaaaa', A), tab('b_bbbbbbbbbbbb', GONE)], selected: { [A]: 'b_aaaaaaaaaaaa', [GONE]: 'b_bbbbbbbbbbbb' } }));
    const browser = start(fakeIndex([A]).index);
    expect(browser.store.list().tabs.map((t) => [t.tabId, t.suspended])).toEqual([['b_aaaaaaaaaaaa', true]]);
    browser.stop();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ tabs: [{ tabId: 'b_aaaaaaaaaaaa' }], selected: { [A]: 'b_aaaaaaaaaaaa' } });
  });

  it('keeps every tab when the index is unavailable', () => {
    mkdirSync(join(userData, 'browser'));
    writeFileSync(join(userData, 'browser', 'tabs.json'), JSON.stringify({ version: 1, tabs: [tab('b_bbbbbbbbbbbb', GONE)], selected: {} }));
    const browser = start(fakeIndex([], 'newer').index);
    expect(browser.store.list().tabs).toHaveLength(1);
    browser.stop();
  });

  it('closes a session\'s tabs when its record is removed, and only then', () => {
    const { index, change, listeners } = fakeIndex([A]);
    const browser = start(index);
    browser.store.open({ appSessionId: A, url: null, select: true });
    change(A, 'update');
    expect(browser.store.list(A).tabs).toHaveLength(1);
    change(A, 'removed');
    expect(browser.store.list(A).tabs).toEqual([]);
    browser.stop();
    expect(listeners.size).toBe(0);
  });

  it('one profiles accessor serves both a new tab\'s partition and browser.profiles.list (Decision Log 40)', () => {
    const profiles = vi.fn(() => [{ profileDir: 'Profile 1', name: 'Work', partition: 'persist:maws-chrome-Profile 1', importedAt: 't', storageDirName: 'x' }]);
    const handlers = new Map<string, (input: unknown) => unknown>();
    const browser = start(fakeIndex([A]).index, {
      profiles,
      settings: () => ({ ...BROWSER_SETTINGS_DEFAULTS, profile: 'Profile 1' }),
      register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
    });
    expect(handlers.get('browser.profiles.list')!(undefined)).toEqual({ profiles: [{ profileDir: 'Profile 1', name: 'Work' }] });
    expect(browser.store.open({ appSessionId: A, url: null, select: true }).tab.partition).toBe('persist:maws-chrome-Profile 1');
    expect(profiles).toHaveBeenCalledTimes(2);
    browser.stop();
  });
});
