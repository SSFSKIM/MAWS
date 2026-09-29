// The pasted atom's chip (C7 execution document, "Document model and serialisation"): the terminal's placeholder words,
// `Pasted text #1 +40 lines`, for a paste the send frames in the terminal's tags, and the unavailable rendering, `Pasted text #n · unavailable`, for a
// recalled placeholder whose body is not stored (it sends nothing). Deleted whole by Backspace (an atom).
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import type { PastedAttrs } from '../doc';

export const UNAVAILABLE_TITLE = 'The body of this paste is not stored';

// A numbered name (`Pasted text #k`, `Image #k`, `PDF #k`) takes the atom's place in the document, the number `display`
// and `pastedContents` give it; any other name (a dropped file's) stays as it is.
export function chipName(name: string, n: number | null): string {
  const numbered = /^(Pasted text|Image|PDF) #\d+$/.exec(name);
  return numbered && n !== null ? `${numbered[1]} #${n}` : name;
}

export function PastedView({ node, selected, decorations }: ReactNodeViewProps) {
  const { lines, text } = node.attrs as PastedAttrs;
  const n = decorations.map((d) => (d.spec as { pastedNumber?: number }).pastedNumber).find((v) => typeof v === 'number') ?? null;
  const name = chipName((node.attrs as PastedAttrs).name, n);
  const unavailable = text === null;
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-pasted={unavailable ? 'unavailable' : 'text'}
      title={unavailable ? UNAVAILABLE_TITLE : text.length > 400 ? `${text.slice(0, 400)}…` : text}
      className={`mx-px inline-flex items-center rounded-sm border px-1 align-baseline text-ui-sm ${unavailable ? 'border-dashed border-border-strong text-fg-faint' : 'border-border bg-bg-hover text-fg-muted'} ${selected ? 'outline outline-1 outline-accent' : ''}`}
    >
      {unavailable ? `${name} · unavailable` : `${name} +${lines} lines`}
    </NodeViewWrapper>
  );
}
