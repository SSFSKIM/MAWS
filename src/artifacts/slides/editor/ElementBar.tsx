// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer", "Insert"; M5): the toolbar's
// element controls: Insert, the selection's arrange commands (front, back, forward, backward on pinned elements; group,
// ungroup; Detach a flow child; duplicate; delete) and the inspector's toggle. Each arrange button is one gesture; the
// commands are the stage keys' own (transform/commands.ts).
import { useSyncExternalStore } from 'react';
import type { SlideCanvas } from '../canvas';
import type { NewKind } from '../writers-elements';
import { DECK_COPY as C } from './copy';
import { InsertMenu } from './menus/Insert';
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
  onNotice: (text: string) => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

export function ElementBar({ session, slideId, canvas, scale, readOnly, onInsert, uploadAsset, onNotice, inspectorOpen, onToggleInspector }: ElementBarProps) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useDocVersion(session); // the commands read the model: render again on its updates
  const cmds = slideId && canvas?.slideId === slideId ? selectionCommands({ session, slideId, canvas, scale }, state.selection, readOnly) : null;
  const notice = (reason: string | null) => reason && onNotice(reason);
  const button = (label: string, enabled: boolean, run: () => void, glyph: string) => (
    <button type="button" className="deck-button" aria-label={label} title={label} disabled={!enabled} onClick={run}>
      {glyph}
    </button>
  );
  return (
    <div className="deck-element-bar" role="group" aria-label={C.arrange}>
      <InsertMenu disabled={readOnly || slideId === null} onInsert={onInsert} uploadAsset={uploadAsset} onNotice={onNotice} />
      <span className="deck-toolbar-divider" aria-hidden />
      {button(C.bringToFront, cmds?.canZ ?? false, () => cmds?.z('front'), '⤒')}
      {button(C.bringForward, cmds?.canZ ?? false, () => cmds?.z('forward'), '↑')}
      {button(C.sendBackward, cmds?.canZ ?? false, () => cmds?.z('backward'), '↓')}
      {button(C.sendToBack, cmds?.canZ ?? false, () => cmds?.z('back'), '⤓')}
      <span className="deck-toolbar-divider" aria-hidden />
      {button(C.group, cmds?.canGroup ?? false, () => notice(cmds?.group() ?? null), '▣')}
      {button(C.ungroup, cmds?.canUngroup ?? false, () => notice(cmds?.ungroup() ?? null), '▢')}
      {button(C.detach, cmds?.canDetach ?? false, () => notice(cmds?.detach() ?? null), '⇱')}
      {button(C.duplicateElements, cmds?.canEdit ?? false, () => notice(cmds?.duplicate() ?? null), '⧉')}
      {button(C.deleteElements, cmds?.canEdit ?? false, () => cmds?.remove(), '⌫')}
      <span className="deck-toolbar-divider" aria-hidden />
      <button type="button" className="deck-button" aria-label={C.inspector} aria-pressed={inspectorOpen} title={C.inspector} onClick={onToggleInspector}>
        ☰
      </button>
    </div>
  );
}
