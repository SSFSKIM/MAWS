// View › Comments (P4-B1; the P4 spec §4.3, Docs' three states; settings version 15): Expand draws a document's open
// threads as cards in the margin, Minimize as icons at the anchors, Hide an empty margin. Per user, so the choice lives
// in the settings (`artifacts.commentsView`) and every open document follows it: the three View-menu actions and the
// editor's own toolbar menu both write it here. The settings store's state follows `settings.changed`.
import type { CommentsView } from '@artifacts/comments/view';
import { ipc } from '../../ipc/client';
import { registerAction } from '../../keymap/actions-runtime';

export async function setCommentsView(view: CommentsView): Promise<void> {
  const result = await ipc.invoke('settings.set', { artifacts: { commentsView: view } });
  if (!result.ok) console.error('[document] settings.set commentsView failed', result.error);
}

/** The View menu's three items; returns their removal. */
export function registerCommentsViewActions(): () => void {
  const offs = [registerAction('comments.expand', () => void setCommentsView('expand')), registerAction('comments.minimize', () => void setCommentsView('minimize')), registerAction('comments.hide', () => void setCommentsView('hide'))];
  return () => offs.forEach((off) => off());
}
