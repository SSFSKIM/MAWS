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
// neither way it opens down, inside the scroll area, which scrolls to it. The side is read from layout alone, and
// written to the element, not rendered: when it opens and again while it is open, at any scroll (a search's landing
// scrolls after its focus has opened the note) and any resize. The pointed-row line (a plugin's description under its
// name) is this same note: both float.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { useDisclosureMotion } from './disclosure';
import { POINTING_DELAY_MS } from './pointing';

// What marks a row that carries a note, so a note can tell the keyboard landing in another one.
const NOTE_ROW = 'data-note-row';
const inAnotherRow = (to: Element | null) => to?.closest(`[${NOTE_ROW}]`) != null;

export interface RowNoteRowProps {
  [NOTE_ROW]: '';
  'aria-describedby': string;
  onPointerEnter(event: PointerEvent<HTMLElement>): void;
  onPointerLeave(event: PointerEvent<HTMLElement>): void;
  onFocus(event: ReactFocusEvent<HTMLElement>): void;
  onBlur(event: ReactFocusEvent<HTMLElement>): void;
}

export interface RowNoteState {
  id: string; // the note's element id, for a control inside the row that should carry the description too
  open: boolean;
  cut: boolean; // closed by the keyboard moving to another row: gone at once, with no exit motion over that row
  rowProps: RowNoteRowProps; // spread onto the row
}

export function useRowNote(): RowNoteState {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Where the pointer and the focus are, apart from whether the note may open: the delay gates only the opening of a
  // closed note, and an open one stays open while either is in the row (focus handed to a pointer still inside, or
  // back, never closes it). Focus is read from the document, not from the row's blur: a focused control the row
  // removes takes the focus with it and no blur reaches the row, so while the note is open the next focus anywhere
  // outside the row closes it, as does the pointer leaving. Focus landing in another row closes it at once, with no
  // exit motion, and even with the pointer still resting here: the card floats over that row and what took the
  // keyboard there. The resting pointer does not reopen it; only a new pointing does.
  const [cut, setCut] = useState(false);
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
  const cutNow = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setCut(true);
    setOpen(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    const focusMoved = (event: FocusEvent) => {
      const at = event.target instanceof Element ? event.target : null;
      if (row.current === null || row.current.contains(at)) return;
      if (inAnotherRow(at)) cutNow();
      else if (!pointerInside.current) setOpen(false);
    };
    document.addEventListener('focusin', focusMoved, true);
    return () => document.removeEventListener('focusin', focusMoved, true);
  }, [open, cutNow]);
  const settle = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    setCut(false);
    setOpen(true);
  };
  return {
    id,
    open,
    cut,
    rowProps: {
      [NOTE_ROW]: '',
      'aria-describedby': id,
      onPointerEnter: (event) => {
        row.current = event.currentTarget;
        pointerInside.current = true;
        settle();
        timer.current = setTimeout(() => {
          timer.current = null;
          if (pointerInside.current) show();
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
        show();
      },
      onBlur: (event) => {
        const to = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        if (event.currentTarget.contains(to)) return;
        if (inAnotherRow(to)) cutNow();
        else if (!pointerInside.current) setOpen(false);
      },
    },
  };
}

// The outer element is placed and moved, its inner one drawn: the outer carries no border, so the height the motion
// opens to is the height it rests at; its padding keeps the card off the row's edge either way it opens. It stacks above
// a list's sticky group heads (z-10, `GroupHeading`), which come later in the list than the row whose note crosses them.
const PLACE = 'pointer-events-none absolute inset-x-0 top-full z-20 flow-root py-0.5 data-[side=up]:top-auto data-[side=up]:bottom-full';
const NOTE = 'w-fit max-w-[30rem] rounded-md border border-border-strong bg-bg-overlay px-2.5 py-1.5 text-ui-sm leading-normal text-fg-muted shadow-float [overflow-wrap:anywhere]';

// `className` places the note in its row (a grid column, an indent); the note draws itself.
export function RowNote({ note, className = '', children }: { note: RowNoteState; className?: string; children: ReactNode }) {
  const { ref, mounted } = useDisclosureMotion<HTMLDivElement>(note.open);
  useOpeningSide(note.open, ref);
  return (
    <div ref={ref} id={note.id} data-row-note="" data-side="down" data-open={note.open || undefined} hidden={!mounted || (!note.open && note.cut)} className={`${PLACE} ${className}`}>
      <div className={NOTE}>{children}</div>
    </div>
  );
}

// The side, from the row's place in the live bounds of what clips it and the card's full height (its content's, not
// the height the opening motion has reached), read on opening and at every scroll (captured: a scroll area's own does
// not bubble) and resize while open.
function useOpeningSide(open: boolean, ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const place = () => placeSide(element);
    place();
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, ref]);
}

function placeSide(element: HTMLElement) {
  const row = element.parentElement;
  if (row === null) return;
  const below = row.getBoundingClientRect();
  const height = element.scrollHeight;
  const clip = clipOf(row);
  element.dataset.side = below.bottom + height > clip.bottom && below.top - height >= clip.top ? 'up' : 'down';
}

/** Places every open note under `root` again, at once: for a scroll set in code, whose scroll event waits for a frame
 * (a search's landing, which opens its row's note by focus before it scrolls; a hidden window draws no frame). */
export function placeOpenNotes(root: Element) {
  for (const element of root.querySelectorAll<HTMLElement>('[data-row-note][data-open]')) placeSide(element);
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
