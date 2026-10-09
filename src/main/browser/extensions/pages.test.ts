import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { BROWSER_LOADED_TABS_MAX } from '@shared/browser/tab';
import { TabStore } from '../tabs';
import type { LoadedAction } from './actions';
import { ExtensionPages, extensionPagesRule, UnknownExtensionError } from './pages';

const A = 'App-A' as AppSessionId;
const B = 'App-B' as AppSessionId;
const PART = 'persist:maws-chrome-Default';
const WORK = 'persist:maws-chrome-Profile 1';
const PROBE = 'nenbjdahllkkbfanbpfmmdacjencdfpg';
const OTHER = 'ofmpefonpiifpjlopbcacdiahhnegimn';

const action = (extensionId: string, name: string, options = true): LoadedAction => ({
  extensionId,
  name,
  title: name,
  hasPopup: false,
  hasOptions: options,
  popupUrl: null,
  optionsUrl: options ? `chrome-extension://${extensionId}/options.html` : null,
  iconPath: null,
  path: '/ext',
});

function harness() {
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  let ids = 0;
  const store = new TabStore({
    emit,
    createView: () => ({ webContents: { loadURL: vi.fn(() => Promise.resolve()), close: vi.fn(), isDestroyed: () => false } }) as unknown as WebContentsView,
    resolvePartition: () => PART,
    newTabId: () => `b_${(++ids).toString(16).padStart(12, '0')}`,
    schedule: () => {},
  });
  const loaded = new Map<string, LoadedAction[]>([[PART, [action(PROBE, 'MAWS probe extension'), action(OTHER, 'No options', false)]]]);
  const icon = vi.fn(async () => 'data:image/png;base64,SUNPTg==');
  const pages = new ExtensionPages({
    store,
    actions: { find: (partition, id) => loaded.get(partition)?.find((candidate) => candidate.extensionId === id) ?? null, icon },
    emit,
  });
  const page = (appSessionId = A, partition = PART) => store.open({ appSessionId, url: 'https://a.test/', select: true, partition }).tab.tabId;
  const notices = () => emitted.filter((e) => e.name === 'browser.notice').map((e) => e.payload);
  return { store, pages, page, notices, icon };
}

describe('ExtensionPages: the options tab', () => {
  it('opens the extension\'s options page as a new selected internal tab of the tab\'s session and partition, its icon the action\'s', async () => {
    const h = harness();
    const from = h.page();
    const tab = h.pages.openOptions(from, PROBE)!;
    expect(tab).toMatchObject({
      appSessionId: A,
      partition: PART,
      url: `chrome-extension://${PROBE}/options.html`,
      title: 'MAWS probe extension · Options',
      internal: { kind: 'extension', extensionId: PROBE, title: 'MAWS probe extension · Options' },
    });
    expect(h.store.list(A).selected[A]).toBe(tab.tabId);
    await vi.waitFor(() => expect(h.store.entry(tab.tabId)!.tab.favicon).toBe('data:image/png;base64,SUNPTg=='));
    expect(h.icon).toHaveBeenCalledWith(PART, PROBE);
  });

  it('selects the session\'s open options tab of that extension rather than opening a second', () => {
    const h = harness();
    const from = h.page();
    const first = h.pages.openOptions(from, PROBE)!;
    h.store.select(A, from);
    expect(h.pages.openOptions(from, PROBE)!.tabId).toBe(first.tabId);
    expect(h.store.list(A).selected[A]).toBe(first.tabId);
    expect(h.store.all()).toHaveLength(2);
    expect(h.pages.openOptions(h.page(B), PROBE)!.tabId).not.toBe(first.tabId); // another session's is its own
  });

  it('opens nothing when the loaded-tab cap has no tab to unload for it, and says so naming the extension', () => {
    const h = harness();
    const from = h.page();
    for (let i = 1; i < BROWSER_LOADED_TABS_MAX; i++) h.page(); // twelve loaded, every one still loading: no victim
    expect(h.pages.openOptions(from, PROBE)).toBeNull();
    expect(h.store.all().some((entry) => entry.tab.internal !== null)).toBe(false);
    expect(h.notices()).toEqual([{ appSessionId: A, tabId: from, kind: 'tabsCap', count: BROWSER_LOADED_TABS_MAX, name: 'MAWS probe extension' }]);
  });

  it('refuses an extension with no options page, not loaded in the tab\'s partition, or an unknown tab', () => {
    const h = harness();
    expect(() => h.pages.openOptions(h.page(), OTHER)).toThrow(UnknownExtensionError);
    expect(() => h.pages.openOptions(h.page(A, WORK), PROBE)).toThrow(UnknownExtensionError);
    expect(() => h.pages.openOptions('b_ffffffffffff', PROBE)).toThrow('unknown browser tab');
  });

  it('closes an extension\'s options tabs with a notice naming it, in that partition only; or every one of a partition', () => {
    const h = harness();
    const from = h.page();
    const probe = h.pages.openOptions(from, PROBE)!.tabId;
    const other = h.pages.openOptions(h.page(B), PROBE)!.tabId;
    h.pages.close(WORK, PROBE);
    h.pages.close(PART, OTHER);
    expect(h.store.all()).toHaveLength(4);
    h.pages.close(PART, PROBE);
    expect(h.store.entry(probe)).toBeUndefined();
    expect(h.store.entry(other)).toBeUndefined();
    expect(h.store.entry(from)).toBeDefined();
    expect(h.notices()).toEqual([
      { appSessionId: A, tabId: null, kind: 'extensionPageClosed', name: 'MAWS probe extension' },
      { appSessionId: B, tabId: null, kind: 'extensionPageClosed', name: 'MAWS probe extension' },
    ]);
    h.pages.openOptions(from, PROBE);
    h.pages.close(PART, null); // the profile's removal
    expect(h.store.all().filter((entry) => entry.tab.internal)).toHaveLength(0);
  });
});

// The request rule: Back, an agent's Page.navigate, a restored URL, a redirect all make a main-frame request first.
describe('extensionPagesRule: what a tab\'s main frame may load', () => {
  const OPTIONS = `chrome-extension://${PROBE}/options.html`;
  function ruled() {
    const h = harness();
    const left: [string, string][] = [];
    const rule = extensionPagesRule({ entryOf: (wc) => h.store.entryOf(wc), leave: (entry, url) => void left.push([entry.tab.tabId, url]) });
    const ask = (tabId: string | null, url: string, resourceType = 'mainFrame') =>
      rule({ url, resourceType, webContents: tabId === null ? ({} as never) : h.store.entry(tabId)!.view!.webContents } as never, PART);
    return { h, left, ask };
  }

  it('an ordinary tab never loads an extension page (Back to one included); its web pages and every subframe pass', () => {
    const { h, ask } = ruled();
    const page = h.page();
    expect(ask(page, OPTIONS)).toEqual({ cancel: true });
    expect(ask(page, `chrome-extension://${OTHER}/x.html`)).toEqual({ cancel: true });
    expect(ask(page, 'https://a.test/b')).toBeUndefined();
    expect(ask(page, OPTIONS, 'subFrame')).toBeUndefined(); // an extension's frame in a page (web_accessible_resources)
  });

  it('an internal tab loads its own extension\'s pages; another extension\'s is refused; a web page is refused there and left for', async () => {
    const { h, left, ask } = ruled();
    const tab = h.pages.openOptions(h.page(), PROBE)!;
    expect(ask(tab.tabId, `chrome-extension://${PROBE}/advanced.html`)).toBeUndefined();
    expect(ask(tab.tabId, `chrome-extension://${OTHER}/options.html`)).toEqual({ cancel: true });
    expect(ask(tab.tabId, 'file:///etc/hosts')).toEqual({ cancel: true });
    expect(ask(tab.tabId, 'https://docs.test/x')).toEqual({ cancel: true });
    expect(left).toEqual([]); // after the cancel is answered
    await new Promise((resolve) => setImmediate(resolve));
    expect(left).toEqual([[tab.tabId, 'https://docs.test/x']]);
  });

  it('leaves anything not a tab\'s main frame alone: a popup, a background page', () => {
    const { ask } = ruled();
    expect(ask(null, OPTIONS)).toBeUndefined();
  });
});
