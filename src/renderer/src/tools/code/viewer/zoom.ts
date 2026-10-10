// P2-F W-V (L95, §2 item 6): the sizing of an image or a video in its viewer. Fit, the default, draws the media at its
// largest size inside the pane with its aspect kept, so a small image grows and a large one shrinks; a zoom is a scale
// against the media's natural size (1 is actual size), stepped through a fixed ladder from wherever the view stands.
export interface Size {
  width: number;
  height: number;
}

export type Zoom = 'fit' | number;

export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16] as const;

// A fit that lands within rounding of a rung is on it, so a step from it moves to the next rung, never to itself.
const EPSILON = 1e-3;

export const fitScale = (media: Size, box: Size): number => Math.min(box.width / media.width, box.height / media.height);

export const scaleOf = (zoom: Zoom, media: Size, box: Size): number => (zoom === 'fit' ? fitScale(media, box) : zoom);

export const zoomedIn = (scale: number): number => ZOOM_STEPS.find((step) => step > scale + EPSILON) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];

export const zoomedOut = (scale: number): number => ZOOM_STEPS.findLast((step) => step < scale - EPSILON) ?? ZOOM_STEPS[0];

// Whole pixels, rounded down, so a fit never overflows the pane by a fraction and draws a scrollbar.
export const drawnSize = (media: Size, scale: number): Size => ({ width: Math.floor(media.width * scale), height: Math.floor(media.height * scale) });
