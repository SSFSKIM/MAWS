// The row note and the pointed-row line (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md, "What the
// cut builds" and rule 5): what a row keeps for the pointer and the keyboard. Pointing at the row shows it after
// POINTING_DELAY_MS; focus anywhere in the row shows it at once; it closes once the pointer and the focus have both left
// (G15). Its element stays mounted, hidden at rest, so the row's `aria-describedby` reads it at all times. No frame is
// waited on: a hidden window draws none, and the reveal must hold without a repaint.
//
// It floats over the rows that follow (the owner's choice of 2026-11-20 between the two placements, shown as pictures):
// nothing under the pointer moves and no height is spent at rest, open or closed. It is placed at its row's lower edge
// (its parent, which is `relative`), above what follows, and lets the pointer through to the row it covers, so moving
// down leaves the row it belongs to; its words are read, not pointed into. It opens with the shared disclosure motion.
// Where opening down would pass the bottom of the scroll area it sits in (the nearest ancestor that clips, else the
// window), and there is room above, it opens upward over the row above instead (`data-side="up"`); where there is room
// neither way it opens down, inside the scroll area, which scrolls to it. The side is read when it opens, from layout
// alone, and written to the element, not rendered. The pointed-row line (a plugin's description under its name) is
// this same note: both float.
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { useDisclosureMotion } from './disclosure';
import { POINTING_DELAY_MS } from './pointing';

export interface RowNoteRowProps {
  'aria-describedby': string;
  onPointerEnter(event: PointerEvent<HTMLElement>): void;
  onPointerLeave(event: PointerEvent<HTMLElement>): void;
  onFocus(event: ReactFocusEvent<HTMLElement>): void;
  onBlur(event: ReactFocusEvent<HTMLElement>): void;
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
  // back, never closes it). Focus is read from the document, not from the row's blur: a focused control the row
  // removes takes the focus with it and no blur reaches the row, so while the note is open the next focus anywhere
  // outside the row closes it, as does the pointer leaving.
  const row = useRef<HTMLElement | null>(null);
  const pointerInside = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusInside = () => row.current !== null && row.current.contains(document.activeElement);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const focusMoved = (event: FocusEvent) => {
      if (row.current !== null && !row.current.contains(event.target as Node | null) && !pointerInside.current) setOpen(false);
    };
    document.addEventListener('focusin', focusMoved, true);
    return () => document.removeEventListener('focusin', focusMoved, true);
  }, [open]);
  const settle = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    id,
    open,
    rowProps: {
      'aria-describedby': id,
      onPointerEnter: (event) => {
        row.current = event.currentTarget;
        pointerInside.current = true;
        settle();
        timer.current = setTimeout(() => {
          timer.current = null;
          if (pointerInside.current) setOpen(true);
        }, POINTING_DELAY_MS);
      },
      onPointerLeave: (event) => {
        row.current = event.currentTarget;
        pointerInside.current = false;
        settle();
        if (!focusInside()) setOpen(false);
      },
      onFocus: (event) => {
        row.current = event.currentTarget;
        setOpen(true);
      },
      onBlur: (event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (!pointerInside.current) setOpen(false);
      },
    },
  };
}

// The outer element is placed and moved, its inner one drawn: the outer carries no border, so the height the motion
// opens to is the height it rests at; its padding keeps the card off the row's edge either way it opens.
const PLACE = 'pointer-events-none absolute inset-x-0 top-full z-10 flow-root py-0.5 data-[side=up]:top-auto data-[side=up]:bottom-full';
const NOTE = 'w-fit max-w-[30rem] rounded-md border border-border-strong bg-bg-overlay px-2.5 py-1.5 text-ui-sm leading-normal text-fg-muted shadow-float [overflow-wrap:anywhere]';

// `className` places the note in its row (a grid column, an indent); the note draws itself.
export function RowNote({ note, className = '', children }: { note: RowNoteState; className?: string; children: ReactNode }) {
  const { ref, mounted } = useDisclosureMotion<HTMLDivElement>(note.open);
  useOpeningSide(note.open, ref);
  return (
    <div ref={ref} id={note.id} data-row-note="" data-side="down" data-open={note.open || undefined} hidden={!mounted} className={`${PLACE} ${className}`}>
      <div className={NOTE}>{children}</div>
    </div>
  );
}

function useOpeningSide(open: boolean, ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = ref.current;
    const row = element?.parentElement;
    if (!open || !element || !row) return;
    const below = row.getBoundingClientRect();
    const height = element.scrollHeight;
    const clip = clipOf(row);
    element.dataset.side = below.bottom + height > clip.bottom && below.top - height >= clip.top ? 'up' : 'down';
  }, [open, ref]);
}

// The box that cuts the note off: the nearest ancestor whose overflow clips, else the window.
function clipOf(from: HTMLElement): { top: number; bottom: number } {
  for (let node = from.parentElement; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).overflowY !== 'visible') {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}
