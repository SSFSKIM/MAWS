// The one resizer (C5 execution document, M2; residue *Resizers*): an ARIA window splitter on the edge of a region.
// Keyboard: arrows move 8 px (Shift 32), Home and End go to the bounds, Enter restores the default; a double-click
// restores it too. Pointer: a drag with capture follows the pointer inside the bounds, and a drag that goes
// `collapseThreshold` px past the minimum collapses the region (releasing before that leaves it at the minimum). The
// keyboard never collapses: the region's toggle does that. `grow` says which way enlarges the region: +1 for a
// resizer on a region's right (or bottom) edge, -1 for one on its left (or top) edge. A drag-collapse hands back the
// value the drag started from, so the region reopens at the size it had rather than at the minimum; a region shown
// narrower than its persisted size (clamped to the window) passes that size as `restoreValue`, so the clamp is never
// written back. P3-G (§D1.6): `expandThreshold` is the mirror on the maximum's side: a drag that reaches that far past
// the maximum ends there and calls `onExpand` with the same restore value (the panel floats); the keyboard never does.
// UX wave U8b (Addendum 7): a frame of another origin takes the pointer's events as soon as the pointer is over it, past
// the separator's capture, so a drag toward a delivered page never moved and never heard its release. While a drag is
// active the document carries `data-resizing`, under which no frame takes pointer events (`styles/app.css`); and a drag
// also ends when it loses its capture, so a release that never arrives leaves no drag behind.
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

export const RESIZER_STEP = 8;
export const RESIZER_BIG_STEP = 32;

export interface ResizerProps {
  label: string;
  controls: string; // id of the region it sizes
  orientation?: 'vertical' | 'horizontal'; // vertical: a vertical line, dragged along x
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  grow?: 1 | -1;
  collapseThreshold?: number | null;
  onChange(value: number): void;
  restoreValue?: number; // what a drag-collapse hands back; `value` when not given
  onCollapse?(restore: number): void; // `restore`: the value the drag started from, for reopening at that size
  expandThreshold?: number | null; // P3-G
  onExpand?(restore: number): void; // P3-G: as `onCollapse`, past the maximum
  onReset?(): void; // UX wave U8b: Enter and a double-click call this in place of restoring `defaultValue`, when given
  percentOf?: number; // UX wave U8b (M3): a splitter of a share, whose ARIA values are percents of this extent
  className?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
// The document's mark of a drag in progress, read by the rule that keeps frames from taking the drag's events. One fact
// of the page with as many owners as there are live drags (two pointers make two), so it is a count, kept here: a drag
// adds one at its press and takes it off at its end or its separator's unmount, and the mark goes at zero (Addendum 8).
export const RESIZING_ATTRIBUTE = 'data-resizing';
let liveDrags = 0;
function dragStarted(): void {
  liveDrags += 1;
  document.documentElement.setAttribute(RESIZING_ATTRIBUTE, '');
}
function dragEnded(): void {
  liveDrags -= 1;
  if (liveDrags === 0) document.documentElement.removeAttribute(RESIZING_ATTRIBUTE);
}

export function Resizer({
  label,
  controls,
  orientation = 'vertical',
  value,
  min,
  max,
  defaultValue,
  grow = 1,
  collapseThreshold = null,
  restoreValue,
  onChange,
  onCollapse,
  expandThreshold = null,
  onExpand,
  onReset,
  percentOf,
  className = '',
}: ResizerProps) {
  const drag = useRef<{ pointerId: number; from: number; start: number; restore: number } | null>(null);
  // A separator removed mid-drag (its group closed) takes its drag off the count. `drag` is set exactly while this
  // separator's one drag is counted, so it never takes off more than it added.
  useEffect(() => () => {
    if (!drag.current) return;
    drag.current = null; // as `end` does: a late end for this pointer then finds no drag of its own
    dragEnded();
  }, []);
  const vertical = orientation === 'vertical';
  const coordinate = (event: PointerEvent) => (vertical ? event.clientX : event.clientY);
  const aria = (px: number) => (percentOf ? Math.round((px / percentOf) * 100) : px);

  const set = (next: number) => {
    const clamped = clamp(Math.round(next), min, max);
    if (clamped !== value) onChange(clamped);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? RESIZER_BIG_STEP : RESIZER_STEP;
    const [less, more] = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    let next: number | null = null;
    if (event.key === more) next = value + grow * step;
    else if (event.key === less) next = value - grow * step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else if (event.key === 'Enter' && onReset) {
      event.preventDefault();
      onReset();
      return;
    } else if (event.key === 'Enter') next = defaultValue;
    if (next === null) return;
    event.preventDefault();
    set(next);
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    dragEnded();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-controls={controls}
      aria-valuenow={aria(value)}
      aria-valuemin={aria(min)}
      aria-valuemax={aria(max)}
      onKeyDown={onKeyDown}
      onDoubleClick={() => (onReset ? onReset() : set(defaultValue))}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault(); // no text selection while dragging
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (!drag.current) dragStarted(); // a second press during a drag takes the drag over, counted once
        drag.current = { pointerId: event.pointerId, from: coordinate(event), start: value, restore: restoreValue ?? value };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.pointerId !== event.pointerId) return;
        const raw = current.start + grow * (coordinate(event) - current.from);
        if (collapseThreshold !== null && onCollapse && raw <= min - collapseThreshold) {
          end(event);
          onCollapse(current.restore);
          return;
        }
        if (expandThreshold !== null && onExpand && raw >= max + expandThreshold) {
          end(event);
          onExpand(current.restore);
          return;
        }
        set(raw);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      className={`group z-10 touch-none outline-none [-webkit-app-region:no-drag] ${vertical ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'} ${className}`}
    >
      {/* The visible line: shown on hover, focus and drag, over the region's own border. */}
      <div
        aria-hidden
        className={`pointer-events-none bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100 ${
          vertical ? 'mx-auto h-full w-0.5' : 'my-auto h-0.5 w-full'
        }`}
      />
    </div>
  );
}
