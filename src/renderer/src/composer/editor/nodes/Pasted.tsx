// The pasted atom's chip (C7 execution document, "Document model and serialisation"): the terminal's placeholder words,
// `Pasted text #1 +40 lines`, for a paste the send frames in the terminal's tags, and the unavailable rendering, `Pasted text #n · unavailable`, for a
// recalled placeholder whose body is not stored (it sends nothing). Deleted whole by Backspace (an atom). UX wave U4a M6
// (l3-input-09; decision 23): a click opens a small popover with the chip's text and "Show in text field", which
// replaces the chip with that text as one undoable step; a chip whose text was not kept says so there and offers
// nothing. A dropped text file's chip is the same node and opens the same way.
import { closeHistory } from '@tiptap/pm/history';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { NOTE, POPOVER } from '../../frame/chip-style';
import { plainTextSlice } from '../clipboard';
import type { PastedAttrs } from '../doc';

export const UNAVAILABLE_TITLE = 'The body of this paste is not stored';
export const SHOW_IN_TEXT_FIELD = 'Show in text field';

// A numbered name (`Pasted text #k`, `Image #k`, `PDF #k`) takes the atom's place in the document, the number `display`
// and `pastedContents` give it; any other name (a dropped file's) stays as it is.
export function chipName(name: string, n: number | null): string {
  const numbered = /^(Pasted text|Image|PDF) #\d+$/.exec(name);
  return numbered && n !== null ? `${numbered[1]} #${n}` : name;
}

export function PastedView({ node, selected, decorations, editor, getPos }: ReactNodeViewProps) {
  const [open, setOpen] = useState(false);
  const { lines, text } = node.attrs as PastedAttrs;
  const n = decorations.map((d) => (d.spec as { pastedNumber?: number }).pastedNumber).find((v) => typeof v === 'number') ?? null;
  const name = chipName((node.attrs as PastedAttrs).name, n);
  const unavailable = text === null;
  // The chip's text in its place, as a paste of it would land (one paragraph a line), in a history step of its own
  const showInTextField = () => {
    const at = getPos();
    setOpen(false);
    if (text === null || typeof at !== 'number' || !editor.isEditable) return;
    const { state, view } = editor;
    view.dispatch(closeHistory(state.tr).replaceRange(at, at + node.nodeSize, plainTextSlice(state.schema, text)).scrollIntoView());
    view.focus();
  };
  return (
    <NodeViewWrapper as="span" contentEditable={false} data-pasted={unavailable ? 'unavailable' : 'text'} title={unavailable ? UNAVAILABLE_TITLE : text.length > 400 ? `${text.slice(0, 400)}…` : text} className="mx-px inline-flex align-baseline">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`inline-flex items-center rounded-sm border px-1 text-ui-sm ${unavailable ? 'border-dashed border-border-strong text-fg-faint' : 'border-border bg-bg-hover text-fg-muted'} ${selected || open ? 'outline outline-1 outline-accent' : ''}`}
          >
            {unavailable ? `${name} · unavailable` : `${name} +${lines} lines`}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          {/* the composer's popup: a key in it is the composer's, never a pane's (C5's sink rule) */}
          <Popover.Content
            data-key-sink="composer"
            aria-label={name}
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            onCloseAutoFocus={(event) => {
              event.preventDefault(); // back to the box, not to the chip
              editor.view.focus();
            }}
            className={`${POPOVER} flex w-80 flex-col p-0`}
          >
            {unavailable ? (
              <p className={`${NOTE} m-0`}>{UNAVAILABLE_TITLE}</p>
            ) : (
              <>
                <pre className="m-0 max-h-60 overflow-auto px-2 py-1.5 font-mono text-ui-sm break-words whitespace-pre-wrap text-fg">{text}</pre>
                <div className="border-t border-border p-1">
                  <button
                    type="button"
                    disabled={!editor.isEditable}
                    onClick={showInTextField}
                    className="flex h-7 w-full items-center rounded-sm px-2 text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
                  >
                    {SHOW_IN_TEXT_FIELD}
                  </button>
                </div>
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </NodeViewWrapper>
  );
}
