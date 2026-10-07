// Comment mode's preload protocol (E4d execution document, Design §3 and §9; Interfaces "comment-protocol.ts"): the two
// channels between main and a browser tab's preload, the messages on them, the caps a pick report is trimmed to before
// it leaves the page, the label a pick shows and sends, and the words the in-page hover UI and the context menu use.
//
// Zod-free and DOM-free: the sandboxed browser preload bundles it alone, so it imports nothing the app preload reaches
// (`@shared/ipc/*`) and no zod, or Rollup would split a shared chunk (`src/preload/bundle.test.ts`). Main's schema for
// the report is `comment.ts`'s `PickReportSchema`.
import { A11Y_PATH_MAX, A11Y_SEGMENT_NAME_MAX, CSS_PATH_MAX, fit, fitEnd, oneLine, type ElementDescription } from './describe';

export { A11Y_SEGMENT_NAME_MAX, CSS_PATH_MAX, fit, oneLine };

// `browser:preload:*` (E4a Design §14): main accepts a message on `fromPreload` only from a tab's own webContents.
export const COMMENT_CHANNEL = { toPreload: 'browser:preload:comment', fromPreload: 'browser:preload:pick' } as const;

export type ToPreload =
  | { type: 'arm'; epoch: number }
  | { type: 'disarm' }
  // the context menu's one-shot pick at a point, in CSS px of the viewport; no hover UI
  | { type: 'pickAt'; x: number; y: number; requestId: string; epoch: number };

export type PickRect = { x: number; y: number; width: number; height: number };

// The preload's one message per arm (or per `pickAt`): geometry and names only. `rect` is the picked element's (the
// marquee for an area) in CSS px of the viewport, re-measured after the hover UI is hidden; `requestId` is the
// `pickAt`'s, null for an armed pick.
export type PickReport = {
  type: 'picked';
  epoch: number;
  requestId: string | null;
  mode: 'click' | 'area';
  description: ElementDescription;
  nameOverLong: boolean;
  rect: PickRect;
  scroll: { x: number; y: number };
  viewport: { width: number; height: number };
};
// A pick the preload could not name: no css within `CSS_PATH_MAX` (`tooDeep`), nothing at a `pickAt` point (`noElement`).
export type PickRefused = { type: 'refused'; epoch: number; requestId: string | null; reason: 'tooDeep' | 'noElement' };
// The arm's acknowledgement: the shield is in the page. Main counts the tab armed only from here (Decision Log 34), so a
// page with no preload (an adopted `window.open` tab) is never shown as armed.
export type PickArmed = { type: 'armed'; epoch: number };
export type PreloadMessage = PickReport | PickRefused | PickArmed;

export const REPORT_NAME_MAX = 200; // X10's label cap; a longer name is cut and flagged, and the anchor omits it
export const REPORT_A11Y_MAX = A11Y_PATH_MAX; // 300: page text in the person's prompt, kept small (Design §9)
export const REPORT_TOKEN_MAX = 64; // `role` (E4c's cap) and `tag`
export const DRAG_THRESHOLD_PX = 6; // a pointer moved further with the button down is an area pick
export const PICK_AT_MS = 2000; // how long main waits for the report a `pickAt` asked for
export const ARM_ACK_MS = 2000; // how long main waits for the arm's acknowledgement (the preload shares the page's main thread)

// The description bounded to the report's caps, so a long page string never makes a legitimate pick fail main's schema.
export function trimDescription(description: ElementDescription): { description: ElementDescription; nameOverLong: boolean } {
  const nameOverLong = description.name.length > REPORT_NAME_MAX;
  return {
    description: {
      ...description,
      role: description.role === null ? null : fit(description.role, REPORT_TOKEN_MAX),
      name: fit(description.name, REPORT_NAME_MAX),
      a11y: fitEnd(description.a11y, REPORT_A11Y_MAX),
      tag: fit(description.tag, REPORT_TOKEN_MAX),
    },
    nameOverLong,
  };
}

// `<role> “<name>”`, the tag standing in for a missing role and the name cut to fit `max`; the role or tag alone when
// the name is empty. Curly quotes, so E3's lead (`Comment on "<label>"`) reads cleanly (Decision Log 7). The badge uses
// it at 40, the anchor's label at 200.
export function elementLabel(description: Pick<ElementDescription, 'role' | 'name' | 'tag'>, max: number): string {
  const head = description.role ?? description.tag;
  const room = max - head.length - 3; // the space and the two quotes
  if (description.name === '' || room < 2) return fit(head, max);
  return `${head} “${fit(description.name, room)}”`;
}

// MAWS's own nodes in the page, each carrying the marker attribute so a hit test can skip them.
export const COMMENT_NODES = { shield: 'maws-comment-shield', overlay: 'maws-comment-overlay', badge: 'maws-comment-badge', marker: 'data-maws-comment' } as const;

// The words main's context menu and the preload's badge show (the renderer's `COMMENT_COPY` re-exports them).
export const COMMENT_WORDS = { menu: 'Comment', hint: 'Click to comment · drag for an area · Esc leaves' } as const;
