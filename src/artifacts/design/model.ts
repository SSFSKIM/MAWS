// P3-E1 M1 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's §1 "The model", Decision Log 10,
// 11 (3) and 13): the design model on C's roots, verbatim. `deck` holds the manifest's keys (`faces` and `dsOverrides` as
// C's nested maps, so C's Theme menu and overrides work unchanged); `slides` holds the boards, each C's slide node with
// four plain scalar keys `x`, `y`, `w`, `h` (never `attr:*`, so the dialect's attribute space is untouched), an optional
// `title`, any other key of the board's manifest entry as `canvas:<key>` (its JSON text), and C's `notes` and `elements`;
// `threads` holds the comments. Undo, history, restore and anchors are C's over these roots, so a board move is one more
// key change to them. A board the manifest names whose file never arrived carries the missing-source marker (Decision Log
// 11 (3)): the model keeps what it has, no HTML is invented, and the file's arrival clears it. Yjs only through the seam.
import { slideFile, slideOrder } from '../slides/model';
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { boardPath, CANVAS_LIMITS, CANVAS_PATH, dict, FRAME_KEYS, frameProblems, serializeCanvasJson, type BoardFrame, type CanvasBoard, type CanvasJson } from './canvas';

/** The slide key marking a board the manifest names but whose file the design never received. */
export const MISSING_SOURCE_KEY = 'missingSource';
/** The prefix of a board node's key holding a manifest entry's key MAWS does not read. */
export const EXTRA_PREFIX = 'canvas:';
/** A board with no size of its own (no manifest size, no `data-size`) takes the slide's (the parent's §1). */
export const DEFAULT_SIZE = { w: 1920, h: 1080 } as const;
/** The gap a defaulted board leaves after the right-most board. */
export const PLACEMENT_GAP = 100;

const DECK_MAPS = ['faces', 'dsOverrides'] as const;

/** Board ids in manifest order, back to front (C's slide order: by fractional `order`, then id). */
export const boardOrder = slideOrder;

export const isMissingSource = (doc: Doc, id: string): boolean => Y.hasSlide(doc, id) && Y.slideScalars(doc, id)[MISSING_SOURCE_KEY] === true;

/** A board's frame when its four keys are numbers, else null (the repair completes a partial one). */
export function boardFrame(doc: Doc, id: string): BoardFrame | null {
  if (!Y.hasSlide(doc, id)) return null;
  const s = Y.slideScalars(doc, id);
  const [x, y, w, h] = FRAME_KEYS.map((k) => s[k]);
  return typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number' ? { x, y, w, h } : null;
}

/** A board's manifest entry as the model holds it: the frame keys and title present, then its kept keys. */
export function boardEntry(doc: Doc, id: string): CanvasBoard {
  const s = Y.slideScalars(doc, id);
  const entry = dict<unknown>() as CanvasBoard;
  for (const k of FRAME_KEYS) if (s[k] !== undefined) entry[k] = s[k] as number;
  if (s.title !== undefined) entry.title = s.title as string;
  for (const [k, v] of Object.entries(s)) {
    if (!k.startsWith(EXTRA_PREFIX) || typeof v !== 'string') continue;
    try {
      entry[k.slice(EXTRA_PREFIX.length)] = JSON.parse(v) as unknown;
    } catch {
      // not a key this module wrote: no entry to read back
    }
  }
  return entry;
}

/** The manifest the model holds: the deck root's keys and maps, every board's entry, the order. */
export function readCanvas(doc: Doc): CanvasJson {
  const canvas = Object.assign(dict<unknown>(), { v: 1 }, Y.deckScalars(doc)) as CanvasJson;
  for (const name of DECK_MAPS) {
    const entries = Y.deckEntries(doc, name);
    if (entries) (canvas as Record<string, unknown>)[name] = entries;
  }
  canvas.order = boardOrder(doc);
  canvas.boards = dict<CanvasBoard>();
  for (const id of canvas.order) canvas.boards[id] = boardEntry(doc, id);
  return canvas;
}

/** The design's files, as `artifact_read` returns them: the manifest, then every board's file in order; none invented. */
export function designFiles(doc: Doc): Record<string, string> {
  const files: Record<string, string> = { [CANVAS_PATH]: serializeCanvasJson(readCanvas(doc)) };
  for (const id of boardOrder(doc)) if (!isMissingSource(doc, id)) files[boardPath(id)] = slideFile(doc, id);
  return files;
}

/** `designFiles`'s paths in its order, without reading a file (A's `paths`, for a publish's `kept` and `removed`). */
export function designPaths(doc: Doc): string[] {
  return [CANVAS_PATH, ...boardOrder(doc).flatMap((id) => (isMissingSource(doc, id) ? [] : [boardPath(id)]))];
}

/** Writes a manifest's deck-level keys into the deck root (inside the caller's transaction); boards and order are not its. */
export function writeCanvasKeys(doc: Doc, canvas: CanvasJson): void {
  for (const [key, value] of Object.entries(canvas)) {
    if (key === 'boards' || key === 'order' || value === undefined) continue;
    if ((DECK_MAPS as readonly string[]).includes(key)) {
      const name = key as (typeof DECK_MAPS)[number];
      Y.ensureDeckMap(doc, name);
      for (const [k, v] of Object.entries(value as Record<string, Y.Json>)) Y.setDeckEntry(doc, name, k, v);
    } else Y.setDeckKey(doc, key, value as Y.Json);
  }
}

/** The node key a manifest entry's key is held under. */
export const entryKey = (key: string): string => ((FRAME_KEYS as readonly string[]).includes(key) || key === 'title' ? key : EXTRA_PREFIX + key);

/** Writes the keys of a board's manifest entry onto its node (inside the caller's transaction); `undefined` removes one. */
export function writeBoardEntry(doc: Doc, id: string, entry: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(entry)) {
    const k = entryKey(key);
    if (value === undefined) Y.deleteSlideKey(doc, id, k);
    else Y.setSlideKey(doc, id, k, k === key ? (value as Y.Json) : JSON.stringify(value));
  }
}

/** Where a board with no position goes: after the right-most of the other boards, a gap apart, at y 0. */
export function placementAfter(doc: Doc, except: Iterable<string> = []): { x: number; y: number } {
  const skip = new Set(except);
  let right: number | null = null;
  for (const id of Y.slideIds(doc)) {
    if (skip.has(id)) continue;
    const s = Y.slideScalars(doc, id);
    if (typeof s.x === 'number' && typeof s.w === 'number' && Number.isFinite(s.x + s.w)) right = Math.max(right ?? -Infinity, s.x + s.w);
  }
  return { x: right === null ? 0 : right + PLACEMENT_GAP, y: 0 };
}

/**
 * The host's repair of board frames (beside C's `repair`, from the adapter's `afterUpdate` alone; the parent's Decision
 * Log 17): a frame concurrency left
 * outside the model's rules is brought back by one deterministic rule, so every replica repairing the same state writes
 * the same values. Every writer refuses an invalid frame, so only merges produce one: two valid writes of `w` and `h`
 * whose product passes the area cap (the height is cut to fit the width), or a key a replica removed or wrote unreadable
 * (the publish's warned defaults: after the right-most board, at y 0, 1920×1080). Returns the number of keys written.
 */
export function repairBoards(doc: Doc, options: { boards?: Iterable<string> } = {}, origin?: unknown): number {
  let writes = 0;
  transact(
    doc,
    () => {
      const ids = [...(options.boards ?? Y.slideIds(doc))].filter((id) => Y.hasSlide(doc, id)).sort();
      for (const id of ids) {
        const s = Y.slideScalars(doc, id);
        const fix: Partial<BoardFrame> = {};
        const readable = (k: keyof BoardFrame) => frameProblems(id, { [k]: s[k] }).length === 0 && s[k] !== undefined;
        if (!readable('w')) fix.w = typeof s.w === 'number' && s.w > CANVAS_LIMITS.side ? CANVAS_LIMITS.side : DEFAULT_SIZE.w;
        if (!readable('h')) fix.h = typeof s.h === 'number' && s.h > CANVAS_LIMITS.side ? CANVAS_LIMITS.side : DEFAULT_SIZE.h;
        const w = fix.w ?? (s.w as number);
        const h = fix.h ?? (s.h as number);
        if (w * h > CANVAS_LIMITS.area) fix.h = Math.floor(CANVAS_LIMITS.area / w);
        if (!readable('x') || !readable('y')) {
          const at = placementAfter(doc, [id]);
          if (!readable('x')) fix.x = at.x;
          if (!readable('y')) fix.y = at.y;
        }
        for (const [k, v] of Object.entries(fix)) {
          Y.setSlideKey(doc, id, k, v);
          writes++;
        }
      }
    },
    origin,
  );
  return writes;
}
