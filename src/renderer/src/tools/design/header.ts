// The design's X32 header (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the ledger's X32 row
// `{title, saved, unresolved, actions: [History, Comments, Export, Zoom to fit], exports: [png, pdf]}`), built from the
// tab's own state (X32's lifetime rule). The saved word is C's deck's (`savedOf`). M3 brings Zoom to fit (the tab's view,
// every board in it) and Theme (C's panel beside the world, the restyle of every board); Comments and Version history
// arrive with M4 and the PNG and PDF exports with M5, in the order the row names.
import type { DocumentState } from '@artifacts/host';
import type { DeckRail } from '@artifacts/slides/editor/session';
import type { EditorHostAction, EditorHostExport, EditorHostRegistration } from '../../panel/editor-host';
import { savedOf } from '../presentation/header';
import { ThemeIcon } from '../presentation/icons';
import { ZoomToFitIcon } from './icons';

export interface DesignHeaderState {
  title: string;
  document: DocumentState | null;
  saving: boolean;
  closeGuard(): Promise<boolean>;
  /** The panel open beside the world. */
  rail: DeckRail | null;
  /** Open threads, orphans included (M4; 0 or absent: no count). */
  unresolved?: number;
  /** The Export menu (M5). */
  exports?: readonly EditorHostExport[];
}

/** What the header's actions do, on the tab's own state. */
export interface DesignHeaderCommands {
  fitAll(): void;
  toggleRail(rail: DeckRail): void;
}

function designActions(state: DesignHeaderState, commands: DesignHeaderCommands): EditorHostAction[] {
  return [
    { id: 'zoom-to-fit', label: 'Zoom to fit', icon: ZoomToFitIcon, onSelect: () => commands.fitAll() },
    { id: 'theme', label: 'Theme', icon: ThemeIcon, pressed: state.rail === 'theme', onSelect: () => commands.toggleRail('theme') },
  ];
}

/** The registration; without `commands` (the design not open yet) no actions. */
export function designHeader(state: DesignHeaderState, commands?: DesignHeaderCommands): EditorHostRegistration {
  const { title, document, saving, closeGuard, exports, unresolved } = state;
  return { title, saved: savedOf(document, saving), closeGuard, ...(commands && { actions: designActions(state, commands) }), ...(exports && { exports }), ...(unresolved ? { unresolved } : {}) };
}
