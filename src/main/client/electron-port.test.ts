// The client port in Electron main (P5 O1 M3): what each member asks of Electron, parented to the asking client's window
// while its page lives and app-level otherwise, and the answers it maps back.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotifyEvent } from '@shared/client/port';
import { fakePage } from '../../../test/support/fake-page';

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class FakeNotification {
    static supported = true;
    static instances: FakeNotification[] = [];
    static isSupported = () => FakeNotification.supported;
    listeners = new Map<string, Listener>();
    show = vi.fn();
    close = vi.fn();
    constructor(readonly options: unknown) {
      FakeNotification.instances.push(this);
    }
    on(event: string, listener: Listener) {
      this.listeners.set(event, listener);
      return this;
    }
    fire(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.({}, ...args);
    }
  }
  const windows = new Map<object, unknown>(); // page → its window
  return {
    FakeNotification,
    windows,
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    shell: { showItemInFolder: vi.fn(), openPath: vi.fn(), openExternal: vi.fn(async () => {}) },
    dock: { setBadge: vi.fn(), bounce: vi.fn() },
    appWindows: [] as unknown[],
  };
});
vi.mock('electron', () => ({
  app: { dock: electron.dock },
  BrowserWindow: { fromWebContents: (page: object) => electron.windows.get(page) ?? null },
  dialog: electron.dialog,
  shell: electron.shell,
  Notification: electron.FakeNotification,
}));
vi.mock('../windows', () => ({ appWindows: () => electron.appWindows }));

const { clientOf } = await import('../ipc/clients');
const { electronClientPort } = await import('./electron-port');

const fakeWindow = () => ({ isMinimized: vi.fn(() => true), restore: vi.fn(), show: vi.fn(), focus: vi.fn() });
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-electron-port-'));
  electron.FakeNotification.instances = [];
  electron.FakeNotification.supported = true;
  electron.appWindows = [];
});
afterEach(() => {
  vi.clearAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function asking() {
  const page = fakePage();
  const win = fakeWindow();
  electron.windows.set(page, win);
  return { page, win, client: clientOf(page as never) };
}
const port = (env: NodeJS.ProcessEnv = {}, openWindow = vi.fn(() => fakeWindow() as never)) => electronClientPort({ env, openWindow });

describe('dialogs', () => {
  it('a pick asks the open panel over the client’s window, and maps its answer', async () => {
    const { win, client } = asking();
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/a', '/b'] });
    expect(await port().pick(client, { kind: 'file', multiple: true, defaultPath: '/p', filters: [{ name: 'Images', extensions: ['png'] }] })).toEqual({ paths: ['/a', '/b'] });
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledExactlyOnceWith(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png'] }], defaultPath: '/p' });
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await port().pick(null, { kind: 'directory', multiple: false })).toEqual({ cancelled: true });
    expect(electron.dialog.showOpenDialog).toHaveBeenLastCalledWith({ properties: ['openDirectory', 'createDirectory'] }); // no client: app-level
  });

  it('a pick under the e2e answers MAWS_E2E_PICK_PATHS and opens no panel', async () => {
    expect(await port({ MAWS_E2E: '1', MAWS_E2E_PICK_PATHS: dir }).pick(null, { kind: 'directory', multiple: false })).toEqual({ paths: [dir] });
    expect(await port({ MAWS_E2E: '1' }).pick(null, { kind: 'file', multiple: false })).toEqual({ cancelled: true });
    expect(electron.dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it('a gone client’s dialog is app-level, never noClient', async () => {
    const { page, client } = asking();
    page.destroy();
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/x.txt' });
    expect(await port().save(client, { defaultPath: '/d/x.txt' })).toEqual({ path: '/x.txt' });
    expect(electron.dialog.showSaveDialog).toHaveBeenCalledExactlyOnceWith({ defaultPath: '/d/x.txt' });
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '' });
    expect(await port().save(null, { defaultPath: '/d/x.txt' })).toEqual({ cancelled: true });
  });

  it('a question is two buttons, the cancel its default, over the client’s window', async () => {
    const { win, client } = asking();
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 });
    const request = { kind: 'warning' as const, message: 'Replace “x”?', detail: 'It goes.', confirm: 'Replace', cancel: 'Cancel' };
    expect(await port().confirm(client, request)).toEqual({ confirmed: true });
    expect(electron.dialog.showMessageBox).toHaveBeenCalledExactlyOnceWith(win, { type: 'warning', message: 'Replace “x”?', detail: 'It goes.', buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
    expect(await port().confirm(null, request)).toEqual({ confirmed: false });
  });
});

describe('opening and revealing', () => {
  it('a path opens through shell.openPath, whose error text is the reason; a reveal shows it in Finder', async () => {
    electron.shell.openPath.mockResolvedValueOnce('').mockResolvedValueOnce('no application');
    expect(await port().openExternal(null, { path: '/d/a.pdf' })).toEqual({ opened: true });
    expect(await port().openExternal(null, { path: '/d/a.pdf' })).toEqual({ opened: false, reason: 'no application' });
    expect(await port().reveal(null, '/d/a.pdf')).toEqual({ revealed: true });
    expect(electron.shell.showItemInFolder).toHaveBeenCalledExactlyOnceWith('/d/a.pdf');
  });

  it('a URL is scheme-checked and handed to the browser', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await port().openExternal(null, { url: 'https://example.com/' })).toEqual({ opened: true });
    expect(electron.shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/');
    expect(await port().openExternal(null, { url: 'file:///etc/passwd' })).toEqual({ opened: false, reason: 'only http, https and mailto links open outside MAWS' });
    expect(electron.shell.openExternal).toHaveBeenCalledOnce();
  });
});

describe('notifications, the badge and focus', () => {
  it('a notification relays Electron’s six events, and closes through its handle', () => {
    const events: NotifyEvent[] = [];
    const handle = port().notify(null, { title: 'T', body: 'B', silent: true, reply: { placeholder: 'Reply' }, actions: ['Allow once'] }, (event) => events.push(event));
    const [notification] = electron.FakeNotification.instances;
    expect(notification!.options).toEqual({ title: 'T', body: 'B', silent: true, hasReply: true, replyPlaceholder: 'Reply', actions: [{ type: 'button', text: 'Allow once' }] });
    expect(notification!.show).toHaveBeenCalledOnce();
    notification!.fire('show');
    notification!.fire('failed', 'not allowed');
    notification!.fire('click');
    notification!.fire('reply', 'words');
    notification!.fire('action', 0);
    notification!.fire('close');
    expect(events).toEqual([{ kind: 'shown' }, { kind: 'failed', error: 'not allowed' }, { kind: 'clicked' }, { kind: 'replied', text: 'words' }, { kind: 'action', index: 0 }, { kind: 'closed' }]);
    (handle as { close(): void }).close();
    expect(notification!.close).toHaveBeenCalledOnce();
    expect(port().notify(null, { title: 'T', body: 'B', silent: false }, () => {})).not.toBeNull();
    expect(electron.FakeNotification.instances[1]!.options).toEqual({ title: 'T', body: 'B', silent: false });
  });

  it('answers unsupported when the OS has no notifications', () => {
    electron.FakeNotification.supported = false;
    expect(port().notify(null, { title: 'T', body: 'B', silent: true }, () => {})).toEqual({ unsupported: 'notifications are not supported' });
    expect(electron.FakeNotification.instances).toEqual([]);
  });

  it('the badge shows a count, and clears at zero', () => {
    port().badge(null, 3);
    port().badge(null, 0);
    expect(electron.dock.setBadge.mock.calls).toEqual([['3'], ['']]);
  });

  it('a request bounces the dock; a bring shows the client’s window, else the app’s first, else a new one', () => {
    port().focus(null, 'request');
    expect(electron.dock.bounce).toHaveBeenCalledExactlyOnceWith('informational');
    const { win, client } = asking();
    port().focus(client, 'bring');
    expect([win.restore, win.show, win.focus].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
    const first = fakeWindow();
    electron.appWindows = [first];
    port().focus(null, 'bring');
    expect(first.focus).toHaveBeenCalledOnce();
    electron.appWindows = [];
    const opened = fakeWindow();
    const openWindow = vi.fn(() => opened as never);
    port({}, openWindow).focus(null, 'bring');
    expect(openWindow).toHaveBeenCalledOnce();
    expect(opened.show).toHaveBeenCalledOnce();
  });
});
