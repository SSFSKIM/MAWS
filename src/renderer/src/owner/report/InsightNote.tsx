// An insight (the P2-C document, Design §8): beside the text it follows, in a right margin, when the pane holds the
// transcript's column and a margin of at least 240 px on each side; else an inline aside in reading order. The DOM
// order is the reading order either way, so a screen reader meets the insight after the text it explains. The room is
// measured, not queried: the column is `--measure` wide, which Settings › Appearance moves (768, 960 or 1280 px), and
// a container query cannot read that property.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Markdown } from '../../transcript/view/markdown/Markdown';
import { LABEL } from './copy';

export const MARGIN_MIN = 240;
export const MARGIN_GAP = 16;

export function InsightNote({ text, live }: { text: string; live: boolean }) {
  return (
    <aside className="owner-insight" aria-label={LABEL.insight}>
      <div className="owner-card-label">{LABEL.insight}</div>
      <Markdown markdown={text} live={live} />
    </aside>
  );
}

// The insights after one text, together, beside it or under it.
export function InsightGroup({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const margin = useMarginRoom(ref);
  return (
    <div ref={ref} className="owner-insights" data-placement={margin ? 'margin' : 'inline'}>
      {children}
    </div>
  );
}

// Whether the pane's transcript leaves a margin column of MARGIN_MIN beside the row's column, plus the gap to it.
function useMarginRoom(ref: React.RefObject<HTMLElement | null>): boolean {
  const [room, setRoom] = useState(false);
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>('[data-transcript-scroller]');
    const column = ref.current?.closest<HTMLElement>('.thread-column');
    if (!scroller || !column || typeof ResizeObserver === 'undefined') return;
    const measure = () => setRoom((scroller.clientWidth - column.offsetWidth) / 2 >= MARGIN_MIN + MARGIN_GAP);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(column); // the column moves with the transcript width setting
    return () => observer.disconnect();
  }, [ref]);
  return room;
}
