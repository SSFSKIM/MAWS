// P3-E1 M1: the design model's reads on C's roots (a board is C's slide node with plain x, y, w, h and title keys), the
// files `artifact_read` returns, the missing-source marker, and the host's repair of a frame concurrency merged invalid.
import { describe, expect, it } from 'vitest';
import { slideFile } from '../slides/model';
import { transact } from '../yjs';
import * as Y from '../yjs/slides';
import { boardPath, CANVAS_PATH, parseCanvasJson, serializeCanvasJson } from './canvas';
import { boardFrame, designFiles, designPaths, isMissingSource, MISSING_SOURCE_KEY, readCanvas, repairBoards, writeBoardEntry, writeCanvasKeys } from './model';
import { BOARDS, design, replicaFrom, sync, updatesOf } from './fixtures/support';

describe('the design’s files', () => {
  it('reads the manifest from the deck root and the boards’ plain keys, then each board’s file in manifest order', () => {
    const doc = design();
    const files = designFiles(doc);
    expect(Object.keys(files)).toEqual([CANVAS_PATH, boardPath('b1'), boardPath('b2'), boardPath('b3')]);
    expect(designPaths(doc)).toEqual(Object.keys(files));
    expect(JSON.parse(files[CANVAS_PATH]!)).toEqual({
      v: 1,
      title: 'Design',
      boards: { b1: { ...BOARDS[0]!.at, title: 'Phone' }, b2: BOARDS[1]!.at, b3: BOARDS[2]!.at },
      order: ['b1', 'b2', 'b3'],
    });
    expect(files[boardPath('b1')]).toMatch(/^<section id="b1"/);
    expect(files[boardPath('b1')]).not.toMatch(/390|844/); // the size is the manifest's, never the file's
  });

  it('is a fixed point: the manifest it writes loads back to itself, unknown keys at the top and in a board included', () => {
    const doc = design();
    transact(doc, () => {
      writeCanvasKeys(doc, { boards: {}, order: [], zeta: { kept: [1, 2] }, faces: { lora: { family: 'Lora', src: 'assets/lora.woff2' } }, dsOverrides: { '--ds-color-accent': '#c00' }, designSystems: [{ id: 'x' }] });
      writeBoardEntry(doc, 'b2', { locked: true, meta: { by: 'agent' } });
    });
    const text = designFiles(doc)[CANVAS_PATH]!;
    const parsed = parseCanvasJson(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeCanvasJson(parsed.canvas)).toBe(text);
    expect(parsed.canvas.zeta).toEqual({ kept: [1, 2] });
    expect(parsed.canvas.boards.b2).toEqual({ ...BOARDS[1]!.at, locked: true, meta: { by: 'agent' } });
    expect(parsed.canvas.faces).toEqual({ lora: { family: 'Lora', src: 'assets/lora.woff2' } });
    expect(readCanvas(doc)).toEqual(parsed.canvas);
  });

  it('answers a held board’s source verbatim, nothing trimmed', () => {
    const doc = design();
    const source = '<section id="b2"><p id="p" style="font-size:20px">Kept</p><script>x()</script></section>';
    transact(doc, () => Y.setSlideKey(doc, 'b2', 'held', { source, reasons: ['a slide file holds no script'] }));
    expect(designFiles(doc)[boardPath('b2')]).toBe(source);
  });

  it('lists a missing-source board in the manifest without inventing its file', () => {
    const doc = design();
    transact(doc, () => {
      Y.createSlide(doc, 'gone', { [MISSING_SOURCE_KEY]: true, order: 'a9' }, '');
      writeBoardEntry(doc, 'gone', { x: 5000, y: 0, w: 390, h: 844, title: 'Promised' });
    });
    expect(isMissingSource(doc, 'gone')).toBe(true);
    expect(isMissingSource(doc, 'b1')).toBe(false);
    const files = designFiles(doc);
    expect(files[boardPath('gone')]).toBeUndefined();
    expect(designPaths(doc)).toEqual(Object.keys(files));
    expect(JSON.parse(files[CANVAS_PATH]!).boards.gone).toEqual({ x: 5000, y: 0, w: 390, h: 844, title: 'Promised' });
    expect(JSON.parse(files[CANVAS_PATH]!).order).toEqual(['b1', 'b2', 'b3', 'gone']);
  });

  it('reads a board’s frame only when it is whole', () => {
    const doc = design();
    expect(boardFrame(doc, 'b3')).toEqual(BOARDS[2]!.at);
    transact(doc, () => Y.deleteSlideKey(doc, 'b3', 'h'));
    expect(boardFrame(doc, 'b3')).toBeNull();
    expect(boardFrame(doc, 'nope')).toBeNull();
  });
});

describe('two replicas writing one board’s frame', () => {
  it('converge with both keys when one moves the board and the other resizes it', () => {
    const base = design();
    const a = replicaFrom(base, 10);
    const b = replicaFrom(base, 20);
    transact(a, () => writeBoardEntry(a, 'b2', { x: 640 }));
    transact(b, () => writeBoardEntry(b, 'b2', { w: 1200 }));
    sync(a, b);
    expect(boardFrame(a, 'b2')).toEqual({ x: 640, y: 0, w: 1200, h: 1024 });
    expect(boardFrame(b, 'b2')).toEqual(boardFrame(a, 'b2'));
    expect(designFiles(a)).toEqual(designFiles(b));
  });
});

describe('repairBoards (the host’s repair of frames)', () => {
  it('writes nothing on a valid design', () => {
    const doc = design();
    expect(updatesOf(doc, () => expect(repairBoards(doc)).toBe(0))).toHaveLength(0);
  });

  it('brings a merge of two valid writes over the area cap back inside it, deterministically on every replica', () => {
    const base = design([{ id: 'big', at: { x: 0, y: 0, w: 8192, h: 4096 } }]);
    const a = replicaFrom(base, 10);
    const b = replicaFrom(base, 20);
    transact(a, () => writeBoardEntry(a, 'big', { w: 16_384 })); // 16384×4096: inside
    transact(b, () => writeBoardEntry(b, 'big', { h: 8192 })); // 8192×8192: inside
    sync(a, b);
    expect(boardFrame(a, 'big')).toEqual({ x: 0, y: 0, w: 16_384, h: 8192 }); // the merge: 2^27 px
    const c = replicaFrom(a, 30);
    expect(repairBoards(a)).toBe(1);
    expect(repairBoards(c)).toBe(1);
    expect(boardFrame(a, 'big')).toEqual({ x: 0, y: 0, w: 16_384, h: 4096 });
    expect(boardFrame(c, 'big')).toEqual(boardFrame(a, 'big'));
  });

  it('completes a frame a replica left partial or unreadable with the warned defaults, scoped to the boards given', () => {
    const doc = design();
    transact(doc, () => {
      Y.deleteSlideKey(doc, 'b2', 'w');
      Y.setSlideKey(doc, 'b2', 'x', 'left');
      Y.deleteSlideKey(doc, 'b3', 'y');
    });
    expect(repairBoards(doc, { boards: ['b3'] })).toBe(1);
    expect(boardFrame(doc, 'b3')).toEqual({ ...BOARDS[2]!.at, y: 0 });
    expect(boardFrame(doc, 'b2')).toBeNull();
    expect(repairBoards(doc)).toBe(2);
    // x after the right-most other board (b3 at 2000 + 1080) and a 100 px gap; w the default 1920
    expect(boardFrame(doc, 'b2')).toEqual({ x: 3180, y: 0, w: 1920, h: 1024 });
  });

  it('leaves a missing-source board’s frame to the same rules and never touches its marker', () => {
    const doc = design();
    transact(doc, () => {
      Y.createSlide(doc, 'gone', { [MISSING_SOURCE_KEY]: true, order: 'a9' }, '');
      writeBoardEntry(doc, 'gone', { x: 0, y: 0, w: 390, h: 844 });
    });
    expect(repairBoards(doc)).toBe(0);
    expect(slideFile(doc, 'gone')).toBe('<section id="gone">\n</section>\n');
    expect(isMissingSource(doc, 'gone')).toBe(true);
  });
});
