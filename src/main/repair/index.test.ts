// The repair window's wiring in main (P5 O15 M2, Interfaces §B; fix wave 5, the architect's panel, scalpel-1#1): while
// the window is up, reopening MAWS retries. On macOS opening an app that already runs (the Dock, Finder) starts no second
// process: it fires the app's `activate`, which here does what a second launch does, the window shown and focused and one
// attempt through the controller's one-at-a-time rule; the listener goes once the window resolves or closes, so that
// afterwards the app's own `activate` is the only one. Electron is faked: an EventEmitter app and window.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LaunchOutcome } from '../hosts/daemon';

const electron = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter: Emitter } = require('node:events') as typeof import('node:events');
  const app = Object.assign(new Emitter(), { quit: vi.fn() });
  const windows: FakeWindow[] = [];
  class FakeWindow extends Emitter {
    destroyed = false;
    webContents = Object.assign(new Emitter(), { setWindowOpenHandler: vi.fn(), send: vi.fn() });
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
    isMinimized = () => false;
    isDestroyed = () => this.destroyed;
    loadFile = vi.fn(async () => {});
    loadURL = vi.fn(async () => {});
    close = vi.fn(() => {
      this.destroyed = true;
      this.emit('closed');
    });
    constructor() {
      super();
      windows.push(this);
    }
  }
  const ipcMain = { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
  return { app, windows, FakeWindow, ipcMain };
});
vi.mock('electron', () => ({ app: electron.app, BrowserWindow: electron.FakeWindow, ipcMain: electron.ipcMain, shell: { openExternal: vi.fn(async () => {}), showItemInFolder: vi.fn() } }));
vi.mock('../window', () => ({ installContentSecurityPolicy: vi.fn(), THEME_BACKGROUND: { light: '#fff', dark: '#000' } }));
vi.mock('../window-show', () => ({ showAppWindow: vi.fn() }));

import { repairLaunch } from './index';

const NOT_LOADED = { kind: 'not-loaded', why: 'the LaunchAgent is installed but not loaded' } as const;
const PRIVATE: LaunchOutcome = { ok: true, launch: { daemon: 'private' } };
afterEach(() => {
  electron.app.removeAllListeners();
  electron.windows.length = 0;
  vi.clearAllMocks();
});

function scene() {
  const pending: ((outcome: LaunchOutcome) => void)[] = [];
  const attempt = vi.fn(() => new Promise<LaunchOutcome>((resolve) => pending.push(resolve)));
  const launched = repairLaunch(NOT_LOADED, attempt, { packaged: true, profileDir: '/tmp/maws-repair-wiring', env: {}, onSecondLaunch: () => {} });
  const win = electron.windows.at(-1)!;
  return { attempt, launched, win, answer: (outcome: LaunchOutcome) => pending.shift()!(outcome) };
}

describe('the repair window while it is up', () => {
  it('a reopen (the app’s activate) shows and focuses the window and starts one attempt, as a second launch does', () => {
    const { attempt, win } = scene();
    electron.app.emit('activate');
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledOnce();
    electron.app.emit('activate'); // while that attempt runs: none more
    expect(attempt).toHaveBeenCalledOnce();
  });

  it('leaves no activate listener once the window resolves into the app', async () => {
    const { launched, win, answer } = scene();
    const before = electron.app.listenerCount('activate');
    let atClose = -1; // Electron closes a window later, so the listener must be gone by the close call, not by 'closed'
    win.close.mockImplementation(() => {
      atClose = electron.app.listenerCount('activate');
    });
    electron.app.emit('activate');
    answer(PRIVATE);
    await expect(launched).resolves.toEqual({ daemon: 'private' });
    expect(before).toBe(1);
    expect(atClose).toBe(0);
    expect(electron.app.listenerCount('activate')).toBe(0);
  });

  it('leaves no activate listener once the window is closed, which quits MAWS', () => {
    const { win } = scene();
    win.close();
    expect(electron.app.quit).toHaveBeenCalled();
    expect(electron.app.listenerCount('activate')).toBe(0);
  });
});
