// P3-E1 M1 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's §1 and Decision Log 10): the
// design's agent-facing index, `project/canvas.json`, `{v: 1, title, boards: {<id>: {x, y, w, h, title?}}, order,
// faces?, designSystems?, dsOverrides?}`: its paths, the model cap E0 measured, the loader and the canonical serializer.
// Every key the manifest carries is kept, at the top and in a board's entry, as C keeps deck.json's; the deck-level
// keys a design shares with a deck (title, faces, designSystems, dsOverrides) are checked by C's own loader. A frame
// outside the cap or of the wrong type is refused naming the board, never clamped; a partial frame loads (the publish
// completes it with its warned defaults). Board files are C's slide dialect, unchanged.
import { DECK_LIMITS, parseDeckJson, type DeckFace } from '../slides/deck';
import { ID_RE } from '../slides/parse';

export const CANVAS_PATH = 'project/canvas.json';
const BOARD_PATH_RE = /^project\/boards\/([^/]+)\.html$/;
/** A board's file path. */
export const boardPath = (id: string): string => `project/boards/${id}.html`;
/** The board id a path names, or null when it is not a board file with a valid id. */
export function boardIdOf(path: string): string | null {
  const id = BOARD_PATH_RE.exec(path)?.[1];
  return id !== undefined && ID_RE.test(id) ? id : null;
}

/**
 * The design's limits (the parent's §1 "Limits"; E0, Decision Log 10): boards per design; a board's side and area in CSS
 * px (above 16,384 a side the capture window cuts a picture silently; 2^26 px is a native bitmap of 256 MiB); the bytes
 * one publish sends (C's).
 */
export const CANVAS_LIMITS = {
  boards: 200,
  side: 16_384,
  area: 2 ** 26,
  publishBytes: DECK_LIMITS.publishBytes,
} as const;

export interface BoardFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const FRAME_KEYS = ['x', 'y', 'w', 'h'] as const;
/** A board's entry: its frame and title, then any key MAWS does not read (kept verbatim). */
export interface CanvasBoard extends Partial<BoardFrame> {
  title?: string;
  [key: string]: unknown;
}
export interface CanvasJson {
  v?: unknown;
  title?: string;
  boards: Record<string, CanvasBoard>;
  /** Board ids back to front (the board list's order). */
  order: string[];
  faces?: Record<string, DeckFace>;
  designSystems?: unknown;
  dsOverrides?: Record<string, string>;
  [key: string]: unknown;
}
export interface CanvasDiagnostic {
  severity: 'warning' | 'note';
  property: string;
  message: string;
}
export type CanvasParse = { ok: true; canvas: CanvasJson; diagnostics: CanvasDiagnostic[] } | { ok: false; problems: string[] };

/** A dictionary with no prototype, so any key (`__proto__` too) is an own key. */
export const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Why a frame (whole or partial) is not one the model holds, one message per broken key: the coordinates are finite
 * numbers, a side is more than 0 and at most `CANVAS_LIMITS.side`, and the area of a whole size at most `.area`. The one
 * check the loader, the publish's merge, the writers and the repair share.
 */
export function frameProblems(board: string, frame: Partial<Record<keyof BoardFrame, unknown>>): string[] {
  const out: string[] = [];
  for (const key of FRAME_KEYS) {
    if (!(key in frame)) continue;
    const v = frame[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) out.push(`board ${board}: ${key} is not a finite number`);
    else if ((key === 'w' || key === 'h') && v <= 0) out.push(`board ${board}: ${key} is ${v} (a side is more than 0 px)`);
    else if ((key === 'w' || key === 'h') && v > CANVAS_LIMITS.side) out.push(`board ${board}: ${key} is ${v} px (over ${CANVAS_LIMITS.side} px a side)`);
  }
  const { w, h } = frame;
  if (out.length === 0 && typeof w === 'number' && typeof h === 'number' && w * h > CANVAS_LIMITS.area) out.push(`board ${board}: ${w}×${h} is ${w * h} px (over ${CANVAS_LIMITS.area} px)`);
  return out;
}

/** Load `project/canvas.json`. A malformed manifest, board entry or frame refuses it whole, naming each problem. */
export function parseCanvasJson(text: string): CanvasParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, problems: [`${CANVAS_PATH} is not JSON: ${(e as Error).message}`] };
  }
  if (!isRecord(raw)) return { ok: false, problems: [`${CANVAS_PATH} is not a JSON object`] };
  const problems: string[] = [];
  const diagnostics: CanvasDiagnostic[] = [];
  const canvas: CanvasJson = Object.assign(dict<unknown>(), { boards: dict<CanvasBoard>(), order: [] as string[] });

  const boards = Object.hasOwn(raw, 'boards') ? raw.boards : {};
  if (!isRecord(boards)) problems.push('boards is not an object of board id → {x, y, w, h, title?}');
  else {
    const n = Object.keys(boards).length;
    if (n > CANVAS_LIMITS.boards) problems.push(`${CANVAS_PATH} names ${n} boards (over ${CANVAS_LIMITS.boards})`);
    else
      for (const [id, entry] of Object.entries(boards)) {
        if (!ID_RE.test(id)) problems.push(`board id "${id}" is not [A-Za-z0-9_-]{1,64}`);
        else if (!isRecord(entry)) problems.push(`board ${id}: an entry is an object {x, y, w, h, title?}`);
        else {
          const found = frameProblems(id, entry);
          if (entry.title !== undefined && typeof entry.title !== 'string') found.push(`board ${id}: title is not a string`);
          problems.push(...found);
          canvas.boards[id] = Object.assign(dict<unknown>(), entry) as CanvasBoard;
        }
      }
  }

  const order = Object.hasOwn(raw, 'order') ? raw.order : [];
  if (!Array.isArray(order)) problems.push('order is not a list of board ids');
  else {
    const seen = new Set<string>();
    for (const id of order as unknown[]) {
      if (typeof id !== 'string' || !ID_RE.test(id)) diagnostics.push({ severity: 'warning', property: 'order', message: `${JSON.stringify(id)} is not a board id; dropped` });
      else if (seen.has(id)) diagnostics.push({ severity: 'warning', property: 'order', message: `board ${id} is listed twice; the second dropped` });
      else {
        seen.add(id);
        canvas.order.push(id);
      }
    }
  }
  if (Object.hasOwn(raw, 'sections')) problems.push('sections is a deck’s outline; a design has none');
  if (problems.length > 0) return { ok: false, problems };

  // the keys a design shares with a deck, checked by C's loader (an entry breaking its rule dropped with a warning)
  const shared = dict<unknown>();
  for (const key of DECK_SHARED) if (Object.hasOwn(raw, key)) shared[key] = raw[key];
  const deck = parseDeckJson(JSON.stringify(shared));
  if (!deck.ok) return { ok: false, problems: deck.problems.map((p) => p.replace('project/deck.json', CANVAS_PATH)) };
  diagnostics.push(...deck.diagnostics);
  for (const key of DECK_SHARED) if (deck.deck[key] !== undefined) (canvas as Record<string, unknown>)[key] = deck.deck[key];

  for (const [key, value] of Object.entries(raw)) if (!KNOWN.has(key)) canvas[key] = value; // v and every key MAWS does not read
  return { ok: true, canvas, diagnostics };
}
const DECK_SHARED = ['title', 'faces', 'designSystems', 'dsOverrides'] as const;
const KNOWN = new Set<string>(['boards', 'order', ...DECK_SHARED]);

/** The manifest's key order, then every other key sorted; a board's frame, its title, then its other keys sorted. */
const CANVAS_KEYS = ['v', 'title', 'boards', 'order', 'faces', 'designSystems', 'dsOverrides'];
const BOARD_KEYS = [...FRAME_KEYS, 'title'];
const FACE_KEYS = ['family', 'href', 'src', 'google']; // P4-B2 D19: the host's record last, as deck.json writes it
const rank = (key: string, order: readonly string[]) => (order.includes(key) ? order.indexOf(key) : order.length);
const byRank = (order: readonly string[]) => (a: string, b: string) => rank(a, order) - rank(b, order) || (a < b ? -1 : a > b ? 1 : 0);
function ordered<T>(value: Record<string, T>, keys: string[]): Record<string, T> {
  const out = dict<T>();
  for (const key of keys) out[key] = value[key]!;
  return out;
}

/** The manifest's canonical file: a fixed point of `serializeCanvasJson(parseCanvasJson(x).canvas)` after one pass. */
export function serializeCanvasJson(canvas: CanvasJson): string {
  const at = new Map(canvas.order.map((id, i) => [id, i]));
  const boardIds = Object.keys(canvas.boards).sort((a, b) => (at.get(a) ?? Infinity) - (at.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0));
  const boards = dict<unknown>();
  for (const id of boardIds) {
    const entry = canvas.boards[id]!;
    boards[id] = ordered(entry, Object.keys(entry).filter((k) => entry[k] !== undefined).sort(byRank(BOARD_KEYS)));
  }
  const out: Record<string, unknown> = Object.assign(dict<unknown>(), canvas, { boards });
  if (canvas.faces) {
    const faces = dict<unknown>();
    for (const key of Object.keys(canvas.faces).sort()) faces[key] = ordered(canvas.faces[key]!, Object.keys(canvas.faces[key]!).sort(byRank(FACE_KEYS)));
    out.faces = faces;
  }
  if (canvas.dsOverrides) out.dsOverrides = ordered(canvas.dsOverrides, Object.keys(canvas.dsOverrides).sort());
  return JSON.stringify(ordered(out, Object.keys(out).filter((k) => out[k] !== undefined).sort(byRank(CANVAS_KEYS))), null, 2) + '\n';
}
