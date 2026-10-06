import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { describe, expect, it } from 'vitest';
import { appWindows, isAppWindow, registerAppWindow } from './windows';

class FakeWindow extends EventEmitter {
  destroyed = false;
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    this.destroyed = true;
    this.emit('closed');
  }
}
const fake = () => new FakeWindow() as FakeWindow & BrowserWindow;

describe('the app-window registry (E2 Design §7, Decision Log 21)', () => {
  it('lists the registered windows in creation order and never a window it was not given', () => {
    const [a, capture, b] = [fake(), fake(), fake()];
    registerAppWindow(a);
    registerAppWindow(b);
    expect(appWindows()).toEqual([a, b]);
    expect(isAppWindow(a)).toBe(true);
    expect(isAppWindow(capture)).toBe(false);
    a.close();
    b.close();
  });

  it('drops a window from the open list when it closes, and still knows it was the app’s', () => {
    const win = fake();
    registerAppWindow(win);
    win.close();
    expect(appWindows()).not.toContain(win);
    expect(isAppWindow(win)).toBe(true); // a `closed` listener that runs after the registry's still sees an app window
  });

  it('passes over a destroyed window that has not emitted `closed` yet', () => {
    const win = fake();
    registerAppWindow(win);
    win.destroyed = true;
    expect(appWindows()).not.toContain(win);
    win.close();
  });
});
