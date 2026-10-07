import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_DENIED_MAX, DEFAULT_PARTITION } from '@shared/browser/tab';
import { CLIPBOARD_HUMAN_INPUT_MS, guardPage, permissionGranted, preparePermissions, withDenied } from './permissions';
import { TabStore, type TabEntry } from './tabs';

const A = 'App-A' as AppSessionId;
const NOW = 1_000_000;
const human = (at: number | null) => ({ lastHumanAt: at, lastInputAt: at });

describe('permissionGranted: deny-all with the human clipboard write (E4a Design §8, Decision Log 12)', () => {
  it('denies every permission whatever the input', () => {
    for (const permission of ['notifications', 'geolocation', 'media', 'clipboard-read', 'fullscreen', 'midi', 'openExternal']) {
      expect(permissionGranted(permission, { control: 'idle' }, human(NOW), NOW)).toBe(false);
    }
  });

  it('grants clipboard-sanitized-write within 2 s of the human\'s input while the agent does not hold the page', () => {
    const write = 'clipboard-sanitized-write';
    expect(permissionGranted(write, { control: 'idle' }, human(NOW - CLIPBOARD_HUMAN_INPUT_MS), NOW)).toBe(true);
    expect(permissionGranted(write, { control: 'human' }, human(NOW - 10), NOW)).toBe(true);
    expect(permissionGranted(write, { control: 'idle' }, human(NOW - CLIPBOARD_HUMAN_INPUT_MS - 1), NOW)).toBe(false);
    expect(permissionGranted(write, { control: 'idle' }, human(null), NOW)).toBe(false); // no input yet
    expect(permissionGranted(write, { control: 'agent' }, human(NOW - 10), NOW)).toBe(false);
    expect(permissionGranted(write, { control: 'idle' }, { lastHumanAt: null, lastInputAt: NOW }, NOW)).toBe(false); // the agent's input
  });

  it('withDenied keeps one line per (host, permission), the newest eight', () => {
    let denied = withDenied([], { host: 'a.test', permission: 'notifications' });
    denied = withDenied(denied, { host: 'a.test', permission: 'notifications' });
    expect(denied).toEqual([{ host: 'a.test', permission: 'notifications' }]);
    for (let i = 0; i < BROWSER_DENIED_MAX + 2; i++) denied = withDenied(denied, { host: `h${i}.test`, permission: 'geolocation' });
    expect(denied).toHaveLength(BROWSER_DENIED_MAX);
    expect(denied.at(-1)).toEqual({ host: `h${BROWSER_DENIED_MAX + 1}.test`, permission: 'geolocation' });
  });
});

describe('preparePermissions: the partition\'s handlers', () => {
  function harness() {
    const store = new TabStore({
      emit: () => {},
      createView: () => ({ webContents: Object.assign(new EventEmitter(), { loadURL: () => Promise.resolve(), close: () => {}, isDestroyed: () => false, getURL: () => 'https://a.test/page' }) }) as unknown as WebContentsView,
      resolvePartition: () => DEFAULT_PARTITION,
      schedule: () => {},
    });
    const handlers: Record<string, (...args: never[]) => unknown> = {};
    const ses = {
      setPermissionRequestHandler: (h: never) => void (handlers.request = h),
      setPermissionCheckHandler: (h: never) => void (handlers.check = h),
      setDevicePermissionHandler: (h: never) => void (handlers.device = h),
      setDisplayMediaRequestHandler: (h: never) => void (handlers.display = h),
    };
    let clock = NOW;
    preparePermissions(store, () => clock)(ses as never, DEFAULT_PARTITION);
    const entry = store.entry(store.open({ appSessionId: A, url: 'https://a.test/page', select: true }).tab.tabId) as TabEntry;
    const request = (permission: string, wc: unknown = entry.view!.webContents, requestingUrl = 'https://a.test/page') => {
      const callback = vi.fn();
      (handlers.request as (...args: unknown[]) => void)(wc, permission, callback, { requestingUrl });
      return callback.mock.calls[0]?.[0] as boolean;
    };
    const check = (permission: string, wc: unknown = entry.view!.webContents) => (handlers.check as (...args: unknown[]) => boolean)(wc, permission, 'https://a.test', {});
    return { store, entry, handlers, request, check, tick: (ms: number) => void (clock += ms) };
  }

  it('denies a request and records it on the tab for the banner, by the requesting frame\'s host', () => {
    const h = harness();
    expect(h.request('notifications')).toBe(false);
    expect(h.request('geolocation', undefined, 'https://maps.test/embed')).toBe(false);
    expect(h.entry.tab.denied).toEqual([
      { host: 'a.test', permission: 'notifications' },
      { host: 'maps.test', permission: 'geolocation' },
    ]);
    expect(h.request('media', { not: 'a tab' })).toBe(false); // no tab: denied, recorded nowhere
    expect(h.entry.tab.denied).toHaveLength(2);
  });

  it('grants the clipboard write right after the human\'s input, by request and by check, and records nothing then', () => {
    const h = harness();
    expect(h.request('clipboard-sanitized-write')).toBe(false);
    expect(h.check('clipboard-sanitized-write')).toBe(false);
    h.entry.input.lastHumanAt = NOW;
    expect(h.request('clipboard-sanitized-write')).toBe(true);
    expect(h.check('clipboard-sanitized-write')).toBe(true);
    expect(h.check('clipboard-read')).toBe(false);
    expect(h.check('clipboard-sanitized-write', null)).toBe(false);
    h.tick(CLIPBOARD_HUMAN_INPUT_MS + 1);
    expect(h.check('clipboard-sanitized-write')).toBe(false);
    expect(h.entry.tab.denied).toEqual([{ host: 'a.test', permission: 'clipboard-sanitized-write' }]);
  });

  it('refuses every device and any screen capture', () => {
    const h = harness();
    expect((h.handlers.device as () => boolean)()).toBe(false);
    const callback = vi.fn();
    (h.handlers.display as (...args: unknown[]) => void)({}, callback);
    expect(callback).toHaveBeenCalledWith({});
  });
});

describe('guardPage: the per-page answers', () => {
  it('cancels HTTP authentication with no credentials', () => {
    const webContents = new EventEmitter();
    guardPage({ view: { webContents } } as unknown as TabEntry);
    const event = { preventDefault: vi.fn() };
    const callback = vi.fn();
    webContents.emit('login', event, { url: 'https://auth.test/' }, { realm: 'r' }, callback);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith();
  });
});
