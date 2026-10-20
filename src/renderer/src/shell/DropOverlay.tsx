// The drop targets of a cross-surface move (P4-B3, X38; its Decision Log 18): a layer drawn over a surface (the panel, a
// main pane's body) only while a drag it takes is under way, so the content beneath (an editor, a frame that would swallow
// the drag's events) never sees it. It accepts every `dragover` (`dropEffect = 'move'`), shows the place the artifact
// will take while hovered with the outcome's label (an HTML5 drag image is fixed at `dragstart`, so the label is drawn
// here, Z7), and on `drop` ends the drag and hands the event to its owner, which reads the payload.
import { useState, type CSSProperties, type DragEvent } from 'react';
import { endDrag } from './transfer';

export function DropOverlay({ label, onDrop, ...data }: { label: string; onDrop(event: DragEvent): void } & Record<`data-${string}`, string | number>) {
  const [over, setOver] = useState(false);
  const accept = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };
  return (
    <div
      {...data}
      onDragEnter={(event) => {
        accept(event);
        setOver(true);
      }}
      onDragOver={accept}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        endDrag();
        onDrop(event);
      }}
      className="absolute inset-0 z-10"
    >
      {over && <DropHighlight label={label} />}
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
