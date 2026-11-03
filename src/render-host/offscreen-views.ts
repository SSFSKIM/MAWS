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
//
// An adopted popup's page is sized through its debugger as well (P5 O17 M8 fix 7). Electron 44.4.5 sizes an offscreen page
// from its view's window, by `OffScreenWebContentsView::OnWindowResize`, which reaches the page's widget only through the
// webContents it was given (`GetView()`, shell/browser/osr/osr_web_contents_view.cc:206-211). The view Electron makes for
// a `window.open` child is never given it (`MaybeOverrideCreateParamsForNewWindow` and `AddNewContents`,
// shell/browser/api/electron_api_web_contents.cc:1433-1514, call no `SetWebContents`, which the other two offscreen paths
// do at :986 and :1009). Chromium makes the child's widget in `CreateNewWindow` (content/browser/web_contents/
// web_contents_impl.cc:5668), before `createWindow` runs and while that view has no window: at 0×0. So placing the child
// in the sizing window moves nothing, and the page reads 0×0 until something else creates a new widget for it. Chromium's
// own resize of that widget, `WebContentsImpl::SetDeviceEmulationSize` (web_contents_impl.cc:11978), is reached by CDP's
// `Emulation.setVisibleSize` (content/browser/devtools/protocol/emulation_handler.cc:869) and outlives the attachment
// (its `Disable` leaves it). A widget made later, by a cross-site navigation, is made at the window's size.
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
  private window: BaseWindow | null = null;
  private readonly placed = new Set<TabEntry>();
  private readonly adopted = new WeakSet<WebContents>(); // Chromium's children, sized through their debugger

  constructor(private readonly partitions: Pick<Partitions, 'session'>) {}

  // TabStore's `createView`: a tab's view in its partition, prepared first; an adopted popup's over Chromium's child
  createView = (tab: BrowserTab, adopted?: WebContents): WebContentsView => {
    this.partitions.session(tab.partition);
    const view = adopted ? new WebContentsView({ webContents: adopted }) : new WebContentsView({ webPreferences: { partition: tab.partition, ...offscreenPreferences() } });
    view.webContents.setWebRTCIPHandlingPolicy(HEADLESS_WEBRTC_IP_POLICY);
    if (adopted) this.adopted.add(adopted);
    return view;
  };

  // The store's `onViewCreated`: into the sizing window, at the viewport; for an adopted popup, its page's sizing (see the
  // head), under way after this returns, rejecting with Chromium's error
  place(entry: TabEntry): Promise<void> | undefined {
    const view = entry.view;
    if (!view || this.placed.has(entry)) return undefined;
    const { width, height } = HEADLESS_VIEWPORT;
    if (!this.window || this.window.isDestroyed()) this.window = new BaseWindow({ show: false, width, height, useContentSize: true, frame: false, skipTaskbar: true });
    this.window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width, height });
    this.placed.add(entry);
    if (!this.adopted.has(view.webContents)) return undefined;
    // after Electron's `createWindow` has the child back: nothing attaches to it inside Electron's own open
    return new Promise<void>((resolve) => setImmediate(resolve)).then(() => this.sizeAdopted(entry, view));
  }

  // An adopted popup's page at the viewport (see the head): one command under a lease, given back at once, so the
  // attachment ends unless the agent holds one too. A tab gone meanwhile has no page to size.
  private async sizeAdopted(entry: TabEntry, view: WebContentsView): Promise<void> {
    const tabDebugger = entry.debugger;
    if (entry.view !== view || !tabDebugger || view.webContents.isDestroyed()) return;
    const lease = await tabDebugger.lease();
    try {
      await tabDebugger.send('Emulation.setVisibleSize', { ...HEADLESS_VIEWPORT });
    } finally {
      lease.release();
    }
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
