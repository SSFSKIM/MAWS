import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { SETTINGS_DEFAULTS_V11 } from '@shared/settings/defaults';

const prepared = vi.hoisted(() => [] as string[]); // what each opened partition was given, in order

// A page's view as startBrowser's listeners use it, with a webContents.debugger that records attach and every command;
// and the window the e2e-free wiring test places it in.
const fakes = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  const cdp: unknown[] = [];
  const webContents = () => {
    const dbg = Object.assign(new EventEmitter(), {
      attachedTo: false,
      attach: () => {
        dbg.attachedTo = true;
        cdp.push('attach');
      },
      detach: () => void (dbg.attachedTo = false),
      isAttached: () => dbg.attachedTo,
      sendCommand: (method: string, params?: unknown) => {
        if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { id: 'F' } } });
        cdp.push([method, params]);
        return Promise.resolve({});
      },
    });
    const history = { canGoBack: () => false, canGoForward: () => false, getActiveIndex: () => 0, getEntryAtIndex: () => ({ title: '' }) };
    return Object.assign(new EventEmitter(), {
      debugger: dbg,
      navigationHistory: history,
      loadURL: () => Promise.resolve(),
      close: () => {},
      isDestroyed: () => false,
      isFocused: () => false,
      isLoading: () => false,
      getURL: () => 'https://a.test/',
      getZoomFactor: () => 1,
      setWindowOpenHandler: () => {},
    });
  };
  class View {
    readonly webContents = webContents();
    visible = true;
    setVisible(visible: boolean) {
      this.visible = visible;
    }
    setBounds() {}
  }
  const win = Object.assign(new EventEmitter(), {
    id: 1,
    webContents: Object.assign(new EventEmitter(), { getURL: () => 'app://index.html', focus: () => {} }),
    contentView: { addChildView: () => {}, removeChildView: () => {} },
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
  });
  const app = Object.assign(new EventEmitter(), { getVersion: () => '9.9.9' }); // the app's own events (the client certificate a request with no page asks for); E13: its version
  return { cdp, View, win, app };
});

// E4d start: the preload channel's listener comment mode adds to ipcMain (E4d Task 2.2)
const commentIpc = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  const channel = new EventEmitter();
  return { channel, on: channel.on.bind(channel), removeListener: channel.removeListener.bind(channel) };
});
// E4d end

vi.mock('electron', () => ({
  app: fakes.app,
  ipcMain: { handle: () => {}, on: commentIpc.on, removeListener: commentIpc.removeListener }, // E4d: on, removeListener
  BrowserWindow: { fromWebContents: () => fakes.win, getAllWindows: () => [] }, // E13: getAllWindows
  session: {
    fromPartition: () => ({
      getUserAgent: () => 'UA Electron/1',
      setUserAgent: () => {},
      webRequest: { onBeforeRequest: () => {} },
      getPreloadScripts: () => [],
      registerPreloadScript: ({ id, type, filePath }: { id: string; type: string; filePath: string }) => void prepared.push(`preload ${id} ${type} ${filePath.split('/').slice(-2).join('/')}`),
      setPermissionRequestHandler: () => void prepared.push('permission requests'),
      setPermissionCheckHandler: () => void prepared.push('permission checks'),
      setDevicePermissionHandler: () => void prepared.push('devices'),
      setDisplayMediaRequestHandler: () => void prepared.push('display media'),
      on: (event: string) => void prepared.push(event),
    }),
  },
  WebContentsView: fakes.View,
}));

const { startBrowser } = await import('./index');
const { registerAppWindow } = await import('../windows');
registerAppWindow(fakes.win as never);

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
  return startBrowser({ userData, settings: () => SETTINGS_DEFAULTS_V11.browser, index, register: () => {}, emit: () => {}, env: {}, ...more });
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

  it('a page that closes itself after stop (every page is closed there) leaves tabs.json as stop wrote it', () => {
    mkdirSync(join(userData, 'browser'));
    const file = join(userData, 'browser', 'tabs.json');
    const browser = start(fakeIndex([A]).index);
    const { tab } = browser.store.open({ appSessionId: A, url: 'https://a.test/', select: true });
    const wc = browser.store.entry(tab.tabId)!.view!.webContents as unknown as import('node:events').EventEmitter;
    browser.stop();
    expect(JSON.parse(readFileSync(file, 'utf8')).tabs).toHaveLength(1);
    vi.useFakeTimers();
    try {
      wc.emit('destroyed'); // Electron destroys each closed page a moment later
      vi.advanceTimersByTime(1000);
    } finally {
      vi.useRealTimers();
    }
    expect(JSON.parse(readFileSync(file, 'utf8')).tabs).toHaveLength(1);
  });

  it('refuses a client certificate to a request no page made (a favicon fetch), and leaves a page\'s own to its handler', () => {
    const browser = start(fakeIndex([A]).index);
    expect(fakes.app.listenerCount('select-client-certificate')).toBe(1);
    const unowned = { preventDefault: vi.fn() };
    const refuse = vi.fn();
    fakes.app.emit('select-client-certificate', unowned, null, 'https://mtls.test/favicon.ico', [{ subjectName: 'owner' }], refuse);
    expect(unowned.preventDefault).toHaveBeenCalled();
    expect(refuse).toHaveBeenCalledWith();
    const paged = { preventDefault: vi.fn() };
    const pick = vi.fn();
    fakes.app.emit('select-client-certificate', paged, { id: 3 }, 'https://mtls.test/', [{ subjectName: 'owner' }], pick);
    expect(paged.preventDefault).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    browser.stop();
    expect(fakes.app.listenerCount('select-client-certificate')).toBe(0);
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
      settings: () => ({ ...SETTINGS_DEFAULTS_V11.browser, profile: 'Profile 1' }),
      register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
    });
    expect(handlers.get('browser.profiles.list')!(undefined)).toEqual({ profiles: [{ profileDir: 'Profile 1', name: 'Work' }] });
    expect(browser.store.open({ appSessionId: A, url: null, select: true }).tab.partition).toBe('persist:maws-chrome-Profile 1');
    expect(profiles).toHaveBeenCalledTimes(2);
    browser.stop();
  });

  it('reads the profile when a tab opens, so a change applies to tabs opened afterwards (Design §9)', () => {
    let settings = SETTINGS_DEFAULTS_V11.browser;
    const profiles = () => [{ profileDir: 'Profile 1', name: 'Work', partition: 'persist:maws-chrome-Profile 1', importedAt: 't', storageDirName: 'x' }];
    const browser = start(fakeIndex([A]).index, { profiles, settings: () => settings });
    const before = browser.store.open({ appSessionId: A, url: null, select: true }).tab;
    settings = { ...settings, profile: 'Profile 1' };
    const after = browser.store.open({ appSessionId: A, url: null, select: true }).tab;
    expect([before.partition, after.partition]).toEqual([DEFAULT_PARTITION, 'persist:maws-chrome-Profile 1']);
    expect(browser.store.list(A).tabs.find((t) => t.tabId === before.tabId)!.partition).toBe(DEFAULT_PARTITION);
    browser.stop();
  });

  it('installs the e2e seam under MAWS_E2E=1 only, and removes it at stop', () => {
    const plain = start(fakeIndex([A]).index);
    expect(globalThis.__maws_browser).toBeUndefined();
    plain.stop();
    const e2e = start(fakeIndex([A]).index, { env: { MAWS_E2E: '1' } });
    const { tab } = e2e.store.open({ appSessionId: A, url: null, select: true });
    expect(globalThis.__maws_browser!.tab(tab.tabId)).toEqual({ visible: false, bounds: null, attached: false, windowId: null, owner: null });
    expect(globalThis.__maws_browser!.metrics()).toEqual({ loaded: 0, sampled: 0 });
    e2e.stop();
    expect(globalThis.__maws_browser).toBeUndefined();
  });

  it('prepares a partition, when a tab first needs it, with the browser preload, the permission handlers and the download listener', () => {
    prepared.length = 0;
    const browser = start(fakeIndex([A]).index);
    expect(prepared).toEqual([]);
    browser.store.open({ appSessionId: A, url: null, select: true });
    expect(prepared).toEqual(['preload maws-browser frame preload/browser.js', 'permission requests', 'permission checks', 'devices', 'display media', 'will-download']);
    browser.store.open({ appSessionId: A, url: null, select: true });
    expect(prepared).toHaveLength(6); // once per partition
    browser.stop();
  });

  it('wires each new page\'s input seams and, under focus emulation, its debugger and the view manager\'s hook', async () => {
    const handlers = new Map<string, (input: unknown, context: unknown) => unknown>();
    const register = ((name: string, handler: (input: unknown, context: unknown) => unknown) => void handlers.set(name, handler)) as never;
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const page = (browser: ReturnType<typeof start>) => {
      const { tab } = browser.store.open({ appSessionId: A, url: 'https://a.test/', select: true });
      const entry = browser.store.entry(tab.tabId)!;
      return { tab, entry, wc: entry.view!.webContents as unknown as import('node:events').EventEmitter };
    };

    fakes.cdp.length = 0;
    const off = start(fakeIndex([A]).index, { register });
    const plain = page(off);
    plain.wc.emit('before-input-event', { preventDefault: () => {} }, { type: 'keyDown', key: 'a', code: 'KeyA' });
    expect(plain.entry.input.lastHumanActivationAt).not.toBeNull(); // the gates are live
    await settle();
    expect(fakes.cdp).toEqual([]); // off: nothing attaches
    off.stop();

    const on = start(fakeIndex([A]).index, { register, env: { MAWS_BROWSER_FOCUS_EMULATION: '1' } });
    const emulated = page(on);
    await settle();
    expect(fakes.cdp).toEqual(['attach']); // at view creation
    emulated.wc.emit('did-navigate', {}, 'https://a.test/', 200, 'OK');
    const rect = { x: 0, y: 0, width: 300, height: 200 };
    handlers.get('browser.view.place')!({ tabId: emulated.tab.tabId, paneId: 'p', surface: 'panel', rect, claim: true }, { sender: fakes.win.webContents });
    await settle();
    expect(fakes.cdp).toContainEqual(['Emulation.setFocusEmulationEnabled', { enabled: true }]); // the hook sends through the debugger
    on.stop();
  });
});

// E4d start: comment mode's wiring inside startBrowser (E4d execution document, Interfaces "Main"; Decision Log 26(b))
const { contextMenuTemplate } = await import('./context-menu');
const { COMMENT_CHANNEL } = await import('@shared/browser/comment-protocol');
describe('startBrowser wires comment mode (E4d)', () => {
  beforeEach(() => void commentIpc.channel.removeAllListeners()); // independent of whether earlier suites stopped
  const menuLabels = () =>
    contextMenuTemplate({ x: 1, y: 1, linkURL: '', srcURL: '', mediaType: 'none', isEditable: false, selectionText: '', editFlags: {} } as never, { canGoBack: false, canGoForward: false }, {} as never).map(
      (item) => item.label,
    );

  it('registers browser.comment.set, the preload channel, the menu\'s Comment and the seam, and removes them at stop', async () => {
    const handlers = new Map<string, (input: unknown, context: unknown) => unknown>();
    const register = ((name: string, handler: (input: unknown, context: unknown) => unknown) => void handlers.set(name, handler)) as never;
    const browser = start(fakeIndex([A]).index, { register, env: { MAWS_E2E: '1' } });
    expect(handlers.get('browser.comment.set')!({ tabId: 'b_00000000000f', on: true }, {})).toEqual({ on: false, reason: 'unknownTab' });
    expect(commentIpc.channel.listenerCount(COMMENT_CHANNEL.fromPreload)).toBe(1);
    expect(menuLabels()).toContain('Comment');

    const { tab } = browser.store.open({ appSessionId: A, url: 'https://a.test/', select: true });
    const page = Object.assign(browser.store.entry(tab.tabId)!.view!.webContents, { id: 42 }); // the fake has no id of its own
    commentIpc.channel.emit(COMMENT_CHANNEL.fromPreload, { sender: page }, { type: 'picked', epoch: 0, requestId: null });
    expect(globalThis.__maws_browser_comment!.state(tab.tabId)).toEqual({ armed: false, arming: false, epoch: 0, dropped: 1, webContentsId: 42 }); // nothing armed: dropped
    await expect(globalThis.__maws_browser_comment!.replayReport(tab.tabId, 'junk')).resolves.toBe(true);
    expect(globalThis.__maws_browser_comment!.state(tab.tabId)!.dropped).toBe(2);
    globalThis.__maws_browser_comment!.setControl(tab.tabId, 'agent');
    expect(browser.store.entry(tab.tabId)!.tab.control).toBe('agent');
    expect(globalThis.__maws_browser_comment!.state('b_00000000000f')).toBeNull();

    browser.stop();
    expect(commentIpc.channel.listenerCount(COMMENT_CHANNEL.fromPreload)).toBe(0);
    expect(menuLabels()).not.toContain('Comment');
    expect(globalThis.__maws_browser_comment).toBeUndefined();
  });

  it('installs no seam without MAWS_E2E=1', () => {
    const browser = start(fakeIndex([A]).index);
    expect(globalThis.__maws_browser_comment).toBeUndefined();
    browser.stop();
  });
});
// E4d end
// E4c start: the browser tools started inside startBrowser (E4c Design §4; Decision Log 36)
describe('startBrowser: the browser tools (E4c)', () => {
  const fakeHosts = () => {
    const events = new Map<string, unknown>();
    return {
      events,
      hosts: {
        onEvent: vi.fn((name: string, listener: unknown) => {
          events.set(name, listener);
          return () => void events.delete(name);
        }),
        dispatch: vi.fn(async () => ({ ok: true })),
        onState: vi.fn(() => () => {}),
      },
    };
  };

  it("subscribes to the engine host's browser requests only when it is given the hosts, and stops at stop", () => {
    start(fakeIndex([A]).index).stop(); // E4a alone: nothing to subscribe to
    const { hosts, events } = fakeHosts();
    const browser = start(fakeIndex([A]).index, { hosts: hosts as never });
    expect([...events.keys()]).toEqual(['session.status', 'maws.browser.request', 'maws.browser.cancel']); // E13's status hook first
    expect(hosts.onState).toHaveBeenCalledWith('engine-host', expect.any(Function));
    browser.stop();
    expect(events.size).toBe(0);
  });

  it('under MAWS_E2E=1 mints deterministic tab ids and adds the agent to the seam', async () => {
    const { hosts } = fakeHosts();
    const e2e = start(fakeIndex([A]).index, { env: { MAWS_E2E: '1' }, hosts: hosts as never });
    expect(e2e.store.open({ appSessionId: A, url: null, select: true }).tab.tabId).toBe('b_000000000001');
    const answer = await globalThis.__maws_browser!.agent!.run(A, 'browser_tabs', { action: 'list' });
    expect(answer).toMatchObject({ ok: true, result: { tabs: [{ tabId: 'b_000000000001' }] } });
    e2e.stop();
    const plain = start(fakeIndex([A]).index, { hosts: hosts as never });
    expect(plain.store.open({ appSessionId: A, url: null, select: true }).tab.tabId).not.toBe('b_000000000001');
    plain.stop();
  });
});
// E4c end

// E13 start: cua's primitive server (the in-app browser spec of 2026-10-08, M2)
describe("startBrowser: cua's primitive server (E13)", () => {
  it('serves a socket per session from a status of its live engine (never a trust bootstrap\'s), closed with its record and at stop', async () => {
    userData = mkdtempSync('/tmp/mbs-'); // a Unix socket path must stay short
    const listeners = new Set<(payload: { appSessionId: AppSessionId; status: { process: string } }) => void>();
    const hosts = {
      onEvent: vi.fn((name: string, listener: never) => {
        if (name !== 'session.status') return () => {};
        listeners.add(listener);
        return () => void listeners.delete(listener);
      }),
      dispatch: vi.fn(async () => ({ ok: true })),
      onState: vi.fn(() => () => {}),
    };
    const { index, change } = fakeIndex([A]);
    const browser = start(index, { hosts: hosts as never });
    const dir = join(userData, 'browser', 'cua');
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const status = (appSessionId: string, process: string) => listeners.forEach((l) => l({ appSessionId: appSessionId as AppSessionId, status: { process } }));
    status('a-bootstrap-id', 'ready');
    status(A, 'exited');
    expect(readdirSync(dir)).toEqual([]);
    status(A, 'ready'); // an engine that outlived the app's relaunch (D-16)
    await vi.waitFor(() => expect(readdirSync(dir)).toEqual([`${A}.sock`]));
    expect(browser.cua.socketPathFor(A)).toBe(join(dir, `${A}.sock`));
    change(A, 'removed');
    expect(readdirSync(dir)).toEqual([]);
    browser.cua.socketPathFor(A);
    browser.stop();
    expect(readdirSync(dir)).toEqual([]);
  });
});
// E13 end
