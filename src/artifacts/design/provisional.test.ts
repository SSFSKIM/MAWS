// P4-A2 G2.2 (docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md, G-R6): a new board's frame from a partial
// canvas.json: none until its entry parses whole, then where the publish will put it (the entry's keys, a missing size
// from its file's data-size or the slide's, a missing place after the right-most board), none for a frame the publish
// would refuse.
import { describe, expect, it } from 'vitest';
import { applyV2, newDoc, stateV2, type Doc } from '../yjs';
import { boardPath, CANVAS_PATH } from './canvas';
import { BOARDS, design } from './fixtures/support';
import { boardFrame, designFiles } from './model';
import { provisionalBoardFrame } from './provisional';
import { publishCanvas } from './publish';

const BOARD = '<section id="b4" style="background:#ffffff"><h1 id="t4" style="font-size:72px">New</h1></section>';
const SIZED = BOARD.replace('<section id="b4"', '<section id="b4" data-size="800x600"');

/** The canvas.json the agent sends: the one it read with `entry` for board b4 (none when undefined). */
function manifest(doc: Doc, entry?: Record<string, unknown>): string {
  const read = JSON.parse(designFiles(doc)[CANVAS_PATH]!) as { boards: Record<string, unknown>; order: string[] };
  if (entry) read.boards.b4 = entry;
  read.order.push('b4');
  return JSON.stringify(read);
}

/** Where the real publish puts b4, on a copy of the design. */
function published(doc: Doc, canvas: string, board: string) {
  const copy = newDoc();
  applyV2(copy, stateV2(doc));
  const out = publishCanvas(copy, designFiles(doc), { [CANVAS_PATH]: canvas, [boardPath('b4')]: board }, false);
  expect(out.conflicts).toEqual([]);
  return boardFrame(copy, 'b4');
}

describe('provisionalBoardFrame', () => {
  it('gives no frame until the board’s entry parses whole, then the entry’s, as the publish places it', () => {
    const doc = design();
    const canvas = manifest(doc, { x: 3200, y: 40, w: 640, h: 480, title: 'Card' });
    const entryEnds = canvas.indexOf('"title":"Card"}') + '"title":"Card"}'.length;
    for (let cut = 0; cut < entryEnds; cut++) expect(provisionalBoardFrame(doc, 'b4', canvas.slice(0, cut), true, BOARD), canvas.slice(0, cut)).toBeNull();
    const frame = { x: 3200, y: 40, w: 640, h: 480 };
    expect(provisionalBoardFrame(doc, 'b4', canvas.slice(0, entryEnds), true, BOARD)).toEqual(frame);
    expect(provisionalBoardFrame(doc, 'b4', canvas, false, BOARD)).toEqual(frame);
    expect(published(doc, canvas, BOARD)).toEqual(frame);
  });

  it('completes an entry without a size or a place as the publish does', () => {
    const doc = design();
    const right = Math.max(...BOARDS.map((b) => b.at.x + b.at.w));
    const placed = manifest(doc, { x: 10, y: 20 });
    expect(provisionalBoardFrame(doc, 'b4', placed, false, SIZED)).toEqual({ x: 10, y: 20, w: 800, h: 600 });
    expect(published(doc, placed, SIZED)).toEqual({ x: 10, y: 20, w: 800, h: 600 });
    expect(provisionalBoardFrame(doc, 'b4', placed, false, BOARD), 'no data-size: the slide’s size').toEqual({ x: 10, y: 20, w: 1920, h: 1080 });
    const sized = manifest(doc, { w: 300, h: 200 });
    expect(provisionalBoardFrame(doc, 'b4', sized, false, BOARD)).toEqual({ x: right + 100, y: 0, w: 300, h: 200 });
    expect(published(doc, sized, BOARD)).toEqual({ x: right + 100, y: 0, w: 300, h: 200 });
  });

  it('gives no frame for a board the manifest does not name, a frame the publish would refuse, or a manifest that does not parse', () => {
    const doc = design();
    expect(provisionalBoardFrame(doc, 'b4', manifest(doc), false, BOARD)).toBeNull();
    expect(provisionalBoardFrame(doc, 'b4', manifest(doc, { x: 0, y: 0, w: 0, h: 600 }), false, BOARD)).toBeNull();
    expect(provisionalBoardFrame(doc, 'b4', manifest(doc, { x: 0, y: 0, w: 20000, h: 600 }), false, BOARD)).toBeNull();
    expect(provisionalBoardFrame(doc, 'b4', manifest(doc, { x: 0, y: 0 }), false, BOARD.replace('<section id="b4"', '<section id="b4" data-size="big"'))).toBeNull();
    expect(provisionalBoardFrame(doc, 'b4', manifest(doc, { x: 'left', y: 0, w: 10, h: 10 }), false, BOARD)).toBeNull();
    expect(provisionalBoardFrame(doc, 'b4', 'not json', false, BOARD)).toBeNull();
  });
});
