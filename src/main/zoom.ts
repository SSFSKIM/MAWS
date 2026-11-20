// The window's zoom (UX wave U6b-5b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md; l7-shell-08; decisions
// 23 to 29, 34 and 36; S3; M1's verdict, Decision Log 17). ⌘= and ⌘− make every app window larger and smaller in the
// in-app browser's steps, Actual Size returns to 100 %, and the factor survives a relaunch.
//
// `window.zoom` in layout.json is the truth: main's own key, published (the map and the file together, or neither), absent
// at 100 %. Nothing here keeps a copy: every reader asks the store. Each app window's page is made isolated (its zoom is
// its own, shared with no other page of its origin, and kept by Chromium nowhere: M1's rows c and d) at the stored factor
// (`openAt`, given as the window's `zoomFactor`, which is in force at its first show: row f's f1), and an isolated factor
// survives a reload (row e), so nothing is applied after a load and nothing reset at quit. The presenter's and the repair
// window take no zoom of the app's (row g).
//
// Where a CSS pixel of the app's page is handed to a native call in window points, the number is multiplied by the
// factor (`zoomOf`): the in-app browser's view and its extension popup (`toPoints`, decision 27), its native menus, the
// comment's pin (divided), the traffic lights (`trafficLightsAt`) and the device-size box in the window.
import type { WebContents } from 'electron';
import { WindowZoomSchema, ZOOM_MAX, ZOOM_MIN, type ZoomTo } from '@shared/ipc/schema/layout';
import { stepZoom } from './browser/navigation';
import type { registerMainHandler } from './ipc/router';
import type { LayoutStore } from './layout/store';

export { ZOOM_MAX, ZOOM_MIN };
const ZOOM_KEY = 'window.zoom';

// The factor after an act: a step of the in-app browser's presets held to the two bounds, 1, or the factor as it is.
export function nextFactor(current: number, to: ZoomTo): number {
  switch (to) {
    case 'in':
      return Math.min(stepZoom(current, 'in'), ZOOM_MAX);
    case 'out':
      return Math.max(stepZoom(current, 'out'), ZOOM_MIN);
    case 'actual':
      return 1;
    case 'current':
      return current;
  }
}

// The stored key's factor; 1 for an absent or invalid value, which is left as found until the next change.
export function readFactor(stored: unknown): number {
  const parsed = WindowZoomSchema.safeParse(stored);
  return parsed.success ? parsed.data.factor : 1;
}

type Rect = { x: number; y: number; width: number; height: number };
// Decision 27: a rectangle in the window's CSS pixels in window points. Each edge is multiplied and rounded to a point
// and the size is the difference, so two rectangles that touch in CSS pixels touch in points. At 1 a whole-pixel
// rectangle is itself.
export function toPoints(rect: Rect, factor: number): Rect {
  const x = Math.round(rect.x * factor);
  const y = Math.round(rect.y * factor);
  return { x, y, width: Math.round((rect.x + rect.width) * factor) - x, height: Math.round((rect.y + rect.height) * factor) - y };
}

// Placement 5: the traffic lights stay centred in the toolbar's 44 CSS pixels (`--toolbar-h`), whose centre is 22 × the
// factor points down; the buttons are 14 points high. At 1 they stand where C5 put them, { x: 16, y: 15 }.
export function trafficLightsAt(factor: number): { x: number; y: number } {
  return { x: 16, y: Math.round(22 * factor - 7) };
}

// What S3 needs of an app window (a BrowserWindow).
export interface ZoomWindow {
  webContents: Pick<WebContents, 'setZoomFactor' | 'isDestroyed'>;
  contentView: { children: readonly unknown[] };
  isDestroyed(): boolean;
  setWindowButtonPosition(position: { x: number; y: number }): void;
}

export interface ZoomDeps {
  layout: Pick<LayoutStore, 'get' | 'publish'>;
  windows(): readonly ZoomWindow[]; // the app windows (`appWindows`)
  placeAgain(win: ZoomWindow): void; // S3 step 4: the in-app browser's views of the window at the new factor; its popup closes
  emit(name: 'layout.zoomChanged', payload: { factor: number }): void;
  register: typeof registerMainHandler;
}

let bound: Pick<ZoomDeps, 'layout' | 'windows'> | null = null;
const factorNow = () => (bound ? readFactor(bound.layout.get(ZOOM_KEY)) : 1);

// The factor of the app window that hosts these contents, its own page or a view attached to it; 1 for any other.
export function zoomOf(contents: WebContents): number {
  const hosted = bound?.windows().some((win) => !win.isDestroyed() && (win.webContents === contents || win.contentView.children.some((child) => (child as { webContents?: unknown }).webContents === contents)));
  return hosted ? factorNow() : 1;
}

// The web preferences that put a window being made at the stored factor before it is first shown (M1's row f, f1).
export function openAt(): { zoomMode: 'isolated'; zoomFactor: number } {
  return { zoomMode: 'isolated', zoomFactor: factorNow() };
}

// `layout.zoom`, in S3's order: the next factor from the stored one; the key published (a write that throws leaves
// everything as it was, and the command answers the error); the factor on every app window's page; each window's lights
// and its browser placements again; the event to every app page; the answer. Commands are handled in order, so two
// presses are two steps.
export function startZoom(deps: ZoomDeps): void {
  bound = deps;
  const live = () => deps.windows().filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed());
  deps.register('layout.zoom', ({ to }) => {
    const current = factorNow();
    const next = nextFactor(current, to);
    if (next === current) return { factor: current };
    deps.layout.publish(ZOOM_KEY, next === 1 ? null : { version: 1, factor: next });
    const windows = live();
    for (const win of windows) win.webContents.setZoomFactor(next);
    for (const win of windows) {
      win.setWindowButtonPosition(trafficLightsAt(next));
      deps.placeAgain(win);
    }
    deps.emit('layout.zoomChanged', { factor: next });
    return { factor: next };
  });
}
