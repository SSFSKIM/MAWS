// The deck's X32 header (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Shell"; G's editor host contract):
// what the header above the deck editor says, built from the tab's own state (X32's lifetime rule). The saved word is
// the replica's: saved when live with nothing left waiting, saving while edits have waited past the tab's delay for the
// host's acknowledgement, reconnecting while the port is down or the replica syncs again, read-only when the store is.
// The actions arrive with the milestones that bring them (Present, Comments, History, Theme, Check, Insert: M5 to M8)
// and the exports with M9; Mark up is the header's own, offered while the stage is registered as its surface.
import type { DocumentState } from '@artifacts/host';
import type { EditorHostRegistration, SavedState } from '../../panel/editor-host';

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
}

export function deckHeader({ title, document, saving, closeGuard }: DeckHeaderState): EditorHostRegistration {
  return { title, saved: savedOf(document, saving), closeGuard };
}
