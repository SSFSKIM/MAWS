// The main region's contents (§5.2, D-8, D-13; residue *Split* and *Banner placement*): one pane by default, at most two
// side by side with a keyboard-operable divider between them, and while a tab is dragged with no split, a drop zone
// over the region's right edge that opens the second pane with it. The region is a grid of three rows: the panes' tab
// strips, the banner host spanning every pane, then the panes' contents; each pane places its strip and its content
// in its own column (the pane element itself is `display: contents`).
import { useLayoutEffect, useRef, useState } from 'react';
import { BannerHost } from '../app/BannerHost';
import { useLayout } from '../stores/layout';
import { DropEdge } from './DropEdge';
import { Pane } from './Pane';
import { SplitDivider } from './SplitDivider';

export function MainArea() {
  const split = useLayout((s) => s.main.panes.length === 2);
  const ratio = useLayout((s) => s.main.splitRatio);
  const dragging = useLayout((s) => s.dragging !== null);
  const region = useRef<HTMLDivElement>(null);
  const width = useWidth(region);

  return (
    <div
      ref={region}
      className="relative grid min-h-0 min-w-0 flex-1"
      style={{
        gridTemplateRows: 'auto auto minmax(0, 1fr)',
        gridTemplateColumns: split ? `minmax(0, ${ratio}fr) 1px minmax(0, ${1 - ratio}fr)` : 'minmax(0, 1fr)',
      }}
    >
      <Pane index={0} split={split} column={1} />
      {/* Over the divider's line in its row: a banner belongs to the whole region, not to a pane. */}
      <BannerHost className="relative z-10" style={{ gridRow: 2, gridColumn: '1 / -1' }} />
      {split && <SplitDivider width={width} />}
      {split && <Pane index={1} split column={3} />}
      {dragging && !split && <DropEdge />}
    </div>
  );
}

// The element's width, kept current as the window and the regions resize.
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
