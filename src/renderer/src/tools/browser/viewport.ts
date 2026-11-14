// U12a (the UX wave's U12, l9-browser-delivery-06; Interfaces §D): the one sum behind a device size, read by the pane
// (which sizes the page's element, and so the view), the options menu (which sizes fit) and the chip (what the page reads),
// so the three cannot disagree. A size is in the page's CSS pixels; at a page zoom of z the element is z times as large,
// cut to the room the pane has. The room is one mount's: the page box of the pane that holds the view.
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

/** The page element's size in the pane's own pixels for a device size, and what the page then reads as its size.
 *  width = min(round(viewport.width * zoom), room.width), and the same for height; reads = each side divided by
 *  zoom, rounded. Null for Responsive, where the element fills its room as today. */
export function pageBox(viewport: BrowserViewport | null, zoom: number, room: Room): PageBox | null {
  if (viewport === null) return null;
  const width = Math.min(Math.round(viewport.width * zoom), room.width);
  const height = Math.min(Math.round(viewport.height * zoom), room.height);
  return { width, height, reads: { width: Math.round(width / zoom), height: Math.round(height / zoom) } };
}

/** Whether a device size's width fits the room now: viewport.width * zoom <= room.width. */
export function fits(viewport: BrowserViewport, zoom: number, room: Room): boolean {
  return viewport.width * zoom <= room.width;
}
