// E4a (Task 3.1): the renderer's mirror of main's browser tabs (Design §1): the first list and the events after it, in
// either order; the placeholders while covered; control moves; the chrome's transient notices routed by session
// (Decision Log 44 (a), (f)); main's chrome commands relayed to whoever listens.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { browserTab, T1, T2, T3 } from '../../test-support/browser';
import { BROWSER_COPY } from './copy';
import { currentSet } from '../../stores/layout-model';
import { useLayout } from '../../stores/layout';
import { BROWSER_NOTICE_MS, browser, connectBrowser, dismissNotice, listSession, loadedTabs, onChromeCommand, onExtensionReveal, onShowRequest, raiseNotice, requestShow, resetBrowser, tabOpened, tabTitle } from './store';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const PLACEHOLDER = 'data:image/jpeg;base64,AAAA';

const sessionOf = (id: AppSessionId) => browser.getState().sessions.get(id);

let fake: FakeClient;
let disconnect: () => void;
beforeEach(() => {
  resetBrowser();
  fake = fakeClient();
  disconnect = connectBrowser(fake.client);
});
afterEach(() => {
  disconnect();
  vi.useRealTimers();
});

describe('connectBrowser', () => {
  it('subscribes to browser.notice before its first list, then lists every tab (Decision Log 44 (a))', () => {
    expect(fake.calls.indexOf('on browser.notice')).toBeGreaterThanOrEqual(0);
    expect(fake.calls.indexOf('on browser.notice')).toBeLessThan(fake.calls.indexOf('invoke browser.tabs.list'));
    expect(fake.invoked('browser.tabs.list')).toEqual([{}]);
  });

  it('the list fills each session with its tabs and selection, and marks the store ready', async () => {
    expect(browser.getState().ready).toBe(false);
    await fake.reply('browser.tabs.list', { tabs: [browserTab(T1, A), browserTab(T2, B), browserTab(T3, A)], selected: { [A]: T3, [B]: null } });
    expect(browser.getState().ready).toBe(true);
    expect(sessionOf(A)).toEqual({ tabs: [browserTab(T1, A), browserTab(T3, A)], selected: T3 });
    expect(sessionOf(B)).toEqual({ tabs: [browserTab(T2, B)], selected: null });
  });

  it('a tabs.changed that lands while the list is out wins over the older answer for its session', async () => {
    fake.event('browser.tabs.changed', { appSessionId: A, tabs: [browserTab(T1, A, { title: 'Newer' })], selected: T1 });
    await fake.reply('browser.tabs.list', { tabs: [browserTab(T1, A), browserTab(T2, B)], selected: { [A]: null, [B]: T2 } });
    expect(sessionOf(A)).toEqual({ tabs: [browserTab(T1, A, { title: 'Newer' })], selected: T1 });
    expect(sessionOf(B)).toEqual({ tabs: [browserTab(T2, B)], selected: T2 });
  });

  it('a session-scoped list (the tool’s mount) replaces that session alone', async () => {
    await fake.reply('browser.tabs.list', { tabs: [browserTab(T1, A), browserTab(T2, B)], selected: { [A]: T1, [B]: T2 } });
    listSession(A, fake.client);
    expect(fake.invoked('browser.tabs.list')).toEqual([{}, { appSessionId: A }]);
    await fake.reply('browser.tabs.list', { tabs: [], selected: { [A]: null } });
    expect(sessionOf(A)).toEqual({ tabs: [], selected: null });
    expect(sessionOf(B)).toEqual({ tabs: [browserTab(T2, B)], selected: T2 });
  });

  it('control moves patch the tab wherever it is listed', async () => {
    await fake.reply('browser.tabs.list', { tabs: [browserTab(T1, A)], selected: { [A]: T1 } });
    fake.event('browser.control.changed', { tabId: T1, control: 'human', controlSince: '2026-10-06T11:00:00.000Z' });
    expect(sessionOf(A)!.tabs[0]).toMatchObject({ control: 'human', controlSince: '2026-10-06T11:00:00.000Z' });
  });

  it('keeps a covered tab’s placeholder until the tab is listed uncovered, or gone', async () => {
    fake.event('browser.tabs.changed', { appSessionId: A, tabs: [browserTab(T1, A, { covered: true }), browserTab(T2, A, { covered: true })], selected: T1 });
    fake.event('browser.view.covered', { tabId: T1, placeholder: PLACEHOLDER });
    fake.event('browser.view.covered', { tabId: T2, placeholder: null });
    expect(browser.getState().placeholders).toEqual(new Map([[T1, PLACEHOLDER], [T2, null]]));
    fake.event('browser.tabs.changed', { appSessionId: A, tabs: [browserTab(T1, A, { covered: true }), browserTab(T2, A)], selected: T1 });
    expect(browser.getState().placeholders).toEqual(new Map([[T1, PLACEHOLDER]]));
    fake.event('browser.tabs.changed', { appSessionId: A, tabs: [], selected: null });
    expect(browser.getState().placeholders).toEqual(new Map());
  });

  it('relays main’s chrome commands to every listener until it unsubscribes', () => {
    const heard = vi.fn();
    const off = onChromeCommand(heard);
    fake.event('browser.chrome.command', { tabId: T1, command: 'openFind' });
    off();
    fake.event('browser.chrome.command', { tabId: T1, command: 'closeFind' });
    expect(heard.mock.calls).toEqual([[{ tabId: T1, command: 'openFind' }]]);
  });

  it('a tab this window opened is listed at once, selected, and a list asked before it does not drop it', async () => {
    await fake.reply('browser.tabs.list', { tabs: [browserTab(T1, A)], selected: { [A]: T1 } });
    listSession(A, fake.client); // out while the tab opens
    tabOpened(browserTab(T2, A));
    expect(sessionOf(A)).toEqual({ tabs: [browserTab(T1, A), browserTab(T2, A)], selected: T2 });
    await fake.reply('browser.tabs.list', { tabs: [browserTab(T1, A)], selected: { [A]: T1 } });
    expect(sessionOf(A)).toEqual({ tabs: [browserTab(T1, A), browserTab(T2, A)], selected: T2 });
    // main's own event is the newer word: once it listed the tab, the open's answer changes nothing
    fake.event('browser.tabs.changed', { appSessionId: A, tabs: [browserTab(T1, A), browserTab(T2, A, { title: 'Newer' })], selected: T2 });
    tabOpened(browserTab(T2, A));
    expect(sessionOf(A)!.tabs[1]).toMatchObject({ title: 'Newer' });
    // a session the store has not heard of yet
    tabOpened(browserTab(T3, B));
    expect(sessionOf(B)).toEqual({ tabs: [browserTab(T3, B)], selected: T3 });
  });

  // cua #90 (M3's re-review P3): an options tab main replaced with a page leaves one main tab where there was one
  it('an options tab replaced with a page: the main tab showing it shows the page in place, and no chrome is asked to open one', () => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, hydrated: true });
    const { openTab } = useLayout.getState();
    openTab({ kind: 'browser', appSessionId: A, browserTabId: T1 }); // the options tab, as its own main tab
    openTab({ kind: 'diagnostics' });
    useLayout.getState().activateTab(`browser:${A}:${T1}`);
    const heard = vi.fn();
    const off = onExtensionReveal(heard);
    fake.event('browser.extensions.reveal', { tabId: T1, show: { kind: 'replacement', tab: browserTab(T2, A) } });
    off();
    const pane = currentSet(useLayout.getState().main).panes[0];
    expect(pane.tabs.map((tab) => tab.id)).toEqual([`browser:${A}:${T2}`, 'diagnostics']);
    expect(pane.activeTabId).toBe(`browser:${A}:${T2}`);
    expect(useLayout.getState().main.closedTabs).toEqual([]);
    expect(sessionOf(A)!.tabs.map((tab) => tab.tabId)).toEqual([T2]); // listed before main's event, as a tab opened here is
    expect(heard).not.toHaveBeenCalled();
  });

  it('relays a request to show a tab on a surface to every listener until it unsubscribes', () => {
    const heard = vi.fn();
    const off = onShowRequest(heard);
    requestShow(T1, 'panel');
    off();
    requestShow(T1, 'main');
    expect(heard.mock.calls).toEqual([[{ tabId: T1, surface: 'panel' }]]);
  });

  it('disconnecting stops every event', async () => {
    disconnect();
    fake.event('browser.tabs.changed', { appSessionId: A, tabs: [browserTab(T1, A)], selected: T1 });
    expect(sessionOf(A)).toBeUndefined();
    disconnect = () => {};
  });
});

describe('the chrome’s notices', () => {
  it('main’s notices land under their session and leave after 4 s; a local one (Copy URL) the same way', () => {
    vi.useFakeTimers();
    fake.event('browser.notice', { appSessionId: A, tabId: null, kind: 'tabsFileBroken' });
    fake.event('browser.notice', { appSessionId: B, tabId: T2, kind: 'tabsCap', count: 12 });
    raiseNotice({ appSessionId: A, tabId: T1, kind: 'urlCopied' });
    expect(browser.getState().notices.map(({ appSessionId, kind, count }) => ({ appSessionId, kind, count }))).toEqual([
      { appSessionId: A, kind: 'tabsFileBroken', count: undefined },
      { appSessionId: B, kind: 'tabsCap', count: 12 },
      { appSessionId: A, kind: 'urlCopied', count: undefined },
    ]);
    vi.advanceTimersByTime(BROWSER_NOTICE_MS - 1);
    expect(browser.getState().notices).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(browser.getState().notices).toEqual([]);
  });

  it('Dismiss takes one notice away at once', () => {
    fake.event('browser.notice', { appSessionId: A, tabId: null, kind: 'tabsFileBroken' });
    fake.event('browser.notice', { appSessionId: A, tabId: T1, kind: 'downloadRefusedAgent' });
    dismissNotice(browser.getState().notices[0]!.id);
    expect(browser.getState().notices.map((notice) => notice.kind)).toEqual(['downloadRefusedAgent']);
  });

  // E4c start: a page dialog MAWS answered on a tab nobody had placed (A-42) keeps its kind and excerpt for the line
  it('main’s dialogAnswered notice keeps the dialog’s type and excerpt, and its line says what MAWS answered', async () => {
    fake.event('browser.notice', { appSessionId: A, tabId: T1, kind: 'dialogAnswered', dialogType: 'confirm', excerpt: 'Leave this page?' });
    fake.event('browser.notice', { appSessionId: A, tabId: T1, kind: 'dialogAnswered', dialogType: 'alert', excerpt: '' });
    expect(browser.getState().notices.map(({ kind, dialogType, excerpt }) => ({ kind, dialogType, excerpt }))).toEqual([
      { kind: 'dialogAnswered', dialogType: 'confirm', excerpt: 'Leave this page?' },
      { kind: 'dialogAnswered', dialogType: 'alert', excerpt: '' },
    ]);
    const { noticeText } = await import('./chrome/Notices');
    expect(noticeText({ kind: 'dialogAnswered', dialogType: 'confirm', excerpt: 'Leave this page?' })).toBe(BROWSER_COPY.dialogAnswered('confirm', 'Leave this page?'));
    expect(BROWSER_COPY.dialogAnswered('confirm', 'Leave this page?')).toBe('While this tab was hidden the page asked “Leave this page?”; MAWS answered Cancel');
    expect(BROWSER_COPY.dialogAnswered('alert', 'Saved.')).toBe('While this tab was hidden the page showed an alert, which MAWS closed: “Saved.”');
    expect(BROWSER_COPY.dialogAnswered('alert', '')).toBe('While this tab was hidden the page showed an alert, which MAWS closed');
    expect(BROWSER_COPY.dialogAnswered('confirm', '')).toBe('While this tab was hidden the page asked for a confirmation; MAWS answered Cancel');
  });
  // E4c end
});

describe('tabTitle', () => {
  it('the page’s title, else its host, else nothing (the chip then says New tab)', () => {
    expect(tabTitle(browserTab(T1, A, { title: 'Page A' }))).toBe('Page A');
    expect(tabTitle(browserTab(T1, A, { title: '', url: 'https://en.wikipedia.org/wiki/X' }))).toBe('en.wikipedia.org');
    expect(tabTitle(browserTab(T1, A, { title: '', url: '' }))).toBe('');
    expect(BROWSER_COPY.newTab).toBe('New tab');
  });

  it('while the load failed, the failed host, as Chrome names a tab at the address it could not reach', () => {
    const failed = (host: string) => ({ url: 'http://127.0.0.1:1/', host, kind: 'refused' as const, code: -102, description: 'ERR_CONNECTION_REFUSED' });
    expect(tabTitle(browserTab(T1, A, { title: 'Page A', url: 'http://127.0.0.1:1/', loadError: failed('127.0.0.1') }))).toBe('127.0.0.1');
    expect(tabTitle(browserTab(T1, A, { title: 'Page A', loadError: { ...failed(''), url: 'http://e4a.invalid/x' } }))).toBe('e4a.invalid');
  });
});

describe('loadedTabs (Session info, Task 3.4)', () => {
  it('counts the tabs with a page across sessions, summing what main sampled, null before any sample', () => {
    const state = (tabs: ReturnType<typeof browserTab>[]) => ({ ...browser.getState(), sessions: new Map([[A, { tabs, selected: null }]]) });
    expect(loadedTabs(state([]))).toEqual({ loaded: 0, memoryKiB: null });
    expect(loadedTabs(state([browserTab(T1, A), browserTab(T2, A, { url: '' }), browserTab(T3, A, { suspended: true })]))).toEqual({ loaded: 1, memoryKiB: null });
    expect(loadedTabs(state([browserTab(T1, A, { memoryKiB: 2048 }), browserTab(T2, A, { url: '', memoryKiB: 1024 })]))).toEqual({ loaded: 2, memoryKiB: 3072 });
    expect(loadedTabs(state([browserTab(T1, A, { failed: { message: 'no view' } })]))).toEqual({ loaded: 0, memoryKiB: null }); // no view, no page
  });
});
