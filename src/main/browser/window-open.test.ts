import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { TabStore, type TabEntry } from './tabs';
import { attachWindowOpen, decideWindowOpen, WINDOW_OPEN_BURST, WINDOW_OPEN_INPUT_MS } from './window-open';

const A = 'App-A' as AppSessionId;
const NOW = 1_000_000;
const base = { url: 'https://a.test/c.html', disposition: 'foreground-tab', now: NOW, lastActivationAt: NOW - 100, recentOpens: [] as number[], linkTarget: 'in-app' as const, hasRoom: true };

describe('decideWindowOpen: the gate (E4a Design §14, Decision Log 11 and 24)', () => {
  it('adopts an http(s) or about:blank open after recent input: selected but for a background tab', () => {
    expect(decideWindowOpen(base)).toEqual({ action: 'adopt', select: true });
    expect(decideWindowOpen({ ...base, disposition: 'new-window' })).toEqual({ action: 'adopt', select: true });
    expect(decideWindowOpen({ ...base, disposition: 'default' })).toEqual({ action: 'adopt', select: true });
    expect(decideWindowOpen({ ...base, disposition: 'background-tab' })).toEqual({ action: 'adopt', select: false });
    expect(decideWindowOpen({ ...base, url: 'about:blank' })).toEqual({ action: 'adopt', select: true });
  });

  it('blocks (and counts) an open with no attributed input in the last 5 s, a fourth open within 5 s, a bad URL, "other", or no room', () => {
    const blocked = { action: 'deny', blocked: true };
    expect(decideWindowOpen({ ...base, lastActivationAt: null })).toEqual(blocked);
    expect(decideWindowOpen({ ...base, lastActivationAt: NOW - WINDOW_OPEN_INPUT_MS - 1 })).toEqual(blocked);
    expect(decideWindowOpen({ ...base, lastActivationAt: NOW - WINDOW_OPEN_INPUT_MS })).toEqual({ action: 'adopt', select: true });
    const burst = Array.from({ length: WINDOW_OPEN_BURST }, (_, i) => NOW - 1000 * i);
    expect(decideWindowOpen({ ...base, recentOpens: burst })).toEqual(blocked);
    expect(decideWindowOpen({ ...base, recentOpens: burst.map((at) => at - WINDOW_OPEN_INPUT_MS) })).toEqual({ action: 'adopt', select: true }); // older than 5 s
    for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'zoommtg://x', 'not a url']) expect(decideWindowOpen({ ...base, url })).toEqual(blocked);
    expect(decideWindowOpen({ ...base, disposition: 'other' })).toEqual(blocked);
    expect(decideWindowOpen({ ...base, hasRoom: false })).toEqual(blocked);
  });

  it('linkTarget external hands an http(s) open to the system browser; a mailto: open always goes out; neither is counted', () => {
    expect(decideWindowOpen({ ...base, linkTarget: 'external' })).toEqual({ action: 'external' });
    expect(decideWindowOpen({ ...base, linkTarget: 'external', hasRoom: false })).toEqual({ action: 'external' });
    expect(decideWindowOpen({ ...base, linkTarget: 'external', url: 'about:blank' })).toEqual({ action: 'adopt', select: true }); // nothing to hand out
    expect(decideWindowOpen({ ...base, url: 'mailto:e4a@example.test' })).toEqual({ action: 'external' });
    expect(decideWindowOpen({ ...base, url: 'mailto:e4a@example.test', lastActivationAt: null })).toEqual({ action: 'deny', blocked: true }); // still gated
  });
});

describe('attachWindowOpen: the handler on the page', () => {
  function harness(linkTarget: 'in-app' | 'external' = 'in-app', refuseChild = false, partition = DEFAULT_PARTITION) {
    const loaded: unknown[][] = [];
    const loads = () => vi.fn((...args: unknown[]) => (loaded.push(args), Promise.resolve()));
    const store = new TabStore({
      emit: () => {},
      createView: (_tab, adopted?) => {
        if (adopted && refuseChild) throw new Error('no view');
        return {
          webContents:
            adopted ??
            Object.assign(new EventEmitter(), {
              loadURL: loads(), // E11: each made view's loads, as the test reads them
              close: () => {},
              isDestroyed: () => false,
              setWindowOpenHandler: vi.fn(),
            }),
        } as unknown as WebContentsView;
      },
      resolvePartition: () => DEFAULT_PARTITION,
      schedule: () => {},
    });
    const seam = { line: vi.fn(), openExternal: vi.fn() };
    let clock = NOW;
    const entry = store.entry(store.open({ appSessionId: A, url: 'https://a.test/', select: true, partition }).tab.tabId) as TabEntry;
    const preferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
    attachWindowOpen(entry, { store, linkTarget: () => linkTarget, seam, childPreferences: preferences, now: () => clock });
    const handler = (entry.view!.webContents as unknown as { setWindowOpenHandler: { mock: { calls: [(details: unknown) => Record<string, unknown>][] } } }).setWindowOpenHandler.mock.calls[0]![0];
    const open = (url: string, disposition = 'foreground-tab', details: Record<string, unknown> = {}) => handler({ url, disposition, frameName: '', features: '', referrer: { url: '', policy: 'default' }, ...details });
    return { store, entry, seam, open, preferences, loaded, tick: (ms: number) => void (clock += ms) };
  }

  it('denies and counts an open with no input, with the seam line', () => {
    const h = harness();
    expect(h.open('https://a.test/c.html')).toEqual({ action: 'deny' });
    expect(h.open('https://a.test/c.html')).toEqual({ action: 'deny' });
    expect(h.entry.tab.blockedPopups).toBe(2);
    expect(h.seam.line.mock.calls).toEqual([['browser-blocked-popup https://a.test/c.html'], ['browser-blocked-popup https://a.test/c.html']]);
  });

  it('allows an open after input, outliving its opener, with MAWS\'s own webPreferences, adopting Chromium\'s child', () => {
    const h = harness();
    h.entry.input.lastActivationAt = NOW;
    const answer = h.open('https://a.test/c.html', 'background-tab');
    expect(answer).toMatchObject({ action: 'allow', outlivesOpener: true, overrideBrowserWindowOptions: { webPreferences: h.preferences } });
    const child = Object.assign(new EventEmitter(), { loadURL: vi.fn(), close: () => {}, isDestroyed: () => false, setWindowOpenHandler: vi.fn() });
    const returned = (answer.createWindow as (options: unknown) => unknown)({ webContents: child, webPreferences: { nodeIntegration: true } });
    expect(returned).toBe(child);
    const adopted = h.store.entryOf(child as never)!;
    expect(adopted.tab).toMatchObject({ appSessionId: A, url: 'https://a.test/c.html' });
    expect(h.store.list(A).selected[A]).toBe(h.entry.tab.tabId); // background-tab: not selected
    expect(h.entry.tab.blockedPopups).toBe(0);
  });

  it('a child that cannot become a tab is handed back to Electron and closed on the next tick', async () => {
    const h = harness('in-app', true);
    h.entry.input.lastActivationAt = NOW;
    const answer = h.open('https://a.test/c.html');
    const child = Object.assign(new EventEmitter(), { close: vi.fn(), isDestroyed: () => false, setWindowOpenHandler: vi.fn() });
    expect((answer.createWindow as (options: unknown) => unknown)({ webContents: child })).toBe(child);
    expect(child.close).not.toHaveBeenCalled(); // not from under Electron, which still holds it
    await new Promise((resolve) => setImmediate(resolve));
    expect(child.close).toHaveBeenCalledTimes(1);
  });

  // A link opened with a modifier (⌘-click, ⇧-click) reaches the handler through Electron's `-new-window` path, where
  // Chromium makes no child: `createWindow` has no webContents and must open the page itself (the e2e's ⌘-click).
  it('with no child from Chromium, a new tab of the opener\'s session and partition loads the URL, selected but for a background tab', () => {
    const h = harness('in-app', false, 'persist:maws-chrome-work');
    h.entry.input.lastActivationAt = NOW;
    const background = h.open('https://a.test/d.html', 'background-tab');
    expect(background).toMatchObject({ action: 'allow', outlivesOpener: true });
    (background.createWindow as (options: unknown) => unknown)({ webPreferences: h.preferences });
    const opened = h.store.list(A).tabs.find((tab) => tab.url === 'https://a.test/d.html')!;
    expect(opened).toMatchObject({ appSessionId: A, partition: 'persist:maws-chrome-work', loading: true, suspended: false });
    expect(h.store.entry(opened.tabId)!.view).not.toBeNull();
    expect(h.store.list(A).selected[A]).toBe(h.entry.tab.tabId); // background-tab: the selection stays

    (h.open('https://a.test/e.html', 'foreground-tab').createWindow as (options: unknown) => unknown)({});
    const selected = h.store.list(A).tabs.find((tab) => tab.url === 'https://a.test/e.html')!;
    expect(h.store.list(A).selected[A]).toBe(selected.tabId);
    expect(h.entry.tab.blockedPopups).toBe(0);
  });

  // E11 (tracker row E4a "modifier-click drops referrer and postBody"): the tab the page opens itself loads as the
  // link would have, with its Referer and, for a form, its POST body and content type
  it('with no child from Chromium, the new tab loads with the request\'s referrer and post body', () => {
    const h = harness();
    h.entry.input.lastActivationAt = NOW;
    const referrer = { url: 'https://a.test/form.html', policy: 'strict-origin-when-cross-origin' };
    const postBody = { data: [{ type: 'rawData', bytes: Buffer.from('q=maws') }], contentType: 'application/x-www-form-urlencoded' };
    h.loaded.length = 0;
    (h.open('https://a.test/search', 'background-tab', { referrer, postBody }).createWindow as (options: unknown) => unknown)({});
    expect(h.loaded).toEqual([['https://a.test/search', { httpReferrer: referrer, postData: postBody.data, extraHeaders: 'content-type: application/x-www-form-urlencoded' }]]);

    const multipart = { data: [{ type: 'rawData', bytes: Buffer.from('--b\r\n') }], contentType: 'multipart/form-data', boundary: '----b' };
    h.loaded.length = 0;
    (h.open('https://a.test/upload', 'background-tab', { referrer, postBody: multipart }).createWindow as (options: unknown) => unknown)({});
    expect(h.loaded[0]![1]).toMatchObject({ extraHeaders: 'content-type: multipart/form-data; boundary=----b' });

    h.loaded.length = 0;
    (h.open('https://a.test/plain', 'background-tab').createWindow as (options: unknown) => unknown)({}); // no referrer, no body
    expect(h.loaded).toEqual([['https://a.test/plain', {}]]);
  });

  it('the room check and the tab the page opens itself spare the opener (a page never suspends its own opener)', () => {
    const h = harness();
    h.entry.input.lastActivationAt = NOW;
    const room = vi.spyOn(h.store, 'hasRoomForView');
    const opened = vi.spyOn(h.store, 'open');
    (h.open('https://a.test/d.html').createWindow as (options: unknown) => unknown)({});
    expect(room).toHaveBeenCalledWith(h.entry);
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://a.test/d.html', opener: h.entry }));
  });

  it('three opens per 5 s: the fourth is blocked; external hands out and denies', () => {
    const h = harness();
    h.entry.input.lastActivationAt = NOW;
    for (let i = 0; i < WINDOW_OPEN_BURST; i++) expect(h.open('https://a.test/c.html')).toMatchObject({ action: 'allow' });
    expect(h.open('https://a.test/c.html')).toEqual({ action: 'deny' });
    expect(h.entry.tab.blockedPopups).toBe(1);

    const out = harness('external');
    out.entry.input.lastActivationAt = NOW;
    expect(out.open('https://b.test/')).toEqual({ action: 'deny' });
    expect(out.seam.openExternal).toHaveBeenCalledWith('https://b.test/');
    expect(out.entry.tab.blockedPopups).toBe(0);
  });
});
