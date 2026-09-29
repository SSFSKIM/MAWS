import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { WindowState } from '@shared/ipc/schema/layout';
import { DEFAULT_WINDOW_SIZE, restoreWindowState, trackWindowState, type TrackedWindow } from './window-state';

const PRIMARY = { x: 0, y: 25, width: 1512, height: 920 }; // a laptop's work area under the menu bar
const EXTERNAL = { x: 1512, y: -300, width: 2560, height: 1415 };
const saved = (bounds: WindowState['bounds'], flags: Partial<WindowState> = {}): WindowState => ({ bounds, maximized: false, fullscreen: false, ...flags });
const CENTRED = { x: Math.round((1512 - 1280) / 2), y: 25 + Math.round((920 - 820) / 2), ...DEFAULT_WINDOW_SIZE };

describe('window state validation', () => {
  it('restores bounds that lie on a current display', () => {
    const bounds = { x: 100, y: 80, width: 1200, height: 800 };
    expect(restoreWindowState(saved(bounds), [PRIMARY, EXTERNAL], PRIMARY)).toEqual(saved(bounds));
  });

  it('restores bounds on a secondary display', () => {
    const bounds = { x: 2000, y: -200, width: 1400, height: 900 };
    expect(restoreWindowState(saved(bounds), [PRIMARY, EXTERNAL], PRIMARY).bounds).toEqual(bounds);
  });

  it('rejects bounds off every display and centres the default size on the primary display', () => {
    const offscreen = { x: 5000, y: 3000, width: 1200, height: 800 }; // the external display was unplugged
    expect(restoreWindowState(saved(offscreen), [PRIMARY], PRIMARY)).toEqual(saved(CENTRED));
  });

  it('accepts bounds overlapping a display by 64 px and rejects 63', () => {
    const overlapping = (px: number) => ({ x: PRIMARY.width - px, y: 100, width: 800, height: 600 });
    expect(restoreWindowState(saved(overlapping(64)), [PRIMARY], PRIMARY).bounds).toEqual(overlapping(64));
    expect(restoreWindowState(saved(overlapping(63)), [PRIMARY], PRIMARY).bounds).toEqual(CENTRED);
    const lowEdge = (px: number) => ({ x: 100, y: 25 + 920 - px, width: 800, height: 600 });
    expect(restoreWindowState(saved(lowEdge(64)), [PRIMARY], PRIMARY).bounds).toEqual(lowEdge(64));
    expect(restoreWindowState(saved(lowEdge(63)), [PRIMARY], PRIMARY).bounds).toEqual(CENTRED);
  });

  it('a saved maximized: true restores maximized, and full screen likewise', () => {
    const bounds = { x: 100, y: 80, width: 1200, height: 800 };
    expect(restoreWindowState(saved(bounds, { maximized: true }), [PRIMARY], PRIMARY)).toEqual(saved(bounds, { maximized: true }));
    expect(restoreWindowState(saved(bounds, { fullscreen: true }), [PRIMARY], PRIMARY).fullscreen).toBe(true);
  });

  it('keeps the maximized flag when the bounds had to be replaced', () => {
    const offscreen = { x: 5000, y: 3000, width: 1200, height: 800 };
    expect(restoreWindowState(saved(offscreen, { maximized: true }), [PRIMARY], PRIMARY)).toEqual(saved(CENTRED, { maximized: true }));
  });

  it('an absent or malformed value is a first launch', () => {
    expect(restoreWindowState(null, [PRIMARY], PRIMARY)).toEqual(saved(CENTRED));
    expect(restoreWindowState({ bounds: { x: 1 } }, [PRIMARY], PRIMARY)).toEqual(saved(CENTRED));
  });

  it('shrinks the default to a work area smaller than 1280×820', () => {
    const small = { x: 0, y: 0, width: 1024, height: 700 };
    expect(restoreWindowState(null, [small], small).bounds).toEqual({ x: 0, y: 0, width: 1024, height: 700 });
  });
});

class FakeWindow extends EventEmitter implements TrackedWindow {
  normal = { x: 10, y: 20, width: 1300, height: 850 };
  max = false;
  full = false;
  getNormalBounds = () => this.normal;
  isMaximized = () => this.max;
  isFullScreen = () => this.full;
}

describe('window state tracking', () => {
  it('saves the normal bounds and flags on every move, resize, maximize and full-screen change', () => {
    const win = new FakeWindow();
    const save = vi.fn();
    trackWindowState(win, save);
    for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.emit(event);
    expect(save).toHaveBeenCalledTimes(6);
    win.max = true;
    win.emit('maximize');
    expect(save).toHaveBeenLastCalledWith({ bounds: win.normal, maximized: true, fullscreen: false });
  });

  it('saves once more when the window closes and stops listening', () => {
    const win = new FakeWindow();
    const save = vi.fn();
    trackWindowState(win, save);
    win.emit('close');
    expect(save).toHaveBeenCalledTimes(1);
    win.emit('closed');
    win.emit('resize');
    expect(save).toHaveBeenCalledTimes(1);
  });
});
