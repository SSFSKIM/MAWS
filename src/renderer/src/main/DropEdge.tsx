// The drop zone that opens the split (residue *Split*): the rightmost 15 % of the main region, shown only while a tab
// is dragged and there is no second pane. Dropping the tab there moves it into a new right pane.
import { useState, type DragEvent } from 'react';
import { useLayout } from '../stores/layout';
import { TAB_DRAG_TYPE } from './Tab';

export function DropEdge() {
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(TAB_DRAG_TYPE);
  return (
    <div
      data-testid="drop-edge"
      onDragEnter={(event) => accepts(event) && setOver(true)}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        const id = event.dataTransfer.getData(TAB_DRAG_TYPE);
        const layout = useLayout.getState();
        layout.setDragging(null);
        if (id) layout.moveTab(id, 1, 0);
      }}
      className={`absolute inset-y-0 right-0 z-20 flex w-[15%] items-center justify-center border-l-2 border-dashed text-ui-sm ${
        over ? 'border-accent bg-accent-soft text-fg' : 'border-border-strong bg-bg-hover text-fg-muted'
      }`}
    >
      Open in split
    </div>
  );
}
