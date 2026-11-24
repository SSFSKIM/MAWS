// The shared deck/design element tools: Insert, text-style controls supplied by the editor, one stable Arrange menu,
// and Inspector. Arrange uses the stage keys' own selection commands (transform/commands.ts), with one undo gesture
// per action. Hints reflect working stage bindings: native tab-strip chords take precedence over the legacy
// front/back handlers' ⌥⌘ brackets, so those actions advertise no shortcut. Detach has no key binding.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): Inspector is a named glyph (G401), and
// a refused group, ungroup, detach or duplicate is told shortly, the model's reason its tooltip (G413). G401 is the
// deck's row: the design workbench, which no row cuts here, keeps the word (`inspectorWord`).
import { DropdownMenu } from 'radix-ui';
import { useSyncExternalStore, type ReactNode } from 'react';
import { NamedGlyph } from '../../../renderer/src/ui/glyph';
import { SidePanelIcon } from '../../ui/icons';
import type { SlideCanvas } from '../canvas';
import type { NewKind } from '../writers-elements';
import { DECK_COPY as C } from './copy';
import { InsertMenu } from './menus/Insert';
import type { ShowNotice, StartStatus } from './notice';
import type { DeckSession } from './session';
import { selectionCommands } from './transform/commands';
import { useDocVersion } from './transform/use-doc-version';

export interface ElementBarProps {
  session: DeckSession;
  slideId: string | null;
  canvas: SlideCanvas | null;
  scale: number;
  readOnly: boolean;
  onInsert: (kind: NewKind) => void;
  uploadAsset?: (file: File) => Promise<string>;
  onNotice: ShowNotice;
  /** A status that lasts while its operation runs (an image's upload). */
  onStatus: StartStatus;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  /** The Inspector toggle as its word, not the glyph (the design workbench: G401 cuts only the deck's). */
  inspectorWord?: boolean;
  /** Text style belongs between Insert and Arrange in both editors. */
  children?: ReactNode;
}

export function ElementBar({ session, slideId, canvas, scale, readOnly, onInsert, uploadAsset, onNotice, onStatus, inspectorOpen, onToggleInspector, inspectorWord = false, children }: ElementBarProps) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useDocVersion(session);
  const cmds = slideId && canvas?.slideId === slideId ? selectionCommands({ session, slideId, canvas, scale }, state.selection, readOnly) : null;
  const notice = (refused: string, reason: string | null) => reason && onNotice(refused, reason);
  const item = (label: string, enabled: boolean, run: () => void, shortcut?: string) => (
    <DropdownMenu.Item className="deck-menu-item" aria-label={label} disabled={!enabled} onSelect={run}>
      {label}
      {shortcut && <span className="deck-menu-shortcut" aria-hidden>{shortcut}</span>}
    </DropdownMenu.Item>
  );
  return (
    <div className="deck-element-bar" role="group" aria-label={C.arrange}>
      <InsertMenu session={session} disabled={readOnly || slideId === null} onInsert={onInsert} uploadAsset={uploadAsset} onNotice={onNotice} onStatus={onStatus} />
      {children}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="deck-button" aria-label={C.arrange}>{C.arrange} ▾</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="deck-menu" aria-label={C.arrange} align="start" sideOffset={4}>
            {item(C.bringToFront, cmds?.canZ ?? false, () => cmds?.z('front'))}
            {item(C.bringForward, cmds?.canZ ?? false, () => cmds?.z('forward'), '⌘]')}
            {item(C.sendBackward, cmds?.canZ ?? false, () => cmds?.z('backward'), '⌘[')}
            {item(C.sendToBack, cmds?.canZ ?? false, () => cmds?.z('back'))}
            <DropdownMenu.Separator className="deck-menu-separator" />
            {item(C.group, cmds?.canGroup ?? false, () => notice(C.refused.group, cmds?.group() ?? null), '⌘G')}
            {item(C.ungroup, cmds?.canUngroup ?? false, () => notice(C.refused.ungroup, cmds?.ungroup() ?? null), '⇧⌘G')}
            {item(C.detach, cmds?.canDetach ?? false, () => notice(C.refused.detach, cmds?.detach() ?? null))}
            <DropdownMenu.Separator className="deck-menu-separator" />
            {item(C.duplicateElements, cmds?.canEdit ?? false, () => notice(C.refused.duplicate, cmds?.duplicate() ?? null), '⌘D')}
            {item(C.deleteElements, cmds?.canEdit ?? false, () => cmds?.remove(), '⌫')}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {inspectorWord ? (
        <button type="button" className="deck-button" aria-label={C.inspector} aria-pressed={inspectorOpen} title={C.inspector} onClick={onToggleInspector}>
          {C.inspector}
        </button>
      ) : (
        <NamedGlyph label={C.inspector} pressed={inspectorOpen} className="deck-button deck-glyph" onClick={onToggleInspector}>
          <SidePanelIcon />
        </NamedGlyph>
      )}
    </div>
  );
}
