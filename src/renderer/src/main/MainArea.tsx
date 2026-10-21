// The main region's contents (§5.2, D-8, D-13; residue *Split* and *Banner placement*): one pane by default, at most two
// side by side with a keyboard-operable divider between them, and while a tab (P4-B3 M4: or a panel record) is dragged
// with no split, a drop zone over the region's right edge that opens the second pane with it. The region is a grid of
// three rows: the panes' tab strips, the banner host spanning every pane, then the panes' contents; each pane places its
// strip and its content in its own column (the pane element itself is `display: contents`).
//
// P4-B3 M1 (parent §4.5, its Decision Log 3 to 5): the split's columns are pixels, the stored ratio clamped to the panes'
// floors at every width (a window resize only clamps). While the divider is dragged the columns follow the drag's live
// width; armed, the session pane ("S") stays mounted at 0 px with its strip and content hidden, so a disarm is lossless.
// A floating split renders the other pane ("A") alone across the region, with no divider and no drop edge; S is not
// rendered here. A's `Pane` keeps its place among the children through arm, disarm, float and dock, so it never remounts.
// M2 (its Decision Log 10): S's session is drawn by the split's card, in a layer on the content row across the region
// (after every other child, so nothing before it moves). LC-3: while armed, the card's outline lies in that cell, last.
import { useLayoutEffect, useRef, useState } from 'react';
import { SplitCardLayer, SplitCardOutline } from '../shell/FloatingCard'; // P4-B3 M2; LC-3: the armed outline
import { useDragAccepted } from '../shell/transfer'; // P4-B3 M4
import { useLayout } from '../stores/layout';
import { currentSet, floatingPane, paneShowsSession } from '../stores/layout-model';
import { DropEdge } from './DropEdge';
import { Pane } from './Pane';
import { splitLeft, type SplitSessions } from './split';
import { SplitDivider, type SplitDragState } from './SplitDivider';

export function MainArea() {
  const split = useLayout((s) => currentSet(s.main).panes.length === 2);
  const ratio = useLayout((s) => currentSet(s.main).splitRatio);
  const floated = useLayout((s) => floatingPane(currentSet(s.main)));
  const leftSession = useLayout((s) => paneShowsSession(currentSet(s.main), 0));
  const rightSession = useLayout((s) => paneShowsSession(currentSet(s.main), 1));
  const edge = useDragAccepted('edge'); // P4-B3: the drop edge is offered only to a drag it takes
  const [drag, setDrag] = useState<SplitDragState | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const width = useWidth(region);
  const sessions: SplitSessions = { left: leftSession, right: rightSession };
  const docked = split && floated === null;
  // A drag the divider cannot finish (the split it sized went from under it) is dropped with it.
  if (drag !== null && !docked) setDrag(null);

  return (
    <div
      ref={region}
      data-main-area
      className="relative grid min-h-0 min-w-0 flex-1"
      style={{ gridTemplateRows: 'auto auto minmax(0, 1fr)', gridTemplateColumns: docked ? splitColumns(width, ratio, sessions, drag) : 'minmax(0, 1fr)' }}
    >
      {floated !== 0 && <Pane index={0} split={docked} column={1} collapsed={docked && drag?.armed === 'left'} />}
      {docked && <SplitDivider width={width} sessions={sessions} live={drag} onDrag={setDrag} />}
      {split && floated !== 1 && <Pane index={1} split={docked} column={docked ? 3 : 1} collapsed={docked && drag?.armed === 'right'} />}
      {edge && !split && <DropEdge />}
      {floated !== null && <SplitCardLayer />}
      {docked && drag?.armed && <SplitCardOutline floating={drag.armed === 'left' ? 0 : 1} />}
    </div>
  );
}

// The docked split's columns: the drag's live width while dragged (an armed side at 0), else the stored ratio within the
// floors; before the region has a width, the ratio as fractions.
function splitColumns(width: number, ratio: number, sessions: SplitSessions, drag: SplitDragState | null): string {
  if (drag?.armed === 'left') return '0px 1px minmax(0, 1fr)';
  if (drag?.armed === 'right') return 'minmax(0, 1fr) 1px 0px';
  if (drag) return `${drag.left}px 1px minmax(0, 1fr)`;
  if (width > 0) return `${splitLeft(width, ratio, sessions)}px 1px minmax(0, 1fr)`;
  return `minmax(0, ${ratio}fr) 1px minmax(0, ${1 - ratio}fr)`;
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
