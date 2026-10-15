// The deck's X32 header (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Shell"; G's editor host contract):
// what the header above the deck editor says, built from the tab's own state (X32's lifetime rule). The saved word is
// the replica's: saved when live with nothing left waiting, saving while edits have waited past the tab's delay for the
// host's acknowledgement, reconnecting while the port is down or the replica syncs again, read-only when the store is.
// The actions arrive with the milestones that bring them (Present, Comments, History, Theme, Check, Insert: M5 to M8)
// and the exports with M9; Mark up is the header's own, offered while the stage is registered as its surface.
// M6: Present (the audience window, D13), Theme and Check against the design system (panels beside the stage, D10),
// each driving the tab's own deck session, offered once the deck has opened.
// M7: Comments (the threads rail beside the stage, D9) after Present, and the deck's open threads as the header's count.
// M8: Version history (B's rail beside the stage, D11) after Comments, offered when the tab has the deck's history.
import type { DocumentState } from '@artifacts/host';
import type { DeckRail } from '@artifacts/slides/editor/session';
import type { EditorHostAction, EditorHostExport, EditorHostRegistration, SavedState } from '../../panel/editor-host';
import { CommentsIcon, HistoryIcon } from '../document/icons'; // M7: the document's, so both kinds' Comments look alike (M8: and History)
import { CheckIcon, PresentIcon, ThemeIcon } from './icons';

export function savedOf(document: DocumentState | null, saving: boolean): SavedState | null {
  if (!document) return null;
  if (document.readOnly) return 'readonly';
  if (document.phase !== 'live') return 'reconnecting';
  return saving ? 'saving' : 'saved';
}

export interface DeckHeaderState {
  title: string;
  document: DocumentState | null;
  saving: boolean;
  closeGuard(): Promise<boolean>;
  exports?: readonly EditorHostExport[]; // M9: the Export menu (exports.ts)
  rail: DeckRail | null; // M6: the panel open beside the stage
  canPresent: boolean; // M6: the deck has a slide to show
  unresolved?: number; // M7: open threads, orphans included (0 or absent: no count)
  history?: boolean; // M8: version history is offered
}

/** M6: what the header's actions do, on the tab's own state (X32's lifetime rule). */
export interface DeckHeaderCommands {
  present(): void;
  toggleRail(rail: DeckRail): void;
}

function deckActions(state: DeckHeaderState, commands: DeckHeaderCommands): EditorHostAction[] {
  return [
    { id: 'present', label: 'Present', icon: PresentIcon, disabled: !state.canPresent, onSelect: () => commands.present() },
    { id: 'comments', label: 'Comments', icon: CommentsIcon, pressed: state.rail === 'comments', onSelect: () => commands.toggleRail('comments') }, // M7
    ...(state.history ? [{ id: 'history', label: 'Version history', icon: HistoryIcon, pressed: state.rail === 'history', onSelect: () => commands.toggleRail('history') }] : []), // M8
    { id: 'theme', label: 'Theme', icon: ThemeIcon, pressed: state.rail === 'theme', onSelect: () => commands.toggleRail('theme') },
    { id: 'check', label: 'Check against the design system', icon: CheckIcon, pressed: state.rail === 'check', onSelect: () => commands.toggleRail('check') },
  ];
}

/** The registration; without `commands` (the deck not open yet) no actions. */
export function deckHeader(state: DeckHeaderState, commands?: DeckHeaderCommands): EditorHostRegistration {
  const { title, document, saving, closeGuard, exports, unresolved } = state;
  return { title, saved: savedOf(document, saving), closeGuard, ...(commands && { actions: deckActions(state, commands) }), ...(exports && { exports }), ...(unresolved ? { unresolved } : {}) /* M7 */ };
}
