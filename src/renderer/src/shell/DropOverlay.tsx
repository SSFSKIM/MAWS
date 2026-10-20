// The drop targets of a cross-surface move (P4-B3, X38; its Decision Log 18): a layer drawn over a surface (the panel, a
// main pane's body) for every drag from the other surface, so the content beneath (an editor that takes every drag, a
// frame that would swallow its events) never sees one. Accepting (`accepts`), it takes every `dragover` (`dropEffect =
// 'move'`), shows the place the artifact will take while hovered with the outcome's label (an HTML5 drag image is fixed
// at `dragstart`, so the label is drawn here, Z7), and on `drop` ends the drag and hands the event to its owner, which
// reads the payload. Refusing, it takes nothing: no `preventDefault`, `dropEffect` left 'none', so the cursor says
// no-drop (Z2, M5).
import { useState, type CSSProperties, type DragEvent } from 'react';
import { endDrag } from './transfer';

export function DropOverlay({ label, accepts, onDrop, ...data }: { label: string; accepts: boolean; onDrop(event: DragEvent): void } & Record<`data-${string}`, string | number>) {
  const [over, setOver] = useState(false);
  const accept = (event: DragEvent) => {
    if (!accepts) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    return true;
  };
  return (
    <div
      {...data}
      data-drop-overlay={accepts ? 'accepted' : 'refused'}
      onDragEnter={(event) => {
        if (accept(event)) setOver(true);
      }}
      onDragOver={accept}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (!accepts) return;
        event.preventDefault();
        endDrag();
        onDrop(event);
      }}
      className="absolute inset-0 z-10"
    >
      {over && accepts && <DropHighlight label={label} />}
    </div>
  );
}

// The resulting place, outlined and tinted, its label at the centre; `className` and `style` place it (the whole target
// by default).
export function DropHighlight({ label, className = 'inset-0', style, ...data }: { label: string; className?: string; style?: CSSProperties } & Record<`data-${string}`, string>) {
  return (
    <div {...data} style={style} className={`pointer-events-none absolute flex items-center justify-center border-2 border-accent bg-accent-soft ${className}`}>
      <span className="rounded-sm border border-border-strong bg-bg-overlay px-2 py-1 text-ui-sm text-fg shadow-float">{label}</span>
    </div>
  );
}
