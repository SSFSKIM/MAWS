import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { attachKeys, canShowBookmarksBar, keyAction } from './keys';
import { TabStore, type TabEntry } from './tabs';

const A = 'App-A' as AppSessionId;
const idle = { findOpen: false, loading: false };
const key = (key: string, more: Partial<{ type: string; meta: boolean; control: boolean; alt: boolean; shift: boolean; code: string }> = {}) => ({
  type: 'keyDown',
  key,
  code: more.code ?? `Key${key.toUpperCase()}`,
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...more,
});
const cmd = (k: string, more: Parameters<typeof key>[1] = {}) => key(k, { meta: true, ...more });

describe('keyAction: the chords taken inside the page (E4a Design §4, Decision Log 9)', () => {
  it('takes ⌘R, ⌘[, ⌘], ⌘L, ⌘F, ⌘= / ⌘+ and ⌘-', () => {
    expect(keyAction(cmd('r'), idle)).toEqual({ kind: 'navigate', to: 'reload' });
    expect(keyAction(cmd('R', { shift: true }), idle)).toEqual({ kind: 'navigate', to: 'reload' });
    expect(keyAction(cmd('['), idle)).toEqual({ kind: 'navigate', to: 'back' });
    expect(keyAction(cmd(']'), idle)).toEqual({ kind: 'navigate', to: 'forward' });
    expect(keyAction(cmd('l'), idle)).toEqual({ kind: 'chrome', command: 'focusAddress' });
    expect(keyAction(cmd('f'), idle)).toEqual({ kind: 'chrome', command: 'openFind' });
    expect(keyAction(cmd('='), idle)).toEqual({ kind: 'zoom', action: 'in' });
    expect(keyAction(cmd('+', { shift: true }), idle)).toEqual({ kind: 'zoom', action: 'in' });
    expect(keyAction(cmd('-'), idle)).toEqual({ kind: 'zoom', action: 'out' });
  });

  // cua #90: Chrome's chord for the bookmarks bar; it shadows MAWS's ⌘⇧B (Toggle right panel) inside the page only, and
  // only in a tab that can show a bar (the owner's decision of 2026-10-09: "it toggles the bookmarks bar where there is one")
  it('takes ⇧⌘B as the bookmarks bar toggle in a tab that can show a bar, and ⌘B, ⌥⇧⌘B, ⌃⇧⌘B not', () => {
    const withBar = { ...idle, bookmarksBar: true };
    expect(keyAction(cmd('B', { shift: true }), withBar)).toEqual({ kind: 'chrome', command: 'toggleBookmarksBar' });
    expect(keyAction(cmd('b', { shift: true }), withBar)).toEqual({ kind: 'chrome', command: 'toggleBookmarksBar' });
    for (const input of [cmd('b'), cmd('B', { shift: true, alt: true }), cmd('B', { shift: true, control: true }), key('B', { shift: true })]) expect(keyAction(input, withBar)).toBeNull();
  });

  it('passes ⇧⌘B to the menu (Toggle right panel) in a tab that can show no bar', () => {
    expect(keyAction(cmd('B', { shift: true }), idle)).toBeNull();
    expect(keyAction(cmd('B', { shift: true }), { ...idle, bookmarksBar: false })).toBeNull();
  });

  it('acts on keyDown only', () => {
    expect(keyAction(cmd('r', { type: 'keyUp' }), idle)).toBeNull();
    expect(keyAction(cmd('r', { type: 'char' }), idle)).toBeNull();
  });

  it('leaves every other chord to the page or the menu: ⌘0, ⌘K, ⌘W, Ctrl-R, ⌥⌘L, ⇧⌘L, plain letters', () => {
    for (const input of [cmd('0'), cmd('k'), cmd('w'), key('r', { control: true }), cmd('l', { alt: true }), cmd('L', { shift: true }), cmd('r', { control: true }), key('r'), key('[')]) {
      expect(keyAction(input, idle)).toBeNull();
    }
  });

  it('takes Esc only while the find bar is open (closeFind) or the page is loading (stop)', () => {
    const esc = key('Escape', { code: 'Escape' });
    expect(keyAction(esc, idle)).toBeNull();
    expect(keyAction(esc, { findOpen: true, loading: true })).toEqual({ kind: 'chrome', command: 'closeFind' });
    expect(keyAction(esc, { findOpen: false, loading: true })).toEqual({ kind: 'navigate', to: 'stop' });
    expect(keyAction({ ...esc, shift: true }, { findOpen: true, loading: false })).toBeNull();
  });
});

describe('canShowBookmarksBar (cua #90)', () => {
  const consented = { consentedAt: '2026-10-09T00:00:00.000Z', syncedAt: null, count: 0, error: 'missing', errorAt: '2026-10-09T00:00:00.000Z' };
  const profiles = [
    { partition: 'persist:maws-chrome-Default', bookmarks: consented },
    { partition: 'persist:maws-chrome-Profile%201', bookmarks: null },
    { partition: 'persist:maws-chrome-Old' }, // a version 1 record, read loosely
  ];
  it('is true for a profile with its bookmarks consented (whatever its last sync did), and false for the Default partition, an unconsented or old record, and an unknown partition', () => {
    expect(canShowBookmarksBar(profiles, 'persist:maws-chrome-Default')).toBe(true);
    expect(canShowBookmarksBar(profiles, DEFAULT_PARTITION)).toBe(false);
    expect(canShowBookmarksBar(profiles, 'persist:maws-chrome-Profile%201')).toBe(false);
    expect(canShowBookmarksBar(profiles, 'persist:maws-chrome-Old')).toBe(false);
    expect(canShowBookmarksBar(profiles, 'persist:maws-chrome-Gone')).toBe(false);
  });
});

describe('attachKeys: before-input-event', () => {
  function harness(barPartitions: string[] = [DEFAULT_PARTITION]) {
    const emitted: { name: EventName; payload: unknown }[] = [];
    const store = new TabStore({
      emit: <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload }),
      createView: () => ({ webContents: Object.assign(new EventEmitter(), { loadURL: () => Promise.resolve(), close: () => {}, isDestroyed: () => false }) }) as unknown as WebContentsView,
      resolvePartition: () => DEFAULT_PARTITION,
      schedule: () => {},
    });
    const navigator = { navigate: vi.fn(() => true), zoom: vi.fn(() => 1.1), find: vi.fn() };
    const tabId = store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId;
    const entry = store.entry(tabId) as TabEntry;
    const focus = vi.fn();
    entry.host = { webContents: { focus } } as never;
    const bookmarksBar = vi.fn((partition: string) => barPartitions.includes(partition)); // cua #90
    attachKeys(entry, { store, navigator, bookmarksBar, emit: <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload }) });
    const wc = entry.view!.webContents as unknown as EventEmitter;
    const press = (input: ReturnType<typeof key>) => {
      const event = { preventDefault: vi.fn() };
      wc.emit('before-input-event', event, input);
      return event.preventDefault.mock.calls.length > 0;
    };
    const commands = () => emitted.filter((e) => e.name === 'browser.chrome.command').map((e) => e.payload);
    return { store, entry, tabId, navigator, focus, press, commands };
  }

  it('acts on a taken chord, prevents it, and suppresses its keyUp only', () => {
    const h = harness();
    h.store.update(h.tabId, { loading: false });
    expect(h.press(cmd('r', { code: 'KeyR' }))).toBe(true);
    expect(h.navigator.navigate).toHaveBeenCalledWith(h.tabId, 'reload');
    expect(h.press(cmd('r', { type: 'keyUp', code: 'KeyR' }))).toBe(true);
    expect(h.press(cmd('r', { type: 'keyUp', code: 'KeyR' }))).toBe(false); // once
    expect(h.press(key('a', { type: 'keyUp', code: 'KeyA' }))).toBe(false);
    expect(h.press(cmd('k'))).toBe(false);
    expect(h.press(cmd('='))).toBe(true);
    expect(h.navigator.zoom).toHaveBeenCalledWith(h.tabId, 'in');
  });

  it('⌘L and ⌘F give the window\'s own page the focus, then tell the chrome; Esc then closes the find bar and stops finding', () => {
    const h = harness();
    h.store.update(h.tabId, { loading: false });
    h.press(cmd('l'));
    expect(h.focus).toHaveBeenCalledTimes(1);
    h.press(cmd('f'));
    expect(h.focus).toHaveBeenCalledTimes(2);
    expect(h.entry.findOpen).toBe(true);
    expect(h.press(key('Escape', { code: 'Escape' }))).toBe(true);
    expect(h.navigator.find).toHaveBeenCalledWith(h.tabId, { text: null });
    expect(h.commands()).toEqual([
      { tabId: h.tabId, command: 'focusAddress' },
      { tabId: h.tabId, command: 'openFind' },
      { tabId: h.tabId, command: 'closeFind' },
    ]);
  });

  it('⇧⌘B passes to the menu in a tab whose partition can show no bar (the Default partition, an unconsented profile) (cua #90)', () => {
    const h = harness([]);
    expect(h.press(cmd('B', { shift: true, code: 'KeyB' }))).toBe(false);
    expect(h.press(cmd('B', { shift: true, type: 'keyUp', code: 'KeyB' }))).toBe(false);
    expect(h.commands()).toEqual([]);
  });

  it('⇧⌘B tells the chrome to flip the bookmarks bar and leaves the focus in the page (cua #90)', () => {
    const h = harness();
    expect(h.press(cmd('B', { shift: true, code: 'KeyB' }))).toBe(true);
    expect(h.focus).not.toHaveBeenCalled();
    expect(h.commands()).toEqual([{ tabId: h.tabId, command: 'toggleBookmarksBar' }]);
    expect(h.press(cmd('B', { shift: true, type: 'keyUp', code: 'KeyB' }))).toBe(true); // its keyUp stays out of the page
  });

  it('a taken chord whose keyUp went to the app window does not swallow the next press of its key', () => {
    const h = harness();
    expect(h.press(cmd('l', { code: 'KeyL' }))).toBe(true); // its keyUp goes to the app's window, which now has the focus
    expect(h.press(key('l', { code: 'KeyL' }))).toBe(false);
    expect(h.press(key('l', { type: 'keyUp', code: 'KeyL' }))).toBe(false); // reaches the page
  });

  it('Esc while loading stops; with nothing to do it reaches the page', () => {
    const h = harness();
    expect(h.store.entry(h.tabId)!.tab.loading).toBe(true);
    expect(h.press(key('Escape', { code: 'Escape' }))).toBe(true);
    expect(h.navigator.navigate).toHaveBeenCalledWith(h.tabId, 'stop');
    h.store.update(h.tabId, { loading: false });
    expect(h.press(key('Escape', { code: 'Escape' }))).toBe(false);
  });
});
