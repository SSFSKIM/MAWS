// Where a tab's view lives in a windowless tab engine: the app's ViewManager (src/main/browser/view.ts) places a view in
// the app window whose pane reported its rect, and leaves it there hidden when the pane lets go; a render host has no
// window and no pane, so each tab's view gets a hidden window of its own at the viewport the agent works in (1280×800),
// made when the store creates the view and closed when the store destroys it. `offscreen` puts no window around it at
// all (the view was made with offscreen webPreferences by the host's createView); the two `hidden` modes differ only in
// the page's background throttling, which the host sets.
import { BaseWindow } from 'electron';
import type { TabEntry } from '../../../src/main/browser/tabs';

export type TabWindowMode = 'hidden' | 'hidden-unthrottled' | 'offscreen';

export interface HeadlessViewsOptions {
  mode: TabWindowMode;
  width: number;
  height: number;
  log(line: string): void;
}

export class HeadlessViews {
  private readonly hosts = new Map<TabEntry, BaseWindow>();

  constructor(private readonly options: HeadlessViewsOptions) {}

  place(entry: TabEntry): void {
    const view = entry.view;
    if (!view) return;
    const { width, height, mode } = this.options;
    if (mode === 'offscreen') {
      view.setBounds({ x: 0, y: 0, width, height });
      view.webContents.setFrameRate?.(60);
      this.options.log(`tab ${entry.tab.tabId}: offscreen view ${width}x${height}, no window`);
      return;
    }
    const win = new BaseWindow({ show: false, width, height, useContentSize: true, frame: false, skipTaskbar: true });
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width, height });
    this.hosts.set(entry, win);
    const [cw, ch] = win.getContentSize();
    this.options.log(`tab ${entry.tab.tabId}: hidden window ${win.id}, content ${cw}x${ch}`);
  }

  unplace(entry: TabEntry): void {
    const win = this.hosts.get(entry);
    this.hosts.delete(entry);
    if (!win || win.isDestroyed()) return;
    if (entry.view) win.contentView.removeChildView(entry.view);
    win.destroy();
  }

  // cua's `windows.query`: the hidden windows, none focused (the offscreen mode answers one notional window).
  windows(): { id: number; focused: boolean }[] {
    const live = [...this.hosts.values()].filter((win) => !win.isDestroyed()).map((win) => ({ id: win.id, focused: false }));
    return live.length > 0 || this.options.mode !== 'offscreen' ? live : [{ id: 1, focused: false }];
  }

  dispose(): void {
    for (const entry of [...this.hosts.keys()]) this.unplace(entry);
  }
}
