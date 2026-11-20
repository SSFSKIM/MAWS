// The row note and the pointed-row line (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md, "What the
// cut builds" and rule 5): what a row keeps for the pointer and the keyboard. Pointing at the row shows it after
// POINTING_DELAY_MS; focus anywhere in the row shows it at once; it closes once the pointer and the focus have both left
// (G15). Its element stays mounted, hidden at rest, so the row's `aria-describedby` reads it at all times. No frame is
// waited on: a hidden window draws none, and the reveal must hold without a repaint.
//
// Two forms. A `note` (a row's helper text) takes no height at rest and opens under the row with the shared disclosure
// motion, pushing the rows below down (the placement the owner accepted on Settings). A `line` (a second line under a
// row's name: a plugin's description) keeps its line's height at rest, undrawn, and is drawn in place (the placement the
// owner accepted on plugin rows). The prototype placement: under `[data-note-placement="overlay"]` on the document root
// (the `note-overlay` variant, styles/app.css), both float at the row's lower edge over what follows, so nothing under
// the pointer moves and no height is spent at rest. The float lets the pointer through to the row it covers, so moving
// down leaves the row the note belongs to; its words are then read, not pointed into. The row the note belongs to is
// `relative` for it.
import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { useDisclosureMotion } from './disclosure';
import { POINTING_DELAY_MS } from './pointing';

export type RowNoteForm = 'note' | 'line';

export interface RowNoteRowProps {
  'aria-describedby': string;
  onPointerEnter(): void;
  onPointerLeave(): void;
  onFocus(): void;
  onBlur(event: FocusEvent<HTMLElement>): void;
}

export interface RowNoteState {
  id: string; // the note's element id, for a control inside the row that should carry the description too
  open: boolean;
  rowProps: RowNoteRowProps; // spread onto the row
}

export function useRowNote(): RowNoteState {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Where the pointer and the focus are, apart from whether the note may open: the delay gates only the opening of a
  // closed note, and an open one stays open while either is in the row (focus handed to a pointer still inside, or
  // back, never closes it).
  const pointerInside = useRef(false);
  const focusInside = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const settle = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    id,
    open,
    rowProps: {
      'aria-describedby': id,
      onPointerEnter: () => {
        pointerInside.current = true;
        settle();
        timer.current = setTimeout(() => {
          timer.current = null;
          if (pointerInside.current) setOpen(true);
        }, POINTING_DELAY_MS);
      },
      onPointerLeave: () => {
        pointerInside.current = false;
        settle();
        if (!focusInside.current) setOpen(false);
      },
      onFocus: () => {
        focusInside.current = true;
        setOpen(true);
      },
      onBlur: (event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focusInside.current = false;
        if (!pointerInside.current) setOpen(false);
      },
    },
  };
}

// A note's outer element is placed and moved, its inner one drawn: the outer carries no border, so the height the
// motion opens to is the height it rests at. A line is one element, placed and drawn, whose words are text: it rests
// `visibility: hidden`, which its descendants inherit, and a description is read through a hidden element's own text.
const PLACE = 'flow-root note-overlay:pointer-events-none note-overlay:absolute note-overlay:inset-x-0 note-overlay:top-full note-overlay:z-10';
const NOTE = 'mt-1 mb-1 w-fit max-w-[30rem] rounded-md border border-border-strong bg-bg-overlay px-2.5 py-1.5 text-ui-sm leading-normal text-fg-muted [overflow-wrap:anywhere] note-overlay:mt-0.5 note-overlay:shadow-float';
const LINE = 'text-ui-sm leading-normal text-fg-muted [overflow-wrap:anywhere] note-overlay:mt-0.5 note-overlay:w-fit note-overlay:max-w-[30rem] note-overlay:rounded-md note-overlay:border note-overlay:border-border-strong note-overlay:bg-bg-overlay note-overlay:px-2.5 note-overlay:py-1.5 note-overlay:shadow-float';

// `className` places the note in its row (a grid column, an indent); the note draws itself. A line's children are text.
export function RowNote({ note, form = 'note', className = '', children }: { note: RowNoteState; form?: RowNoteForm; className?: string; children: ReactNode }) {
  if (form === 'line')
    return (
      <div id={note.id} data-row-note="line" data-open={note.open || undefined} style={note.open ? undefined : RESERVED} className={`${PLACE} ${LINE} ${className}`}>
        {children}
      </div>
    );
  return (
    <FoldingNote note={note} className={className}>
      {children}
    </FoldingNote>
  );
}
const RESERVED = { visibility: 'hidden' } as const;

function FoldingNote({ note, className, children }: { note: RowNoteState; className: string; children: ReactNode }) {
  const { ref, mounted } = useDisclosureMotion<HTMLDivElement>(note.open);
  return (
    <div ref={ref} id={note.id} data-row-note="note" data-open={note.open || undefined} hidden={!mounted} className={`${PLACE} ${className}`}>
      <div className={NOTE}>{children}</div>
    </div>
  );
}
