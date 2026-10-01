// The toolbar below the box (C7 execution document, "Composer frame"; §5.4 as amended 2026-10-01, W2): one row of plain
// controls outside the box's border and inside the frame, and nothing else around the box. At the left "+" (files,
// photos, the palette, connectors and plugins), the location (its popover carries the project directory, the worktrees,
// the branch picker and the additional directories), `+ dir` and the permission mode; at the right the session's
// context ring (C3: a started session's, the composer passes it) and the model with its effort. No `@` button (typing
// `@` opens the same menu) and no mic until dictation exists.
import type { ReactNode, RefObject } from 'react';
import type { EditorHandle } from '../editor/controller';
import { PlusMenu } from '../plus-menu/PlusMenu';
import { AddDirChip } from './AddDirChip';
import type { FrameBindings } from './bindings';
import { LocationChip } from './LocationChip';
import { ModeChip } from './ModeChip';
import { ModelChip } from './ModelChip';

export interface ToolbarProps {
  bindings: FrameBindings;
  cwd: string;
  dirty: boolean;
  editor: RefObject<EditorHandle | null>;
  // a chip showing an engine read opened: the location reads the permission rules (its directories), the mode and the
  // model the engine's models
  onOpen?(what: 'models' | 'rules'): void;
  ring?: ReactNode; // the session's context ring, before the model
}

export function Toolbar({ bindings, cwd, dirty, editor, onOpen, ring = null }: ToolbarProps) {
  return (
    <div role="toolbar" aria-label="Composer tools" className="flex min-w-0 items-center gap-0.5">
      <PlusMenu cwd={cwd} editor={editor} />
      <LocationChip location={bindings.location} branch={bindings.branch} directories={bindings.directories.value} dirty={dirty} onOpen={() => onOpen?.('rules')} />
      <AddDirChip directories={bindings.directories} cwd={cwd} />
      <ModeChip binding={bindings.mode} onOpen={() => onOpen?.('models')} />
      <span className="min-w-2 flex-1" />
      {ring}
      <ModelChip binding={bindings.model} onOpen={() => onOpen?.('models')} openWidget={() => editor.current?.openWidget('model') ?? false} />
    </div>
  );
}
