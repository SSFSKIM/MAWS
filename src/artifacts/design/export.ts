// P3-E1 M5 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M5; the parent's §1 "Export", XE9 and Decision
// Logs 10 and 26): what a design's PNG and PDF export draws, decided before any window opens. Main's exporter
// (src/main/design/export.ts) reads the state through the design model (`withDesignModel`, so a retained legacy state is
// projected, never migrated) and materializes it here at once, then awaits its system and assets.
//
// - The boards as C's standalone page draws them: C's `exportDeckOf` over the model, each slide at its board's manifest
//   size (its node's `w`/`h`), whatever width or height its section's own style says.
// - A PNG is one board (`board`, the first in order by default) at native size, at `scale`, or at a `width` or `height`
//   keeping its shape; a side over the picture cap (8,192 px) refuses `exportTooLarge {board, w, h, maxScale}`, the
//   largest scale that fits, never a crop or a clamp.
// - A PDF is one page per selected board (`boards`, all in order by default; named boards in the order named), each its
//   board's size at the scale; a page side over 19,200 px (14,400 pt, the readers' limit) refuses the same way, naming
//   the largest board, with the scale that fits every page. Never Letter: a paper size refuses.
// - The selection is checked by name before C's page filters could leave a board out (a hidden board is still drawn):
//   an unknown board refuses `notFound`, an empty or repeated selection `invalid`, and so does a board that cannot be
//   drawn as it is (held, its file never arrived, its frame unreadable), never another board in its place.
// - A scaled draw zooms each board's frame (content and box together) and, in print, gives each its page at the scaled
//   size: CSS the design writes after C's page (`PageOptions.extraCss`), so the measure stays at native size.
// Portable: no window, no Electron, no Node.
import { heldOf } from '../slides/model';
import { exportDeckOf, type ExportDeck } from '../slides/export/standalone';
import type { Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { boardFrame, isMissingSource } from './model';

/** The export limits (the parent's §1 "Limits" and XE9); `pngSide` is the schema's EXPORT_SIZE_MAX. */
export const DESIGN_EXPORT_LIMITS = { pngSide: 8_192, pdfSide: 19_200, scaleMin: 0.1, scaleMax: 4 } as const;

export interface DesignExportBoard {
  id: string;
  title: string | null;
  /** The board's size; 0 when its frame is unreadable (`frame` false). */
  w: number;
  h: number;
  frame: boolean;
  /** Why the board's file is held (its markup did not load), null when it loads. */
  held: string[] | null;
  /** The manifest names the board but its file never arrived. */
  missing: boolean;
}

export interface DesignExportSource {
  /** C's export deck of the whole design, every slide sized. */
  deck: ExportDeck;
  /** Its boards in order. */
  boards: DesignExportBoard[];
}

export interface DesignExportRequest {
  format: 'png' | 'pdf';
  board?: string;
  boards?: readonly string[];
  scale?: number;
  width?: number;
  height?: number;
  pageSize?: string;
}

export interface DesignExportRefusal {
  reason: 'notFound' | 'invalid' | 'exportTooLarge';
  data: Record<string, unknown>;
  message: string;
}

export type DesignExportPlan =
  | { ok: true; format: 'png'; deck: ExportDeck; board: DesignExportBoard; scale: number; width: number; height: number }
  | { ok: true; format: 'pdf'; deck: ExportDeck; boards: DesignExportBoard[]; scale: number }
  | { ok: false; refusal: DesignExportRefusal };

/** The design's boards as an export reads them; synchronous, so the caller can free a temporary model at once. */
export function designExportOf(model: Doc, fallbackTitle: string): DesignExportSource {
  const deck = exportDeckOf(model, fallbackTitle);
  const boards = deck.slides.map((slide): DesignExportBoard => {
    const frame = boardFrame(model, slide.id);
    const title = Y.slideScalars(model, slide.id).title;
    return { id: slide.id, title: typeof title === 'string' ? title : null, w: frame?.w ?? 0, h: frame?.h ?? 0, frame: frame !== null, held: heldOf(model, slide.id)?.reasons ?? null, missing: isMissingSource(model, slide.id) };
  });
  return { deck, boards };
}

/** The largest scale (to four places, at most 4) at which the board's longer side stays within `side` px. */
export function fittingScale(w: number, h: number, side: number): number {
  return Math.min(DESIGN_EXPORT_LIMITS.scaleMax, Math.floor((side / Math.max(w, h)) * 10_000) / 10_000);
}

const px = (v: number) => Math.max(1, Math.round(v));
const fail = (reason: DesignExportRefusal['reason'], data: Record<string, unknown>, message: string): DesignExportPlan => ({ ok: false, refusal: { reason, data, message } });
const inRange = (scale: number) => scale >= DESIGN_EXPORT_LIMITS.scaleMin && scale <= DESIGN_EXPORT_LIMITS.scaleMax;

/** Why a selected board cannot be drawn as it is, or null. */
function undrawable(board: DesignExportBoard): DesignExportPlan | null {
  if (board.held) return fail('invalid', { board: board.id, held: board.held }, `board ${board.id} is held (its file did not load: ${board.held.join('; ')}); publish a board file that loads, or leave the board out`);
  if (board.missing) return fail('invalid', { board: board.id, missingSource: true }, `board ${board.id} has no file yet (the manifest names it); publish its file, or leave the board out`);
  if (!board.frame) return fail('invalid', { board: board.id }, `board ${board.id} has no readable size`);
  return null;
}

/** C's deck holding only `boards`, in their order. */
const deckOf = (source: DesignExportSource, boards: readonly DesignExportBoard[]): ExportDeck => ({ ...source.deck, slides: boards.map((b) => source.deck.slides.find((s) => s.id === b.id)!) });

/**
 * A scale at which the board's sides round to exactly `width` and `height` (`px`'s rounding), or null when none does.
 * Each side admits the scales of its rounding, from (side − 0.5)/length (included) to (side + 0.5)/length (excluded);
 * the scale is taken from both sides' interval intersected with the scale range (both ends included, P3-F L227): a
 * side's own ratio when it serves both and is in range, else the intersection's middle, else its ends. Only when no
 * scale in range serves both is a scale outside the range answered (so the caller refuses it for the range, as it does
 * a single side), and null when no scale at all serves both.
 */
function commonScale(board: Pick<DesignExportBoard, 'w' | 'h'>, width: number, height: number): number | null {
  const fits = (s: number) => px(board.w * s) === width && px(board.h * s) === height;
  const lo = Math.max((width - 0.5) / board.w, (height - 0.5) / board.h);
  const hi = Math.min((width + 0.5) / board.w, (height + 0.5) / board.h);
  const own = [width / board.w, height / board.h];
  const from = Math.max(lo, DESIGN_EXPORT_LIMITS.scaleMin);
  const to = Math.min(hi, DESIGN_EXPORT_LIMITS.scaleMax);
  const inside = [...own, (from + to) / 2, from, to].find((s) => inRange(s) && fits(s));
  if (inside !== undefined) return inside;
  return [...own, (lo + hi) / 2].find(fits) ?? null;
}

function planPng(source: DesignExportSource, request: DesignExportRequest): DesignExportPlan {
  if (request.boards !== undefined) return fail('invalid', { boards: request.boards }, 'a PNG pictures one board: name it with board (boards selects a PDF’s pages)');
  if (source.boards.length === 0) return fail('invalid', { boards: 0 }, 'the design has no board to picture');
  const board = request.board === undefined ? source.boards[0]! : source.boards.find((b) => b.id === request.board);
  if (!board) return fail('notFound', { board: request.board }, `the design has no board ${request.board}`);
  const cannot = undrawable(board);
  if (cannot) return cannot;
  const { scale, width, height } = request;
  let s: number;
  let out: { w: number; h: number };
  if (scale !== undefined) {
    s = scale;
    out = { w: px(board.w * s), h: px(board.h * s) };
    if ((width !== undefined && width !== out.w) || (height !== undefined && height !== out.h)) {
      return fail('invalid', { board: board.id, scale, ...(width !== undefined && { width }), ...(height !== undefined && { height }) }, `board ${board.id} at scale ${scale} is ${out.w}×${out.h} px, not the ${width ?? out.w}×${height ?? out.h} asked; give a scale or a size, not both`);
    }
  } else if (width !== undefined && height !== undefined) {
    // both sides: one scale must round to each exactly (M5 fix wave: never a pixel of distortion)
    const common = commonScale(board, width, height);
    if (common === null) return fail('invalid', { board: board.id, width, height }, `board ${board.id} is ${board.w}×${board.h} px; no one scale draws it at ${width}×${height} (a PNG keeps the board’s shape: give the width or the height alone)`);
    s = common;
    out = { w: width, h: height };
  } else if (width !== undefined || height !== undefined) {
    s = width !== undefined ? width / board.w : height! / board.h;
    out = { w: width ?? px(board.w * s), h: height ?? px(board.h * s) };
  } else {
    s = 1;
    out = { w: px(board.w), h: px(board.h) };
  }
  if (!inRange(s)) return fail('invalid', { board: board.id, scale: s }, `board ${board.id} would be drawn at scale ${s}, outside ${DESIGN_EXPORT_LIMITS.scaleMin} to ${DESIGN_EXPORT_LIMITS.scaleMax}`);
  const cap = DESIGN_EXPORT_LIMITS.pngSide;
  if (out.w > cap || out.h > cap) {
    const maxScale = fittingScale(board.w, board.h, cap);
    const at = s === 1 && scale === undefined && width === undefined && height === undefined ? 'at native size' : `at scale ${Math.round(s * 10_000) / 10_000}`;
    return fail('exportTooLarge', { board: board.id, w: board.w, h: board.h, maxScale }, `board ${board.id} is ${board.w}×${board.h} px, ${at} a ${out.w}×${out.h} px PNG, over the ${cap} px a side a PNG can be; export it at scale ${maxScale} or less (${px(board.w * maxScale)}×${px(board.h * maxScale)} px)`);
  }
  return { ok: true, format: 'png', deck: deckOf(source, [board]), board, scale: s, width: out.w, height: out.h };
}

function planPdf(source: DesignExportSource, request: DesignExportRequest): DesignExportPlan {
  if (request.board !== undefined) return fail('invalid', { board: request.board }, 'a PDF takes boards, a list (board names a PNG’s one board)');
  if (request.width !== undefined || request.height !== undefined) return fail('invalid', { ...(request.width !== undefined && { width: request.width }), ...(request.height !== undefined && { height: request.height }) }, 'width and height size a PNG; a PDF’s pages are its boards’ sizes, at scale');
  let boards: DesignExportBoard[];
  if (request.boards === undefined) {
    if (source.boards.length === 0) return fail('invalid', { boards: 0 }, 'the design has no board to print');
    boards = source.boards;
  } else {
    if (request.boards.length === 0) return fail('invalid', { boards: [] }, 'boards names no board; leave it out to print every board');
    boards = [];
    for (const id of request.boards) {
      if (boards.some((b) => b.id === id)) return fail('invalid', { board: id }, `boards names board ${id} twice`);
      const board = source.boards.find((b) => b.id === id);
      if (!board) return fail('notFound', { board: id }, `the design has no board ${id}`);
      boards.push(board);
    }
  }
  for (const board of boards) {
    const cannot = undrawable(board);
    if (cannot) return cannot;
  }
  const scale = request.scale ?? 1;
  if (!inRange(scale)) return fail('invalid', { scale }, `scale ${scale} is outside ${DESIGN_EXPORT_LIMITS.scaleMin} to ${DESIGN_EXPORT_LIMITS.scaleMax}`);
  const cap = DESIGN_EXPORT_LIMITS.pdfSide;
  const largest = boards.reduce((a, b) => (Math.max(b.w, b.h) > Math.max(a.w, a.h) ? b : a));
  if (Math.max(largest.w, largest.h) * scale > cap) {
    const maxScale = fittingScale(largest.w, largest.h, cap);
    return fail('exportTooLarge', { board: largest.id, w: largest.w, h: largest.h, maxScale }, `board ${largest.id} is ${largest.w}×${largest.h} px; at scale ${scale} its page would be over the ${cap} px a side a PDF page can be (14,400 pt); export the PDF at scale ${maxScale} or less`);
  }
  return { ok: true, format: 'pdf', deck: deckOf(source, boards), boards, scale };
}

/** What `request` draws of `source`, or why it is refused (before any window opens). */
export function planDesignExport(source: DesignExportSource, request: DesignExportRequest): DesignExportPlan {
  if (request.pageSize !== undefined) return fail('invalid', { pageSize: request.pageSize }, 'a design is never fitted to paper: its pages are its boards’ sizes (pageSize does not apply)');
  if (request.scale !== undefined && !inRange(request.scale)) return fail('invalid', { scale: request.scale }, `scale ${request.scale} is outside ${DESIGN_EXPORT_LIMITS.scaleMin} to ${DESIGN_EXPORT_LIMITS.scaleMax}`);
  return request.format === 'png' ? planPng(source, request) : planPdf(source, request);
}

const cssNumber = (v: number) => String(Math.round(v * 10_000) / 10_000);
const cssString = (v: string) => `"${v.replace(/["\\]/g, (c) => `\\${c}`)}"`;

/**
 * The scaled draw, written after C's page: each board's frame zoomed (its content and its box together); in `print`
 * each frame on a page of its own at the scaled size, named after its place in the selection. Nothing at scale 1.
 */
export function scaledDrawCss(boards: readonly Pick<DesignExportBoard, 'id' | 'w' | 'h'>[], scale: number, print: boolean): string {
  if (scale === 1) return '';
  const frames = boards.map((b, i) => `.maws-frame[data-frame=${cssString(b.id)}] { zoom: ${cssNumber(scale)};${print ? ` page: design-${i};` : ''} }`);
  const pages = print ? boards.map((b, i) => `@page design-${i} { size: ${cssNumber(b.w * scale)}px ${cssNumber(b.h * scale)}px; margin: 0; }`) : [];
  return [...frames, ...pages].join('\n');
}
