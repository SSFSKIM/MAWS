// The one resizer (C5 execution document, M2; residue *Resizers*): an ARIA window splitter on the edge of a region.
// Keyboard: arrows move 8 px (Shift 32), Home and End go to the bounds, Enter restores the default; a double-click
// restores it too. Pointer: a drag with capture follows the pointer inside the bounds, and a drag that goes
// `collapseThreshold` px past the minimum collapses the region (releasing before that leaves it at the minimum). The
// keyboard never collapses: the region's toggle does that. `grow` says which way enlarges the region: +1 for a
// resizer on a region's right (or bottom) edge, -1 for one on its left (or top) edge. A drag-collapse hands back the
// value the drag started from, so the region reopens at the size it had rather than at the minimum.
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

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
  onCollapse?(restore: number): void; // `restore`: the value the drag started from, for reopening at that size
  className?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
  onChange,
  onCollapse,
  className = '',
}: ResizerProps) {
  const drag = useRef<{ pointerId: number; from: number; start: number } | null>(null);
  const vertical = orientation === 'vertical';
  const coordinate = (event: PointerEvent) => (vertical ? event.clientX : event.clientY);

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
    else if (event.key === 'Enter') next = defaultValue;
    if (next === null) return;
    event.preventDefault();
    set(next);
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-controls={controls}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onKeyDown={onKeyDown}
      onDoubleClick={() => set(defaultValue)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault(); // no text selection while dragging
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { pointerId: event.pointerId, from: coordinate(event), start: value };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.pointerId !== event.pointerId) return;
        const raw = current.start + grow * (coordinate(event) - current.from);
        if (collapseThreshold !== null && onCollapse && raw <= min - collapseThreshold) {
          end(event);
          onCollapse(current.start);
          return;
        }
        set(raw);
      }}
      onPointerUp={end}
      onPointerCancel={end}
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
