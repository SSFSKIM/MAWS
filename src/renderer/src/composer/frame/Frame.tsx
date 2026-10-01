// The compact frame (C7 execution document, "Composer frame", §5.4 as amended by the owner's ruling and sizing
// correction, D-20 after Claude Desktop): the chip row above the box; the attachment strip when there are attachments;
// the box holding only the editor and the submit control at its right (one line at rest, growing to a cap, then the
// editor scrolls); the toolbar below the box, outside its border. Nothing around it: no heading, no hint line. The
// same component sits centred on an unstarted session and docked under the transcript (C5 places it); it fills the
// column C5 puts it in, the transcript's own (W2), and caps nothing itself.
// A docked card (a request, or C10's trust and relay-down cards) takes the place of the draft's parts, the attachment
// strip, the box and the toolbar, under the same chip row (architect's ruling on M6, mockup 04): those parts stay
// mounted and hidden, so the editor keeps its document, and they hide in the same commit the card mounts.
import type { ReactNode, RefObject } from 'react';
import type { Attachment } from '../editor/doc';
import type { EditorHandle } from '../editor/controller';
import { AttachmentStrip } from './AttachmentStrip';
import type { FrameBindings } from './bindings';
import { ChipRow } from './ChipRow';
import { Toolbar } from './Toolbar';

export interface FrameProps {
  bindings: FrameBindings;
  cwd: string;
  dirty: boolean;
  attachments: readonly Attachment[];
  editorHandle: RefObject<EditorHandle | null>;
  editor: ReactNode; // M3's Editor (the only element under the composer key sink)
  submit: ReactNode; // the submit control, beside the editor and outside its sink
  docked?: ReactNode; // a docked card, in the draft's place under the chip row; null or absent: the draft shows
  onOpen?(what: 'models' | 'rules'): void; // a chip showing an engine read opened: the composer reads it then, not per mount
}

export function Frame({ bindings, cwd, dirty, attachments, editorHandle, editor, submit, docked = null, onOpen }: FrameProps) {
  const isDocked = docked !== null && docked !== undefined;
  return (
    <div data-composer-frame data-docked={isDocked || undefined} className="flex w-full min-w-0 flex-col gap-1">
      <ChipRow bindings={bindings} cwd={cwd} dirty={dirty} onOpen={() => onOpen?.('rules')} />
      {docked}
      <div data-composer-draft hidden={isDocked} className="flex min-w-0 flex-col gap-1">
        <AttachmentStrip attachments={attachments} onRemove={(id) => editorHandle.current?.removeAttachment(id)} />
        <div data-composer-box className="flex min-w-0 items-end gap-2 rounded-xl border border-border-strong bg-bg-raised py-1.5 pr-1.5 pl-2.5 focus-within:border-accent">
          <div className="min-w-0 flex-1 py-0.5">{editor}</div>
          {submit}
        </div>
        <Toolbar bindings={bindings} cwd={cwd} editor={editorHandle} onOpen={() => onOpen?.('models')} />
      </div>
    </div>
  );
}
