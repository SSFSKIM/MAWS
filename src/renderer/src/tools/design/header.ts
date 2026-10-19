// The design's X32 header (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the ledger's X32 row
// `{title, saved, unresolved, actions: [History, Comments, Export, Zoom to fit], exports: [png, pdf]}`), built from the
// tab's own state (X32's lifetime rule). The saved word is C's deck's (`savedOf`). M3 brings Zoom to fit (the tab's view,
// every board in it) and Theme (C's panel beside the world, the restyle of every board); M4 Version history and Comments
// (the rails beside the world) before them, in the order the row names; M5 the PNG and PDF exports (./exports.ts).
import type { DocumentState } from '@artifacts/host';
import type { DeckRail } from '@artifacts/slides/editor/session';
import type { EditorHostAction, EditorHostExport, EditorHostRegistration } from '../../panel/editor-host';
import { CommentsIcon, HistoryIcon } from '../document/icons';
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
  /** M4: version history is offered (the tab has the design's history). */
  history?: boolean;
  /** The history shows a version (or two compared) in place of the live world: Zoom to fit, the live world's, is disabled. */
  previewing?: boolean;
}

/** What the header's actions do, on the tab's own state. */
export interface DesignHeaderCommands {
  fitAll(): void;
  toggleRail(rail: DeckRail): void;
}

function designActions(state: DesignHeaderState, commands: DesignHeaderCommands): EditorHostAction[] {
  return [
    ...(state.history ? [{ id: 'history', label: 'Version history', icon: HistoryIcon, pressed: state.rail === 'history', onSelect: () => commands.toggleRail('history') }] : []), // M4
    { id: 'comments', label: 'Comments', icon: CommentsIcon, pressed: state.rail === 'comments', onSelect: () => commands.toggleRail('comments') }, // M4
    { id: 'zoom-to-fit', label: 'Zoom to fit', icon: ZoomToFitIcon, onSelect: () => commands.fitAll(), ...(state.previewing && { disabled: true }) },
    { id: 'theme', label: 'Theme', icon: ThemeIcon, pressed: state.rail === 'theme', onSelect: () => commands.toggleRail('theme') },
  ];
}

/** The registration; without `commands` (the design not open yet) no actions. */
export function designHeader(state: DesignHeaderState, commands?: DesignHeaderCommands): EditorHostRegistration {
  const { title, document, saving, closeGuard, exports, unresolved } = state;
  return { title, saved: savedOf(document, saving), closeGuard, ...(commands && { actions: designActions(state, commands) }), ...(exports && { exports }), ...(unresolved ? { unresolved } : {}) };
}
