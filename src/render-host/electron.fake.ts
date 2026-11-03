// A stand-in Electron for the render host's tab engine (P5 O17 M4: "the root composed under a stand-in Electron"; the real
// Electron run is M8's): `vi.mock('electron', () => import('./electron.fake'))`. A `WebContentsView` over a page that
// records its preferences, bounds, WebRTC policy and `window.open` handler (its webContents the cua stand's FakeContents,
// whose debugger records every CDP command), and a `BaseWindow` that records its options, its child views and anything
// that would show or focus it. `made` keeps every instance, `reset` forgets them between cases.
import type { WindowOpenHandlerResponse } from 'electron';
import { FakeContents } from '../main/browser/cua/server.fake';

let frames = 0;

export class FakePage extends FakeContents {
  readonly id = 1_000 + frames; // a webContents id, as Electron's (P5 O17 M8's inspection names each view by it)
  webRtcPolicy: string | null = null;
  openHandler: ((details: Record<string, unknown>) => WindowOpenHandlerResponse) | null = null;
  constructor() {
    super(`HEADLESS-FRAME-${++frames}`);
  }
  setWebRTCIPHandlingPolicy(policy: string) {
    this.webRtcPolicy = policy;
  }
  override setWindowOpenHandler(handler?: (details: Record<string, unknown>) => WindowOpenHandlerResponse) {
    this.openHandler = handler ?? null;
  }
  isLoading() {
    return false;
  }
  getZoomFactor() {
    return 1;
  }
  readonly input: Record<string, unknown>[] = []; // P5 O17 M6: what a viewer's input sent the page
  sendInputEvent(event: Record<string, unknown>) {
    this.input.push(event);
  }
  insertion: Promise<void> | null = null; // what insertText answers (resolved at once unless a case says)
  insertText(text: string) {
    this.input.push({ type: 'insertText', text });
    return this.insertion ?? Promise.resolve();
  }
}

export class WebContentsView {
  readonly webContents: FakePage;
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  constructor(readonly options: { webPreferences?: Record<string, unknown>; webContents?: FakePage }) {
    this.webContents = options.webContents ?? new FakePage();
    made.views.push(this);
  }
  setBounds(bounds: { x: number; y: number; width: number; height: number }) {
    this.bounds = { ...bounds };
  }
  getBounds() {
    return { ...this.bounds };
  }
  setVisible() {}
}

let windows = 0;

export class BaseWindow {
  readonly id = ++windows;
  readonly children: WebContentsView[] = [];
  readonly shown: string[] = []; // every call that would show or focus it
  destroyed = false;
  readonly contentView = {
    addChildView: (view: WebContentsView) => void this.children.push(view),
    removeChildView: (view: WebContentsView) => void this.children.splice(this.children.indexOf(view), 1),
  };
  constructor(readonly options: Record<string, unknown>) {
    made.windows.push(this);
  }
  show() {
    this.shown.push('show');
  }
  showInactive() {
    this.shown.push('showInactive');
  }
  focus() {
    this.shown.push('focus');
  }
  destroy() {
    this.destroyed = true;
  }
  isDestroyed() {
    return this.destroyed;
  }
}

export const made = { views: [] as WebContentsView[], windows: [] as BaseWindow[] };

export function reset(): void {
  made.views.length = 0;
  made.windows.length = 0;
}
