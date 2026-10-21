// The drop zone that opens the split (residue *Split*): the rightmost 15 % of the main region's content (below the
// strips, which win over it, Z4), shown only while a drag it takes is under way and there is no second pane
// (`dragAccepted('edge')`: a main tab whose pane keeps another, or a panel record, P4-B3). While hovered, the right half
// is highlighted, the pane that will open (Z6), labelled with the outcome. A main tab dropped there moves into a new right
// pane; a panel record moves there as a main tab (X38).
import { useState } from 'react';
import { DropHighlight } from '../shell/DropOverlay';
import { dropPanelRecord, endDrag, PANEL_TAB_DRAG_TYPE, TAB_DRAG_TYPE } from '../shell/transfer';
import { TRANSFER_COPY } from '../tools/artifacts/copy';
import { useLayout } from '../stores/layout';

const CONTENT_ROW = { gridRow: 3, gridColumn: 1 } as const; // the region's content row (MainArea's grid), below the strips

export function DropEdge() {
  const [over, setOver] = useState(false);
  return (
    <>
      {over && <DropHighlight data-testid="drop-edge-highlight" label={TRANSFER_COPY.openInSplit} style={CONTENT_ROW} className="inset-y-0 right-0 z-20 w-1/2" />}
      <div
        data-testid="drop-edge"
        style={CONTENT_ROW}
        onDragEnter={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          endDrag();
          if (event.dataTransfer.types.includes(PANEL_TAB_DRAG_TYPE)) return dropPanelRecord(event, { pane: 1, index: 0 });
          const id = event.dataTransfer.getData(TAB_DRAG_TYPE);
          if (id) useLayout.getState().moveTab(id, 1, 0);
        }}
        className={`absolute inset-y-0 right-0 z-30 flex w-[15%] items-center justify-center border-l-2 border-dashed text-ui-sm ${
          over ? 'border-accent text-fg' : 'border-border-strong bg-bg-hover text-fg-muted'
        }`}
      >
        {!over && TRANSFER_COPY.openInSplit}
      </div>
    </>
  );
}
