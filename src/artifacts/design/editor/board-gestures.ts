// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the parent's §1 "The workbench"): where a
// board frame goes under a move or resize gesture, in world px. C's snapping (`snapMove`, `snapResize`) runs over the
// sibling boards' boxes with no lines of its own (the world has no edges or margins), so a board meets another's edge,
// centre or an equal gap in its row within C's six screen pixels at the zoom; ⌘ places it freely. A frame is whole
// pixels; one the model's cap refuses keeps its requested size and names the cap (`frameProblems`, the writers' one
// rule): the workbench shows the refusal and writes nothing, never a clamped frame.
import { snapMove, snapResize, SNAP_SCREEN_PX, type Guide, type Handle, type Pt } from '../../slides/geometry';
import { frameProblems, type BoardFrame } from '../canvas';

const NO_LINES = { x: [], y: [] };
const MIN_SIDE = 1;

export interface MovedFrame {
  frame: BoardFrame;
  /** World px. */
  guides: Guide[];
}
export interface ResizedFrame extends MovedFrame {
  /** Why the model refuses `frame` (each naming the board); empty when it takes it. */
  problems: string[];
}

const whole = (f: BoardFrame): BoardFrame => ({ x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h) });

/** `start` moved by the world delta `d`, snapped to `siblings` unless `snap` is off. */
export function movedFrame(start: BoardFrame, d: Pt, siblings: readonly BoardFrame[], zoom: number, snap: boolean): MovedFrame {
  const moved = { ...start, x: start.x + d.x, y: start.y + d.y };
  if (!snap) return { frame: whole(moved), guides: [] };
  const snapped = snapMove(moved, { lines: NO_LINES, siblings }, SNAP_SCREEN_PX / zoom);
  return { frame: whole({ ...moved, x: snapped.x, y: snapped.y }), guides: snapped.guides };
}

/** `start` with the edges `handle` names dragged by the world delta `d` (a pixel a side at least), snapped unless off. */
export function resizedFrame(boardId: string, start: BoardFrame, handle: Handle, d: Pt, siblings: readonly BoardFrame[], zoom: number, snap: boolean): ResizedFrame {
  const f = { ...start };
  if (handle.includes('e')) f.w = Math.max(MIN_SIDE, start.w + d.x);
  if (handle.includes('w')) {
    f.w = Math.max(MIN_SIDE, start.w - d.x);
    f.x = start.x + start.w - f.w;
  }
  if (handle.includes('s')) f.h = Math.max(MIN_SIDE, start.h + d.y);
  if (handle.includes('n')) {
    f.h = Math.max(MIN_SIDE, start.h - d.y);
    f.y = start.y + start.h - f.h;
  }
  let guides: Guide[] = [];
  let frame = f;
  if (snap) {
    const snapped = snapResize(f, handle, { lines: NO_LINES, siblings }, SNAP_SCREEN_PX / zoom, MIN_SIDE);
    frame = snapped.box;
    guides = snapped.guides;
  }
  const out = whole(frame);
  return { frame: out, guides, problems: frameProblems(boardId, out) };
}
