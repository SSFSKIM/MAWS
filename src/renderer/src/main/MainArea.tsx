// The main region's contents (§5.2, D-8, D-13; residue *Split*): one pane by default, at most two side by side with a
// keyboard-operable divider between them, and while a tab is dragged with no split, a drop zone over the region's
// right edge that opens the second pane with it.
import { useLayoutEffect, useRef, useState } from 'react';
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
    <div ref={region} className="relative flex min-h-0 min-w-0 flex-1">
      <Pane index={0} split={split} share={split ? ratio : 1} />
      {split && <SplitDivider width={width} />}
      {split && <Pane index={1} split share={1 - ratio} />}
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
