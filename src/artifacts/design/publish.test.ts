// P3-E1 M1 (acceptance 1's portable half): `publishCanvas(live, base, sent, force)`, the design's three-way publish.
// Board files go through C's property-level publish; the manifest is compared key by key (a board's x, y, w, h, title,
// kept keys, its place in the order; the deck-level keys and map entries). Everything is planned on a scratch copy before
// the live write, so a refusal anywhere writes nothing, and a landing publish is one transaction.
import { describe, expect, it } from 'vitest';
import { FilesError } from '../files';
import { readSlide, setStyle, slideOrder } from '../slides/model';
import { newDoc, transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { boardPath, CANVAS_PATH, parseCanvasJson, serializeCanvasJson, type CanvasJson } from './canvas';
import { boardFrame, designFiles, isMissingSource, readCanvas, writeBoardEntry } from './model';
import { publishCanvas, type CanvasPublishOutcome } from './publish';
import { EXTRA_PREFIX } from './model';
import { setBoardFrame } from './writers';
import { BOARDS, design, replicaFrom, updatesOf } from './fixtures/support';

const [B1, B2, B3] = ['b1', 'b2', 'b3'].map(boardPath) as [string, string, string];
const manifest = (files: Record<string, string>): CanvasJson => {
  const parsed = parseCanvasJson(files[CANVAS_PATH]!);
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.canvas;
};
/** The agent's edit of what it read: the manifest changed by `edit`, and the board files given. */
const sentWith = (base: Record<string, string>, edit: (c: CanvasJson) => void, files: Record<string, string | null> = {}) => {
  const c = manifest(base);
  edit(c);
  return { [CANVAS_PATH]: serializeCanvasJson(c), ...files };
};
const restyled = (base: Record<string, string>) => base[B1]!.replace('font-size:72px', 'font-size:72px; color:#123456');
function publish(doc: Doc, base: Record<string, string>, sent: Record<string, string | null>, force = false): { out: CanvasPublishOutcome; updates: number } {
  let out!: CanvasPublishOutcome;
  const updates = updatesOf(doc, () => (out = publishCanvas(doc, base, sent, force))).length;
  return { out, updates };
}
const refused = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FilesError);
    return (e as FilesError).problems.map((p) => `${p.path}: ${p.message}`);
  }
  throw new Error('not refused');
};

const PHONE = '<section id="phone" style="background:#fff"><h1 id="t" style="font-size:32px">Sign in</h1></section>';
const TABLET = '<section id="tablet"><p id="p" style="font-size:16px">Tablet</p></section>';
const DESKTOP = '<section id="desktop"><p id="p" style="font-size:16px">Desktop</p><aside>Speaker</aside></section>';
const POSTER = '<section id="poster"><h1 id="t" style="font-size:96px">Poster</h1></section>';
const FOUR = {
  [CANVAS_PATH]: JSON.stringify({
    v: 1,
    title: 'Launch',
    boards: {
      phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' },
      tablet: { x: 500, y: 0, w: 834, h: 1194 },
      desktop: { x: 1500, y: 0, w: 1440, h: 1024 },
      poster: { x: 3100, y: 0, w: 1080, h: 10_000 },
    },
    order: ['phone', 'tablet', 'desktop', 'poster'],
    brand: { tone: 'calm' },
  }),
  [boardPath('phone')]: PHONE,
  [boardPath('tablet')]: TABLET,
  [boardPath('desktop')]: DESKTOP,
  [boardPath('poster')]: POSTER,
};

describe('a design created from its files (A’s create: a publish on an empty doc)', () => {
  it('lands four boards of different sizes, a poster over 8,192 px among them, in one transaction, and a republish of what it reads is a no-op', () => {
    const doc = newDoc();
    const { out, updates } = publish(doc, {}, FOUR);
    expect(out.conflicts).toEqual([]);
    expect(updates).toBe(1);
    expect(out.added).toEqual(['phone', 'tablet', 'desktop', 'poster'].map(boardPath).sort());
    expect(out.changed).toEqual([CANVAS_PATH, ...out.added].sort());
    expect(out.warnings).toEqual([]);
    expect(slideOrder(doc)).toEqual(['phone', 'tablet', 'desktop', 'poster']);
    expect(boardFrame(doc, 'poster')).toEqual({ x: 3100, y: 0, w: 1080, h: 10_000 });
    expect(readCanvas(doc)).toMatchObject({ v: 1, title: 'Launch', brand: { tone: 'calm' }, boards: { phone: { title: 'Phone' } } });
    expect(Y.readNotes(doc, 'desktop')).toBe('Speaker');
    const read = designFiles(doc);
    expect(publish(doc, read, read)).toEqual({ out: expect.objectContaining({ changed: [], conflicts: [] }), updates: 0 });
    expect(publish(doc, read, read, true).updates).toBe(0); // sent = base is never the agent's change, even under force
  });

  it('answers A’s second call (the session’s new base, forced on the base state) with the same files', () => {
    const live = design();
    const base = designFiles(live);
    const baseDoc = replicaFrom(live, 7);
    const sent = sentWith(base, (c) => ((c.boards.b1!.x = 50), c.order.reverse()), { [B1]: restyled(base), [boardPath('b4')]: '<section id="b4"><p id="p">New</p></section>' });
    expect(publish(live, base, sent).out.conflicts).toEqual([]);
    publishCanvas(baseDoc, base, sent, true);
    expect(designFiles(baseDoc)).toEqual(designFiles(live));
  });
});

describe('the manifest beside the board files', () => {
  it('merges the owner’s board move with the agent’s restyle of an element on that board', () => {
    const doc = design();
    const base = designFiles(doc);
    setBoardFrame(doc, 'b1', { x: 900, y: 40 });
    const { out, updates } = publish(doc, base, sentWith(base, (c) => (c.boards.b2!.w = 1200), { [B1]: restyled(base) }));
    expect(out.conflicts).toEqual([]);
    expect(updates).toBe(1);
    expect(out.changed).toEqual([B1, CANVAS_PATH]);
    expect(boardFrame(doc, 'b1')).toEqual({ x: 900, y: 40, w: 390, h: 844 });
    expect(boardFrame(doc, 'b2')).toEqual({ ...BOARDS[1]!.at, w: 1200 });
    expect(readSlide(doc, 'b1').children[0]!.style.color).toBe('#123456');
  });

  it('refuses both writing one board’s x, naming it; forced, the agent wins exactly that key and a key it did not change stays', () => {
    const doc = design();
    const base = designFiles(doc);
    setBoardFrame(doc, 'b1', { x: 900, w: 400 });
    const sent = sentWith(base, (c) => (c.boards.b1!.x = 50));
    const before = designFiles(doc);
    expect(publish(doc, base, sent)).toEqual({ out: expect.objectContaining({ changed: [], conflicts: [{ path: CANVAS_PATH, detail: 'board b1: x changed since your read' }] }), updates: 0 });
    expect(designFiles(doc)).toEqual(before);
    expect(publish(doc, base, sent, true).out.conflicts).toEqual([]);
    expect(boardFrame(doc, 'b1')).toEqual({ x: 50, y: 0, w: 400, h: 844 });
  });

  it('refuses a board file conflict and a manifest conflict together, writing nothing (the HTML that would land included)', () => {
    const doc = design();
    const base = designFiles(doc);
    setStyle(doc, 'b1', 'title', { color: '#ff0000' });
    setBoardFrame(doc, 'b2', { w: 999 });
    const sent = sentWith(base, (c) => (c.boards.b2!.w = 1200), { [B1]: restyled(base), [B3]: base[B3]!.replace('Body of b3', 'Body three') });
    const { out, updates } = publish(doc, base, sent);
    expect(updates).toBe(0);
    expect(out.conflicts).toEqual([
      { path: CANVAS_PATH, detail: 'board b2: w changed since your read' },
      { path: B1, detail: 'element title: color changed since your read' },
    ]);
    expect(readSlide(doc, 'b3').children[1]!.text).toEqual(readSlide(design(), 'b3').children[1]!.text);
    // only the manifest refuses: the board files that would land write nothing either
    const html = sentWith(base, (c) => (c.boards.b2!.w = 1200), { [B3]: base[B3]!.replace('Body of b3', 'Body three') });
    expect(publish(doc, base, html)).toEqual({ out: expect.objectContaining({ conflicts: [{ path: CANVAS_PATH, detail: 'board b2: w changed since your read' }] }), updates: 0 });
  });

  it('refuses, even under force, a merge whose frame passes the cap (each side valid alone), and lands nothing of the publish', () => {
    const doc = design([{ id: 'big', at: { x: 0, y: 0, w: 8192, h: 4096 } }]);
    const base = designFiles(doc);
    setBoardFrame(doc, 'big', { w: 16_384 }); // the owner widens: 16384×4096
    const sent = sentWith(base, (c) => (c.boards.big!.h = 8192), { [boardPath('big')]: base[boardPath('big')]!.replace('Body of big', 'Bigger') });
    for (const force of [false, true]) {
      const { out, updates } = publish(doc, base, sent, force);
      expect(updates).toBe(0);
      expect(out.conflicts).toEqual([{ path: CANVAS_PATH, detail: 'board big: merged with the changes since your read, 16384×8192 is 134217728 px (over 67108864 px)' }]);
    }
  });

  it('removes a board by its file, refusing when the owner moved or edited it since the read', () => {
    const doc = design();
    const base = designFiles(doc);
    setBoardFrame(doc, 'b2', { x: 777 });
    setStyle(doc, 'b3', 'title', { color: '#00f' });
    const gone = (id: string) => sentWith(base, (c) => (delete c.boards[id], (c.order = c.order.filter((o) => o !== id))), { [boardPath(id)]: null });
    expect(publish(doc, base, gone('b2'))).toEqual({ out: expect.objectContaining({ conflicts: [{ path: CANVAS_PATH, detail: 'board b2: x changed since your read' }] }), updates: 0 });
    expect(publish(doc, base, gone('b3')).out.conflicts).toEqual([{ path: B3, detail: 'board: changed since your read' }]);
    const { out } = publish(doc, base, gone('b1'));
    expect(out.conflicts).toEqual([]);
    expect(out.changed).toEqual([B1, CANVAS_PATH]);
    expect(slideOrder(doc)).toEqual(['b2', 'b3']);
  });

  it('refuses an edit of a board removed since the read, and a board created meanwhile under the same id', () => {
    const doc = design();
    const base = designFiles(doc);
    transact(doc, () => Y.deleteSlide(doc, 'b2'));
    expect(publish(doc, base, sentWith(base, (c) => (c.boards.b2!.x = 1))).out.conflicts).toEqual([{ path: CANVAS_PATH, detail: 'board b2: removed since your read' }]);
    const fresh = design();
    const read = designFiles(fresh);
    transact(fresh, () => {
      Y.createSlide(fresh, 'b4', { order: 'a9' }, '');
      writeBoardEntry(fresh, 'b4', { x: 0, y: 2000, w: 10, h: 10 });
    });
    const out = publish(fresh, read, sentWith(read, (c) => (c.boards.b4 = { x: 5, y: 5, w: 20, h: 20 }), { [boardPath('b4')]: '<section id="b4"><p id="p">Mine</p></section>' })).out;
    expect(out.conflicts).toEqual([
      { path: CANVAS_PATH, detail: 'board b4: created since your read' },
      { path: boardPath('b4'), detail: 'board: created since your read' },
    ]);
  });
});

describe('the order (projected onto each board’s fractional key)', () => {
  it('merges the agent’s and the owner’s re-orders of different boards, and names the board both moved differently', () => {
    const doc = design([...BOARDS, { id: 'b4', at: { x: 4000, y: 0, w: 10, h: 10 } }]);
    const base = designFiles(doc);
    transact(doc, () => Y.setSlideKey(doc, 'b1', 'order', 'a9')); // the owner sends b1 to the end
    expect(slideOrder(doc)).toEqual(['b2', 'b3', 'b4', 'b1']);
    const { out } = publish(doc, base, sentWith(base, (c) => (c.order = ['b4', 'b1', 'b2', 'b3']))); // the agent: b4 first
    expect(out.conflicts).toEqual([]);
    expect(slideOrder(doc)).toEqual(['b4', 'b2', 'b3', 'b1']);
    const read = designFiles(doc);
    transact(doc, () => Y.setSlideKey(doc, 'b3', 'order', '0')); // the owner: b3 first
    const sent = sentWith(read, (c) => (c.order = ['b4', 'b2', 'b1', 'b3'])); // the agent: b3 last
    expect(publish(doc, read, sent).out.conflicts).toEqual([{ path: CANVAS_PATH, detail: 'board b3: order changed since your read' }]);
    expect(publish(doc, read, sent, true).out.conflicts).toEqual([]);
    expect(slideOrder(doc)).toEqual(['b4', 'b2', 'b1', 'b3']);
  });

  it('places a new board where the agent’s order lists it, and drops an order entry naming no board with a warning', () => {
    const doc = design();
    const base = designFiles(doc);
    const { out } = publish(doc, base, sentWith(base, (c) => ((c.boards.n = { x: 0, y: 3000, w: 100, h: 100 }), (c.order = ['b1', 'n', 'ghost', 'b2', 'b3'])), { [boardPath('n')]: '<section id="n"></section>' }));
    expect(out.conflicts).toEqual([]);
    expect(slideOrder(doc)).toEqual(['b1', 'n', 'b2', 'b3']);
    expect(out.warnings).toEqual([{ path: CANVAS_PATH, property: 'order', message: 'order lists board ghost, which the design does not hold; dropped' }]);
  });
});

describe('absent manifest entries, frames and files', () => {
  it('places a board whose file came without geometry after the right-most board, at its data-size or 1920×1080, with a warning', () => {
    const doc = design();
    const base = designFiles(doc);
    const { out } = publish(doc, base, { [boardPath('b4')]: '<section id="b4"><p id="p">New</p></section>', [boardPath('b5')]: '<section id="b5" data-size="390x844"></section>' });
    expect(out.conflicts).toEqual([]);
    expect(boardFrame(doc, 'b4')).toEqual({ x: 3180, y: 0, w: 1920, h: 1080 });
    expect(boardFrame(doc, 'b5')).toEqual({ x: 5200, y: 0, w: 390, h: 844 });
    expect(out.warnings.filter((w) => w.path === CANVAS_PATH).map((w) => w.message)).toEqual([
      'board b4: no x, y, w, h in canvas.json; its frame is 3180,0 1920×1080',
      'board b5: no x, y, w, h in canvas.json; its frame is 5200,0 390×844 (its data-size)',
    ]);
    expect(out.changed).toContain(CANVAS_PATH);
    expect(out.warnings.filter((w) => w.path !== CANVAS_PATH)).toEqual([]); // data-size is a loader note, never a warning
  });

  it('keeps a board the sent manifest leaves out, and a partial entry’s missing keys, with warnings', () => {
    const doc = design();
    const base = designFiles(doc);
    const { out } = publish(doc, base, sentWith(base, (c) => (delete c.boards.b2, (c.boards.b3 = { title: 'Poster' }))));
    expect(out.conflicts).toEqual([]);
    expect(boardFrame(doc, 'b2')).toEqual(BOARDS[1]!.at);
    expect(readCanvas(doc).boards.b3).toEqual({ ...BOARDS[2]!.at, title: 'Poster' });
    expect(out.warnings.map((w) => w.message)).toEqual(['board b3: no x, y, w, h in canvas.json; kept', 'board b2: not in canvas.json’s boards; its frame is kept']);
  });

  it('holds a manifest entry whose file never came as a missing-source board, invents no file, and clears the marker when the file arrives', () => {
    const doc = design();
    const base = designFiles(doc);
    const first = publish(doc, base, sentWith(base, (c) => ((c.boards.later = { x: 0, y: 2000, w: 390, h: 844, title: 'Later' }), c.order.push('later')))).out;
    expect(first.conflicts).toEqual([]);
    expect(first.warnings.map((w) => w.message)).toEqual(['board later: canvas.json names it but no project/boards/later.html came; it is kept as an empty frame until its file is published']);
    expect(isMissingSource(doc, 'later')).toBe(true);
    const read = designFiles(doc);
    expect(read[boardPath('later')]).toBeUndefined();
    expect(manifest(read).boards.later).toEqual({ x: 0, y: 2000, w: 390, h: 844, title: 'Later' });
    const { out } = publish(doc, read, { [boardPath('later')]: '<section id="later"><p id="p" style="font-size:16px">Here</p></section>' });
    expect(out.conflicts).toEqual([]);
    expect(out.added).toEqual([boardPath('later')]);
    expect(isMissingSource(doc, 'later')).toBe(false);
    expect(designFiles(doc)[boardPath('later')]).toContain('Here');
    expect(boardFrame(doc, 'later')).toEqual({ x: 0, y: 2000, w: 390, h: 844 });
  });

  it('removes a missing-source board by sending its path as null', () => {
    const doc = design();
    const base = designFiles(doc);
    publish(doc, base, sentWith(base, (c) => (c.boards.later = { x: 0, y: 2000, w: 390, h: 844 })));
    const read = designFiles(doc);
    const { out } = publish(doc, read, sentWith(read, (c) => delete c.boards.later, { [boardPath('later')]: null }));
    expect(out.conflicts).toEqual([]);
    expect(Y.hasSlide(doc, 'later')).toBe(false);
  });

  it('holds a board file that fails structurally with its source verbatim, landing the rest', () => {
    const doc = design();
    const base = designFiles(doc);
    const bad = '<section id="b2"><p id="p">Kept</p><script>x()</script></section>';
    const { out } = publish(doc, base, sentWith(base, (c) => (c.boards.b1!.x = 5), { [B2]: bad }));
    expect(out.conflicts).toEqual([]);
    expect(out.held).toEqual([{ path: B2, reasons: [expect.any(String)] }]);
    expect(designFiles(doc)[B2]).toBe(bad);
    expect(boardFrame(doc, 'b1')!.x).toBe(5);
  });
});

describe('the manifest’s own keys', () => {
  it('compares the deck-level keys and map entries key by key, kept keys included', () => {
    const doc = design();
    const base = designFiles(doc);
    transact(doc, () => Y.setDeckKey(doc, 'title', 'Owner’s'));
    const sent = sentWith(base, (c) => ((c.zeta = { kept: true }), (c.dsOverrides = { '--ds-color-accent': '#c00' }), (c.boards.b1!.locked = true)));
    expect(publish(doc, base, sent).out.conflicts).toEqual([]);
    const canvas = readCanvas(doc);
    expect(canvas).toMatchObject({ title: 'Owner’s', zeta: { kept: true }, dsOverrides: { '--ds-color-accent': '#c00' } });
    expect(canvas.boards.b1).toMatchObject({ locked: true });
    const read = designFiles(doc);
    transact(doc, () => Y.setDeckKey(doc, 'title', 'Again'));
    expect(publish(doc, read, sentWith(read, (c) => (c.title = 'Agent’s'))).out.conflicts).toEqual([{ path: CANVAS_PATH, detail: 'canvas.json key title: changed since your read' }]);
  });
});

describe('what the publish refuses before planning', () => {
  it('names each path or manifest problem, writing nothing', () => {
    const doc = design();
    const base = designFiles(doc);
    expect(refused(() => publishCanvas(doc, base, { 'project/deck.json': '{}', [CANVAS_PATH]: null, 'project/boards/a b.html': '<section></section>' }, false))).toEqual([
      'project/boards/a b.html: not a design file: project/canvas.json or project/boards/<id>.html, an id of [A-Za-z0-9_-]{1,64}',
      'project/canvas.json: the canvas manifest cannot be removed',
      'project/deck.json: not a design file: project/canvas.json or project/boards/<id>.html, an id of [A-Za-z0-9_-]{1,64}',
    ]);
    expect(refused(() => publishCanvas(doc, base, sentWith(base, (c) => (c.boards.b1!.w = 20_000)), false))).toEqual(['project/canvas.json: board b1: w is 20000 px (over 16384 px a side)']);
    expect(refused(() => publishCanvas(doc, base, { [B2]: '<section id="other"><script></script></section>' }, false))).toEqual([`${B2}: the section’s id is "other", not the file name’s "b2"`]);
    const many = Object.fromEntries(Array.from({ length: 198 }, (_, i) => [boardPath(`n${i}`), `<section id="n${i}"></section>`]));
    expect(refused(() => publishCanvas(doc, base, many, false))).toEqual(['project/canvas.json: the design would hold 201 boards (over 200)']);
    // a created board's size as its entry and data-size together would make it, before anything lands
    expect(refused(() => publishCanvas(doc, base, sentWith(base, (c) => (c.boards.wide = { w: 16_384 }), { [boardPath('wide')]: '<section id="wide" data-size="100x8192"></section>' }), false))).toEqual(['project/canvas.json: board wide: 16384×8192 is 134217728 px (over 67108864 px)']);
    expect(designFiles(doc)).toEqual(base);
  });
});

describe('task-review fix wave 1', () => {
  it('(1) leaves a board deleted since the read deleted when the agent resends its untouched entry and file, forced or not', () => {
    for (const force of [false, true]) {
      const doc = design();
      const base = designFiles(doc);
      transact(doc, () => Y.deleteSlide(doc, 'b2'));
      const sent = { ...base, ...sentWith(base, (c) => (c.boards.b1!.x = 50)) }; // every file it read, b2's included
      const { out } = publish(doc, base, sent, force);
      expect(out.conflicts).toEqual([]);
      expect(Y.hasSlide(doc, 'b2')).toBe(false);
      expect(boardFrame(doc, 'b1')!.x).toBe(50);
      expect(out.warnings.filter((w) => w.message.includes('b2'))).toEqual([]);
    }
  });

  it('(1) still refuses an edit or a re-order of a board deleted since the read', () => {
    const doc = design();
    const base = designFiles(doc);
    transact(doc, () => Y.deleteSlide(doc, 'b2'));
    expect(publish(doc, base, sentWith(base, (c) => (c.boards.b2!.title = 'Kept'))).out.conflicts).toEqual([{ path: CANVAS_PATH, detail: 'board b2: removed since your read' }]);
    expect(publish(doc, base, sentWith(base, (c) => (c.order = ['b2', 'b1', 'b3']))).out.conflicts).toEqual([{ path: CANVAS_PATH, detail: 'board b2: removed since your read' }]);
    expect(publish(doc, base, sentWith(base, (c) => (c.order = ['b1', 'b3', 'b2']))).out.conflicts).toEqual([{ path: CANVAS_PATH, detail: 'board b2: removed since your read' }]);
    // a re-order of other boards that leaves the deleted one where it stood among them is not its
    const four = design([...BOARDS, { id: 'b4', at: { x: 4000, y: 0, w: 10, h: 10 } }]);
    const read = designFiles(four);
    transact(four, () => Y.deleteSlide(four, 'b2'));
    expect(publish(four, read, sentWith(read, (c) => (c.order = ['b1', 'b2', 'b4', 'b3']))).out.conflicts).toEqual([]);
    expect(slideOrder(four)).toEqual(['b1', 'b4', 'b3']);
  });

  it('(2) refuses a null for a manifest-only board whose file arrived since the read, writing nothing; forced, removes it', () => {
    const doc = design();
    const base = designFiles(doc);
    publish(doc, base, sentWith(base, (c) => (c.boards.later = { x: 0, y: 2000, w: 390, h: 844 })));
    const read = designFiles(doc); // the agent reads 'later' as manifest-only
    publish(doc, read, { [boardPath('later')]: '<section id="later"><p id="p" style="font-size:16px">Arrived</p></section>' }); // another writer's file
    const before = designFiles(doc);
    const { out, updates } = publish(doc, read, { [boardPath('later')]: null });
    expect(out.conflicts).toEqual([{ path: boardPath('later'), detail: 'board: changed since your read' }]);
    expect(updates).toBe(0);
    expect(designFiles(doc)).toEqual(before);
    expect(publish(doc, read, { [boardPath('later')]: null }, true).out.conflicts).toEqual([]);
    expect(Y.hasSlide(doc, 'later')).toBe(false);
  });

  it('(3) refuses an invalid data-size it would use for a missing dimension, before any write, and ignores it under a whole frame', () => {
    const doc = design();
    const base = designFiles(doc);
    const file = (size: string) => ({ [boardPath('n')]: `<section id="n" data-size="${size}"></section>` });
    expect(refused(() => publishCanvas(doc, base, file('16385x10'), false))).toEqual(['project/canvas.json: board n: data-size "16385x10": w is 16385 px (over 16384 px a side)']);
    expect(refused(() => publishCanvas(doc, base, file('16384x8192'), false))).toEqual(['project/canvas.json: board n: data-size "16384x8192": 16384×8192 is 134217728 px (over 67108864 px)']);
    expect(refused(() => publishCanvas(doc, base, file('0x10'), false))).toEqual(['project/canvas.json: board n: data-size "0x10": w is 0 (a side is more than 0 px)']);
    expect(refused(() => publishCanvas(doc, base, file('wide'), false))).toEqual(['project/canvas.json: board n: data-size "wide" is not <w>x<h> in px']);
    expect(refused(() => publishCanvas(doc, base, { ...sentWith(base, (c) => (c.boards.n = { x: 0, y: 0, h: 10 })), ...file('16385x10') }, false))).toEqual(['project/canvas.json: board n: data-size "16385x10": w is 16385 px (over 16384 px a side)']);
    expect(designFiles(doc)).toEqual(base);
    const whole = publish(doc, base, { ...sentWith(base, (c) => (c.boards.n = { x: 0, y: 3000, w: 100, h: 100 })), ...file('16385x10') });
    expect(whole.out.conflicts).toEqual([]);
    expect(boardFrame(doc, 'n')).toEqual({ x: 0, y: 3000, w: 100, h: 100 });
  });

  it('(4) adds, changes and removes a kept board key named __proto__ through the publish', () => {
    const doc = design();
    const edit = (change: (entry: Record<string, unknown>) => void) => {
      const read = designFiles(doc);
      const c = manifest(read);
      change(c.boards.b1 as Record<string, unknown>);
      expect(publish(doc, read, { [CANVAS_PATH]: serializeCanvasJson(c) }).out.conflicts).toEqual([]);
      return Y.slideScalars(doc, 'b1')[`${EXTRA_PREFIX}__proto__`];
    };
    const own = (v: unknown) => Object.defineProperty({}, '__proto__', { value: v, enumerable: true, writable: true, configurable: true }) as Record<string, unknown>;
    expect(edit((e) => Object.assign(e, own({ p: 1 })))).toBe('{"p":1}');
    expect(Object.hasOwn(readCanvas(doc).boards.b1!, '__proto__')).toBe(true);
    expect(edit((e) => Object.assign(e, own({ p: 2 })))).toBe('{"p":2}');
    expect(edit((e) => delete e['__proto__'])).toBeUndefined();
    expect(Object.hasOwn(readCanvas(doc).boards.b1!, '__proto__')).toBe(false);
  });
});

describe('task-review fix wave 2', () => {
  it('(1) recreates, under force, a board deleted since the read whose changed file comes with its entry as read, at that frame', () => {
    const doc = design();
    const base = designFiles(doc);
    transact(doc, () => {
      Y.deleteSlide(doc, 'b2');
      Y.deleteSlide(doc, 'b3');
    });
    const sent = { ...base, ...sentWith(base, (c) => (c.boards.b1!.x = 50)), [B2]: base[B2]!.replace('Body of b2', 'Body two') };
    const { out } = publish(doc, base, sent, true);
    expect(out.conflicts).toEqual([]);
    expect(boardFrame(doc, 'b2')).toEqual({ x: 500, y: 0, w: 1440, h: 1024 });
    expect(out.warnings.filter((w) => /no x|no w|frame is/.test(w.message))).toEqual([]);
    expect(Y.hasSlide(doc, 'b3')).toBe(false); // untouched: its deletion stands
    expect(boardFrame(doc, 'b1')!.x).toBe(50);
  });

  it('(M6 final review) recreates, under force, a board deleted since the read at its frame and title when the manifest comes back byte for byte as read', () => {
    const doc = design();
    const base = designFiles(doc);
    transact(doc, () => Y.deleteSlide(doc, 'b1'));
    setBoardFrame(doc, 'b2', { x: 777 }); // a survivor moved since the read: an unchanged manifest leaves it alone
    const sent = { [CANVAS_PATH]: base[CANVAS_PATH]!, [B1]: restyled(base) };
    const before = designFiles(doc);
    const refusedOut = publish(doc, base, sent);
    expect(refusedOut.out.conflicts.length).toBeGreaterThan(0); // not forced: refused, nothing written
    expect(refusedOut.updates).toBe(0);
    expect(designFiles(doc)).toEqual(before);
    const { out } = publish(doc, base, sent, true);
    expect(out.conflicts).toEqual([]);
    expect(boardFrame(doc, 'b1')).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(readCanvas(doc).boards.b1!.title).toBe('Phone');
    expect(readSlide(doc, 'b1').children[0]!.style.color).toBe('#123456');
    expect(out.warnings.filter((w) => /no x|no w|placed/.test(w.message))).toEqual([]);
    expect(boardFrame(doc, 'b2')!.x).toBe(777);
    // sent as read with nothing recreated, the same manifest stays no change at all, forced or not
    for (const force of [false, true]) expect(publish(doc, designFiles(doc), designFiles(doc), force).updates).toBe(0);
  });

  it('(2) merges an order that moved only another board around a board deleted since the read', () => {
    const doc = design([...BOARDS, { id: 'b4', at: { x: 4000, y: 0, w: 10, h: 10 } }]);
    const base = designFiles(doc);
    transact(doc, () => Y.deleteSlide(doc, 'b2'));
    const { out } = publish(doc, base, sentWith(base, (c) => (c.order = ['b2', 'b3', 'b4', 'b1'])));
    expect(out.conflicts).toEqual([]);
    expect(slideOrder(doc)).toEqual(['b3', 'b4', 'b1']);
  });
});

describe('Decision Log 38: C’s refusal on the single live pass writes nothing', () => {
  it('leaves the live doc untouched when only C’s half conflicts beside a clean manifest change', () => {
    const doc = design();
    const base = designFiles(doc);
    setStyle(doc, 'b1', 'title', { color: '#ff0000' });
    const before = designFiles(doc);
    const { out, updates } = publish(doc, base, sentWith(base, (c) => (c.boards.b2!.w = 1200), { [B1]: restyled(base) }));
    expect(out.conflicts).toEqual([{ path: B1, detail: 'element title: color changed since your read' }]);
    expect(updates).toBe(0);
    expect(designFiles(doc)).toEqual(before);
  });

  it('throws C’s plan FilesError beside a clean manifest change, writing nothing', () => {
    const doc = design();
    const base = designFiles(doc);
    let problems: string[] = [];
    expect(updatesOf(doc, () => (problems = refused(() => publishCanvas(doc, base, sentWith(base, (c) => (c.boards.b2!.w = 1200), { [B2]: '<section id="other"><script></script></section>' }), false))))).toHaveLength(0);
    expect(problems).toEqual([`${B2}: the section’s id is "other", not the file name’s "b2"`]);
    expect(designFiles(doc)).toEqual(base);
  });
});

describe('design-workbench fix wave', () => {
  it('(scalpel-1#1) refuses removing a board the owner re-stacked since the read, writing nothing; one left in its place goes; forced, the re-stacked one goes', () => {
    const doc = design();
    const base = designFiles(doc); // b1, b2, b3
    transact(doc, () => Y.setSlideKey(doc, 'b2', 'order', '0')); // the owner: b2 to the front
    expect(slideOrder(doc)).toEqual(['b2', 'b1', 'b3']);
    const before = designFiles(doc);
    const { out, updates } = publish(doc, base, { [B2]: null }); // its file and entry as read
    expect(out.conflicts).toEqual([{ path: CANVAS_PATH, detail: 'board b2: order changed since your read' }]);
    expect(updates).toBe(0);
    expect(designFiles(doc)).toEqual(before);
    expect(publish(doc, base, { [B3]: null }).out.conflicts).toEqual([]); // b3 stood still
    expect(publish(doc, base, { [B2]: null }, true).out.conflicts).toEqual([]);
    expect(slideOrder(doc)).toEqual(['b1']);
  });

  it('(scalpel-1#2) reports a missing-source board’s first file as added and changed when it is the empty board the model held', () => {
    const doc = design();
    const base = designFiles(doc);
    publish(doc, base, sentWith(base, (c) => ((c.boards.later = { x: 0, y: 2000, w: 390, h: 844 }), c.order.push('later'))));
    expect(isMissingSource(doc, 'later')).toBe(true);
    const read = designFiles(doc);
    const { out } = publish(doc, read, { [boardPath('later')]: '<section id="later"></section>' });
    expect(out.conflicts).toEqual([]);
    expect(out.added).toEqual([boardPath('later')]);
    expect(out.changed).toContain(boardPath('later'));
    expect(isMissingSource(doc, 'later')).toBe(false);
    expect(designFiles(doc)[boardPath('later')]).toBeDefined();
  });
});

// P4-B2 D19: a design's faces are a deck's, and so is the host's record of a Google Fonts face's fetch: compared without
// it, carried forward under the agent's edit of the face while it answers the face's request.
describe('the host’s record of a Google Fonts face', () => {
  const LORA = 'https://fonts.googleapis.com/css2?family=Lora';
  const record = { request: LORA, licence: 'OFL', licenceSrc: 'assets/gf-lora-OFL.txt', files: [{ src: 'assets/gf-lora-400.woff2', weight: '400', style: 'normal' }] };
  it('lets an agent who read before the fetch edit the face, and one who read after it neither forge nor drop it', () => {
    const doc = design();
    transact(doc, () => Y.setDeckEntry(doc, 'faces', 'lora', { family: 'Lora', href: LORA } as unknown as Y.Json));
    const before = designFiles(doc);
    transact(doc, () => Y.setDeckEntry(doc, 'faces', 'lora', { family: 'Lora', href: LORA, google: record } as unknown as Y.Json)); // the host's write
    const after = designFiles(doc);
    expect(manifest(after).faces).toEqual({ lora: { family: 'Lora', href: LORA } }); // the loader drops it from the agent's base
    expect(JSON.parse(after[CANVAS_PATH]!).faces.lora.google).toEqual(record); // the read shows it
    const forged = sentWith(after, (c) => void (c.faces!.lora = { family: 'Lora', href: LORA, google: { ...record, files: [] } }));
    expect(publish(doc, after, forged).out).toMatchObject({ changed: [], conflicts: [] });
    const edit = publish(doc, before, sentWith(before, (c) => void (c.faces!.lora = { family: 'Lora', href: `${LORA}&display=swap` }))).out;
    expect(edit.conflicts).toEqual([]);
    expect(readCanvas(doc).faces!.lora).toEqual({ family: 'Lora', href: `${LORA}&display=swap`, google: record });
  });
});
