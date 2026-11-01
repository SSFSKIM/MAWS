// Where a headless tab's view lives (P5 O17 M4; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M4, Interfaces §D;
// O5's M7 verdict, conditions 1 and 4; the U3 spike's spikes/u3-remote-browser/host/headless-views.ts): the app's
// ViewManager places a tab's view over the pane that owns it; the render host has no pane and no window a person sees, so
// every view, an adopted popup's too, is rendered offscreen at the viewport the agent works in (1280×800) and held in one
// sizing window that is never shown: an offscreen view outside any window reads its page at 0×0 and paints nothing (the
// spike's first run). The window is made with the first view and destroyed with the last, so an idle render host holds
// none; it has no frame, no taskbar entry and no Dock presence (the root's accessory policy), and nothing here focuses or
// shows it. No power save blocker is taken (condition 4); the frame source is M6's.
//
// The page's preferences are view.ts's `tabWebPreferences` (sandboxed, isolated, no Node) with offscreen rendering, and
// its WebRTC policy is view.ts's; both are restated, held equal by offscreen-views.test.ts, since view.ts reads
// `__dirname` at load (its preload's path) and the render host's chunk reads none (bundle-guard.test.ts). An adopted
// popup is Chromium's child, made with `childPreferences` (window-open.ts's override), offscreen too.
import { BaseWindow, WebContentsView, type WebContents, type WebPreferences } from 'electron';
import type { BrowserTab } from '@shared/browser/tab';
import type { Partitions } from '../main/browser/partition';
import type { TabEntry } from '../main/browser/tabs';

export const HEADLESS_VIEWPORT = { width: 1280, height: 800 } as const; // DIP, the agent's viewport
export const HEADLESS_WEBRTC_IP_POLICY = 'default_public_interface_only'; // view.ts's TAB_WEBRTC_IP_POLICY (P3-F1)

// view.ts's tabWebPreferences, offscreen
export function offscreenPreferences(): WebPreferences {
  return { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: true, safeDialogs: true, offscreen: true };
}

export class OffscreenViews {
  readonly childPreferences: WebPreferences = offscreenPreferences();
  // P5 O17 M8 fix 6: Chromium makes a popup's child before it is adopted, at the size the open's window options give it; an
  // offscreen child made at Chromium's default reads its page at 0×0 (pass 3's real run): it is made at the viewport
  readonly childSize = { ...HEADLESS_VIEWPORT };
  private window: BaseWindow | null = null;
  private readonly placed = new Set<TabEntry>();

  constructor(private readonly partitions: Pick<Partitions, 'session'>) {}

  // TabStore's `createView`: a tab's view in its partition, prepared first; an adopted popup's over Chromium's child
  createView = (tab: BrowserTab, adopted?: WebContents): WebContentsView => {
    this.partitions.session(tab.partition);
    const view = adopted ? new WebContentsView({ webContents: adopted }) : new WebContentsView({ webPreferences: { partition: tab.partition, ...offscreenPreferences() } });
    view.webContents.setWebRTCIPHandlingPolicy(HEADLESS_WEBRTC_IP_POLICY);
    return view;
  };

  // The store's `onViewCreated`: into the sizing window, at the viewport
  place(entry: TabEntry): void {
    const view = entry.view;
    if (!view || this.placed.has(entry)) return;
    const { width, height } = HEADLESS_VIEWPORT;
    if (!this.window || this.window.isDestroyed()) this.window = new BaseWindow({ show: false, width, height, useContentSize: true, frame: false, skipTaskbar: true });
    this.window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width, height });
    this.placed.add(entry);
  }

  // The store's `onViewDestroying`: out of the window, which goes with the last view
  unplace(entry: TabEntry): void {
    if (!this.placed.delete(entry)) return;
    const window = this.window;
    if (window && !window.isDestroyed() && entry.view) window.contentView.removeChildView(entry.view);
    if (this.placed.size > 0) return;
    if (window && !window.isDestroyed()) window.destroy();
    this.window = null;
  }

  dispose(): void {
    for (const entry of [...this.placed]) this.unplace(entry);
  }
}
