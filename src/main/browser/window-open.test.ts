import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { TabStore, type TabEntry } from './tabs';
import { attachWindowOpen, decideWindowOpen, WINDOW_OPEN_BURST, WINDOW_OPEN_INPUT_MS } from './window-open';

const A = 'App-A' as AppSessionId;
const NOW = 1_000_000;
const base = { url: 'https://a.test/c.html', disposition: 'foreground-tab', now: NOW, lastInputAt: NOW - 100, recentOpens: [] as number[], linkTarget: 'in-app' as const, hasRoom: true };

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
    expect(decideWindowOpen({ ...base, lastInputAt: null })).toEqual(blocked);
    expect(decideWindowOpen({ ...base, lastInputAt: NOW - WINDOW_OPEN_INPUT_MS - 1 })).toEqual(blocked);
    expect(decideWindowOpen({ ...base, lastInputAt: NOW - WINDOW_OPEN_INPUT_MS })).toEqual({ action: 'adopt', select: true });
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
    expect(decideWindowOpen({ ...base, url: 'mailto:e4a@example.test', lastInputAt: null })).toEqual({ action: 'deny', blocked: true }); // still gated
  });
});

describe('attachWindowOpen: the handler on the page', () => {
  function harness(linkTarget: 'in-app' | 'external' = 'in-app', refuseChild = false) {
    const store = new TabStore({
      emit: () => {},
      createView: (_tab, adopted?) => {
        if (adopted && refuseChild) throw new Error('no view');
        return {
          webContents:
            adopted ??
            Object.assign(new EventEmitter(), {
              loadURL: () => Promise.resolve(),
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
    const entry = store.entry(store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId) as TabEntry;
    const preferences = { preload: '/out/preload/browser.js', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
    attachWindowOpen(entry, { store, linkTarget: () => linkTarget, seam, childPreferences: preferences, now: () => clock });
    const handler = (entry.view!.webContents as unknown as { setWindowOpenHandler: { mock: { calls: [(details: unknown) => Record<string, unknown>][] } } }).setWindowOpenHandler.mock.calls[0]![0];
    const open = (url: string, disposition = 'foreground-tab') => handler({ url, disposition, frameName: '', features: '', referrer: { url: '', policy: 'default' } });
    return { store, entry, seam, open, preferences, tick: (ms: number) => void (clock += ms) };
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
    h.entry.input.lastInputAt = NOW;
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

  it('a child that cannot become a tab is handed back to Electron and closed on the next tick; no child adopts nothing', async () => {
    const h = harness('in-app', true);
    h.entry.input.lastInputAt = NOW;
    const answer = h.open('https://a.test/c.html');
    const child = Object.assign(new EventEmitter(), { close: vi.fn(), isDestroyed: () => false, setWindowOpenHandler: vi.fn() });
    expect((answer.createWindow as (options: unknown) => unknown)({ webContents: child })).toBe(child);
    expect(child.close).not.toHaveBeenCalled(); // not from under Electron, which still holds it
    await new Promise((resolve) => setImmediate(resolve));
    expect(child.close).toHaveBeenCalledTimes(1);

    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tabs = h.store.list(A).tabs.length;
      expect((h.open('https://a.test/d.html').createWindow as (options: unknown) => unknown)({})).toBeUndefined();
      expect(h.store.list(A).tabs).toHaveLength(tabs); // no tab, and no second webContents built
      expect(warned).toHaveBeenCalled();
    } finally {
      warned.mockRestore();
    }
  });

  it('three opens per 5 s: the fourth is blocked; external hands out and denies', () => {
    const h = harness();
    h.entry.input.lastInputAt = NOW;
    for (let i = 0; i < WINDOW_OPEN_BURST; i++) expect(h.open('https://a.test/c.html')).toMatchObject({ action: 'allow' });
    expect(h.open('https://a.test/c.html')).toEqual({ action: 'deny' });
    expect(h.entry.tab.blockedPopups).toBe(1);

    const out = harness('external');
    out.entry.input.lastInputAt = NOW;
    expect(out.open('https://b.test/')).toEqual({ action: 'deny' });
    expect(out.seam.openExternal).toHaveBeenCalledWith('https://b.test/');
    expect(out.entry.tab.blockedPopups).toBe(0);
  });
});
