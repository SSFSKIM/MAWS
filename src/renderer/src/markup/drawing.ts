// P3-G (§D4.2, M4's decisions): Mark-up's drawing as plain data, a list of marks in the surface's CSS px (the surface as
// it measured when the still was taken), each with its tool and ink. `drawOps` is the one rendering both the live SVG
// (MarkupLayer) and the composited PNG (composite.ts) paint, so the screen and the attachment agree. Undo takes back the
// last mark, or a Clear.

export type MarkupTool = 'pen' | 'box' | 'arrow' | 'text';
export const MARKUP_TOOLS: readonly MarkupTool[] = ['pen', 'box', 'arrow', 'text'];
// Claude's five inks; they mark content, not chrome, so they are the same in both themes (tokens `--markup-ink-*`).
export type InkName = 'red' | 'blue' | 'green' | 'black' | 'white';
export const INKS: readonly InkName[] = ['red', 'blue', 'green', 'black', 'white'];

export const STROKE_WIDTH = 4;
export const TEXT_SIZE = 16; // semibold
export const HALO_WIDTH = 2; // around each glyph, in the opposite ink
const ARROW_HEAD = 14; // the head's sides, back from the tip
const ARROW_ANGLE = Math.PI / 7; // each side off the shaft
const MIN_EXTENT = 1; // a box or an arrow shorter than this on both axes is a click, not a mark

export interface Point {
  x: number;
  y: number;
}

export type Mark =
  | { tool: 'pen'; ink: InkName; points: readonly Point[] }
  | { tool: 'box' | 'arrow'; ink: InkName; from: Point; to: Point }
  | { tool: 'text'; ink: InkName; at: Point; text: string }; // `at`: the top-left of the text

export interface Drawing {
  marks: readonly Mark[];
  past: readonly (readonly Mark[])[]; // what Undo restores, newest last
}

export const EMPTY_DRAWING: Drawing = Object.freeze({ marks: [], past: [] }) as Drawing;

export const addMark = (drawing: Drawing, mark: Mark): Drawing => ({ marks: [...drawing.marks, mark], past: [...drawing.past, drawing.marks] });
export const undoMark = (drawing: Drawing): Drawing =>
  drawing.past.length === 0 ? drawing : { marks: drawing.past[drawing.past.length - 1], past: drawing.past.slice(0, -1) };
export const clearMarks = (drawing: Drawing): Drawing => (drawing.marks.length === 0 ? drawing : { marks: [], past: [...drawing.past, drawing.marks] });
export const canUndo = (drawing: Drawing): boolean => drawing.past.length > 0;
export const canClear = (drawing: Drawing): boolean => drawing.marks.length > 0;

// Whether a finished mark is worth keeping: a pen's single point is a dot; a box or an arrow needs an extent.
export function isDrawn(mark: Mark): boolean {
  switch (mark.tool) {
    case 'pen':
      return mark.points.length > 0;
    case 'box':
    case 'arrow':
      return Math.abs(mark.to.x - mark.from.x) >= MIN_EXTENT || Math.abs(mark.to.y - mark.from.y) >= MIN_EXTENT;
    case 'text':
      return mark.text.trim() !== '';
  }
}

export const haloOf = (ink: InkName): InkName => (ink === 'white' ? 'black' : 'white');

export type DrawOp = { kind: 'path'; ink: InkName; d: string } | { kind: 'text'; ink: InkName; halo: InkName; x: number; y: number; text: string };

const n = (value: number): string => String(Math.round(value * 100) / 100);
const at = (p: Point): string => `${n(p.x)} ${n(p.y)}`;

function arrowPath(from: Point, to: Point): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const side = (turn: number): Point => ({ x: to.x - ARROW_HEAD * Math.cos(angle + turn), y: to.y - ARROW_HEAD * Math.sin(angle + turn) });
  return `M${at(from)}L${at(to)}M${at(side(ARROW_ANGLE))}L${at(to)}L${at(side(-ARROW_ANGLE))}`;
}

// The marks as draw operations: stroked paths (SVG path data, which Path2D takes as is) and haloed text at its baseline.
export function drawOps(marks: readonly Mark[]): DrawOp[] {
  return marks.map((mark): DrawOp => {
    switch (mark.tool) {
      case 'pen': {
        const [first, ...rest] = mark.points;
        return { kind: 'path', ink: mark.ink, d: `M${at(first)}${(rest.length > 0 ? rest : [first]).map((p) => `L${at(p)}`).join('')}` };
      }
      case 'box': {
        const [x1, x2] = [Math.min(mark.from.x, mark.to.x), Math.max(mark.from.x, mark.to.x)];
        const [y1, y2] = [Math.min(mark.from.y, mark.to.y), Math.max(mark.from.y, mark.to.y)];
        return { kind: 'path', ink: mark.ink, d: `M${n(x1)} ${n(y1)}H${n(x2)}V${n(y2)}H${n(x1)}Z` };
      }
      case 'arrow':
        return { kind: 'path', ink: mark.ink, d: arrowPath(mark.from, mark.to) };
      case 'text':
        return { kind: 'text', ink: mark.ink, halo: haloOf(mark.ink), x: mark.at.x, y: mark.at.y + TEXT_SIZE, text: mark.text };
    }
  });
}

export const inkToken = (ink: InkName): string => `--markup-ink-${ink}`;
