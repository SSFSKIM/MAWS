// The Artifacts tab's sheets (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4), one at a time: an artifact's
// Rename and Delete, the design-system-in-use answer to a Delete, and the Spaces' New, Rename and Delete. Opening one
// replaces the one shown; the tab's `LibraryDialogs` draws it.
import { create } from 'zustand';
import type { LibrarySpace } from '@shared/ipc/schema/library';
import { toast } from '../stores/notices';

export interface ArtifactRef {
  id: string;
  title: string;
}

export type LibraryDialog =
  | { kind: 'rename'; artifact: ArtifactRef }
  | { kind: 'delete'; artifact: ArtifactRef }
  | { kind: 'inUse'; artifact: ArtifactRef; artifactIds: string[] } // a design system the listed artifacts still use
  | { kind: 'newSpace'; moveArtifact?: ArtifactRef } // "Move to Space › New Space…" moves the artifact into it
  | { kind: 'renameSpace'; space: LibrarySpace }
  | { kind: 'deleteSpace'; space: LibrarySpace };

export const useLibraryDialog = create<{ open: LibraryDialog | null }>()(() => ({ open: null }));

export const openLibraryDialog = (dialog: LibraryDialog): void => useLibraryDialog.setState({ open: dialog });

// A sheet settles only itself: its answer may arrive after the owner dismissed it and opened another, which stays. Each
// sheet is given the dialog it was opened as, and closes or replaces only that one.
export const closeLibraryDialog = (dialog: LibraryDialog): void => useLibraryDialog.setState((s) => (s.open === dialog ? { open: null } : s));
export const replaceLibraryDialog = (dialog: LibraryDialog, next: LibraryDialog): void => useLibraryDialog.setState((s) => (s.open === dialog ? { open: next } : s));
export type SheetOf<K extends LibraryDialog['kind']> = { dialog: Extract<LibraryDialog, { kind: K }> };

// A write the store refused, said where the owner is (the list itself changes only when main's index has the write).
export const toastFailure = (message: string): void => void toast({ level: 'warning', text: message, actions: [], dismissible: true });
