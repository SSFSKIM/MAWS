// WR #12: a document keeps 600 px for reading beside an open conversation. Narrower
// surfaces retain the overlay; the editor stays mounted through either layout.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CARD_MIN, useColumnWidth, useFloatingCard } from './floating';

const READING_WIDTH = 600;
export function DocumentSessionSpace({ surface, enabled, children }: { surface: 'main' | 'panel'; enabled: boolean; children: ReactNode }) {
  const self = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const requested = useColumnWidth(surface);
  useLayoutEffect(() => {
    const element = self.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  const column = enabled && requested !== null && width >= READING_WIDTH + CARD_MIN.w ? Math.min(requested, width - READING_WIDTH) : null;
  const reserving = column !== null;
  useLayoutEffect(() => reserving && spacer.current ? useFloatingCard.getState().reserveColumn(spacer.current) : undefined, [reserving]);
  return <div ref={self} className="flex h-full min-h-0 min-w-0">
    <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
    {column !== null && <div ref={spacer} aria-hidden data-document-session-column className="shrink-0" style={{ width: column }} />}
  </div>;
}
