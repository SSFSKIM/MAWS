// P3-E1 M1 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's §1 "Publish", XE6; Decision Log
// 11 (3) and 13 (1)): `artifact_publish`'s write half for a design, on A's `KindAdapter.publish(live, base, sent, force)`.
// The board files go through C's property-level publish (`publishDeck`) under C's slide paths, so an element's property,
// text or place conflicts exactly as on a deck; the manifest is compared here key by key, three-way like C's index: a
// board's `x`, `y`, `w`, `h`, `title` and kept keys, its place in the order (`order.ts`), the deck-level keys and map
// entries. A key the agent did not change (sent = base) is left alone even under force; one it changed applies when live
// still holds the base value, is left alone when live already holds the sent one, and otherwise conflicts naming the
// board and the key; `force` settles exactly the conflicting keys. A frame the merge would leave outside the cap is
// refused even under force. Atomicity (Decision Log 13 (1)): C's publish plans and writes in one private call, so the
// whole publish runs first on a scratch copy of the live state; only a publish that lands there is applied, synchronously
// and in one transaction, to the live state it was planned against, so a refusal anywhere writes nothing.
//
// Absent pieces (the parent's §1): a board whose file came without geometry is placed after the right-most board at its
// `data-size` or 1920×1080, with a warning; a manifest entry with no file is held as a missing-source board (the model
// keeps its frame, no HTML is invented) until its file is published; a board the sent manifest leaves out keeps its
// frame. A board is removed by sending its file as null.
import { FilesError, type FileProblem, type PublishOutcome, type PublishWarning } from '../files';
import { DECK_LIMITS, DECK_PATH, slideIdOf, slidePath } from '../slides/deck';
import { parseHtml } from '../slides/html';
import { deleteSlide, slideFile } from '../slides/model';
import { publishDeck, type DeckPublishOutcome } from '../slides/publish';
import { ANY, rekey } from '../slides/order';
import { applyV2, newDoc, stateV2, transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { boardIdOf, boardPath, CANVAS_LIMITS, CANVAS_PATH, FRAME_KEYS, frameProblems, parseCanvasJson, type BoardFrame, type CanvasBoard, type CanvasJson } from './canvas';
import { boardFrame, DEFAULT_SIZE, isMissingSource, MISSING_SOURCE_KEY, placementAfter, readCanvas, writeBoardEntry } from './model';
import { mergeBoardOrder } from './order';

export interface CanvasPublishOutcome extends PublishOutcome {
  /** The board files the publish created (a subset of `changed`). */
  added: string[];
  warnings: PublishWarning[];
  notes: number;
  /** Sent board files that failed structurally: held with their reasons, nothing trimmed. */
  held: { path: string; reasons: string[] }[];
}

const NOT_DESIGN = 'not a design file: project/canvas.json or project/boards/<id>.html, an id of [A-Za-z0-9_-]{1,64}';
const DECK_MAPS = ['faces', 'dsOverrides'] as const;
const SKIP = new Set<string>(['boards', 'order', ...DECK_MAPS]);

/** Stable JSON: equal by meaning whatever a nested object's key order. */
function stable(v: unknown): string {
  if (v === undefined) return '';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}
const own = (o: object | undefined, key: string): unknown => (o && Object.hasOwn(o, key) ? (o as Record<string, unknown>)[key] : undefined);

const fromDeck = (path: string): string => (path === DECK_PATH ? CANVAS_PATH : slideIdOf(path) !== null ? boardPath(slideIdOf(path)!) : path);
const fromDeckDetail = (detail: string | undefined) => (detail?.startsWith('slide: ') ? `board: ${detail.slice(7)}` : detail);

/** What the publish reads from its arguments alone, checked before anything is planned. */
interface Input {
  sent: Readonly<Record<string, string | null>>;
  base: Readonly<Record<string, string>>;
  sentCanvas: CanvasJson | null;
  baseCanvas: CanvasJson;
  /** Board id → its sent file (null removes it). */
  boards: Map<string, string | null>;
  /** Board id → the size its sent file's `data-size` gives. */
  sizes: Map<string, { w: number; h: number }>;
  warnings: PublishWarning[];
  notes: number;
}

const DATA_SIZE_RE = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/;
function dataSize(id: string, source: string): { w: number; h: number } | null {
  const top = parseHtml(source).find((n) => n.kind === 'element');
  const value = top && top.kind === 'element' && top.tag === 'section' ? new Map(top.attrs).get('data-size') : undefined;
  const m = value === undefined ? null : DATA_SIZE_RE.exec(value);
  if (!m) return null;
  const size = { w: Number(m[1]), h: Number(m[2]) };
  return frameProblems(id, size).length === 0 ? size : null;
}

function prepare(base: Readonly<Record<string, string>>, sent: Readonly<Record<string, string | null>>): Input {
  const problems: FileProblem[] = [];
  const boards = new Map<string, string | null>();
  const sizes = new Map<string, { w: number; h: number }>();
  let bytes = 0;
  for (const path of Object.keys(sent).sort()) {
    const text = sent[path];
    if (typeof text === 'string') bytes += new TextEncoder().encode(text).length;
    const id = boardIdOf(path);
    if (path === CANVAS_PATH) {
      if (text === null) problems.push({ path, message: 'the canvas manifest cannot be removed' });
    } else if (id === null) problems.push({ path, message: NOT_DESIGN });
    else if (text !== undefined) {
      boards.set(id, text);
      const size = text === null ? null : dataSize(id, text);
      if (size) sizes.set(id, size);
    }
  }
  if (bytes > CANVAS_LIMITS.publishBytes) problems.push({ path: CANVAS_PATH, message: `the publish sends ${bytes} bytes (over ${CANVAS_LIMITS.publishBytes})` });
  const warnings: PublishWarning[] = [];
  let notes = 0;
  let sentCanvas: CanvasJson | null = null;
  const text = sent[CANVAS_PATH];
  if (typeof text === 'string' && text !== base[CANVAS_PATH]) {
    const parsed = parseCanvasJson(text);
    if (!parsed.ok) for (const message of parsed.problems) problems.push({ path: CANVAS_PATH, message });
    else {
      sentCanvas = parsed.canvas;
      for (const d of parsed.diagnostics) {
        if (d.severity === 'note') notes++;
        else warnings.push({ path: CANVAS_PATH, property: d.property, message: d.message });
      }
    }
  }
  if (problems.length > 0) throw new FilesError(problems);
  const baseParsed = base[CANVAS_PATH] === undefined ? null : parseCanvasJson(base[CANVAS_PATH]!);
  const baseCanvas: CanvasJson = baseParsed?.ok ? baseParsed.canvas : { boards: {}, order: [] };
  return { sent, base, sentCanvas, baseCanvas, boards, sizes, warnings, notes };
}

/** Plans and writes the whole publish on `doc` (the caller's transaction); a refusal returns its conflicts. */
function apply(doc: Doc, input: Input, force: boolean): CanvasPublishOutcome {
  const { sentCanvas: A, baseCanvas: B } = input;
  const L = readCanvas(doc);
  const live = new Set(Y.slideIds(doc));
  const conflicts: PublishOutcome['conflicts'] = [];
  const unmergeable: PublishOutcome['conflicts'] = [];
  const warnings: PublishWarning[] = [...input.warnings];
  const conflict = (detail: string) => conflicts.push({ path: CANVAS_PATH, detail });
  const warn = (message: string, property?: string) => warnings.push({ path: CANVAS_PATH, ...(property !== undefined && { property }), message });

  // ---- the boards this publish removes, creates, or gives their first file
  const removed = new Set<string>();
  const ownRemovals: string[] = []; // missing-source boards: no file for C to remove
  const deckBase: Record<string, string> = {};
  const deckSent: Record<string, string | null> = {};
  for (const [path, text] of Object.entries(input.base)) if (boardIdOf(path) !== null) deckBase[slidePath(boardIdOf(path)!)] = text;
  const arrivals: string[] = [];
  const fileCreated = new Set<string>();
  for (const [id, text] of input.boards) {
    const read = input.base[boardPath(id)] !== undefined;
    if (text === null) {
      if (!live.has(id) || !(read || Object.hasOwn(B.boards, id))) continue; // not a board the agent read
      removed.add(id);
      const [bb, lb] = [own(B.boards, id) as CanvasBoard | undefined, L.boards[id]!];
      if (bb && !force) for (const key of new Set([...Object.keys(bb), ...Object.keys(lb)])) if (stable(own(bb, key)) !== stable(own(lb, key))) conflict(`board ${id}: ${key} changed since your read`);
      if (read) deckSent[slidePath(id)] = null;
      else ownRemovals.push(id);
      continue;
    }
    deckSent[slidePath(id)] = text;
    if (!live.has(id)) fileCreated.add(id);
    else if (isMissingSource(doc, id)) {
      arrivals.push(id);
      deckBase[slidePath(id)] ??= slideFile(doc, id); // its empty model is what the file replaces
    }
  }

  // ---- the manifest, key by key; every write deferred
  const writes: (() => boolean)[] = [];
  const entries = new Map<string, Record<string, unknown>>(); // board → its keys to write (undefined removes)
  const manifestCreated = new Set<string>();
  const partial = new Map<string, string[]>(); // a created board → the frame keys its entry lacks
  const compare = (vb: unknown, va: unknown, vl: unknown, onConflict: () => void): boolean => {
    const [b, a, l] = [stable(vb), stable(va), stable(vl)];
    if (a === b || a === l) return false;
    if (l !== b && !force) {
      onConflict();
      return false;
    }
    return true;
  };
  if (A) {
    for (const key of new Set([...Object.keys(B), ...Object.keys(A)])) {
      if (SKIP.has(key)) continue;
      const value = own(A, key);
      if (!compare(own(B, key), value, own(L, key), () => conflict(`canvas.json key ${key}: changed since your read`))) continue;
      writes.push(() => (value === undefined ? Y.deleteDeckKey(doc, key) : Y.setDeckKey(doc, key, value as Y.Json), true));
    }
    let faces = Object.keys(L.faces ?? {}).length;
    for (const name of DECK_MAPS) {
      const [mb, ma, ml] = [own(B, name), own(A, name), own(L, name)] as (Record<string, unknown> | undefined)[];
      for (const entry of new Set([...Object.keys(mb ?? {}), ...Object.keys(ma ?? {})])) {
        const value = own(ma, entry);
        if (!compare(own(mb, entry), value, own(ml, entry), () => conflict(`canvas.json key ${name}.${entry}: changed since your read`))) continue;
        if (name === 'faces') faces += (value === undefined ? 0 : 1) - (own(ml, entry) === undefined ? 0 : 1);
        writes.push(() => (value === undefined ? Y.deleteDeckEntry(doc, name, entry) : Y.setDeckEntry(doc, name, entry, value as Y.Json), true));
      }
      if (ma !== undefined && ml === undefined) writes.push(() => (Y.ensureDeckMap(doc, name), true));
    }
    if (faces > DECK_LIMITS.faces) unmergeable.push({ path: CANVAS_PATH, detail: `canvas.json: merged with the changes since your read, it would hold ${faces} faces (over ${DECK_LIMITS.faces})` });

    for (const [id, ab] of Object.entries(A.boards)) {
      if (removed.has(id)) {
        warn(`board ${id}: its file is removed, so its canvas.json entry is dropped`);
        continue;
      }
      const bb = own(B.boards, id) as CanvasBoard | undefined;
      const lb = live.has(id) ? L.boards[id]! : undefined;
      if (!lb) {
        if (bb && !force) {
          conflict(`board ${id}: removed since your read`);
          continue;
        }
        entries.set(id, { ...ab });
        partial.set(id, FRAME_KEYS.filter((k) => ab[k] === undefined));
        if (!fileCreated.has(id)) {
          manifestCreated.add(id);
          warn(`board ${id}: canvas.json names it but no ${boardPath(id)} came; it is kept as an empty frame until its file is published`);
        }
        continue;
      }
      if (!bb && stable({ ...lb, ...ab }) !== stable(lb) && !force) {
        conflict(`board ${id}: created since your read`);
        continue;
      }
      const keys: Record<string, unknown> = {};
      const lacking: string[] = [];
      for (const key of new Set([...Object.keys(bb ?? {}), ...Object.keys(ab)])) {
        if ((FRAME_KEYS as readonly string[]).includes(key) && ab[key] === undefined) {
          lacking.push(key);
          continue;
        }
        if (compare(own(bb, key), own(ab, key), own(lb, key), () => conflict(`board ${id}: ${key} changed since your read`))) keys[key] = own(ab, key);
      }
      if (lacking.length) warn(`board ${id}: no ${FRAME_KEYS.filter((k) => lacking.includes(k)).join(', ')} in canvas.json; kept`);
      if (Object.keys(keys).length === 0) continue;
      entries.set(id, keys);
      // the frame as the merge leaves it, judged by the one rule (even under force: no key is the agent's to win here)
      const next = { ...lb, ...keys };
      const found = frameProblems(id, next);
      if (found.length) {
        const merged = FRAME_KEYS.some((k) => stable(own(bb, k)) !== stable(own(lb, k)));
        for (const p of found) unmergeable.push({ path: CANVAS_PATH, detail: merged ? `board ${id}: merged with the changes since your read, ${p.slice(`board ${id}: `.length)}` : p });
      }
    }
    for (const id of Object.keys(B.boards)) if (live.has(id) && !removed.has(id) && !Object.hasOwn(A.boards, id)) warn(`board ${id}: not in canvas.json’s boards; its frame is kept`);
  }
  for (const id of fileCreated) if (!entries.has(id)) partial.set(id, [...FRAME_KEYS]);
  // a created board's size as it will stand (its entry's, else its data-size or the slide's), judged before any write
  const fills = new Map<string, { w: number; h: number }>();
  const sizeProblems: FileProblem[] = [];
  for (const [id, lacking] of partial) {
    const entry = entries.get(id) ?? {};
    const size = input.sizes.get(id) ?? DEFAULT_SIZE;
    const fill = { w: lacking.includes('w') ? size.w : (entry.w as number), h: lacking.includes('h') ? size.h : (entry.h as number) };
    fills.set(id, fill);
    for (const message of frameProblems(id, fill)) sizeProblems.push({ path: CANVAS_PATH, message });
  }
  if (sizeProblems.length > 0) throw new FilesError(sizeProblems);

  const created = new Set([...fileCreated, ...manifestCreated]);
  const total = live.size - removed.size + created.size;
  if (total > CANVAS_LIMITS.boards) throw new FilesError([{ path: CANVAS_PATH, message: `the design would hold ${total} boards (over ${CANVAS_LIMITS.boards})` }]);

  // ---- the order, board by board
  const survivors = L.order.filter((id) => !removed.has(id));
  const sentOrder = A && stable(A.order) !== stable(B.order) ? A.order : null;
  if (A) {
    for (const id of A.order) if (!survivors.includes(id) && !created.has(id)) warn(`order lists board ${id}, which the design does not hold; dropped`, 'order');
    if (sentOrder) for (const id of B.order) if (survivors.includes(id) && !A.order.includes(id)) warn(`order leaves out board ${id}; its place is kept`, 'order');
  }
  const order = mergeBoardOrder(B.order, A?.order ?? null, survivors, created, force);
  for (const id of order.clashes) conflict(`board ${id}: order changed since your read`);

  // ---- C's half, then ours, on this doc; C refusing writes nothing of its own
  let deck: DeckPublishOutcome | null = null;
  if (Object.keys(deckSent).length > 0) {
    try {
      deck = publishDeck(doc, deckBase, deckSent, force);
    } catch (e) {
      if (e instanceof FilesError) throw new FilesError(e.problems.map((p) => ({ path: fromDeck(p.path), message: p.message })));
      throw e;
    }
  }
  const held = (deck?.held ?? []).map((h) => ({ ...h, path: fromDeck(h.path) }));
  for (const w of deck?.warnings ?? []) warnings.push({ ...w, path: fromDeck(w.path) }); // `data-size` is only a loader note
  const notes = input.notes + (deck?.notes ?? 0);
  const deckConflicts = (deck?.conflicts ?? []).map((c) => ({ path: fromDeck(c.path), ...(c.detail !== undefined && { detail: fromDeckDetail(c.detail) }) }));
  const refusal = [...(force ? [] : conflicts), ...unmergeable, ...deckConflicts];
  if (refusal.length > 0) return { changed: [], conflicts: refusal, added: [], warnings, notes, held };

  let manifest = 0;
  for (const write of writes) if (write()) manifest++;
  for (const id of manifestCreated) {
    Y.createSlide(doc, id, { [MISSING_SOURCE_KEY]: true }, '');
    manifest++;
  }
  for (const [id, keys] of entries)
    if (Y.hasSlide(doc, id)) {
      writeBoardEntry(doc, id, keys);
      manifest++;
    }
  for (const id of arrivals) Y.deleteSlideKey(doc, id, MISSING_SOURCE_KEY);
  for (const id of ownRemovals) {
    deleteSlide(doc, id);
    manifest++;
  }
  // a created board's missing frame keys, in the order it will stand: its data-size or the slide's, after the right-most
  for (const id of order.desired) {
    const lacking = partial.get(id);
    if (!lacking?.length || !Y.hasSlide(doc, id)) continue;
    const fill: BoardFrame = { ...placementAfter(doc, [id]), ...fills.get(id)! };
    for (const k of lacking) Y.setSlideKey(doc, id, k, fill[k as keyof BoardFrame]);
    const f = boardFrame(doc, id)!;
    const sized = input.sizes.has(id) && (lacking.includes('w') || lacking.includes('h'));
    warn(`board ${id}: no ${lacking.join(', ')} in canvas.json; its frame is ${f.x},${f.y} ${f.w}×${f.h}${sized ? ' (its data-size)' : ''}`);
    manifest++;
  }
  const current = new Map<string, string>();
  for (const id of order.desired) {
    const key = Y.hasSlide(doc, id) ? Y.slideScalars(doc, id).order : undefined;
    if (typeof key === 'string') current.set(id, key);
  }
  for (const [id, key] of rekey(order.desired, current, ANY))
    if (Y.hasSlide(doc, id)) {
      Y.setSlideKey(doc, id, 'order', key);
      manifest++;
    }

  const changed = new Set((deck?.changed ?? []).map(fromDeck));
  if (manifest > 0) changed.add(CANVAS_PATH);
  const added = new Set([...(deck?.added ?? []).map(fromDeck), ...arrivals.map(boardPath).filter((p) => changed.has(p))]);
  return { changed: [...changed].sort(), conflicts: [], added: [...added].sort(), warnings, notes, held };
}

/**
 * The design's publish: `live` the host replica the write goes through, `base` the files the session last read, `sent`
 * its files (`null` removes a board). Throws `FilesError` naming every path or manifest the design cannot hold, before
 * writing. Planned on a scratch copy first; applied to `live` in one transaction only when it lands there.
 */
export function publishCanvas(live: Doc, base: Readonly<Record<string, string>>, sent: Readonly<Record<string, string | null>>, force: boolean): CanvasPublishOutcome {
  const input = prepare(base, sent);
  const scratch = newDoc();
  let trial: CanvasPublishOutcome;
  try {
    applyV2(scratch, stateV2(live));
    trial = apply(scratch, input, force);
  } finally {
    scratch.destroy();
  }
  if (trial.conflicts.length > 0) return trial;
  let outcome = trial;
  transact(live, () => void (outcome = apply(live, input, force)));
  return outcome;
}
