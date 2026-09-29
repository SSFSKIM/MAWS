// The toolbar below the box (C7 execution document, "Composer frame"): plain controls outside the box's border and
// inside the frame: "+" (files, photos, the palette, connectors and plugins), `@` (the `@` menu at the caret), the mic
// (P1: a disabled placeholder, never wired), and at the right the permission mode and the model with its effort.
import type { RefObject } from 'react';
import type { EditorHandle } from '../editor/controller';
import { PlusMenu } from '../plus-menu/PlusMenu';
import type { FrameBindings } from './bindings';
import { CHIP } from './chip-style';
import { ModeChip } from './ModeChip';
import { ModelChip } from './ModelChip';

export interface ToolbarProps {
  bindings: Pick<FrameBindings, 'mode' | 'model'>;
  cwd: string;
  editor: RefObject<EditorHandle | null>;
}

export function Toolbar({ bindings, cwd, editor }: ToolbarProps) {
  return (
    <div role="toolbar" aria-label="Composer tools" className="flex min-w-0 items-center gap-0.5">
      <PlusMenu cwd={cwd} editor={editor} />
      <button type="button" aria-label="Mention a file or agent" title="Mention a file or agent" onClick={() => editor.current?.openMention()} className={`${CHIP} size-7 justify-center`}>
        @
      </button>
      <button type="button" aria-label="Voice input" title="Voice input arrives later" disabled className={`${CHIP} size-7 justify-center`}>
        <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current" strokeWidth="1.5">
          <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
          <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
        </svg>
      </button>
      <span className="flex-1" />
      <ModeChip binding={bindings.mode} />
      <ModelChip binding={bindings.model} openWidget={() => editor.current?.openWidget('model') ?? false} />
    </div>
  );
}
