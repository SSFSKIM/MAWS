// The compact frame (C7 execution document, "Composer frame", §5.4 as amended by the owner's ruling and sizing
// correction, D-20 after Claude Desktop): the chip row above the box; the attachment strip when there are attachments;
// the box holding only the editor and the submit control at its right (one line at rest, growing to a cap, then the
// editor scrolls); the toolbar below the box, outside its border. Nothing around it: no heading, no hint line. The
// same component sits centred on an unstarted session and docked under the transcript (C5 places it); C5's column
// sizes it at about two thirds of the pane capped near 720 px, and the frame caps itself there too for other hosts.
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
  hidden?: boolean; // a docked card has the composer's place: the frame stays mounted (the editor keeps its state)
}

export function Frame({ bindings, cwd, dirty, attachments, editorHandle, editor, submit, hidden = false }: FrameProps) {
  return (
    <div data-composer-frame hidden={hidden} className="mx-auto flex w-full max-w-[720px] min-w-0 flex-col gap-1">
      <ChipRow bindings={bindings} cwd={cwd} dirty={dirty} />
      <AttachmentStrip attachments={attachments} onRemove={(id) => editorHandle.current?.removeAttachment(id)} />
      <div data-composer-box className="flex min-w-0 items-end gap-2 rounded-xl border border-border-strong bg-bg-raised py-1.5 pr-1.5 pl-2.5 focus-within:border-accent">
        <div className="min-w-0 flex-1 py-0.5">{editor}</div>
        {submit}
      </div>
      <Toolbar bindings={bindings} cwd={cwd} editor={editorHandle} />
    </div>
  );
}
