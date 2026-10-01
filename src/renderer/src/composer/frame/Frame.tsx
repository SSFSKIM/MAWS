// The compact frame (C7 execution document, "Composer frame", §5.4 as amended by the owner's ruling and sizing
// correction, D-20 after Claude Desktop, and as amended 2026-10-01 for W2 after Codex): the attachment strip when there
// are attachments; the box holding only the editor and the submit control at its right (44px at rest, growing to a
// quarter of the window, then the editor scrolls); the toolbar below the box, outside it, which holds the location and
// `+ dir` too (W2: no chip row above the box). At rest: the box and one row. Nothing around it: no heading, no hint
// line. The same component sits centred on an unstarted session and docked under the transcript (C5 places it); it
// fills the column C5 puts it in, the transcript's own (W2), and caps nothing itself.
// A docked card (a request, or C10's trust and relay-down cards) takes the place of the draft's parts, the attachment
// strip, the box and the toolbar (architect's ruling on M6, mockup 04): those parts stay mounted and hidden, so the
// editor keeps its document, and they hide in the same commit the card mounts.
import type { ReactNode, RefObject } from 'react';
import type { Attachment } from '../editor/doc';
import type { EditorHandle } from '../editor/controller';
import { AttachmentStrip } from './AttachmentStrip';
import type { FrameBindings } from './bindings';
import { Toolbar } from './Toolbar';

export interface FrameProps {
  bindings: FrameBindings;
  cwd: string;
  dirty: boolean;
  attachments: readonly Attachment[];
  editorHandle: RefObject<EditorHandle | null>;
  editor: ReactNode; // M3's Editor (the only element under the composer key sink)
  submit: ReactNode; // the submit control, beside the editor and outside its sink
  docked?: ReactNode; // a docked card, in the draft's place; null or absent: the draft shows
  onOpen?(what: 'models' | 'rules'): void; // a chip showing an engine read opened: the composer reads it then, not per mount
}

export function Frame({ bindings, cwd, dirty, attachments, editorHandle, editor, submit, docked = null, onOpen }: FrameProps) {
  const isDocked = docked !== null && docked !== undefined;
  return (
    <div data-composer-frame data-docked={isDocked || undefined} className="flex w-full min-w-0 flex-col gap-1">
      {docked}
      <div data-composer-draft hidden={isDocked} className="flex min-w-0 flex-col gap-1">
        <AttachmentStrip attachments={attachments} onRemove={(id) => editorHandle.current?.removeAttachment(id)} />
        {/* W2 (C1, Codex's): 22px corners and the faint shadow, no border; 44px at rest, the editor's 20px line inside
            12px above and below, the submit control 8px in from the box's foot */}
        <div data-composer-box className="flex min-h-11 min-w-0 items-end gap-2 rounded-2xl bg-bg-raised pr-2 pl-3 shadow-composer">
          <div className="min-w-0 flex-1 py-3">{editor}</div>
          <div className="mb-2 shrink-0">{submit}</div>
        </div>
        <Toolbar bindings={bindings} cwd={cwd} dirty={dirty} editor={editorHandle} onOpen={onOpen} />
      </div>
    </div>
  );
}
