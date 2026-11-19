// U12a (the UX wave's U12, l9-browser-delivery-06; Interfaces §D): the one sum behind a device size, read by the pane
// (which sizes the page's element, and so the view), the options menu (which sizes fit) and the chip (what the page reads),
// so the three cannot disagree. A size is in the page's CSS pixels; at a page zoom of z the element is z times as large,
// cut to the room the pane has. The room is one mount's: the page box of the pane that holds the view. UX wave U6b-5b
// (decision 35): the element and the room are in the window's CSS pixels, which the app window's zoom a makes a points
// each, so the element is the size times z ÷ a; the page's element is rounded to a whole CSS pixel, so at a = 2 a size of
// an odd width reads one pixel over (375 is 188 CSS pixels, 376 points), and the chip says what the page reads.
import type { BrowserViewport } from '@shared/browser/tab';

export interface Room {
  width: number;
  height: number;
}

export interface PageBox {
  width: number;
  height: number;
  reads: { width: number; height: number }; // the page's own size (its `innerWidth` and `innerHeight`)
}

/** The page element's size in the window's CSS pixels for a device size, and what the page then reads as its size, at
 *  the tab's zoom and the app window's (`app`). width = min(round(viewport.width * zoom / app), room.width), and the same
 *  for height; reads = each side times app / zoom, rounded. Null for Responsive, where the element fills its room. */
export function pageBox(viewport: BrowserViewport | null, zoom: number, room: Room, app: number): PageBox | null {
  if (viewport === null) return null;
  const width = Math.min(Math.round((viewport.width * zoom) / app), room.width);
  const height = Math.min(Math.round((viewport.height * zoom) / app), room.height);
  return { width, height, reads: { width: Math.round((width * app) / zoom), height: Math.round((height * app) / zoom) } };
}

/** Whether a device size's width fits the room now: viewport.width * zoom / app <= room.width. */
export function fits(viewport: BrowserViewport, zoom: number, room: Room, app: number): boolean {
  return (viewport.width * zoom) / app <= room.width;
}
