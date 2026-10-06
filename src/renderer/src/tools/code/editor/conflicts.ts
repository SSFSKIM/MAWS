// Git's conflict markers as blocks (E5 execution document, Interfaces *Conflict blocks*; M3's decisions): the inline
// model (VS Code's), since `@codemirror/merge` has none. `findConflicts` reads the marker grammar off a document; the
// view's extension keeps the blocks in a state field recomputed on every document change, colours each block's marker
// lines and its mine, base and theirs sections, and puts one widget above each block with Accept mine, Accept theirs
// and Accept both (disabled in a read-only view) and the sections' labels. Loaded with CodeView, never in the main
// chunk. The colours are code-theme.ts's, from tokens.
import { Compartment, EditorState, StateField, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { EDITOR_COPY } from '../copy';

// Module-level, as CodeView's other compartments: empty while the merge view is open, so the two never stack.
export const conflicts = new Compartment();

export interface ConflictBlock {
  from: number; // the `<<<<<<<` line's start
  to: number; // the end of the `>>>>>>>` line, its newline included when it has one
  mine: { from: number; to: number; label: string | null }; // the lines between `<<<<<<< ` and `|||||||`/`=======`; the name after `<<<<<<< `
  base: { from: number; to: number } | null; // the lines between `||||||| ` and `=======`, when present
  theirs: { from: number; to: number; label: string | null }; // the lines between `=======` and `>>>>>>> `
}

type Marker = 'start' | 'base' | 'separator' | 'end';

// A marker line: seven of its character alone, or followed by a space and a name (the separator is always bare).
function markerOf(line: string): Marker | null {
  const head = line.slice(0, 7);
  if (line.length > 7 && line[7] !== ' ') return null;
  if (head === '<<<<<<<') return 'start';
  if (head === '|||||||') return 'base';
  if (head === '>>>>>>>') return 'end';
  if (head === '=======' && line.length === 7) return 'separator';
  return null;
}

const nameOf = (line: string) => line.slice(8).trim() || null;

// Blocks in document order. A run is a block only when its markers come in the grammar's order (start, optionally
// base, separator, end) with no other marker line between; an out-of-order marker abandons the run, and a `<<<<<<<`
// always begins a new one, so a stray or nested start leaves the run it interrupts alone.
export function findConflicts(doc: Text): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  let run: { from: number; mineFrom: number; label: string | null; mineTo?: number; baseFrom?: number; baseTo?: number; theirsFrom?: number } | null = null;
  let stage: Marker | null = null; // the last marker of the current run
  let at = 0;
  for (const iter = doc.iterLines(); !iter.next().done; ) {
    const line = iter.value;
    const from = at;
    const next = Math.min(doc.length, from + line.length + 1); // the next line's start (the newline counted)
    at = from + line.length + 1;
    const first = line.charCodeAt(0);
    if (first !== 60 && first !== 124 && first !== 61 && first !== 62) continue; // < | = >
    const marker = markerOf(line);
    if (marker === null) continue;
    if (marker === 'start') {
      run = { from, mineFrom: next, label: nameOf(line) };
      stage = 'start';
    } else if (run && marker === 'base' && stage === 'start') {
      Object.assign(run, { mineTo: from, baseFrom: next });
      stage = 'base';
    } else if (run && marker === 'separator' && (stage === 'start' || stage === 'base')) {
      if (stage === 'start') run.mineTo = from;
      else run.baseTo = from;
      run.theirsFrom = next;
      stage = 'separator';
    } else if (run && marker === 'end' && stage === 'separator') {
      blocks.push({
        from: run.from,
        to: next,
        mine: { from: run.mineFrom, to: run.mineTo!, label: run.label },
        base: run.baseFrom === undefined ? null : { from: run.baseFrom, to: run.baseTo! },
        theirs: { from: run.theirsFrom!, to: from, label: nameOf(line) },
      });
      run = null;
      stage = null;
    } else {
      run = null;
      stage = null;
    }
  }
  return blocks;
}

// Replaces the block with the chosen side's lines ('both': mine, then theirs, nothing between). A block that ends the
// document without a final newline leaves it without one.
export function resolve(view: EditorView, block: ConflictBlock, choice: 'mine' | 'theirs' | 'both'): void {
  const { doc } = view.state;
  const side = (range: { from: number; to: number }) => doc.sliceString(range.from, range.to);
  let insert = choice === 'mine' ? side(block.mine) : choice === 'theirs' ? side(block.theirs) : side(block.mine) + side(block.theirs);
  if (block.to === doc.length && doc.lineAt(block.to).from !== block.to && insert.endsWith('\n')) insert = insert.slice(0, -1);
  view.dispatch({ changes: { from: block.from, to: block.to, insert }, userEvent: 'input.resolve', scrollIntoView: true });
}

// Rescanned on every document change (2.6 ms for a 4 MB file, the editor's cap, of 75,000 lines; measured 2026-10-06);
// a document with none keeps the one empty list, so its decorations are not rebuilt per keystroke.
export const conflictField = StateField.define<ConflictBlock[]>({
  create: (state) => findConflicts(state.doc),
  update(blocks, tr) {
    if (!tr.docChanged) return blocks;
    const next = findConflicts(tr.newDoc);
    return next.length === 0 && blocks.length === 0 ? blocks : next;
  },
});

// The blocks of a state, none when the extension is not configured (the merge view is open).
export const conflictsOf = (state: EditorState): readonly ConflictBlock[] => state.field(conflictField, false) ?? [];

// Moves the selection to the next (or previous) block's first line, wrapping, and scrolls it into view.
export function stepConflict(view: EditorView, direction: -1 | 1): boolean {
  const blocks = conflictsOf(view.state);
  if (blocks.length === 0) return false;
  const head = view.state.selection.main.head;
  const target = direction > 0 ? (blocks.find((block) => block.from > head) ?? blocks[0]) : (blocks.findLast((block) => block.to <= head && block.from < head) ?? blocks.at(-1)!);
  view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }), userEvent: 'select.conflict' });
  return true;
}

class ConflictActions extends WidgetType {
  constructor(
    readonly labels: { mine: string | null; theirs: string | null; base: boolean },
    readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: ConflictActions) {
    return other.readOnly === this.readOnly && other.labels.mine === this.labels.mine && other.labels.theirs === this.labels.theirs && other.labels.base === this.labels.base;
  }

  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'cm-conflict-actions';
    const act = (choice: 'mine' | 'theirs' | 'both') => (event: MouseEvent) => {
      event.preventDefault();
      // the block this widget sits above, as the document is now
      const at = view.posAtDOM(dom);
      const block = conflictsOf(view.state).find((candidate) => candidate.from === at);
      if (block && !view.state.readOnly) resolve(view, block, choice);
    };
    for (const [choice, label] of [
      ['mine', EDITOR_COPY.acceptMine],
      ['theirs', EDITOR_COPY.acceptTheirs],
      ['both', EDITOR_COPY.acceptBoth],
    ] as const) {
      const button = dom.appendChild(document.createElement('button'));
      button.type = 'button';
      button.className = 'cm-conflict-action';
      button.textContent = label;
      button.disabled = this.readOnly;
      button.addEventListener('click', act(choice));
    }
    const label = (section: 'mine' | 'base' | 'theirs', text: string) => {
      const span = dom.appendChild(document.createElement('span'));
      span.className = `cm-conflict-label cm-conflict-label-${section}`;
      span.textContent = text;
    };
    label('mine', EDITOR_COPY.mineLabel(this.labels.mine));
    if (this.labels.base) label('base', EDITOR_COPY.base);
    label('theirs', EDITOR_COPY.theirsLabel(this.labels.theirs));
    return dom;
  }

  ignoreEvent() {
    return true; // the editor leaves clicks in the widget to its buttons
  }
}

const markerLine = Decoration.line({ class: 'cm-conflict-marker' });
const sectionLine = { mine: Decoration.line({ class: 'cm-conflict-mine' }), base: Decoration.line({ class: 'cm-conflict-base' }), theirs: Decoration.line({ class: 'cm-conflict-theirs' }) };

function decorate(state: EditorState): DecorationSet {
  const { doc, readOnly } = state;
  const ranges: Range<Decoration>[] = [];
  const lineStarts = (from: number, to: number, decoration: Decoration) => {
    for (let pos = from; pos < to; pos = doc.lineAt(pos).to + 1) ranges.push(decoration.range(pos));
  };
  for (const block of conflictsOf(state)) {
    const labels = { mine: block.mine.label, theirs: block.theirs.label, base: block.base !== null };
    ranges.push(Decoration.widget({ widget: new ConflictActions(labels, readOnly), block: true, side: -1 }).range(block.from));
    ranges.push(markerLine.range(block.from));
    lineStarts(block.mine.from, block.mine.to, sectionLine.mine);
    if (block.base) {
      ranges.push(markerLine.range(block.mine.to));
      lineStarts(block.base.from, block.base.to, sectionLine.base);
    }
    ranges.push(markerLine.range(block.base ? block.base.to : block.mine.to));
    lineStarts(block.theirs.from, block.theirs.to, sectionLine.theirs);
    ranges.push(markerLine.range(block.theirs.to));
  }
  return Decoration.set(ranges, true);
}

// The blocks, their decorations and their actions: the `conflicts` compartment's content while no merge view is open.
export const conflictBlocks: Extension = [conflictField, EditorView.decorations.compute([conflictField, EditorState.readOnly], decorate)];
