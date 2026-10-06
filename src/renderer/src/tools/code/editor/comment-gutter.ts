// The comment gutter (E5 execution document, Interfaces *The comment gutter and the anchor seam*; M3's decisions): a
// column after the line numbers with one mark per line, shown while its gutter element is hovered (code-theme.ts, which
// also fixes the column's width), in read-only views as in editing ones. A mark's click names its line to the listener,
// which builds X10's file-line anchor and opens the composer seam. Loaded with CodeView, never in the main chunk.
import { Compartment, type Extension } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';
import { EDITOR_COPY } from '../copy';

// Module-level, as CodeView's other compartments.
export const comments = new Compartment();

export type CommentListener = (line: number) => void;

// One line's mark. It carries the line it was drawn for: the gutter redraws on every document change, and a mark whose
// line number moved is replaced, so a click names the line the owner sees beside it (not one resolved from the pointer's
// height, which needs layout).
class CommentMark extends GutterMarker {
  constructor(
    readonly line: number,
    readonly onComment: CommentListener,
  ) {
    super();
  }

  eq(other: CommentMark) {
    return other.line === this.line && other.onComment === this.onComment;
  }

  toDOM() {
    const mark = document.createElement('span');
    mark.className = 'cm-comment-mark';
    mark.setAttribute('role', 'button');
    mark.setAttribute('aria-label', EDITOR_COPY.comment(this.line));
    mark.title = EDITOR_COPY.comment(this.line);
    mark.textContent = '+';
    mark.addEventListener('mousedown', (event) => event.preventDefault()); // the editor keeps its focus and selection
    mark.addEventListener('click', (event) => {
      event.preventDefault();
      this.onComment(this.line);
    });
    return mark;
  }
}

export function commentGutter(onComment: CommentListener): Extension {
  return gutter({
    class: 'cm-commentGutter',
    lineMarker: (view, block) => new CommentMark(view.state.doc.lineAt(block.from).number, onComment),
  });
}
