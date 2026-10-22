// P3-E1 M1 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's §1 "Publish", XE6; Decision Log
// 11 (3) and 13 (1)): `artifact_publish`'s write half for a design, on A's `KindAdapter.publish(live, base, sent, force)`.
// The board files go through C's property-level publish (`publishDeck`) under C's slide paths, so an element's property,
// text or place conflicts exactly as on a deck; the manifest is compared here key by key, three-way like C's index: a
// board's `x`, `y`, `w`, `h`, `title` and kept keys, its place in the order (`order.ts`), the deck-level keys and map
// entries. A key the agent did not change (sent = base) is left alone even under force; one it changed applies when live
// still holds the base value, is left alone when live already holds the sent one, and otherwise conflicts naming the
// board and the key; `force` settles exactly the conflicting keys. A frame the merge would leave outside the cap is
// refused even under force. Atomicity (Decision Log 13 (1), its means ruled by Decision Log 38): a refusal anywhere writes
// nothing. Design plans its half first, writing nothing; when it refuses, C's half runs on a scratch copy only, so both
// halves' conflicts are answered; otherwise C's publish runs once on the live state inside the one transaction, relying on
// C's contract (every FilesError and conflict before its single write), and Design's validated writes follow.
//
// Absent pieces (the parent's §1): a board whose file came without geometry is placed after the right-most board at its
// `data-size` or 1920×1080, with a warning; a manifest entry with no file is held as a missing-source board (the model
// keeps its frame, no HTML is invented) until its file is published; a board the sent manifest leaves out keeps its
// frame. A board is removed by sending its file as null.
import { FilesError, type FileProblem, type PublishOutcome, type PublishWarning } from '../files';
import { carryRecord, DECK_LIMITS, DECK_PATH, slideIdOf, slidePath, withoutRecord } from '../slides/deck';
import { parseHtml } from '../slides/html';
import { deleteSlide, slideFile } from '../slides/model';
import { publishDeck, type DeckPublishOutcome } from '../slides/publish';
import { ANY, rekey } from '../slides/order';
import { applyV2, newDoc, stateV2, transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { boardIdOf, boardPath, CANVAS_LIMITS, CANVAS_PATH, dict, FRAME_KEYS, frameProblems, parseCanvasJson, type BoardFrame, type CanvasBoard, type CanvasJson } from './canvas';
import { boardFrame, DEFAULT_SIZE, isMissingSource, MISSING_SOURCE_KEY, placementAfter, readCanvas, writeBoardEntry } from './model';
import { mergeBoardOrder, movableIn } from './order';

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
  /** Board id → the size its sent file's `data-size` gives, or why that attribute gives none (absent: no entry). */
  sizes: Map<string, { w: number; h: number } | { problem: string }>;
  warnings: PublishWarning[];
  notes: number;
}

const DATA_SIZE_RE = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*$/;
/** A board file's `data-size` (`<w>x<h>` in px): null when absent, else the size or why it is not one the model holds. */
export function dataSize(id: string, source: string): { w: number; h: number } | { problem: string } | null {
  const top = parseHtml(source).find((n) => n.kind === 'element');
  const value = top && top.kind === 'element' && top.tag === 'section' ? new Map(top.attrs).get('data-size') : undefined;
  if (value === undefined) return null;
  const m = DATA_SIZE_RE.exec(value);
  if (!m) return { problem: `board ${id}: data-size ${JSON.stringify(value)} is not <w>x<h> in px` };
  const size = { w: Number(m[1]), h: Number(m[2]) };
  const found = frameProblems(id, size);
  return found.length === 0 ? size : { problem: `board ${id}: data-size ${JSON.stringify(value)}: ${found[0]!.slice(`board ${id}: `.length)}` };
}

function prepare(base: Readonly<Record<string, string>>, sent: Readonly<Record<string, string | null>>): Input {
  const problems: FileProblem[] = [];
  const boards = new Map<string, string | null>();
  const sizes: Input['sizes'] = new Map();
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

/** Design's half of a publish, read from `doc` and writing nothing: its refusals, C's arguments, and its deferred writes. */
interface Plan {
  conflicts: PublishOutcome['conflicts'];
  /** Refusals force does not settle. */
  unmergeable: PublishOutcome['conflicts'];
  warnings: PublishWarning[];
  deckBase: Record<string, string>;
  deckSent: Record<string, string | null>;
  /** The deck-level writes, bound to the planned doc. */
  writes: (() => boolean)[];
  manifestCreated: Set<string>;
  entries: Map<string, Record<string, unknown>>;
  arrivals: string[];
  ownRemovals: string[];
  partial: Map<string, string[]>;
  fills: Map<string, { w: number; h: number }>;
  order: ReturnType<typeof mergeBoardOrder>;
}

/**
 * Plans Design's half against `doc` without writing (Decision Log 38): the manifest key by key, frames, order and the
 * boards removed, created or given their first file. Throws `FilesError` for what the design cannot hold.
 */
function plan(doc: Doc, input: Input, force: boolean): Plan {
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
  let restacked: Set<string> | null = null; // the boards the live order moved since the read, read once
  for (const [id, text] of input.boards) {
    const read = input.base[boardPath(id)] !== undefined;
    if (text === input.base[boardPath(id)]) continue; // the file as read: not the agent's change (C's rule)
    if (text === null) {
      if (!live.has(id) || !(read || Object.hasOwn(B.boards, id))) continue; // not a board the agent read
      removed.add(id);
      const [bb, lb] = [own(B.boards, id) as CanvasBoard | undefined, L.boards[id]!];
      if (bb && !force) for (const key of new Set([...Object.keys(bb), ...Object.keys(lb)])) if (stable(own(bb, key)) !== stable(own(lb, key))) conflict(`board ${id}: ${key} changed since your read`);
      // its place, which the entry does not hold: a board the owner re-stacked since the read is refused, the mirror of a
      // deleted board the agent's order moved (below), a tie that cannot tell its move from a neighbour's counting as one
      if (!force && (restacked ??= movableIn(B.order, L.order)).has(id)) conflict(`board ${id}: order changed since your read`);
      if (read) deckSent[slidePath(id)] = null;
      else {
        // read as manifest-only: a file that arrived since is content the agent never saw (C's removal rule)
        if (!isMissingSource(doc, id) && !force) conflicts.push({ path: boardPath(id), detail: 'board: changed since your read' });
        ownRemovals.push(id);
      }
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
        // P4-B2 D19: a face compared without the host's record, which a face the agent writes carries forward (C's rule)
        const isFace = name === 'faces';
        const sentValue = own(ma, entry);
        if (!compare(own(mb, entry), sentValue, isFace ? withoutRecord(own(ml, entry)) : own(ml, entry), () => conflict(`canvas.json key ${name}.${entry}: changed since your read`))) continue;
        const value = isFace ? carryRecord(sentValue, own(ml, entry)) : sentValue;
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
        // its entry as read and no new file for it: the deletion made since the read stands (a changed file recreating it
        // is the agent's change, its entry then the frame it stands at)
        if (bb && stable(ab) === stable(bb) && !fileCreated.has(id)) continue;
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
      const keys = dict<unknown>(); // any key, `__proto__` too, an own entry
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
  // M6 final review: a manifest sent byte for byte as read is no change of the agent's (nothing above compares it), yet
  // it still says where a board the agent's changed file recreates stood: forced, that board takes its entry as read
  // (unforced, C's half refuses the recreation); surviving boards are left alone as before
  if (!A && force && input.sent[CANVAS_PATH] !== undefined && input.sent[CANVAS_PATH] === input.base[CANVAS_PATH])
    for (const id of fileCreated) {
      const bb = own(B.boards, id) as CanvasBoard | undefined;
      if (!bb || entries.has(id)) continue;
      entries.set(id, { ...bb });
      partial.set(id, FRAME_KEYS.filter((k) => bb[k] === undefined));
    }
  for (const id of fileCreated) if (!entries.has(id)) partial.set(id, [...FRAME_KEYS]);
  // a created board's size as it will stand (its entry's, else its data-size or the slide's), judged before any write
  const fills = new Map<string, { w: number; h: number }>();
  const sizeProblems: FileProblem[] = [];
  for (const [id, lacking] of partial) {
    const entry = entries.get(id) ?? {};
    const given = input.sizes.get(id);
    const needed = lacking.includes('w') || lacking.includes('h');
    if (needed && given && 'problem' in given) {
      sizeProblems.push({ path: CANVAS_PATH, message: given.problem }); // an explicit size it would use, refused, never defaulted
      continue;
    }
    const size = given && !('problem' in given) ? given : DEFAULT_SIZE;
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
    // a board deleted since the read keeps its deletion, unless the agent's order moved it: order.ts's classification,
    // where a tie that cannot tell its move from a neighbour's counts as one (refused rather than settled silently)
    const deleted = B.order.filter((id) => !live.has(id) && A.order.includes(id) && !created.has(id));
    const movable = deleted.length > 0 ? movableIn(B.order, A.order) : new Set<string>();
    for (const id of deleted) if (movable.has(id) && !force) conflict(`board ${id}: removed since your read`);
    for (const id of A.order) if (!survivors.includes(id) && !created.has(id) && !deleted.includes(id) && !removed.has(id)) warn(`order lists board ${id}, which the design does not hold; dropped`, 'order');
    if (sentOrder) for (const id of B.order) if (survivors.includes(id) && !A.order.includes(id)) warn(`order leaves out board ${id}; its place is kept`, 'order');
  }
  const order = mergeBoardOrder(B.order, A?.order ?? null, survivors, created, force);
  for (const id of order.clashes) conflict(`board ${id}: order changed since your read`);

  return { conflicts, unmergeable, warnings, deckBase, deckSent, writes, manifestCreated, entries, arrivals, ownRemovals, partial, fills, order };
}

interface DeckHalf {
  deck: DeckPublishOutcome | null;
  conflicts: PublishOutcome['conflicts'];
  held: CanvasPublishOutcome['held'];
  notes: number;
}

/**
 * C's half on `doc`, its answer in the design's paths, its warnings added to the plan's. C's contract (`publishDeck`):
 * every `FilesError` thrown and every conflict returned before its one write, so a refusal or throw writes nothing.
 */
function runDeck(doc: Doc, input: Input, p: Plan, force: boolean): DeckHalf {
  let deck: DeckPublishOutcome | null = null;
  if (Object.keys(p.deckSent).length > 0) {
    try {
      deck = publishDeck(doc, p.deckBase, p.deckSent, force);
    } catch (e) {
      if (e instanceof FilesError) throw new FilesError(e.problems.map((pr) => ({ path: fromDeck(pr.path), message: pr.message })));
      throw e;
    }
  }
  for (const w of deck?.warnings ?? []) p.warnings.push({ ...w, path: fromDeck(w.path) }); // `data-size` is only a loader note
  return {
    deck,
    conflicts: (deck?.conflicts ?? []).map((c) => ({ path: fromDeck(c.path), ...(c.detail !== undefined && { detail: fromDeckDetail(c.detail) }) })),
    held: (deck?.held ?? []).map((h) => ({ ...h, path: fromDeck(h.path) })),
    notes: input.notes + (deck?.notes ?? 0),
  };
}

/** Design's planned writes on `doc` after C's landed (the caller's transaction), and the publish's answer. */
function write(doc: Doc, input: Input, p: Plan, c: DeckHalf): CanvasPublishOutcome {
  const { writes, manifestCreated, entries, arrivals, ownRemovals, partial, fills, order, warnings } = p;
  const { deck, held, notes } = c;
  const warn = (message: string) => warnings.push({ path: CANVAS_PATH, message });
  let manifest = 0;
  for (const deferred of writes) if (deferred()) manifest++;
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
    const given = input.sizes.get(id);
    const sized = given !== undefined && !('problem' in given) && (lacking.includes('w') || lacking.includes('h'));
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

  // a missing-source board given its file has a file it had not: added, whatever C wrote (a file equal to the empty board
  // the model held, its base there, writes nothing)
  const arrived = arrivals.map(boardPath);
  const changed = new Set([...(deck?.changed ?? []).map(fromDeck), ...arrived]);
  if (manifest > 0) changed.add(CANVAS_PATH);
  const added = new Set([...(deck?.added ?? []).map(fromDeck), ...arrived]);
  return { changed: [...changed].sort(), conflicts: [], added: [...added].sort(), warnings, notes, held };
}

/**
 * The design's publish: `live` the host replica the write goes through, `base` the files the session last read, `sent`
 * its files (`null` removes a board). Throws `FilesError` naming every path or manifest the design cannot hold, before
 * writing. Design's half is planned first, writing nothing (Decision Log 38): when it refuses, C's half runs on a scratch
 * copy only, so the answer names both halves' conflicts and the live state is untouched; otherwise C's publish runs once
 * on `live` inside one transaction and Design's already-validated writes follow it, a refusal or throw of C's (made
 * before its own write) leaving nothing written.
 */
export function publishCanvas(live: Doc, base: Readonly<Record<string, string>>, sent: Readonly<Record<string, string | null>>, force: boolean): CanvasPublishOutcome {
  const input = prepare(base, sent);
  const p = plan(live, input, force);
  const own = [...(force ? [] : p.conflicts), ...p.unmergeable];
  if (own.length > 0) {
    let c: DeckHalf = { deck: null, conflicts: [], held: [], notes: input.notes };
    if (Object.keys(p.deckSent).length > 0) {
      const scratch = newDoc();
      try {
        applyV2(scratch, stateV2(live));
        c = runDeck(scratch, input, p, force);
      } finally {
        scratch.destroy();
      }
    }
    return { changed: [], conflicts: [...own, ...c.conflicts], added: [], warnings: p.warnings, notes: c.notes, held: c.held };
  }
  let outcome!: CanvasPublishOutcome;
  transact(live, () => {
    const c = runDeck(live, input, p, force);
    outcome = c.conflicts.length > 0 ? { changed: [], conflicts: c.conflicts, added: [], warnings: p.warnings, notes: c.notes, held: c.held } : write(live, input, p, c);
  });
  return outcome;
}
