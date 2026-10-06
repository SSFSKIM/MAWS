// The toolbar below the box (C7 execution document, "Composer frame"; §5.4 as amended 2026-10-01, W2 and W10): one row
// of plain controls outside the box's border and inside the frame, and nothing else around the box. At the left "+"
// (files, photos, add directory, the palette, connectors and plugins), the location (a started session's; its popover
// carries the project directory and the additional directories) and the permission mode; at the right the model with
// its effort, whose chip opens the model selector (W3), then the session's context ring (C3: a started session's, the
// composer passes it), the outermost control (W10, C10). No `@` button (typing `@` opens the same menu) and no `+ dir`
// chip (W10: Add directory… is the "+" menu's). R2: after the permission mode, a plugin's SessionMode drawing, while one
// draws it (PluginSites.tsx). E9: after that, the microphone (a click starts dictating, a second click stops) with the
// capture's state and the session's dictation notice, small text in the same row.
import type { ReactNode, RefObject } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { EditorHandle } from '../editor/controller';
import { PlusMenu } from '../plus-menu/PlusMenu';
import type { FrameBindings } from './bindings';
import { LocationChip } from './LocationChip';
import { ModeChip } from './ModeChip';
import { ModelChip } from './ModelChip';
import { PluginModeSlot } from './PluginSites'; // R2
import { MicControl } from '../dictation/MicControl'; // E9

export interface ToolbarProps {
  appSessionId: AppSessionId; // W3: the model chip's menu is the session's
  bindings: FrameBindings;
  cwd: string;
  dirty: boolean;
  editor: RefObject<EditorHandle | null>;
  // a chip showing an engine read opened: the location reads the permission rules (its directories), the mode and the
  // model the engine's models
  onOpen?(what: 'models' | 'rules'): void;
  ring?: ReactNode; // the session's context ring, after the model at the right edge (W10)
}

export function Toolbar({ appSessionId, bindings, cwd, dirty, editor, onOpen, ring = null }: ToolbarProps) {
  return (
    <div role="toolbar" aria-label="Composer tools" className="flex min-w-0 items-center gap-0.5">
      <PlusMenu cwd={cwd} editor={editor} directories={bindings.directories} />
      {/* New chat: an unstarted tab's project row above the box stands for the location until the session starts */}
      {bindings.project === null && <LocationChip location={bindings.location} directories={bindings.directories.value} dirty={dirty} onOpen={() => onOpen?.('rules')} />}
      <ModeChip binding={bindings.mode} onOpen={() => onOpen?.('models')} />
      {/* R2: a plugin's mode slot after the permission mode, only while a plugin draws one */}
      <PluginModeSlot appSessionId={appSessionId} />
      {/* E9: the microphone, its capture state and notice */}
      <MicControl appSessionId={appSessionId} />
      <span className="min-w-2 flex-1" />
      <ModelChip appSessionId={appSessionId} binding={bindings.model} onOpen={() => onOpen?.('models')} onClosed={() => editor.current?.focus()} />
      {ring}
    </div>
  );
}
