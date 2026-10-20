// The divider between the two panes (residue *Split*; P4-B3 M1, parent §4.5, its Decision Log 3 and 4). It owns its
// pointer handling rather than using the regions' `Resizer`, which clamps before `onChange` and so hides the raw width
// the float needs. A drag is transient: each move hands the main area the left pane's live width and the armed side
// (`splitDrag`), and nothing reaches `main.tabs` until release, which either writes the ratio or, armed, floats that
// pane's session with the ratio untouched (Dock returns the ratio at pointer-down; M2: through the card's transition,
// which focuses the card's composer). A pointer-cancel or a lost capture
// writes nothing. The keyboard keeps the Resizer's rules within the pixel floors and never floats: arrows 8 px (Shift
// 32), Home and End to the floors, Enter and a double-click to 0.5. Before the region has a width (a first render, a
// test) a nominal 1000 px stands in.
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { RESIZER_BIG_STEP, RESIZER_STEP } from '../app/Resizer';
import { floatSplit } from '../shell/floating'; // P4-B3 M2: the float's focus and transcript marks
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { paneDomId } from './pane-dom';
import { splitBounds, splitDrag, splitLeft, type SplitSessions } from './split';

const NOMINAL_WIDTH = 1000;

export type SplitDragState = ReturnType<typeof splitDrag>;

export function SplitDivider({
  width,
  sessions,
  live,
  onDrag,
}: {
  width: number;
  sessions: SplitSessions; // which panes show a session, so may float
  live: SplitDragState | null; // the drag in progress, which the main area renders
  onDrag(drag: SplitDragState | null): void;
}) {
  const ratio = useLayout((s) => currentSet(s.main).splitRatio);
  const drag = useRef<{ pointerId: number; from: number; start: number; last: SplitDragState | null } | null>(null);
  const w = width > 0 ? width : NOMINAL_WIDTH;
  const { min, max } = splitBounds(w, sessions);
  const value = live?.left ?? splitLeft(w, ratio, sessions);

  const write = (px: number) => {
    const next = Math.min(max, Math.max(min, Math.round(px)));
    if (next !== value) useLayout.getState().setSplitRatio(next / w);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? RESIZER_BIG_STEP : RESIZER_STEP;
    if (event.key === 'Enter') useLayout.getState().setSplitRatio(0.5);
    else if (event.key === 'ArrowRight') write(value + step);
    else if (event.key === 'ArrowLeft') write(value - step);
    else if (event.key === 'Home') write(min);
    else if (event.key === 'End') write(max);
    else return;
    event.preventDefault();
  };

  // `commit`: a release (the drag's outcome is written) rather than a cancel (nothing is).
  const end = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onDrag(null);
    const last = current.last;
    if (!commit || last === null) return;
    const layout = useLayout.getState();
    if (last.armed === null) {
      layout.setSplitRatio(last.left / w);
      return;
    }
    const pane = currentSet(layout.main).panes[last.armed === 'left' ? 0 : 1];
    if (pane) floatSplit(pane.activeTabId);
  };

  return (
    <div className="relative w-px bg-border" style={{ gridRow: '1 / -1', gridColumn: 2 }}>
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize panes"
        aria-orientation="vertical"
        aria-controls={paneDomId(0)}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onKeyDown={onKeyDown}
        onDoubleClick={() => useLayout.getState().setSplitRatio(0.5)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); // no text selection while dragging
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = { pointerId: event.pointerId, from: event.clientX, start: value, last: null };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (current?.pointerId !== event.pointerId) return;
          current.last = splitDrag(w, current.start + event.clientX - current.from, sessions);
          onDrag(current.last);
        }}
        onPointerUp={(event) => end(event, true)}
        onPointerCancel={(event) => end(event, false)}
        onLostPointerCapture={(event) => end(event, false)}
        className="group absolute inset-y-0 -left-0.75 z-10 w-1.5 cursor-col-resize touch-none outline-none [-webkit-app-region:no-drag]"
      >
        {/* The visible line: shown on hover, focus and drag, over the panes' own border. */}
        <div
          aria-hidden
          className="pointer-events-none mx-auto h-full w-0.5 bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100"
        />
      </div>
    </div>
  );
}
