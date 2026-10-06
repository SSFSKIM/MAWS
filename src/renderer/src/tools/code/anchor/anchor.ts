// The composer seam (E5 execution document, Interfaces *The comment gutter and the anchor seam*; P1 spec §3 C and X10):
// what a comment is about, as E5 produces it, and the one call that opens the comment composer for it. The composer is
// E3's (the shared component and its destination control); E3 registers it here and E5 never re-implements it. Until
// then the editor's placeholder sheet shows the anchor. No CodeMirror here: the seam is in the main chunk.
import type { AppSessionId } from '@shared/graph/ids';
import { showAnchor } from '../editor/EditorDialogs';

// X10's file-line anchor, as E5 produces it; E3 owns the full union and the composer.
export interface FileLineAnchor {
  kind: 'file-line';
  locator: string; // `<absolute path>#L<line>`
  label: string; // `<basename>:<line>`
  path: string;
  line: number; // 1-based
}

export type CommentComposerOpener = (anchor: FileLineAnchor, context: { appSessionId: AppSessionId }) => void;

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

export const fileLineAnchor = (path: string, line: number): FileLineAnchor => ({ kind: 'file-line', locator: `${path}#L${line}`, label: `${basename(path)}:${line}`, path, line });

// Registrations, the latest last; each its own record, so a disposer removes its own even when one opener is
// registered twice.
const registrations: { open: CommentComposerOpener }[] = [];

// E3's composer; later registrations win, and the disposer restores the one before.
export function registerCommentComposer(open: CommentComposerOpener): () => void {
  const registration = { open };
  registrations.push(registration);
  return () => {
    const at = registrations.indexOf(registration);
    if (at !== -1) registrations.splice(at, 1);
  };
}

// The registered composer, else the placeholder sheet naming the anchor.
export function openCommentComposer(anchor: FileLineAnchor, context: { appSessionId: AppSessionId }): void {
  const registration = registrations.at(-1);
  if (registration) registration.open(anchor, context);
  else showAnchor(anchor, context.appSessionId);
}
