// U12a (the UX wave's U12, l9-browser-delivery-06; Interfaces §D): the one sum behind a device size, read by the pane
// (which sizes the page's element, and so the view), the options menu (which sizes fit) and the chip (what the page reads),
// so the three cannot disagree. A size is in the page's CSS pixels; at a page zoom of z the element is z times as large,
// cut to the room the pane has. The room is one mount's: the page box of the pane that holds the view. UX wave U6b-5b
// (decision 35): the element and the room are in the window's CSS pixels, which the app window's zoom a makes a points
// each, so the element is the size times z ÷ a; the page's element is rounded to a whole CSS pixel, so at a = 2 a size of
// an odd width reads one pixel over (375 is 188 CSS pixels, 376 points), and the chip says what the page reads. Main places
// the view edge by edge (decision 27: each edge times a, rounded), so what the page reads depends on where the element
// sits too: the room carries the element's rect as the pane last sent it to main (`placed`), both edges (the branch
// review, scalpel-3#2). The page reads its size as Blink does (scalpel-3#1; `innerSize` below), which needs the display's
// device pixels per point (`scale`).
import type { BrowserViewport } from '@shared/browser/tab';

export interface Room {
  width: number;
  height: number;
  placed?: { x: number; y: number; width: number; height: number }; // the page's element as the pane last sent it to main (the window's CSS pixels); absent, the element at the origin
  scale?: number; // the display's device pixels per window point; absent, 1
}

export interface PageBox {
  width: number;
  height: number;
  reads: { width: number; height: number }; // the page's own size (its `innerWidth` and `innerHeight`)
}

// A side's length in points as main places it: its two edges each times the factor, rounded (decision 27's `toPoints`)
const placed = (start: number, end: number, app: number) => Math.round(end * app) - Math.round(start * app);

// What the page reads for a side of `points` window points at the tab's zoom, as Blink computes `innerWidth` and
// `innerHeight`: `LocalDOMWindow::innerWidth` returns `AdjustForAbsoluteZoom::AdjustInt(GetViewportSize().width(),
// GetFrame()->LayoutZoomFactor())` (third_party/blink/renderer/core/frame/local_dom_window.cc), the frame's size in device
// pixels over the layout zoom, which is the display's scale times the tab's zoom, in floats
// (`WebFrameWidgetImpl::SetZoomLevel`, core/frame/web_frame_widget_impl.cc). `AdjustInt(int value, float zoom_factor)`
// (third_party/blink/renderer/core/layout/adjust_for_absolute_zoom.h) adds 0.5 to the value when the zoom is over 1 and
// returns `RoundForImpreciseConversion<int>(fvalue / zoom_factor)`, which adds 0.01 and truncates
// (core/css/css_primitive_value.h). Read at Chromium 152.0.7977.130, Electron 44.4.5's. At a zoom of exactly 1 the value
// is returned as it is.
function innerSize(points: number, zoom: number, scale: number): number {
  const value = Math.round(points * scale);
  const factor = Math.fround(Math.fround(scale) * Math.fround(zoom));
  if (factor === 1) return value;
  const fvalue = Math.fround(factor > 1 ? value + 0.5 : value);
  return Math.trunc(Math.fround(fvalue / factor) + 0.01);
}

/** The page element's size in the window's CSS pixels for a device size, and what the page then reads as its size, at
 *  the tab's zoom and the app window's (`app`). width = min(round(viewport.width * zoom / app), room.width), and the same
 *  for height; reads = each side's placed points (from `room.placed`'s edges) read as Blink reads them (`innerSize`).
 *  Null for Responsive, where the element fills its room. */
export function pageBox(viewport: BrowserViewport | null, zoom: number, room: Room, app: number): PageBox | null {
  if (viewport === null) return null;
  const width = Math.min(Math.round((viewport.width * zoom) / app), room.width);
  const height = Math.min(Math.round((viewport.height * zoom) / app), room.height);
  const at = room.placed ?? { x: 0, y: 0, width, height };
  const scale = room.scale ?? 1;
  const reads = { width: innerSize(placed(at.x, at.x + sent(at.width, width), app), zoom, scale), height: innerSize(placed(at.y, at.y + sent(at.height, height), app), zoom, scale) };
  return { width, height, reads };
}

// A side of the rect as sent, while it is this element's: its rounded edges are within a pixel of the element's size. A
// rect sent before the element took a new size (a size just chosen, the factor just changed) is the old element's until
// the pane's next report, and the side is then the element's own from the sent origin.
const sent = (side: number, element: number) => (Math.abs(side - element) <= 1 ? side : element);

/** Whether a device size's width fits the room now: viewport.width * zoom / app <= room.width. */
export function fits(viewport: BrowserViewport, zoom: number, room: Room, app: number): boolean {
  return (viewport.width * zoom) / app <= room.width;
}
